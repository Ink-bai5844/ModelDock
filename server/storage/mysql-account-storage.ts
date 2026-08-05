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
import {
  DEFAULT_WORKSPACE_QUOTA_BYTES,
  normalizeWorkspaceQuotaBytes,
  type AccountRecord,
  type AccountStorage,
  type EncryptedAccountStateBundle,
  type EncryptedConversationState,
  type EncryptedMessageState,
  type EncryptedStatePart,
} from "./account-storage.js";

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
  workspace_quota_bytes: number | string;
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

interface StateHashRow extends RowDataPacket {
  content_hash: Buffer | null;
}

interface ConversationRow extends RowDataPacket {
  conversation_id: string;
  ordinal: number;
  content_hash: Buffer;
  document_version: number;
  algorithm: string;
  iv: Buffer;
  auth_tag: Buffer;
  ciphertext: Buffer;
}

interface MessageRow extends RowDataPacket {
  conversation_id: string;
  message_id: string;
  ordinal: number;
  content_hash: Buffer;
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

interface ColumnCountRow extends RowDataPacket {
  count: number;
}

const ACCOUNT_COLUMNS = `
  id,
  username,
  normalized_username,
  password_algorithm,
  password_salt,
  password_hash,
  vault_salt,
  workspace_quota_bytes,
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
          workspace_quota_bytes BIGINT UNSIGNED NOT NULL DEFAULT 104857600,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_modeldock_accounts_normalized_username (normalized_username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await this.ensureWorkspaceQuotaColumn();
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
      await this.ensureStateContentHashColumn();
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS modeldock_conversations (
          account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          conversation_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
          ordinal INT UNSIGNED NOT NULL,
          revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
          content_hash BINARY(32) NOT NULL,
          document_version SMALLINT UNSIGNED NOT NULL,
          algorithm VARCHAR(32) CHARACTER SET ascii NOT NULL,
          iv VARBINARY(32) NOT NULL,
          auth_tag VARBINARY(32) NOT NULL,
          ciphertext LONGBLOB NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (account_id, conversation_id),
          KEY ix_modeldock_conversations_order (account_id, ordinal),
          CONSTRAINT fk_modeldock_conversations_account
            FOREIGN KEY (account_id) REFERENCES modeldock_accounts(id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS modeldock_messages (
          account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          conversation_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
          message_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
          ordinal INT UNSIGNED NOT NULL,
          revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
          content_hash BINARY(32) NOT NULL,
          document_version SMALLINT UNSIGNED NOT NULL,
          algorithm VARCHAR(32) CHARACTER SET ascii NOT NULL,
          iv VARBINARY(32) NOT NULL,
          auth_tag VARBINARY(32) NOT NULL,
          ciphertext LONGBLOB NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (account_id, conversation_id, message_id),
          KEY ix_modeldock_messages_order (account_id, conversation_id, ordinal),
          CONSTRAINT fk_modeldock_messages_conversation
            FOREIGN KEY (account_id, conversation_id)
            REFERENCES modeldock_conversations(account_id, conversation_id)
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

  async readStateBundle(userId: string): Promise<{
    root: EncryptedDocument;
    conversations: EncryptedConversationState[];
  }> {
    try {
      const [conversationRows, messageRows] = await Promise.all([
        this.pool.execute<ConversationRow[]>(
          `SELECT conversation_id, ordinal, content_hash, document_version,
                  algorithm, iv, auth_tag, ciphertext
           FROM modeldock_conversations
           WHERE account_id = ?
           ORDER BY ordinal ASC`,
          [userId],
        ),
        this.pool.execute<MessageRow[]>(
          `SELECT conversation_id, message_id, ordinal, content_hash,
                  document_version, algorithm, iv, auth_tag, ciphertext
           FROM modeldock_messages
           WHERE account_id = ?
           ORDER BY conversation_id ASC, ordinal ASC`,
          [userId],
        ),
      ]);
      const messages = new Map<string, EncryptedMessageState[]>();
      for (const row of messageRows[0]) {
        const current = messages.get(row.conversation_id) ?? [];
        current.push({
          id: row.message_id,
          ordinal: row.ordinal,
          payload: this.partFromRow(row),
        });
        messages.set(row.conversation_id, current);
      }
      return {
        root: await this.readState(userId),
        conversations: conversationRows[0].map((row) => ({
          id: row.conversation_id,
          ordinal: row.ordinal,
          payload: this.partFromRow(row),
          messages: messages.get(row.conversation_id) ?? [],
        })),
      };
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

  async updateCredentialsBundle(
    account: AccountRecord,
    bundle: EncryptedAccountStateBundle,
  ): Promise<void> {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      const [accountResult] = await connection.execute<ResultSetHeader>(
        `UPDATE modeldock_accounts
         SET password_algorithm = ?, password_salt = ?, password_hash = ?,
             vault_salt = ?, updated_at = ?
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
      if (accountResult.affectedRows !== 1) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      await this.writeStateBundleWithConnection(connection, account.id, bundle);
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

