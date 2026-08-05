import type { PersistedAppState } from "./accountState";
import type {
  AuthUser,
  AgentStep,
  ChatAttachment,
  ChatMessage,
  LocalSkillDescriptor,
  SkillInvocationPolicy,
} from "./types";

export type ChatStreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "attachment"; attachment: ChatAttachment }
  | { type: "agent-step"; step: AgentStep }
  | { type: "agent-skills"; activeSkillIds: string[] };

export interface AdminAccountSummary {
  id: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  administrator: boolean;
  workspaceQuotaBytes: number;
  workspaceUsedBytes: number;
}

export interface WorkspaceFile {
  path: string;
  type: "file";
  size: number;
  mimeType: string;
  updatedAt: string;
}

export interface WorkspaceSnapshot {
  files: WorkspaceFile[];
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  truncated: boolean;
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
  skillsEnabled: boolean;
}> {
  return requestJson("/api/config");
}

export async function listLocalSkills(): Promise<LocalSkillDescriptor[]> {
  const payload = await requestJson<{ skills: LocalSkillDescriptor[] }>(
    "/api/skills/catalog",
  );
  return payload.skills;
}

export async function listAdminSkills(): Promise<LocalSkillDescriptor[]> {
  const payload = await requestJson<{ skills: LocalSkillDescriptor[] }>(
    "/api/admin/skills",
  );
  return payload.skills;
}

async function uploadSkillArchive(
  file: File,
  skillId?: string,
): Promise<LocalSkillDescriptor> {
  const path = skillId
    ? `/api/admin/skills/${encodeURIComponent(skillId)}`
    : "/api/admin/skills";
  const response = await fetch(path, {
    method: skillId ? "PUT" : "POST",
    credentials: "include",
    headers: {
      "content-type": "application/zip",
      "x-modeldock-filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    skill?: LocalSkillDescriptor;
  } & ErrorPayload;
  if (!response.ok || !payload.skill) {
    throw new ClientApiError(
      response.status,
      payload.error?.code ?? "SKILL_UPLOAD_FAILED",
      payload.error?.message ?? "Skill 成品包上传失败。",
    );
  }
  return payload.skill;
}

export function installAdminSkill(file: File): Promise<LocalSkillDescriptor> {
  return uploadSkillArchive(file);
}

export function updateAdminSkill(
  skillId: string,
  file: File,
): Promise<LocalSkillDescriptor> {
  return uploadSkillArchive(file, skillId);
}

export async function deleteAdminSkill(
  skillId: string,
): Promise<LocalSkillDescriptor> {
  const payload = await requestJson<{ deleted: LocalSkillDescriptor }>(
    `/api/admin/skills/${encodeURIComponent(skillId)}`,
    { method: "DELETE" },
  );
  return payload.deleted;
}

export async function updateAdminSkillPolicy(
  skillId: string,
  policy: SkillInvocationPolicy,
): Promise<LocalSkillDescriptor> {
  const payload = await requestJson<{ skill: LocalSkillDescriptor }>(
    `/api/admin/skills/${encodeURIComponent(skillId)}/policy`,
    {
      method: "PATCH",
      body: JSON.stringify({ policy }),
    },
  );
  return payload.skill;
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

export async function updateAdminWorkspaceQuota(
  accountId: string,
  quotaBytes: number,
): Promise<AdminAccountSummary> {
  const payload = await requestJson<{ account: AdminAccountSummary }>(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/workspace-quota`,
    {
      method: "PATCH",
      body: JSON.stringify({ quotaBytes }),
    },
  );
  return payload.account;
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const payload = await requestJson<{ workspace: WorkspaceSnapshot }>(
    "/api/workspace",
  );
  return payload.workspace;
}

export function workspaceFileUrl(
  filePath: string,
  download = false,
): string {
  const query = new URLSearchParams({ path: filePath });
  if (download) query.set("download", "1");
  return `/api/workspace/file?${query.toString()}`;
}

export async function loadWorkspaceFile(filePath: string): Promise<Blob> {
  const response = await fetch(workspaceFileUrl(filePath), {
    credentials: "include",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new ClientApiError(
      response.status,
      payload.error?.code ?? "WORKSPACE_FILE_FAILED",
      payload.error?.message ?? "工作区文件读取失败。",
    );
  }
  return response.blob();
}

export async function deleteWorkspaceFile(
  filePath: string,
): Promise<{ path: string }> {
  const payload = await requestJson<{ deleted: { path: string } }>(
    workspaceFileUrl(filePath),
    { method: "DELETE" },
  );
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
    skillId?: string;
    skillIds?: string[];
    skillPolicies?: Record<string, SkillInvocationPolicy>;
    agent?: boolean;
    webSearch?: boolean;
    codeMode?: boolean;
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
        step?: AgentStep;
        activeSkillIds?: string[];
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
      if (payload.type === "agent-step" && payload.step) {
        onChunk({ type: "agent-step", step: payload.step });
      }
      if (
        payload.type === "agent-skills" &&
        Array.isArray(payload.activeSkillIds) &&
        payload.activeSkillIds.every((id) => typeof id === "string")
      ) {
        onChunk({ type: "agent-skills", activeSkillIds: payload.activeSkillIds });
      }
    }
    if (done) return;
  }
}
