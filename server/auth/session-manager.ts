import { randomBytes } from "node:crypto";
import { AppError } from "../core/errors.js";

export interface SessionUser {
  id: string;
  username: string;
}

export interface SessionContext {
  token: string;
  user: SessionUser;
  vaultKey: Buffer;
  expiresAt: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionContext>();

  constructor(private readonly lifetimeMs: number) {}

  issue(user: SessionUser, vaultKey: Buffer): SessionContext {
    const token = randomBytes(32).toString("base64url");
    const session: SessionContext = {
      token,
      user,
      vaultKey: Buffer.from(vaultKey),
      expiresAt: Date.now() + this.lifetimeMs,
    };
    this.sessions.set(token, session);
    return session;
  }

  rotate(token: string | undefined, vaultKey: Buffer): SessionContext {
    const current = this.require(token);
    const user = { ...current.user };
    for (const [sessionToken, session] of this.sessions) {
      if (session.user.id === user.id) this.destroy(sessionToken);
    }
    return this.issue(user, vaultKey);
  }

  require(token: string | undefined): SessionContext {
    if (!token) throw new AppError(401, "AUTH_REQUIRED", "请先登录账号。");
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.destroy(token);
      throw new AppError(401, "SESSION_EXPIRED", "登录状态已失效，请重新登录。");
    }
    return session;
  }

  destroy(token: string | undefined): void {
    if (!token) return;
    const session = this.sessions.get(token);
    session?.vaultKey.fill(0);
    this.sessions.delete(token);
  }

  destroyUser(userId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.user.id === userId) this.destroy(token);
    }
  }
}
