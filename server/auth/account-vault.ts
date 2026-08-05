import { randomUUID } from "node:crypto";
import {
  createPasswordDigest,
  createVaultSalt,
  decryptJson,
  deriveVaultKey,
  encryptJson,
  fingerprintJson,
  verifyPassword,
} from "../core/crypto.js";
import { AppError } from "../core/errors.js";
import {
  DEFAULT_WORKSPACE_QUOTA_BYTES,
  MAX_WORKSPACE_QUOTA_BYTES,
  MIN_WORKSPACE_QUOTA_BYTES,
  normalizeWorkspaceQuotaBytes,
  type AccountRecord,
  type AccountStorage,
  type EncryptedAccountStateBundle,
} from "../storage/account-storage.js";
import {
  isPartitionedRoot,
  mergeAccountState,
  partitionAccountState,
  type PlainConversationState,
} from "../storage/state-partition.js";
import { SessionManager, type SessionContext } from "./session-manager.js";

export interface AuthResult {
  token: string;
  user: {
    id: string;
    username: string;
  };
}

export interface AdminAccountSummary {
  id: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  administrator: boolean;
  workspaceQuotaBytes: number;
}

export class AccountVault {
  constructor(
    private readonly storage: AccountStorage,
    private readonly sessions: SessionManager,
    private readonly adminUsername = "admin",
  ) {}

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  async register(usernameInput: string, password: string): Promise<AuthResult> {
    const username = usernameInput.trim();
    this.validateCredentials(username, password);
    const normalizedUsername = username.toLocaleLowerCase("zh-CN");
    if (await this.storage.findByUsername(normalizedUsername)) {
      throw new AppError(409, "USERNAME_TAKEN", "这个账号名称已经被使用。");
    }

    const now = new Date().toISOString();
    const vaultSalt = createVaultSalt();
    const [passwordDigest, vaultKey] = await Promise.all([
      createPasswordDigest(password),
      deriveVaultKey(password, vaultSalt),
    ]);
    const account: AccountRecord = {
      id: randomUUID(),
      username,
      normalizedUsername,
      password: passwordDigest,
      vaultSalt,
      workspaceQuotaBytes: DEFAULT_WORKSPACE_QUOTA_BYTES,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.createAccount(
      account,
      encryptJson(vaultKey, { version: 1 }),
    );
    const session = this.sessions.issue(
      { id: account.id, username: account.username },
      vaultKey,
    );
    vaultKey.fill(0);
    return this.publicResult(session);
  }

  async login(usernameInput: string, password: string): Promise<AuthResult> {
    const normalizedUsername = usernameInput.trim().toLocaleLowerCase("zh-CN");
    const account = await this.storage.findByUsername(normalizedUsername);
    if (!account || !(await verifyPassword(password, account.password))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "账号或密码不正确。");
    }
    const vaultKey = await deriveVaultKey(password, account.vaultSalt);
    try {
      decryptJson(vaultKey, await this.storage.readState(account.id));
    } catch {
      vaultKey.fill(0);
      throw new AppError(500, "VAULT_DECRYPT_FAILED", "账号数据无法解密，请确认密码或数据文件。");
    }
    const session = this.sessions.issue(
      { id: account.id, username: account.username },
      vaultKey,
    );
    vaultKey.fill(0);
    return this.publicResult(session);
  }

  async loginAdmin(
    usernameInput: string,
    password: string,
  ): Promise<AuthResult> {
    const result = await this.login(usernameInput, password);
    if (!this.isAdminUsername(result.user.username)) {
      this.sessions.destroy(result.token);
      throw new AppError(
        403,
        "ADMIN_ACCESS_DENIED",
        "此账号没有管理员权限。",
      );
    }
    return result;
  }

  async getAdminSession(
    token: string | undefined,
  ): Promise<AuthResult["user"]> {
    const session = this.sessions.require(token);
    const account = await this.storage.findById(session.user.id);
    if (!account || !this.isAdminUsername(account.normalizedUsername)) {
      throw new AppError(
        403,
        "ADMIN_ACCESS_DENIED",
        "此账号没有管理员权限。",
      );
    }
    return session.user;
  }

