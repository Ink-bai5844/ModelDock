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

const SESSION_COOKIE = "modeldock_session";
const MAX_JSON_BYTES = 64 * 1024 * 1024;

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
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BYTES) {
      throw new AppError(413, "REQUEST_TOO_LARGE", "请求数据过大。");
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
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
    (typeof attachment.dataUrl === "string" || typeof attachment.url === "string")
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
  await vault.initialize();

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
        return sendJson(response, 200, {
          accounts: await vault.listAdminAccounts(sessionToken(request)),
        });
      }

      const adminAccountMatch = url.pathname.match(
        /^\/api\/admin\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
      );
      if (request.method === "DELETE" && adminAccountMatch) {
        return sendJson(response, 200, {
          deleted: await vault.deleteAccountAsAdmin(
            sessionToken(request),
            adminAccountMatch[1],
          ),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        return sendJson(response, 200, {
          state: await vault.readState(sessionToken(request)),
        });
      }

      if (request.method === "PUT" && url.pathname === "/api/state") {
        const body = await readJson<{ state?: unknown }>(request);
        if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
          throw new AppError(400, "INVALID_STATE", "账号状态必须是 JSON 对象。");
        }
        await vault.writeState(sessionToken(request), body.state);
        return sendJson(response, 200, { ok: true });
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
        if (!body.model || !Array.isArray(body.messages) || !body.messages.every(isGatewayMessage)) {
          throw new AppError(400, "INVALID_CHAT_REQUEST", "聊天请求缺少模型或消息列表。");
        }
        const state = await vault.readState<UserState>(sessionToken(request));
        const provider = providerFromState(state, body.configId);
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
          for await (const chunk of providers.streamChat(provider, {
            model: body.model,
            messages: body.messages,
            temperature: body.temperature,
            maxTokens: body.maxTokens,
            reasoning:
              typeof body.reasoning === "boolean"
                ? body.reasoning
                : undefined,
            signal: controller.signal,
          })) {
            if (chunk.type === "text-delta") {
              response.write(
                `data: ${JSON.stringify({ type: "delta", text: chunk.text })}\n\n`,
              );
            } else if (chunk.type === "reasoning-delta") {
              response.write(
                `data: ${JSON.stringify({ type: "reasoning", text: chunk.text })}\n\n`,
              );
            } else {
              response.write(
                `data: ${JSON.stringify({
                  type: "attachment",
                  attachment: chunk.attachment,
                })}\n\n`,
              );
            }
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
