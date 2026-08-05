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
import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import type { EncryptedDocument } from "../core/crypto.js";
import type {
  AccountRecord,
  AccountStorage,
  EncryptedAccountStateBundle,
  EncryptedConversationState,
  EncryptedMessageState,
} from "./account-storage.js";

interface AccountIndex {
  version: 1;
  accounts: AccountRecord[];
}

interface LegacyCredentialRotationJournal {
  version: 1;
  account: AccountRecord;
  state: EncryptedDocument;
}

interface CredentialRotationJournal {
  version: 2;
  account: AccountRecord;
  bundle: EncryptedAccountStateBundle;
}

interface StoredFingerprint {
  version: 1;
  fingerprint: string;
}

interface StoredConversation extends EncryptedConversationState {
  version: 1;
}

interface StoredMessage extends EncryptedMessageState {
  version: 1;
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

  async readStateBundle(userId: string): Promise<{
    root: EncryptedDocument;
    conversations: EncryptedConversationState[];
  }> {
    const root = await this.readState(userId);
    const conversations: EncryptedConversationState[] = [];
    const entries = await readdir(this.conversationsDirectory(userId), {
      withFileTypes: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.conversationsDirectory(userId), entry.name);
      const stored = await this.readJson<StoredConversation>(
        path.join(directory, "conversation.enc.json"),
      );
      if (!stored || stored.version !== 1) continue;
      const messageEntries = await readdir(path.join(directory, "messages"), {
        withFileTypes: true,
      }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      const messages: EncryptedMessageState[] = [];
      for (const messageEntry of messageEntries) {
        if (!messageEntry.isFile() || !messageEntry.name.endsWith(".enc.json")) continue;
        const message = await this.readJson<StoredMessage>(
          path.join(directory, "messages", messageEntry.name),
        );
        if (message?.version === 1) messages.push(message);
      }
      conversations.push({
        id: stored.id,
        ordinal: stored.ordinal,
        payload: stored.payload,
        messages: messages.sort((left, right) => left.ordinal - right.ordinal),
      });
    }
    return {
      root,
      conversations: conversations.sort((left, right) => left.ordinal - right.ordinal),
    };
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
      } satisfies LegacyCredentialRotationJournal;
      await this.atomicWrite(this.rotationJournalPath(account.id), journal);
      await this.commitCredentialRotation(index, journal);
      await unlink(this.rotationJournalPath(account.id));
    });
  }

  async updateCredentialsBundle(
    account: AccountRecord,
    bundle: EncryptedAccountStateBundle,
  ): Promise<void> {
    await this.serialized(async () => {
      const index = await this.readIndex();
      if (!index.accounts.some((item) => item.id === account.id)) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      await mkdir(this.userDirectory(account.id), { recursive: true });
      const journal = {
        version: 2,
        account,
        bundle,
      } satisfies CredentialRotationJournal;
      await this.atomicWrite(this.rotationJournalPath(account.id), journal);
      await this.commitCredentialRotationBundle(index, journal);
      await unlink(this.rotationJournalPath(account.id));
    });
  }

  async writeState(userId: string, state: EncryptedDocument): Promise<void> {
    await this.serialized(async () => {
      await mkdir(this.userDirectory(userId), { recursive: true });
      await this.atomicWrite(this.statePath(userId), state);
    });
  }

  async writeStateBundle(
    userId: string,
    bundle: EncryptedAccountStateBundle,
  ): Promise<void> {
    await this.serialized(async () => {
      await mkdir(this.userDirectory(userId), { recursive: true });
      await this.commitStateBundle(userId, bundle);
    });
  }

  async updateWorkspaceQuota(
    userId: string,
    quotaBytes: number,
  ): Promise<AccountRecord> {
    return this.serialized(async () => {
      const index = await this.readIndex();
      const accountIndex = index.accounts.findIndex(
        (account) => account.id === userId,
      );
      if (accountIndex < 0) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
      }
      const accounts = [...index.accounts];
      const account = {
        ...accounts[accountIndex],
        workspaceQuotaBytes: quotaBytes,
        updatedAt: new Date().toISOString(),
      };
      accounts[accountIndex] = account;
      await this.atomicWrite(this.accountsPath, { ...index, accounts } satisfies AccountIndex);
      return account;
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

  private stateFingerprintPath(userId: string): string {
    return path.join(this.userDirectory(userId), "state.fingerprint.json");
  }

  private conversationsDirectory(userId: string): string {
    return path.join(this.userDirectory(userId), "conversations");
  }

  private recordFileName(id: string): string {
    return createHash("sha256").update(id, "utf8").digest("hex");
  }

  private rotationJournalPath(userId: string): string {
    return path.join(this.userDirectory(userId), "credential-rotation.pending.json");
  }

  private async recoverCredentialRotations(): Promise<void> {
    const entries = await readdir(this.usersPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const journalPath = this.rotationJournalPath(entry.name);
      let journal: CredentialRotationJournal | LegacyCredentialRotationJournal;
      try {
        journal = JSON.parse(
          await readFile(journalPath, "utf8"),
        ) as CredentialRotationJournal | LegacyCredentialRotationJournal;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (
        ![1, 2].includes(journal.version) ||
        journal.account?.id !== entry.name ||
        (journal.version === 1
          ? journal.state?.algorithm !== "aes-256-gcm"
          : journal.bundle?.root.document.algorithm !== "aes-256-gcm")
      ) {
        throw new Error(`Invalid credential rotation journal: ${entry.name}`);
      }
      if (journal.version === 1) {
        await this.commitCredentialRotation(await this.readIndex(), journal);
      } else {
        await this.commitCredentialRotationBundle(await this.readIndex(), journal);
      }
      await unlink(journalPath);
    }
  }

  private async commitCredentialRotation(
    index: AccountIndex,
    journal: LegacyCredentialRotationJournal,
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

  private async commitCredentialRotationBundle(
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
    await this.commitStateBundle(journal.account.id, journal.bundle);
    await this.atomicWrite(this.accountsPath, { ...index, accounts } satisfies AccountIndex);
  }

  private async commitStateBundle(
    userId: string,
    bundle: EncryptedAccountStateBundle,
  ): Promise<void> {
    const conversationsDirectory = this.conversationsDirectory(userId);
    await mkdir(conversationsDirectory, { recursive: true });
    const expectedConversationDirectories = new Set<string>();
    for (const conversation of bundle.conversations) {
      const directoryName = this.recordFileName(conversation.id);
      expectedConversationDirectories.add(directoryName);
      const directory = path.join(conversationsDirectory, directoryName);
      const messagesDirectory = path.join(directory, "messages");
      await mkdir(messagesDirectory, { recursive: true });
      const conversationPath = path.join(directory, "conversation.enc.json");
      const currentConversation = await this.readJson<StoredConversation>(conversationPath);
      if (
        currentConversation?.payload.fingerprint !== conversation.payload.fingerprint ||
        currentConversation.ordinal !== conversation.ordinal
      ) {
        await this.atomicWrite(conversationPath, {
          version: 1,
          ...conversation,
          messages: [],
        } satisfies StoredConversation);
      }

      const expectedMessages = new Set<string>();
      for (const message of conversation.messages) {
        const fileName = `${this.recordFileName(message.id)}.enc.json`;
        expectedMessages.add(fileName);
        const messagePath = path.join(messagesDirectory, fileName);
        const currentMessage = await this.readJson<StoredMessage>(messagePath);
        if (
          currentMessage?.payload.fingerprint === message.payload.fingerprint &&
          currentMessage.ordinal === message.ordinal
        ) continue;
        await this.atomicWrite(messagePath, {
          version: 1,
          ...message,
        } satisfies StoredMessage);
      }
      for (const entry of await readdir(messagesDirectory, { withFileTypes: true })) {
        if (entry.isFile() && !expectedMessages.has(entry.name)) {
          await rm(path.join(messagesDirectory, entry.name), { force: true });
        }
      }
    }
    for (const entry of await readdir(conversationsDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && !expectedConversationDirectories.has(entry.name)) {
        await rm(path.join(conversationsDirectory, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
    const currentRoot = await this.readJson<StoredFingerprint>(
      this.stateFingerprintPath(userId),
    );
    if (currentRoot?.fingerprint !== bundle.root.fingerprint) {
      await this.atomicWrite(this.statePath(userId), bundle.root.document);
      await this.atomicWrite(this.stateFingerprintPath(userId), {
        version: 1,
        fingerprint: bundle.root.fingerprint,
      } satisfies StoredFingerprint);
    }
  }

  private async readJson<T>(filePath: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
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