  async listAdminAccounts(
    token: string | undefined,
  ): Promise<AdminAccountSummary[]> {
    const admin = await this.getAdminSession(token);
    return (await this.storage.listAccounts()).map((account) => ({
      id: account.id,
      username: account.username,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      administrator: account.id === admin.id,
      workspaceQuotaBytes: normalizeWorkspaceQuotaBytes(
        account.workspaceQuotaBytes,
      ),
    }));
  }

  async getWorkspaceQuotaForAccount(accountId: string): Promise<number> {
    const account = await this.storage.findById(accountId);
    if (!account) {
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
    }
    return normalizeWorkspaceQuotaBytes(account.workspaceQuotaBytes);
  }

  async updateWorkspaceQuotaAsAdmin(
    token: string | undefined,
    targetUserId: string,
    quotaBytes: unknown,
  ): Promise<AdminAccountSummary> {
    const admin = await this.getAdminSession(token);
    if (
      typeof quotaBytes !== "number" ||
      !Number.isSafeInteger(quotaBytes) ||
      quotaBytes < MIN_WORKSPACE_QUOTA_BYTES ||
      quotaBytes > MAX_WORKSPACE_QUOTA_BYTES
    ) {
      throw new AppError(
        400,
        "INVALID_WORKSPACE_QUOTA",
        "工作区容量必须为 1 MB 至 1 TB 之间的整数。",
      );
    }
    const account = await this.storage.updateWorkspaceQuota(
      targetUserId,
      quotaBytes,
    );
    return {
      id: account.id,
      username: account.username,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      administrator: account.id === admin.id,
      workspaceQuotaBytes: normalizeWorkspaceQuotaBytes(
        account.workspaceQuotaBytes,
      ),
    };
  }

