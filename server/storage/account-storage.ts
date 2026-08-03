import type { EncryptedDocument, PasswordDigest } from "../core/crypto.js";

export const DEFAULT_WORKSPACE_QUOTA_BYTES = 100 * 1024 * 1024;
export const MIN_WORKSPACE_QUOTA_BYTES = 1024 * 1024;
export const MAX_WORKSPACE_QUOTA_BYTES = 1024 * 1024 * 1024 * 1024;

export function normalizeWorkspaceQuotaBytes(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_WORKSPACE_QUOTA_BYTES &&
    value <= MAX_WORKSPACE_QUOTA_BYTES
    ? value
    : DEFAULT_WORKSPACE_QUOTA_BYTES;
}

export interface AccountRecord {
  id: string;
  username: string;
  normalizedUsername: string;
  password: PasswordDigest;
  vaultSalt: string;
  workspaceQuotaBytes?: number;
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
  updateWorkspaceQuota(userId: string, quotaBytes: number): Promise<AccountRecord>;
  deleteAccount(userId: string): Promise<void>;
}
