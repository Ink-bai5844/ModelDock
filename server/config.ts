import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ModelDockConfig {
  onlineMode: boolean;
  adminUsername: string;
  dataDirectory: string;
  mysql: {
    host: string;
    port: number;
    database: string;
    user: string;
    passwordEnvironmentVariable: string;
  };
  server: {
    host: string;
    port: number;
    sessionHours: number;
    secureCookies: boolean;
    allowedOrigins: string[];
  };
}

export function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable is not set: ${name}`);
  }
  return value;
}

const DEFAULT_CONFIG: ModelDockConfig = {
  onlineMode: false,
  adminUsername: "admin",
  dataDirectory: "./data",
  mysql: {
    host: "127.0.0.1",
    port: 3306,
    database: "modeldock",
    user: "modeldock",
    passwordEnvironmentVariable: "MODELDOCK_MYSQL_PASSWORD",
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    sessionHours: 24,
    secureCookies: false,
    allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],
  },
};

export async function loadConfig(projectRoot: string): Promise<ModelDockConfig> {
  const configPath = path.join(projectRoot, "config.json");
  const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<ModelDockConfig>;
  const onlineMode = readBooleanEnvironmentVariable(
    "MODELDOCK_ONLINE_MODE",
    raw.onlineMode ?? DEFAULT_CONFIG.onlineMode,
  );
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    onlineMode,
    adminUsername:
      process.env.MODELDOCK_ADMIN_USERNAME ??
      raw.adminUsername ??
      DEFAULT_CONFIG.adminUsername,
    dataDirectory:
      process.env.MODELDOCK_DATA_DIRECTORY ??
      raw.dataDirectory ??
      DEFAULT_CONFIG.dataDirectory,
    mysql: {
      ...DEFAULT_CONFIG.mysql,
      ...raw.mysql,
      host:
        process.env.MODELDOCK_MYSQL_HOST ??
        raw.mysql?.host ??
        DEFAULT_CONFIG.mysql.host,
      port: readNumberEnvironmentVariable(
        "MODELDOCK_MYSQL_PORT",
        raw.mysql?.port ?? DEFAULT_CONFIG.mysql.port,
      ),
      database:
        process.env.MODELDOCK_MYSQL_DATABASE ??
        raw.mysql?.database ??
        DEFAULT_CONFIG.mysql.database,
      user:
        process.env.MODELDOCK_MYSQL_USER ??
        raw.mysql?.user ??
        DEFAULT_CONFIG.mysql.user,
    },
    server: {
      ...DEFAULT_CONFIG.server,
      ...raw.server,
      host:
        process.env.MODELDOCK_SERVER_HOST ??
        raw.server?.host ??
        DEFAULT_CONFIG.server.host,
      port: readNumberEnvironmentVariable(
        "MODELDOCK_SERVER_PORT",
        raw.server?.port ?? DEFAULT_CONFIG.server.port,
      ),
      secureCookies: readBooleanEnvironmentVariable(
        "MODELDOCK_SECURE_COOKIES",
        raw.server?.secureCookies ?? DEFAULT_CONFIG.server.secureCookies,
      ),
      allowedOrigins: raw.server?.allowedOrigins ?? DEFAULT_CONFIG.server.allowedOrigins,
    },
  };
}

function readBooleanEnvironmentVariable(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function readNumberEnvironmentVariable(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return parsed;
}
