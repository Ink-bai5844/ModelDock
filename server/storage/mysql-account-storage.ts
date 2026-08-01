import { isDeepStrictEqual } from "node:util";
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { decodeBase64 } from "../core/base64.js";
import { AppError, StorageUnavailableError } from "../core/errors.js";
import type { EncryptedDocument } from "../core/crypto.js";
import type { AccountRecord, AccountStorage } from "./account-storage.js";

export interface MySqlAccountStorageOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit?: number;
}

export interface AccountImportRecord {
  account: AccountRecord;
  state: EncryptedDocument;
}

export interface AccountImportResult {
  mode: "dry-run" | "applied" | "already-applied";
  accountCount: number;
  ciphertextBytes: number;
  sourceManifest: string;
}

interface AccountRow extends RowDataPacket {
  id: string;
  username: string;
  normalized_username: string;
  password_algorithm: string;
  password_salt: Buffer;
  password_hash: Buffer;
  vault_salt: Buffer;
  created_at: Date;
  updated_at: Date;
}

interface StateRow extends RowDataPacket {
  account_id: string;
  document_version: number;
  algorithm: string;
  iv: Buffer;
  auth_tag: Buffer;
  ciphertext: Buffer;
}

interface CountRow extends RowDataPacket {
  count: number;
}

interface ManifestRow extends RowDataPacket {
  source_manifest: string;
}

const ACCOUNT_COLUMNS = `
  id,
  username,
  normalized_username,
  password_algorithm,
  password_salt,
  password_hash,
  vault_salt,
  created_at,
  updated_at
`;

const STATE_COLUMNS = `
  account_id,
  document_version,
  algorithm,
  iv,
  auth_tag,
  ciphertext
`;

export class MySqlAccountStorage implements AccountStorage {
  private readonly pool: Pool;