  async deleteAccountAsAdmin(
    token: string | undefined,
    targetUserId: string,
  ): Promise<{ id: string; username: string }> {
    const admin = await this.getAdminSession(token);
    if (targetUserId === admin.id) {
      throw new AppError(
        400,
        "ADMIN_ACCOUNT_PROTECTED",
        "管理员账号不能删除自身。",
      );
    }
    const target = await this.storage.findById(targetUserId);
    if (!target) {
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "没有找到这个账号。");
    }
    this.sessions.destroyUser(target.id);
    await this.serializedForUser(target.id, async () => {
      await this.storage.deleteAccount(target.id);
    });
    this.stateFingerprints.delete(target.id);
    this.sessions.destroyUser(target.id);
    return { id: target.id, username: target.username };
  }

  getSession(token: string | undefined): AuthResult["user"] {
    return this.sessions.require(token).user;
  }

  logout(token: string | undefined): void {
    this.sessions.destroy(token);
  }

  async readState<T>(token: string | undefined): Promise<T> {
    const session = this.sessions.require(token);
    const state = await this.readPlainState(session);
    this.stateFingerprints.set(
      session.user.id,
      fingerprintJson(session.vaultKey, state),
    );
    return state as T;
  }

  async writeState(token: string | undefined, state: unknown): Promise<void> {
    const userId = this.sessions.require(token).user.id;
    await this.serializedForUser(userId, async () => {
      const session = this.sessions.require(token);
      const fingerprint = fingerprintJson(session.vaultKey, state);
      if (this.stateFingerprints.get(userId) === fingerprint) return;
      await this.storage.writeStateBundle(
        session.user.id,
        this.encryptStateBundle(session.vaultKey, state),
      );
      this.stateFingerprints.set(userId, fingerprint);
    });
  }

  async changePassword(
    token: string | undefined,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResult> {
    const userId = this.sessions.require(token).user.id;
    return this.serializedForUser(userId, async () => {
      const session = this.sessions.require(token);
      const account = await this.storage.findById(session.user.id);
      if (!account || !(await verifyPassword(currentPassword, account.password))) {
        throw new AppError(
          401,
          "CURRENT_PASSWORD_INCORRECT",
          "当前密码不正确。",
        );
      }
      this.validatePassword(newPassword);
      if (currentPassword === newPassword) {
        throw new AppError(
          400,
          "PASSWORD_UNCHANGED",
          "新密码不能与当前密码相同。",
        );
      }

      const plaintextState = await this.readPlainState(session);
      const vaultSalt = createVaultSalt();
      const [passwordDigest, nextVaultKey] = await Promise.all([
        createPasswordDigest(newPassword),
        deriveVaultKey(newPassword, vaultSalt),
      ]);
      try {
        await this.storage.updateCredentialsBundle(
          {
            ...account,
            password: passwordDigest,
            vaultSalt,
            updatedAt: new Date().toISOString(),
          },
          this.encryptStateBundle(nextVaultKey, plaintextState),
        );
        this.stateFingerprints.set(
          account.id,
          fingerprintJson(nextVaultKey, plaintextState),
        );
        return this.publicResult(this.sessions.rotate(token, nextVaultKey));
      } finally {
        nextVaultKey.fill(0);
      }
    });
  }

  private publicResult(session: SessionContext): AuthResult {
    return {
      token: session.token,
      user: session.user,
    };
  }

  private validateCredentials(username: string, password: string): void {
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) {
      throw new AppError(
        400,
        "INVALID_USERNAME",
        "账号名需为 3–32 个字符，可使用文字、数字、点、短横线和下划线。",
      );
    }
    this.validatePassword(password);
  }

  private validatePassword(password: string): void {
    if (password.length < 8 || password.length > 128) {
      throw new AppError(400, "INVALID_PASSWORD", "密码长度需为 8–128 个字符。");
    }
  }

  private isAdminUsername(username: string): boolean {
    return (
      username.trim().toLocaleLowerCase("zh-CN") ===
      this.adminUsername.trim().toLocaleLowerCase("zh-CN")
    );
  }

  private readonly userOperations = new Map<string, Promise<void>>();
  private readonly stateFingerprints = new Map<string, string>();

  private encryptStateBundle(
    key: Buffer,
    state: unknown,
  ): EncryptedAccountStateBundle {
    const partition = partitionAccountState(state);
    return {
      root: {
        fingerprint: fingerprintJson(key, partition.root),
        document: encryptJson(key, partition.root),
      },
      conversations: partition.conversations.map((conversation) => ({
        id: conversation.id,
        ordinal: conversation.ordinal,
        payload: {
          fingerprint: fingerprintJson(key, conversation.payload),
          document: encryptJson(key, conversation.payload),
        },
        messages: conversation.messages.map((message) => ({
          id: message.id,
          ordinal: message.ordinal,
          payload: {
            fingerprint: fingerprintJson(key, message.payload),
            document: encryptJson(key, message.payload),
          },
        })),
      })),
    };
  }

  private async readPlainState(
    session: SessionContext,
  ): Promise<Record<string, unknown>> {
    const bundle = await this.storage.readStateBundle(session.user.id);
    const root = decryptJson<Record<string, unknown>>(
      session.vaultKey,
      bundle.root,
    );
    if (!isPartitionedRoot(root)) return root;
    const conversations: PlainConversationState[] = bundle.conversations.map(
      (conversation) => ({
        id: conversation.id,
        ordinal: conversation.ordinal,
        payload: decryptJson<Record<string, unknown>>(
          session.vaultKey,
          conversation.payload.document,
        ),
        messages: conversation.messages.map((message) => ({
          id: message.id,
          ordinal: message.ordinal,
          payload: decryptJson<Record<string, unknown>>(
            session.vaultKey,
            message.payload.document,
          ),
        })),
      }),
    );
    return mergeAccountState(root, conversations);
  }

  private async serializedForUser<T>(
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.userOperations.get(userId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.userOperations.set(userId, settled);
    try {
      return await result;
    } finally {
      if (this.userOperations.get(userId) === settled) {
        this.userOperations.delete(userId);
      }
    }
  }
}
