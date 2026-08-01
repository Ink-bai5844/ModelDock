import type { EncryptedDocument, PasswordDigest } from "../core/crypto.js";

export interface AccountRecord {
  id: string;
  username: string;
  normalizedUsername: string;
  password: PasswordDigest;
  vaultSalt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountStorage {
  initialize(): Promise<void>;
  findByUsername(normalizedUsername: string): Promise<AccountRecord | null>;
  findById(id: string): Promise<AccountRecord | null>;
  listAccounts(): Promise<AccountRecord[]>;
  createAccount(account: AccountRecord, initialState: EncryptedDocument): Promise<void>;
  updateCredentials(
    account: AccountRecord,
    reencryptedState: EncryptedDocument,
  ): Promise<void>;
  readState(userId: string): Promise<EncryptedDocument>;
  writeState(userId: string, state: EncryptedDocument): Promise<void>;
  deleteAccount(userId: string): Promise<void>;
}