  constructor(options: MySqlAccountStorageOptions) {
    this.pool = mysql.createPool({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      charset: "utf8mb4",
      timezone: "Z",
      waitForConnections: true,
      connectionLimit: options.connectionLimit ?? 5,
      maxIdle: options.connectionLimit ?? 5,
      idleTimeout: 60_000,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 10_000,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS modeldock_accounts (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          username VARCHAR(32) CHARACTER SET utf8mb4 NOT NULL,
          normalized_username VARCHAR(128)
            CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
          password_algorithm VARCHAR(32) CHARACTER SET ascii NOT NULL,
          password_salt VARBINARY(64) NOT NULL,
          password_hash VARBINARY(64) NOT NULL,
          vault_salt VARBINARY(64) NOT NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_modeldock_accounts_normalized_username (normalized_username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS modeldock_account_states (
          account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
          document_version SMALLINT UNSIGNED NOT NULL,
          algorithm VARCHAR(32) CHARACTER SET ascii NOT NULL,
          iv VARBINARY(32) NOT NULL,
          auth_tag VARBINARY(32) NOT NULL,
          ciphertext LONGBLOB NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (account_id),
          CONSTRAINT fk_modeldock_states_account
            FOREIGN KEY (account_id) REFERENCES modeldock_accounts(id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS modeldock_data_migrations (
          source_manifest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          account_count INT UNSIGNED NOT NULL,
          ciphertext_bytes BIGINT UNSIGNED NOT NULL,
          applied_at DATETIME(3) NOT NULL,
          PRIMARY KEY (source_manifest)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (error) {
      throw this.asStorageError(error);
    }
  }

  async findByUsername(normalizedUsername: string): Promise<AccountRecord | null> {
    try {
      const [rows] = await this.pool.execute<AccountRow[]>(
        `SELECT ${ACCOUNT_COLUMNS}
         FROM modeldock_accounts
         WHERE normalized_username = ?
         LIMIT 1`,
        [normalizedUsername],
      );
      return rows[0] ? this.accountFromRow(rows[0]) : null;
    } catch (error) {
      throw this.asStorageError(error);
    }
  }

  async findById(id: string): Promise<AccountRecord | null> {
    try {
      const [rows] = await this.pool.execute<AccountRow[]>(
        `SELECT ${ACCOUNT_COLUMNS}
         FROM modeldock_accounts
         WHERE id = ?
         LIMIT 1`,
        [id],
      );
      return rows[0] ? this.accountFromRow(rows[0]) : null;
    } catch (error) {
      throw this.asStorageError(error);
    }
  }

  async listAccounts(): Promise<AccountRecord[]> {
    try {
      const [rows] = await this.pool.query<AccountRow[]>(
        `SELECT ${ACCOUNT_COLUMNS}
         FROM modeldock_accounts
         ORDER BY created_at ASC, username ASC`,
      );
      return rows.map((row) => this.accountFromRow(row));
    } catch (error) {
      throw this.asStorageError(error);
    }
  }

  async createAccount(
    account: AccountRecord,
    initialState: EncryptedDocument,
  ): Promise<void> {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      await this.insertAccount(connection, account);
      await this.insertState(connection, account.id, initialState);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (this.mysqlCode(error) === "ER_DUP_ENTRY") {
        throw new AppError(409, "USERNAME_TAKEN", "这个账号名称已经被使用。");
      }
      throw this.asStorageError(error);
    } finally {
      connection.release();
    }
  }

  async readState(userId: string): Promise<EncryptedDocument> {
    try {
      const [rows] = await this.pool.execute<StateRow[]>(
        `SELECT ${STATE_COLUMNS}
         FROM modeldock_account_states
         WHERE account_id = ?
         LIMIT 1`,
        [userId],
      );
      if (!rows[0]) {
        throw new AppError(
          500,
          "ACCOUNT_STATE_MISSING",
          "账号的加密状态数据不存在。",
        );
      }
      return this.stateFromRow(rows[0]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.asStorageError(error);
    }
  }

  async updateCredentials(
    account: AccountRecord,
    reencryptedState: EncryptedDocument,
  ): Promise<void> {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      const [accountResult] = await connection.execute<ResultSetHeader>(
        `UPDATE modeldock_accounts
         SET password_algorithm = ?,
             password_salt = ?,
             password_hash = ?,
             vault_salt = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          account.password.algorithm,
          decodeBase64(account.password.salt, "password salt", 16),
          decodeBase64(account.password.hash, "password hash", 32),
          decodeBase64(account.vaultSalt, "vault salt", 16),
          new Date(account.updatedAt),
          account.id,
        ],
      );
      const [stateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE modeldock_account_states
         SET revision = revision + 1,
             document_version = ?,
             algorithm = ?,
             iv = ?,
             auth_tag = ?,
             ciphertext = ?,
             updated_at = UTC_TIMESTAMP(3)
         WHERE account_id = ?`,
        [
          reencryptedState.version,
          reencryptedState.algorithm,
          decodeBase64(reencryptedState.iv, "iv", 12),
          decodeBase64(reencryptedState.tag, "tag", 16),
          decodeBase64(reencryptedState.ciphertext, "ciphertext"),
          account.id,
        ],
      );
      if (accountResult.affectedRows !== 1 || stateResult.affectedRows !== 1) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error instanceof AppError ? error : this.asStorageError(error);
    } finally {
      connection.release();
    }
  }

  async writeState(userId: string, state: EncryptedDocument): Promise<void> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE modeldock_account_states
         SET revision = revision + 1,
             document_version = ?,
             algorithm = ?,
             iv = ?,
             auth_tag = ?,
             ciphertext = ?,
             updated_at = UTC_TIMESTAMP(3)
         WHERE account_id = ?`,
        [
          state.version,
          state.algorithm,
          decodeBase64(state.iv, "iv", 12),
          decodeBase64(state.tag, "tag", 16),
          decodeBase64(state.ciphertext, "ciphertext"),
          userId,
        ],
      );
      if (result.affectedRows !== 1) {
        throw new AppError(
          500,
          "ACCOUNT_STATE_MISSING",
          "账号的加密状态数据不存在。",
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.asStorageError(error);
    }
  }

  async deleteAccount(userId: string): Promise<void> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `DELETE FROM modeldock_accounts
         WHERE id = ?`,
        [userId],
      );
      if (result.affectedRows !== 1) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.asStorageError(error);
    }
  }

  async importAccounts(
    records: readonly AccountImportRecord[],
    sourceManifest: string,
    dryRun: boolean,
  ): Promise<AccountImportResult> {
    const connection = await this.getConnection();
    const ciphertextBytes = records.reduce(
      (sum, record) =>
        sum + decodeBase64(record.state.ciphertext, "ciphertext").byteLength,
      0,
    );
    try {
      await connection.beginTransaction();
      const [manifestRows] = await connection.execute<ManifestRow[]>(
        `SELECT source_manifest
         FROM modeldock_data_migrations
         WHERE source_manifest = ?
         LIMIT 1
         FOR UPDATE`,
        [sourceManifest],
      );
      if (manifestRows[0]) {
        await this.verifyRecords(connection, records);
        await connection.rollback();
        return {
          mode: "already-applied",
          accountCount: records.length,
          ciphertextBytes,
          sourceManifest,
        };
      }

      const [countRows] = await connection.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM modeldock_accounts",
      );
      const existingCount = Number(countRows[0]?.count ?? 0);
      if (existingCount > 0) {
        if (existingCount !== records.length) {
          throw new AppError(
            409,
            "MIGRATION_CONFLICT",
            `Migration target contains ${existingCount} accounts; expected an empty database or ${records.length} identical accounts.`,
          );
        }
        await this.verifyRecords(connection, records);
      } else {
        for (const record of records) {
          await this.insertAccount(connection, record.account);
          await this.insertState(connection, record.account.id, record.state);
        }
        await this.verifyRecords(connection, records);
      }

      await connection.execute<ResultSetHeader>(
        `INSERT INTO modeldock_data_migrations (
           source_manifest,
           account_count,
           ciphertext_bytes,
           applied_at
         ) VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
        [sourceManifest, records.length, ciphertextBytes],
      );

      if (dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }
      return {
        mode: dryRun ? "dry-run" : "applied",
        accountCount: records.length,
        ciphertextBytes,
        sourceManifest,
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error instanceof AppError ? error : this.asStorageError(error);
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async insertAccount(
    connection: PoolConnection,
    account: AccountRecord,
  ): Promise<void> {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO modeldock_accounts (
         id,
         username,
         normalized_username,
         password_algorithm,
         password_salt,
         password_hash,
         vault_salt,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id,
        account.username,
        account.normalizedUsername,
        account.password.algorithm,
        decodeBase64(account.password.salt, "password salt", 16),
        decodeBase64(account.password.hash, "password hash", 32),
        decodeBase64(account.vaultSalt, "vault salt", 16),
        new Date(account.createdAt),
        new Date(account.updatedAt),
      ],
    );
  }

  private async insertState(
    connection: PoolConnection,
    accountId: string,
    state: EncryptedDocument,
  ): Promise<void> {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO modeldock_account_states (
         account_id,
         revision,
         document_version,
         algorithm,
         iv,
         auth_tag,
         ciphertext,
         updated_at
       ) VALUES (?, 1, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        accountId,
        state.version,
        state.algorithm,
        decodeBase64(state.iv, "iv", 12),
        decodeBase64(state.tag, "tag", 16),
        decodeBase64(state.ciphertext, "ciphertext"),
      ],
    );
  }

  private async verifyRecords(
    connection: PoolConnection,
    records: readonly AccountImportRecord[],
  ): Promise<void> {
    for (const record of records) {
      const [accountRows] = await connection.execute<AccountRow[]>(
        `SELECT ${ACCOUNT_COLUMNS}
         FROM modeldock_accounts
         WHERE id = ? AND normalized_username = ?
         LIMIT 1`,
        [record.account.id, record.account.normalizedUsername],
      );
      const [stateRows] = await connection.execute<StateRow[]>(
        `SELECT ${STATE_COLUMNS}
         FROM modeldock_account_states
         WHERE account_id = ?
         LIMIT 1`,
        [record.account.id],
      );
      if (!accountRows[0] || !stateRows[0]) {
        throw new AppError(
          409,
          "MIGRATION_CONFLICT",
          `Account import is incomplete: ${record.account.id}`,
        );
      }
      if (
        !isDeepStrictEqual(this.accountFromRow(accountRows[0]), record.account) ||
        !isDeepStrictEqual(this.stateFromRow(stateRows[0]), record.state)
      ) {
        throw new AppError(
          409,
          "MIGRATION_CONFLICT",
          `Migration conflict for account: ${record.account.id}`,
        );
      }
    }
  }

  private accountFromRow(row: AccountRow): AccountRecord {
    return {
      id: row.id,
      username: row.username,
      normalizedUsername: row.normalized_username,
      password: {
        algorithm: row.password_algorithm as AccountRecord["password"]["algorithm"],
        salt: row.password_salt.toString("base64"),
        hash: row.password_hash.toString("base64"),
      },
      vaultSalt: row.vault_salt.toString("base64"),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private stateFromRow(row: StateRow): EncryptedDocument {
    return {
      version: row.document_version as EncryptedDocument["version"],
      algorithm: row.algorithm as EncryptedDocument["algorithm"],
      iv: row.iv.toString("base64"),
      tag: row.auth_tag.toString("base64"),
      ciphertext: row.ciphertext.toString("base64"),
    };
  }

  private async getConnection(): Promise<PoolConnection> {
    try {
      return await this.pool.getConnection();
    } catch {
      throw new StorageUnavailableError();
    }
  }

  private mysqlCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object" || !("code" in error)) return undefined;
    return typeof error.code === "string" ? error.code : undefined;
  }

  private asStorageError(_error: unknown): StorageUnavailableError {
    return new StorageUnavailableError();
  }
}
