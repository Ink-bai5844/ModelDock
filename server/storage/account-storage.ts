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

export interface EncryptedStatePart {
  fingerprint: string;
  document: EncryptedDocument;
}

export interface EncryptedMessageState {
  id: string;
  ordinal: number;
  payload: EncryptedStatePart;
}

export interface EncryptedConversationState {
  id: string;
  ordinal: number;
  payload: EncryptedStatePart;
  messages: EncryptedMessageState[];
}

export interface EncryptedAccountStateBundle {
  root: EncryptedStatePart;
  conversations: EncryptedConversationState[];
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
  updateCredentialsBundle(
    account: AccountRecord,
    bundle: EncryptedAccountStateBundle,
  ): Promise<void>;
  readState(userId: string): Promise<EncryptedDocument>;
  readStateBundle(userId: string): Promise<{
    root: EncryptedDocument;
    conversations: EncryptedConversationState[];
  }>;
  writeState(userId: string, state: EncryptedDocument): Promise<void>;
  writeStateBundle(userId: string, bundle: EncryptedAccountStateBundle): Promise<void>;
  updateWorkspaceQuota(userId: string, quotaBytes: number): Promise<AccountRecord>;
  deleteAccount(userId: string): Promise<void>;
}
