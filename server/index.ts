import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountVault } from "./auth/account-vault.js";
import { SessionManager } from "./auth/session-manager.js";
import {
  loadConfig,
  readRequiredEnvironmentVariable,
  type ModelDockConfig,
} from "./config.js";
import { AppError, asAppError } from "./core/errors.js";
import { ProviderGateway } from "./providers/provider-gateway.js";
import type {
  GatewayAttachment,
  GatewayMessage,
  ProviderConfig,
} from "./providers/provider.js";
import { FileAccountStorage } from "./storage/file-account-storage.js";
import { MySqlAccountStorage } from "./storage/mysql-account-storage.js";
import {
  isSkillInvocationPolicy,
  LocalSkillRuntime,
  type SkillInvocationPolicy,
} from "./skills/local-skill-runtime.js";
import {
  extractPrivateTerms,
  PrivateResponseGuard,
  redactPrivateContent,
} from "./skills/privacy-guard.js";
import { AgentRuntime } from "./agent/agent-runtime.js";
import { AgentDataWorkspace } from "./agent/data-workspace.js";
import { createCodeModeSystemMessage } from "./chat/code-mode.js";
import {
  externalizeAccountStateAttachments,
  externalizeGatewayAttachment,
  hydrateGatewayMessages,
  storeWorkspaceAttachment,
} from "./attachments/workspace-attachments.js";

const SESSION_COOKIE = "modeldock_session";
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_SKILL_ARCHIVE_BYTES = 160 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

interface UserState {
  configs?: ProviderConfig[];
}

interface ChatBody {
  configId?: string;
  model?: string;
  messages?: GatewayMessage[];
  temperature?: number;
  maxTokens?: number;
  reasoning?: boolean;
  skillId?: string;
  skillIds?: string[];
  skillPolicies?: Record<string, SkillInvocationPolicy>;
  agent?: boolean;
  webSearch?: boolean;
  codeMode?: boolean;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const buffer = await readBuffer(request, MAX_JSON_BYTES);
  if (!buffer.length) return {} as T;
  return JSON.parse(buffer.toString("utf8")) as T;
}

async function readBuffer(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) {
      throw new AppError(413, "REQUEST_TOO_LARGE", "请求数据过大。");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function sessionToken(request: IncomingMessage): string | undefined {
  return parseCookies(request)[SESSION_COOKIE];
}

function sessionCookie(
  token: string,
  config: ModelDockConfig,
  maxAgeSeconds: number,
): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    config.server.secureCookies ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function workspaceContentDisposition(
  filePath: string,
  download: boolean,
): string {
  const fileName = path.posix.basename(filePath.replace(/\\/g, "/"));
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`;
}

function ensureAllowedOrigin(request: IncomingMessage, config: ModelDockConfig): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  const sameHost =
    host && (origin === `http://${host}` || origin === `https://${host}`);
  if (!sameHost && !config.server.allowedOrigins.includes(origin)) {
    throw new AppError(403, "ORIGIN_NOT_ALLOWED", "请求来源不在允许列表中。");
  }
}

function providerFromState(state: UserState, configId: string | undefined): ProviderConfig {
  if (!configId) {
    throw new AppError(400, "CONFIG_REQUIRED", "缺少 API 配置标识。");
  }
  const config = state.configs?.find((item) => item.id === configId);
  if (!config) {
    throw new AppError(404, "CONFIG_NOT_FOUND", "没有找到这个 API 配置。");
  }
  return config;
}

function isGatewayMessage(value: unknown): value is GatewayMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<GatewayMessage>;
  return (
    ["system", "user", "assistant", "tool"].includes(message.role ?? "") &&
    typeof message.content === "string" &&
    (message.attachments === undefined ||
      (Array.isArray(message.attachments) &&
        message.attachments.every(isGatewayAttachment)))
  );
}

function isGatewayAttachment(value: unknown): value is GatewayAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Partial<GatewayAttachment>;
  return (
    typeof attachment.id === "string" &&
    ["text", "image", "video", "audio"].includes(attachment.kind ?? "") &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.size === "number" &&
    Number.isFinite(attachment.size) &&
    (typeof attachment.dataUrl === "string" ||
      typeof attachment.url === "string" ||
      typeof attachment.workspacePath === "string")
  );
}

