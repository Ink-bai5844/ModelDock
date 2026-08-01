import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import type { EncryptedDocument } from "../core/crypto.js";
import type { AccountRecord, AccountStorage } from "./account-storage.js";

interface AccountIndex {
  version: 1;
  accounts: AccountRecord[];
}

interface CredentialRotationJournal {
  version: 1;
  account: AccountRecord;
  state: EncryptedDocument;
}

export class FileAccountStorage implements AccountStorage {
  private readonly accountsPath: string;
  private readonly usersPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {
    this.accountsPath = path.join(dataDirectory, "accounts.json");
    this.usersPath = path.join(dataDirectory, "users");
  }

  async initialize(): Promise<void> {
    await mkdir(this.usersPath, { recursive: true });
    try {
      await readFile(this.accountsPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.atomicWrite(this.accountsPath, { version: 1, accounts: [] } satisfies AccountIndex);
    }
    await this.recoverCredentialRotations();
  }

  async findByUsername(normalizedUsername: string): Promise<AccountRecord | null> {
    const index = await this.readIndex();
    return index.accounts.find((account) => account.normalizedUsername === normalizedUsername) ?? null;
  }

  async findById(id: string): Promise<AccountRecord | null> {
    const index = await this.readIndex();
    return index.accounts.find((account) => account.id === id) ?? null;
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const index = await this.readIndex();
    return [...index.accounts].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  async createAccount(account: AccountRecord, initialState: EncryptedDocument): Promise<void> {
    await this.serialized(async () => {
      const index = await this.readIndex();
      if (index.accounts.some((item) => item.normalizedUsername === account.normalizedUsername)) {
        throw new AppError(409, "USERNAME_TAKEN", "这个账号名称已经被使用。");
      }
      await mkdir(this.userDirectory(account.id), { recursive: true });
      await this.atomicWrite(this.statePath(account.id), initialState);
      await this.atomicWrite(this.accountsPath, {
        ...index,
        accounts: [...index.accounts, account],
      } satisfies AccountIndex);
    });
  }

  async readState(userId: string): Promise<EncryptedDocument> {
    return JSON.parse(await readFile(this.statePath(userId), "utf8")) as EncryptedDocument;
  }

  async updateCredentials(
    account: AccountRecord,
    reencryptedState: EncryptedDocument,
  ): Promise<void> {
    await this.serialized(async () => {
      const index = await this.readIndex();
      if (!index.accounts.some((item) => item.id === account.id)) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      await mkdir(this.userDirectory(account.id), { recursive: true });
      const journal = {
        version: 1,
        account,
        state: reencryptedState,
      } satisfies CredentialRotationJournal;
      await this.atomicWrite(this.rotationJournalPath(account.id), journal);
      await this.commitCredentialRotation(index, journal);
      await unlink(this.rotationJournalPath(account.id));
    });
  }

  async writeState(userId: string, state: EncryptedDocument): Promise<void> {
    await this.serialized(async () => {
      await mkdir(this.userDirectory(userId), { recursive: true });
      await this.atomicWrite(this.statePath(userId), state);
    });
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.serialized(async () => {
      const index = await this.readIndex();
      if (!index.accounts.some((account) => account.id === userId)) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      await this.atomicWrite(this.accountsPath, {
        ...index,
        accounts: index.accounts.filter((account) => account.id !== userId),
      } satisfies AccountIndex);
      await rm(this.userDirectory(userId), { recursive: true, force: true });
    });
  }

  private async readIndex(): Promise<AccountIndex> {
    return JSON.parse(await readFile(this.accountsPath, "utf8")) as AccountIndex;
  }

  private userDirectory(userId: string): string {
    return path.join(this.usersPath, userId);
  }

  private statePath(userId: string): string {
    return path.join(this.userDirectory(userId), "state.enc.json");
  }

  private rotationJournalPath(userId: string): string {
    return path.join(this.userDirectory(userId), "credential-rotation.pending.json");
  }

  private async recoverCredentialRotations(): Promise<void> {
    const entries = await readdir(this.usersPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const journalPath = this.rotationJournalPath(entry.name);
      let journal: CredentialRotationJournal;
      try {
        journal = JSON.parse(
          await readFile(journalPath, "utf8"),
        ) as CredentialRotationJournal;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (
        journal.version !== 1 ||
        journal.account?.id !== entry.name ||
        journal.state?.algorithm !== "aes-256-gcm"
      ) {
        throw new Error(`Invalid credential rotation journal: ${entry.name}`);
      }
      await this.commitCredentialRotation(await this.readIndex(), journal);
      await unlink(journalPath);
    }
  }

  private async commitCredentialRotation(
    index: AccountIndex,
    journal: CredentialRotationJournal,
  ): Promise<void> {
    const accountIndex = index.accounts.findIndex(
      (item) => item.id === journal.account.id,
    );
    if (accountIndex < 0) {
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
    }
    const accounts = [...index.accounts];
    accounts[accountIndex] = journal.account;
    await this.atomicWrite(this.statePath(journal.account.id), journal.state);
    await this.atomicWrite(this.accountsPath, {
      ...index,
      accounts,
    } satisfies AccountIndex);
  }

  private async atomicWrite(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
