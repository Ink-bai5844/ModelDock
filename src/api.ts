import type { PersistedAppState } from "./accountState";
import type {
  AuthUser,
  ChatAttachment,
  ChatMessage,
} from "./types";

export type ChatStreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "attachment"; attachment: ChatAttachment };

export interface AdminAccountSummary {
  id: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  administrator: boolean;
}

export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new ClientApiError(
      response.status,
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? `请求失败（${response.status}）`,
    );
  }
  return payload;
}

export async function getRuntimeConfig(): Promise<{
  onlineMode: boolean;
  storage: string;
}> {
  return requestJson("/api/config");
}

export async function getSession(): Promise<AuthUser> {
  const payload = await requestJson<{ user: AuthUser }>("/api/auth/session");
  return payload.user;
}

export async function register(username: string, password: string): Promise<AuthUser> {
  const payload = await requestJson<{ user: AuthUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return payload.user;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const payload = await requestJson<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return payload.user;
}

export async function loginAdmin(
  username: string,
  password: string,
): Promise<AuthUser> {
  const payload = await requestJson<{ user: AuthUser }>("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return payload.user;
}

export async function getAdminSession(): Promise<AuthUser> {
  const payload = await requestJson<{ user: AuthUser }>("/api/admin/session");
  return payload.user;
}

export async function listAdminAccounts(): Promise<AdminAccountSummary[]> {
  const payload = await requestJson<{ accounts: AdminAccountSummary[] }>(
    "/api/admin/accounts",
  );
  return payload.accounts;
}

export async function deleteAdminAccount(
  accountId: string,
): Promise<{ id: string; username: string }> {
  const payload = await requestJson<{
    deleted: { id: string; username: string };
  }>(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
  return payload.deleted;
}

export async function logout(): Promise<void> {
  await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await requestJson("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function loadUserState(): Promise<unknown> {
  const payload = await requestJson<{ state: unknown }>("/api/state");
  return payload.state;
}

export async function saveUserState(state: PersistedAppState): Promise<void> {
  await requestJson("/api/state", {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
}

export async function testProviderConnection(
  configId: string,
): Promise<{ ok: true; message: string; models: number }> {
  return requestJson("/api/providers/test", {
    method: "POST",
    body: JSON.stringify({ configId }),
  });
}

export async function streamChat(
  request: {
    configId: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    reasoning?: boolean;
  },
  signal: AbortSignal,
  onChunk: (chunk: ChatStreamChunk) => void,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...request,
      messages: request.messages.map(({ role, content, attachments }) => ({
        role,
        content,
        attachments,
      })),
    }),
    signal,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new ClientApiError(
      response.status,
      payload.error?.code ?? "CHAT_FAILED",
      payload.error?.message ?? "聊天请求失败。",
    );
  }
  if (!response.body) throw new ClientApiError(502, "EMPTY_STREAM", "服务器没有返回消息流。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const rawEvent of events) {
      let eventName = "message";
      const data: string[] = [];
      for (const line of rawEvent.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      const payload = JSON.parse(data.join("\n")) as {
        type?: string;
        text?: string;
        code?: string;
        message?: string;
        attachment?: ChatAttachment;
      };
      if (eventName === "error" || payload.type === "error") {
        throw new ClientApiError(502, payload.code ?? "PROVIDER_ERROR", payload.message ?? "模型调用失败。");
      }
      if (payload.type === "delta" && payload.text) {
        onChunk({ type: "text-delta", text: payload.text });
      }
      if (payload.type === "reasoning" && payload.text) {
        onChunk({ type: "reasoning-delta", text: payload.text });
      }
      if (payload.type === "attachment" && payload.attachment) {
        onChunk({ type: "attachment", attachment: payload.attachment });
      }
    }
    if (done) return;
  }
}