async function serveStatic(
  requestPath: string,
  response: ServerResponse,
  distDirectory: string,
): Promise<void> {
  const decoded = decodeURIComponent(requestPath);
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let candidate = path.resolve(distDirectory, requested);
  if (path.relative(distDirectory, candidate).startsWith("..")) {
    throw new AppError(403, "INVALID_PATH", "无效的静态资源路径。");
  }
  try {
    const file = await stat(candidate);
    if (!file.isFile()) throw new Error("not a file");
  } catch {
    candidate = path.join(distDirectory, "index.html");
  }
  const extension = path.extname(candidate);
  const contentType: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  };
  response.writeHead(200, {
    "content-type": contentType[extension] ?? "application/octet-stream",
    "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(candidate).pipe(response);
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const runtimeRoot = path.basename(projectRoot) === "dist-server"
    ? path.dirname(projectRoot)
    : process.cwd();
  const config = await loadConfig(runtimeRoot);
  const dataDirectory = path.resolve(runtimeRoot, config.dataDirectory);
  const storage = config.onlineMode
    ? new MySqlAccountStorage({
        host: config.mysql.host,
        port: config.mysql.port,
        database: config.mysql.database,
        user: config.mysql.user,
        password: readRequiredEnvironmentVariable(
          config.mysql.passwordEnvironmentVariable,
        ),
      })
    : new FileAccountStorage(dataDirectory);
  const sessions = new SessionManager(config.server.sessionHours * 60 * 60 * 1000);
  const vault = new AccountVault(storage, sessions, config.adminUsername);
  const providers = new ProviderGateway();
  const localSkills = new LocalSkillRuntime({
    ...config.skills,
    directory: path.resolve(runtimeRoot, config.skills.directory),
  });
  const agentWorkspace = new AgentDataWorkspace(dataDirectory, {
    quotaBytes: (accountId) => vault.getWorkspaceQuotaForAccount(accountId),
  });
  const agentRuntime = new AgentRuntime(agentWorkspace, localSkills, config.search);
  await vault.initialize();
  await localSkills.initialize();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    try {
      ensureAllowedOrigin(request, config);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, {
          ok: true,
          onlineMode: config.onlineMode,
          storage: config.onlineMode ? "mysql" : "encrypted-files",
        });
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        return sendJson(response, 200, {
          onlineMode: config.onlineMode,
          storage: config.onlineMode ? "MySQL" : "本地加密文件",
          skillsEnabled: localSkills.enabled,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/register") {
        const body = await readJson<{ username?: string; password?: string }>(request);
        const result = await vault.register(body.username ?? "", body.password ?? "");
        return sendJson(response, 201, { user: result.user }, {
          "set-cookie": sessionCookie(
            result.token,
            config,
            config.server.sessionHours * 60 * 60,
          ),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson<{ username?: string; password?: string }>(request);
        const result = await vault.login(body.username ?? "", body.password ?? "");
        return sendJson(response, 200, { user: result.user }, {
          "set-cookie": sessionCookie(
            result.token,
            config,
            config.server.sessionHours * 60 * 60,
          ),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/admin/login") {
        const body = await readJson<{ username?: string; password?: string }>(request);
        const result = await vault.loginAdmin(
          body.username ?? "",
          body.password ?? "",
        );
        return sendJson(response, 200, { user: result.user }, {
          "set-cookie": sessionCookie(
            result.token,
            config,
            config.server.sessionHours * 60 * 60,
          ),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        vault.logout(sessionToken(request));
        return sendJson(response, 200, { ok: true }, {
          "set-cookie": sessionCookie("", config, 0),
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/auth/change-password"
      ) {
        const body = await readJson<{
          currentPassword?: string;
          newPassword?: string;
        }>(request);
        const result = await vault.changePassword(
          sessionToken(request),
          body.currentPassword ?? "",
          body.newPassword ?? "",
        );
        return sendJson(response, 200, { ok: true }, {
          "set-cookie": sessionCookie(
            result.token,
            config,
            config.server.sessionHours * 60 * 60,
          ),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        return sendJson(response, 200, {
          user: vault.getSession(sessionToken(request)),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/admin/session") {
        return sendJson(response, 200, {
          user: await vault.getAdminSession(sessionToken(request)),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/admin/accounts") {
        const accounts = await vault.listAdminAccounts(sessionToken(request));
        return sendJson(response, 200, {
          accounts: await Promise.all(
            accounts.map(async (account) => ({
              ...account,
              workspaceUsedBytes: (await agentWorkspace.snapshot(account.id)).usedBytes,
            })),
          ),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/admin/skills") {
        await vault.getAdminSession(sessionToken(request));
        return sendJson(response, 200, {
          skills: localSkills.enabled ? await localSkills.listCatalog() : [],
        });
      }

      if (request.method === "POST" && url.pathname === "/api/admin/skills") {
        await vault.getAdminSession(sessionToken(request));
        const archive = await readBuffer(request, MAX_SKILL_ARCHIVE_BYTES);
        return sendJson(response, 201, {
          skill: await localSkills.installArchive(archive),
        });
      }

      const adminSkillPolicyMatch = url.pathname.match(
        /^\/api\/admin\/skills\/([a-z0-9._-]+)\/policy$/,
      );
      if (request.method === "PATCH" && adminSkillPolicyMatch) {
        await vault.getAdminSession(sessionToken(request));
        const body = await readJson<{ policy?: unknown }>(request);
        if (!isSkillInvocationPolicy(body.policy)) {
          throw new AppError(400, "INVALID_SKILL_POLICY", "Skill 调用策略无效。");
        }
        return sendJson(response, 200, {
          skill: await localSkills.setDefaultInvocationPolicy(
            adminSkillPolicyMatch[1],
            body.policy,
          ),
        });
      }

      const adminSkillMatch = url.pathname.match(
        /^\/api\/admin\/skills\/([a-z0-9._-]+)$/,
      );
      if (request.method === "PUT" && adminSkillMatch) {
        await vault.getAdminSession(sessionToken(request));
        const archive = await readBuffer(request, MAX_SKILL_ARCHIVE_BYTES);
        return sendJson(response, 200, {
          skill: await localSkills.installArchive(archive, adminSkillMatch[1]),
        });
      }
      if (request.method === "DELETE" && adminSkillMatch) {
        await vault.getAdminSession(sessionToken(request));
        return sendJson(response, 200, {
          deleted: await localSkills.deleteSkill(adminSkillMatch[1]),
        });
      }

      const adminAccountMatch = url.pathname.match(
        /^\/api\/admin\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
      );
      const adminWorkspaceQuotaMatch = url.pathname.match(
        /^\/api\/admin\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/workspace-quota$/i,
      );
      if (request.method === "PATCH" && adminWorkspaceQuotaMatch) {
        const body = await readJson<{ quotaBytes?: unknown }>(request);
        const account = await vault.updateWorkspaceQuotaAsAdmin(
          sessionToken(request),
          adminWorkspaceQuotaMatch[1],
          body.quotaBytes,
        );
        return sendJson(response, 200, {
          account: {
            ...account,
            workspaceUsedBytes: (await agentWorkspace.snapshot(account.id)).usedBytes,
          },
        });
      }
      if (request.method === "DELETE" && adminAccountMatch) {
        const deleted = await vault.deleteAccountAsAdmin(
          sessionToken(request),
          adminAccountMatch[1],
        );
        await agentWorkspace.deleteWorkspace(deleted.id);
        return sendJson(response, 200, {
          deleted,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/workspace") {
        const user = vault.getSession(sessionToken(request));
        return sendJson(response, 200, {
          workspace: await agentWorkspace.snapshot(user.id),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/workspace/attachment") {
        const user = vault.getSession(sessionToken(request));
        const id = request.headers["x-modeldock-attachment-id"];
        const encodedName = request.headers["x-modeldock-filename"];
        const kind = request.headers["x-modeldock-kind"];
        if (
          typeof id !== "string" ||
          typeof encodedName !== "string" ||
          typeof kind !== "string" ||
          !["text", "image", "video", "audio"].includes(kind)
        ) {
          throw new AppError(400, "INVALID_ATTACHMENT", "附件元数据无效。");
        }
        let name: string;
        try {
          name = decodeURIComponent(encodedName);
        } catch {
          throw new AppError(400, "INVALID_ATTACHMENT", "附件名称无效。");
        }
        const buffer = await readBuffer(request, MAX_ATTACHMENT_BYTES);
        const attachment = await storeWorkspaceAttachment(
          user.id,
          {
            id,
            kind: kind as GatewayAttachment["kind"],
            name,
            mimeType: request.headers["content-type"] ?? "application/octet-stream",
            size: buffer.byteLength,
          },
          buffer,
          agentWorkspace,
        );
        return sendJson(response, 201, { attachment });
      }

      if (url.pathname === "/api/workspace/file") {
        const user = vault.getSession(sessionToken(request));
        const requestedPath = url.searchParams.get("path");
        if (!requestedPath) {
          throw new AppError(400, "INVALID_AGENT_PATH", "缺少工作区文件路径。");
        }
        if (request.method === "DELETE") {
          return sendJson(response, 200, {
            deleted: await agentWorkspace.deleteFile(user.id, requestedPath),
          });
        }
        if (request.method === "GET") {
          const file = await agentWorkspace.fileDescriptor(user.id, requestedPath);
          const download = url.searchParams.get("download") === "1";
          response.writeHead(200, {
            "content-type": file.mimeType,
            "content-length": String(file.size),
            "content-disposition": workspaceContentDisposition(file.path, download),
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "last-modified": new Date(file.updatedAt).toUTCString(),
          });
          createReadStream(file.absolutePath)
            .on("error", () => response.destroy())
            .pipe(response);
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        const token = sessionToken(request);
        const user = vault.getSession(token);
        const currentState = await vault.readState(token);
        const migrated = await externalizeAccountStateAttachments(
          user.id,
          currentState,
          agentWorkspace,
        );
        if (migrated.changed) await vault.writeState(token, migrated.state);
        return sendJson(response, 200, {
          state: migrated.state,
        });
      }

      if (request.method === "PUT" && url.pathname === "/api/state") {
        const body = await readJson<{ state?: unknown }>(request);
        if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
          throw new AppError(400, "INVALID_STATE", "账号状态必须是 JSON 对象。");
        }
        const token = sessionToken(request);
        const user = vault.getSession(token);
        const migrated = await externalizeAccountStateAttachments(
          user.id,
          body.state,
          agentWorkspace,
        );
        await vault.writeState(token, migrated.state);
        return sendJson(response, 200, { ok: true });
      }

      if (request.method === "GET" && url.pathname === "/api/skills/catalog") {
        vault.getSession(sessionToken(request));
        const skills = await localSkills.listCatalog();
        return sendJson(response, 200, {
          skills: skills.filter((skill) => skill.runtimeReady),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/providers/test") {
        const body = await readJson<{ configId?: string }>(request);
        const state = await vault.readState<UserState>(sessionToken(request));
        const provider = providerFromState(state, body.configId);
        return sendJson(response, 200, await providers.testConnection(provider));
      }

      if (request.method === "GET" && url.pathname === "/api/providers/models") {
        const state = await vault.readState<UserState>(sessionToken(request));
        const provider = providerFromState(state, url.searchParams.get("configId") ?? undefined);
        return sendJson(response, 200, {
          models: await providers.listModels(provider),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson<ChatBody>(request);
        if (
          !body.model ||
          !Array.isArray(body.messages) ||
          !body.messages.every(isGatewayMessage) ||
          (body.skillId !== undefined && typeof body.skillId !== "string") ||
          (body.skillIds !== undefined &&
            (!Array.isArray(body.skillIds) ||
              body.skillIds.length > 12 ||
              !body.skillIds.every((id) => typeof id === "string"))) ||
          (body.skillPolicies !== undefined &&
            (!body.skillPolicies ||
              typeof body.skillPolicies !== "object" ||
              Array.isArray(body.skillPolicies) ||
              Object.keys(body.skillPolicies).length > 12 ||
              !Object.entries(body.skillPolicies).every(
                ([id, policy]) =>
                  /^[a-z0-9._-]{1,80}$/.test(id) &&
                  isSkillInvocationPolicy(policy),
              ))) ||
          (body.agent !== undefined && typeof body.agent !== "boolean") ||
          (body.webSearch !== undefined && typeof body.webSearch !== "boolean") ||
          (body.codeMode !== undefined && typeof body.codeMode !== "boolean")
        ) {
          throw new AppError(400, "INVALID_CHAT_REQUEST", "聊天请求缺少模型或消息列表。");
        }
        const token = sessionToken(request);
        const state = await vault.readState<UserState>(token);
        const sessionUser = vault.getSession(token);
        const provider = providerFromState(state, body.configId);
        const hydratedMessages = await hydrateGatewayMessages(
          sessionUser.id,
          body.messages,
          agentWorkspace,
        );
        const agentEnabled = body.agent === true;
        const webSearchEnabled = agentEnabled && body.webSearch === true;
        const codeModeEnabled = body.codeMode === true;
        const requestedSkillIds = [
          ...(body.skillIds ?? []),
          ...(body.skillId ? [body.skillId] : []),
        ];
        const privateSkillActive = await localSkills.hasPrivateMemorySkill(
          requestedSkillIds,
        );
        const privateTerms = privateSkillActive
          ? extractPrivateTerms(body.messages)
          : [];
        const skillMessages = agentEnabled
          ? []
          : await localSkills.buildSystemMessages(body.skillId, body.messages);
        const controller = new AbortController();
        response.on("close", () => controller.abort());
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        try {
          const streamModel = (messages: GatewayMessage[]) =>
            providers.streamChat(provider, {
              model: body.model!,
              messages,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
              reasoning:
                typeof body.reasoning === "boolean"
                  ? body.reasoning
                  : undefined,
              signal: controller.signal,
            });
          const stream = agentEnabled
            ? agentRuntime.run({
                accountId: sessionUser.id,
                messages: hydratedMessages,
                activeSkillIds: requestedSkillIds,
                requiredSkillId: body.skillId,
                skillPolicies: body.skillPolicies ?? {},
                webSearchEnabled,
                codeModeEnabled,
                reasoningEnabled: body.reasoning === true,
                signal: controller.signal,
                streamModel,
              })
            : (async function* () {
                for await (const chunk of streamModel([
                  ...skillMessages,
                  ...(codeModeEnabled
                    ? [createCodeModeSystemMessage(false)]
                    : []),
                  ...hydratedMessages,
                ])) {
                  yield { type: "chunk" as const, chunk };
                }
              })();
          const privateResponse = privateSkillActive
            ? new PrivateResponseGuard(privateTerms)
            : undefined;
          for await (const event of stream) {
            if (event.type === "step") {
              const step = privateSkillActive && event.step.detail
                ? {
                    ...event.step,
                    detail: redactPrivateContent(event.step.detail, privateTerms),
                  }
                : event.step;
              response.write(
                `data: ${JSON.stringify({ type: "agent-step", step })}\n\n`,
              );
            } else if (event.type === "skills") {
              response.write(
                `data: ${JSON.stringify({
                  type: "agent-skills",
                  activeSkillIds: event.activeSkillIds,
                })}\n\n`,
              );
            } else if (event.chunk.type === "text-delta") {
              if (privateResponse) privateResponse.appendText(event.chunk.text);
              else {
                response.write(
                  `data: ${JSON.stringify({ type: "delta", text: event.chunk.text })}\n\n`,
                );
              }
            } else if (event.chunk.type === "reasoning-delta") {
              if (privateResponse) {
                const notice = privateResponse.takeReasoningNotice();
                if (notice) {
                  response.write(
                    `data: ${JSON.stringify({
                      type: "reasoning",
                      text: notice,
                    })}\n\n`,
                  );
                }
              } else {
                response.write(
                  `data: ${JSON.stringify({ type: "reasoning", text: event.chunk.text })}\n\n`,
                );
              }
            } else {
              const attachment = await externalizeGatewayAttachment(
                sessionUser.id,
                event.chunk.attachment,
                agentWorkspace,
              );
              response.write(
                `data: ${JSON.stringify({
                  type: "attachment",
                  attachment,
                })}\n\n`,
              );
            }
          }
          const privateText = privateResponse?.flushText();
          if (privateText) {
            response.write(
              `data: ${JSON.stringify({
                type: "delta",
                text: privateText,
              })}\n\n`,
            );
          }
          response.write(`event: done\ndata: ${JSON.stringify({ type: "done" })}\n\n`);
        } catch (error) {
          const appError = asAppError(error);
          response.write(
            `event: error\ndata: ${JSON.stringify({
              type: "error",
              code: appError.code,
              message: appError.message,
            })}\n\n`,
          );
        }
        response.end();
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        throw new AppError(404, "NOT_FOUND", "接口不存在。");
      }
      return await serveStatic(url.pathname, response, path.join(runtimeRoot, "dist"));
    } catch (error) {
      const appError = asAppError(error);
      if (!response.headersSent) {
        sendJson(response, appError.status, {
          error: {
            code: appError.code,
            message: appError.message,
          },
        });
      } else {
        response.end();
      }
      if (appError.status >= 500 && appError.code === "INTERNAL_ERROR") {
        console.error("[ModelDock]", error);
      }
    }
  });

  server.listen(config.server.port, config.server.host, () => {
    console.log(
      `ModelDock server: http://${config.server.host}:${config.server.port} (${config.onlineMode ? "online/MySQL" : "offline/encrypted files"})`,
    );
  });
}

void main();