  async writeStateBundle(
    userId: string,
    bundle: EncryptedAccountStateBundle,
  ): Promise<void> {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      await this.writeStateBundleWithConnection(connection, userId, bundle);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error instanceof AppError ? error : this.asStorageError(error);
    } finally {
      connection.release();
    }
  }

  async updateWorkspaceQuota(
    userId: string,
    quotaBytes: number,
  ): Promise<AccountRecord> {
    try {
      const now = new Date();
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE modeldock_accounts
         SET workspace_quota_bytes = ?, updated_at = ?
         WHERE id = ?`,
        [quotaBytes, now, userId],
      );
      if (result.affectedRows !== 1) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      const account = await this.findById(userId);
      if (!account) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      return account;
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
         workspace_quota_bytes,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id,
        account.username,
        account.normalizedUsername,
        account.password.algorithm,
        decodeBase64(account.password.salt, "password salt", 16),
        decodeBase64(account.password.hash, "password hash", 32),
        decodeBase64(account.vaultSalt, "vault salt", 16),
        normalizeWorkspaceQuotaBytes(account.workspaceQuotaBytes),
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
        !isDeepStrictEqual(this.accountFromRow(accountRows[0]), {
          ...record.account,
          workspaceQuotaBytes: normalizeWorkspaceQuotaBytes(
            record.account.workspaceQuotaBytes,
          ),
        }) ||
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
      workspaceQuotaBytes: normalizeWorkspaceQuotaBytes(
        Number(row.workspace_quota_bytes),
      ),
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

  private partFromRow(row: {
    content_hash: Buffer;
    document_version: number;
    algorithm: string;
    iv: Buffer;
    auth_tag: Buffer;
    ciphertext: Buffer;
  }): EncryptedStatePart {
    return {
      fingerprint: row.content_hash.toString("base64"),
      document: {
        version: row.document_version as EncryptedDocument["version"],
        algorithm: row.algorithm as EncryptedDocument["algorithm"],
        iv: row.iv.toString("base64"),
        tag: row.auth_tag.toString("base64"),
        ciphertext: row.ciphertext.toString("base64"),
      },
    };
  }

  private async writeStateBundleWithConnection(
    connection: PoolConnection,
    userId: string,
    bundle: EncryptedAccountStateBundle,
  ): Promise<void> {
    const [stateRows] = await connection.execute<StateHashRow[]>(
      `SELECT content_hash
       FROM modeldock_account_states
       WHERE account_id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId],
    );
    if (!stateRows[0]) {
      throw new AppError(500, "ACCOUNT_STATE_MISSING", "账号状态数据不存在。");
    }
    if (!this.hashMatches(stateRows[0].content_hash, bundle.root.fingerprint)) {
      const document = bundle.root.document;
      await connection.execute<ResultSetHeader>(
        `UPDATE modeldock_account_states
         SET revision = revision + 1,
             content_hash = ?,
             document_version = ?,
             algorithm = ?,
             iv = ?,
             auth_tag = ?,
             ciphertext = ?,
             updated_at = UTC_TIMESTAMP(3)
         WHERE account_id = ?`,
        [
          decodeBase64(bundle.root.fingerprint, "state fingerprint", 32),
          document.version,
          document.algorithm,
          decodeBase64(document.iv, "iv", 12),
          decodeBase64(document.tag, "tag", 16),
          decodeBase64(document.ciphertext, "ciphertext"),
          userId,
        ],
      );
    }

    const [conversationRows] = await connection.execute<ConversationRow[]>(
      `SELECT conversation_id, ordinal, content_hash, document_version,
              algorithm, iv, auth_tag, ciphertext
       FROM modeldock_conversations
       WHERE account_id = ?
       FOR UPDATE`,
      [userId],
    );
    const [messageRows] = await connection.execute<MessageRow[]>(
      `SELECT conversation_id, message_id, ordinal, content_hash,
              document_version, algorithm, iv, auth_tag, ciphertext
       FROM modeldock_messages
       WHERE account_id = ?
       FOR UPDATE`,
      [userId],
    );
    const existingConversations = new Map(
      conversationRows.map((row) => [row.conversation_id, row]),
    );
    const existingMessages = new Map(
      messageRows.map((row) => [`${row.conversation_id}\0${row.message_id}`, row]),
    );
    const expectedConversations = new Set(bundle.conversations.map((item) => item.id));
    const expectedMessages = new Set<string>();

    for (const conversation of bundle.conversations) {
      const existing = existingConversations.get(conversation.id);
      const document = conversation.payload.document;
      if (!existing) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO modeldock_conversations (
             account_id, conversation_id, ordinal, revision, content_hash,
             document_version, algorithm, iv, auth_tag, ciphertext, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [
            userId,
            conversation.id,
            conversation.ordinal,
            decodeBase64(conversation.payload.fingerprint, "conversation fingerprint", 32),
            document.version,
            document.algorithm,
            decodeBase64(document.iv, "iv", 12),
            decodeBase64(document.tag, "tag", 16),
            decodeBase64(document.ciphertext, "ciphertext"),
          ],
        );
      } else if (
        existing.ordinal !== conversation.ordinal ||
        !this.hashMatches(existing.content_hash, conversation.payload.fingerprint)
      ) {
        await connection.execute<ResultSetHeader>(
          `UPDATE modeldock_conversations
           SET ordinal = ?, revision = revision + 1, content_hash = ?,
               document_version = ?, algorithm = ?, iv = ?, auth_tag = ?,
               ciphertext = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE account_id = ? AND conversation_id = ?`,
          [
            conversation.ordinal,
            decodeBase64(conversation.payload.fingerprint, "conversation fingerprint", 32),
            document.version,
            document.algorithm,
            decodeBase64(document.iv, "iv", 12),
            decodeBase64(document.tag, "tag", 16),
            decodeBase64(document.ciphertext, "ciphertext"),
            userId,
            conversation.id,
          ],
        );
      }

      for (const message of conversation.messages) {
        const key = `${conversation.id}\0${message.id}`;
        expectedMessages.add(key);
        const existingMessage = existingMessages.get(key);
        const messageDocument = message.payload.document;
        if (!existingMessage) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO modeldock_messages (
               account_id, conversation_id, message_id, ordinal, revision,
               content_hash, document_version, algorithm, iv, auth_tag,
               ciphertext, updated_at
             ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
            [
              userId,
              conversation.id,
              message.id,
              message.ordinal,
              decodeBase64(message.payload.fingerprint, "message fingerprint", 32),
              messageDocument.version,
              messageDocument.algorithm,
              decodeBase64(messageDocument.iv, "iv", 12),
              decodeBase64(messageDocument.tag, "tag", 16),
              decodeBase64(messageDocument.ciphertext, "ciphertext"),
            ],
          );
        } else if (
          existingMessage.ordinal !== message.ordinal ||
          !this.hashMatches(existingMessage.content_hash, message.payload.fingerprint)
        ) {
          await connection.execute<ResultSetHeader>(
            `UPDATE modeldock_messages
             SET ordinal = ?, revision = revision + 1, content_hash = ?,
                 document_version = ?, algorithm = ?, iv = ?, auth_tag = ?,
                 ciphertext = ?, updated_at = UTC_TIMESTAMP(3)
             WHERE account_id = ? AND conversation_id = ? AND message_id = ?`,
            [
              message.ordinal,
              decodeBase64(message.payload.fingerprint, "message fingerprint", 32),
              messageDocument.version,
              messageDocument.algorithm,
              decodeBase64(messageDocument.iv, "iv", 12),
              decodeBase64(messageDocument.tag, "tag", 16),
              decodeBase64(messageDocument.ciphertext, "ciphertext"),
              userId,
              conversation.id,
              message.id,
            ],
          );
        }
      }
    }

    for (const [conversationId] of existingConversations) {
      if (expectedConversations.has(conversationId)) continue;
      await connection.execute<ResultSetHeader>(
        `DELETE FROM modeldock_conversations
         WHERE account_id = ? AND conversation_id = ?`,
        [userId, conversationId],
      );
    }
    for (const [key, message] of existingMessages) {
      if (
        !expectedConversations.has(message.conversation_id) ||
        expectedMessages.has(key)
      ) continue;
      await connection.execute<ResultSetHeader>(
        `DELETE FROM modeldock_messages
         WHERE account_id = ? AND conversation_id = ? AND message_id = ?`,
        [userId, message.conversation_id, message.message_id],
      );
    }
  }

  private hashMatches(current: Buffer | null, fingerprint: string): boolean {
    return Boolean(
      current &&
        current.equals(decodeBase64(fingerprint, "content fingerprint", 32)),
    );
  }

  private async getConnection(): Promise<PoolConnection> {
    try {
      return await this.pool.getConnection();
    } catch {
      throw new StorageUnavailableError();
    }
  }

  private async ensureWorkspaceQuotaColumn(): Promise<void> {
    const [rows] = await this.pool.query<ColumnCountRow[]>(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'modeldock_accounts'
         AND column_name = 'workspace_quota_bytes'`,
    );
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await this.pool.query(
      `ALTER TABLE modeldock_accounts
       ADD COLUMN workspace_quota_bytes BIGINT UNSIGNED NOT NULL
       DEFAULT ${DEFAULT_WORKSPACE_QUOTA_BYTES}
       AFTER vault_salt`,
    );
  }

  private async ensureStateContentHashColumn(): Promise<void> {
    const [rows] = await this.pool.query<ColumnCountRow[]>(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'modeldock_account_states'
         AND column_name = 'content_hash'`,
    );
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await this.pool.query(
      `ALTER TABLE modeldock_account_states
       ADD COLUMN content_hash BINARY(32) NULL
       AFTER revision`,
    );
  }

  private mysqlCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object" || !("code" in error)) return undefined;
    return typeof error.code === "string" ? error.code : undefined;
  }

  private asStorageError(_error: unknown): StorageUnavailableError {
    return new StorageUnavailableError();
  }
}
