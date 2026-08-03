import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { AppError } from "../core/errors.js";
import {
  DEFAULT_WORKSPACE_QUOTA_BYTES,
  normalizeWorkspaceQuotaBytes,
} from "../storage/account-storage.js";
import { createZipArchive } from "./zip-archive.js";

const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 300;
const MAX_SEARCH_MATCHES = 80;
const MAX_DELIVERY_FILES = 24;
const MAX_DELIVERY_BYTES = 8 * 1024 * 1024;
const MAX_WORKSPACE_LIST_ENTRIES = 2_000;

const WORKSPACE_MIME_TYPES: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
  ".xml": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".go": "text/plain; charset=utf-8",
  ".rs": "text/plain; charset=utf-8",
  ".java": "text/plain; charset=utf-8",
  ".c": "text/plain; charset=utf-8",
  ".h": "text/plain; charset=utf-8",
  ".cpp": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".zip": "application/zip",
};

export interface WorkspaceEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
  mimeType?: string;
  updatedAt?: string;
}

export interface WorkspaceSnapshot {
  files: WorkspaceEntry[];
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  truncated: boolean;
}

export interface WorkspaceFileDescriptor {
  absolutePath: string;
  path: string;
  size: number;
  mimeType: string;
  updatedAt: string;
}

export interface AgentDataWorkspaceOptions {
  quotaBytes?: (accountId: string) => number | Promise<number>;
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface WorkspaceArchive {
  buffer: Buffer;
  files: string[];
}

function stableAccountDirectoryName(accountId: string): string {
  if (/^[a-zA-Z0-9._-]{1,128}$/.test(accountId)) return accountId;
  return createHash("sha256").update(accountId).digest("hex");
}

function normalizeRelativePath(value: unknown, fallback = "."): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || value.includes("\0") || path.isAbsolute(value)) {
    throw new AppError(400, "INVALID_AGENT_PATH", "Agent 文件路径无效。 ");
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new AppError(400, "INVALID_AGENT_PATH", "Agent 文件路径不能离开数据工作区。 ");
  }
  return normalized || fallback;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPortablePath(root: string, candidate: string): string {
  const relative = path.relative(root, candidate).replace(/\\/g, "/");
  return relative || ".";
}

export class AgentDataWorkspace {
  private readonly workspacesDirectory: string;
  private readonly quotaBytes: (accountId: string) => number | Promise<number>;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    dataDirectory: string,
    options: AgentDataWorkspaceOptions = {},
  ) {
    this.workspacesDirectory = path.resolve(dataDirectory, "agent-workspaces");
    this.quotaBytes = options.quotaBytes ?? (() => DEFAULT_WORKSPACE_QUOTA_BYTES);
  }

  async list(accountId: string, requestedPath?: unknown): Promise<WorkspaceEntry[]> {
    const root = await this.accountRoot(accountId);
    const target = await this.resolveExisting(root, requestedPath, "directory");
    const results: WorkspaceEntry[] = [];
    await this.walk(root, target, results, MAX_LIST_ENTRIES);
    return results.slice(0, MAX_LIST_ENTRIES);
  }

  async snapshot(accountId: string): Promise<WorkspaceSnapshot> {
    const root = await this.accountRoot(accountId);
    const entries: WorkspaceEntry[] = [];
    await this.walk(root, root, entries, MAX_WORKSPACE_LIST_ENTRIES);
    const usage = await this.calculateUsage(root);
    return {
      files: entries.filter((entry) => entry.type === "file"),
      usedBytes: usage.bytes,
      quotaBytes: normalizeWorkspaceQuotaBytes(
        await this.quotaBytes(accountId),
      ),
      fileCount: usage.files,
      truncated: usage.files > entries.filter((entry) => entry.type === "file").length,
    };
  }

  async fileDescriptor(
    accountId: string,
    requestedPath: unknown,
  ): Promise<WorkspaceFileDescriptor> {
    const root = await this.accountRoot(accountId);
    const target = await this.resolveExisting(root, requestedPath, "file");
    const info = await stat(target);
    return {
      absolutePath: target,
      path: toPortablePath(root, target),
      size: info.size,
      mimeType: this.mimeType(target),
      updatedAt: info.mtime.toISOString(),
    };
  }

  async read(accountId: string, requestedPath: unknown): Promise<{
    path: string;
    content: string;
    truncated: boolean;
  }> {
    const root = await this.accountRoot(accountId);
    const target = await this.resolveExisting(root, requestedPath, "file");
    const info = await stat(target);
    if (info.size > MAX_TEXT_FILE_BYTES) {
      throw new AppError(
        413,
        "AGENT_FILE_TOO_LARGE",
        "Agent 只能读取不超过 256 KiB 的文本文件。",
      );
    }
    const content = await readFile(target, "utf8");
    return { path: toPortablePath(root, target), content, truncated: false };
  }

  async write(
    accountId: string,
    requestedPath: unknown,
    content: unknown,
  ): Promise<{ path: string; bytes: number }> {
    return this.serializedWrite(accountId, async () => {
    if (typeof content !== "string") {
      throw new AppError(400, "INVALID_AGENT_FILE", "Agent 写入内容必须是文本。 ");
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_TEXT_FILE_BYTES) {
      throw new AppError(
        413,
        "AGENT_FILE_TOO_LARGE",
        "Agent 只能写入不超过 256 KiB 的文本文件。",
      );
    }
    const root = await this.accountRoot(accountId);
    const relative = normalizeRelativePath(requestedPath, "");
    if (!relative || relative === ".") {
      throw new AppError(400, "INVALID_AGENT_PATH", "请提供要写入的文件路径。 ");
    }
    const target = path.resolve(root, relative);
    if (!isInside(root, target)) {
      throw new AppError(400, "INVALID_AGENT_PATH", "Agent 文件路径不能离开数据工作区。 ");
    }
    await this.ensureSafeParents(root, path.dirname(target));
    const existing = await lstat(target).catch(() => undefined);
    if (existing?.isSymbolicLink() || existing?.isDirectory()) {
      throw new AppError(400, "INVALID_AGENT_PATH", "Agent 不能写入链接或目录。 ");
    }
    const usage = await this.calculateUsage(root);
    const quotaBytes = normalizeWorkspaceQuotaBytes(
      await this.quotaBytes(accountId),
    );
    const projectedBytes = usage.bytes - (existing?.size ?? 0) + bytes;
    if (projectedBytes > quotaBytes) {
      throw new AppError(
        413,
        "WORKSPACE_QUOTA_EXCEEDED",
        "工作区容量不足，请删除部分文件或联系管理员调整容量。",
      );
    }
    await writeFile(target, content, { encoding: "utf8", flag: "w" });
    return { path: toPortablePath(root, target), bytes };
    });
  }

  async search(
    accountId: string,
    query: unknown,
    requestedPath?: unknown,
  ): Promise<WorkspaceSearchMatch[]> {
    if (typeof query !== "string" || !query.trim()) {
      throw new AppError(400, "INVALID_AGENT_SEARCH", "文件搜索词不能为空。 ");
    }
    const needle = query.trim().toLocaleLowerCase("zh-CN").slice(0, 200);
    const root = await this.accountRoot(accountId);
    const target = await this.resolveExisting(root, requestedPath, "directory");
    const entries: WorkspaceEntry[] = [];
    await this.walk(root, target, entries, MAX_LIST_ENTRIES);
    const matches: WorkspaceSearchMatch[] = [];
    for (const entry of entries) {
      if (entry.type !== "file" || (entry.size ?? 0) > MAX_TEXT_FILE_BYTES) continue;
      const absolute = path.resolve(root, entry.path);
      const content = await readFile(absolute, "utf8").catch(() => undefined);
      if (content === undefined) continue;
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.toLocaleLowerCase("zh-CN").includes(needle)) continue;
        matches.push({ path: entry.path, line: index + 1, text: line.slice(0, 500) });
        if (matches.length >= MAX_SEARCH_MATCHES) return matches;
      }
    }
    return matches;
  }

  async deleteFile(accountId: string, requestedPath: unknown): Promise<{ path: string }> {
    const root = await this.accountRoot(accountId);
    const target = await this.resolveExisting(root, requestedPath, "file");
    const portablePath = toPortablePath(root, target);
    await rm(target, { force: false });
    return { path: portablePath };
  }

  async deleteWorkspace(accountId: string): Promise<void> {
    await mkdir(this.workspacesDirectory, { recursive: true });
    const workspacesRoot = await realpath(this.workspacesDirectory);
    const target = path.resolve(
      workspacesRoot,
      stableAccountDirectoryName(accountId),
    );
    if (!isInside(workspacesRoot, target)) {
      throw new AppError(500, "AGENT_WORKSPACE_ERROR", "工作区边界无效。 ");
    }
    const info = await lstat(target).catch(() => undefined);
    if (!info) return;
    if (info.isSymbolicLink()) {
      throw new AppError(500, "AGENT_WORKSPACE_ERROR", "工作区路径不安全。 ");
    }
    await rm(target, { recursive: true, force: true });
  }

  async createArchive(accountId: string, requestedPaths: string[]): Promise<WorkspaceArchive> {
    const uniquePaths = [...new Set(requestedPaths)];
    if (!uniquePaths.length || uniquePaths.length > MAX_DELIVERY_FILES) {
      throw new AppError(400, "INVALID_AGENT_ARCHIVE", "交付文件数量无效或超过上限。 ");
    }
    const root = await this.accountRoot(accountId);
    const entries: Array<{ name: string; data: Buffer }> = [];
    let totalBytes = 0;
    for (const requestedPath of uniquePaths) {
      const relative = normalizeRelativePath(requestedPath, "");
      if (!relative || relative === ".") {
        throw new AppError(400, "INVALID_AGENT_ARCHIVE", "交付文件路径无效。 ");
      }
      const target = await this.resolveExisting(root, relative, "file");
      const data = await readFile(target);
      totalBytes += data.length;
      if (totalBytes > MAX_DELIVERY_BYTES) {
        throw new AppError(413, "AGENT_ARCHIVE_TOO_LARGE", "交付文件总大小超过 8 MiB。 ");
      }
      entries.push({ name: toPortablePath(root, target), data });
    }
    return {
      buffer: createZipArchive(entries),
      files: entries.map((entry) => entry.name),
    };
  }

  private async accountRoot(accountId: string): Promise<string> {
    await mkdir(this.workspacesDirectory, { recursive: true });
    const workspacesRoot = await realpath(this.workspacesDirectory);
    const root = path.resolve(
      workspacesRoot,
      stableAccountDirectoryName(accountId),
    );
    if (!isInside(workspacesRoot, root)) {
      throw new AppError(500, "AGENT_WORKSPACE_ERROR", "无法建立 Agent 数据工作区。 ");
    }
    await mkdir(root, { recursive: true });
    const resolvedRoot = await realpath(root);
    if (!isInside(workspacesRoot, resolvedRoot)) {
      throw new AppError(500, "AGENT_WORKSPACE_ERROR", "Agent 数据工作区边界无效。 ");
    }
    return resolvedRoot;
  }

  private async resolveExisting(
    root: string,
    requestedPath: unknown,
    expected: "file" | "directory",
  ): Promise<string> {
    const relative = normalizeRelativePath(requestedPath);
    const candidate = path.resolve(root, relative);
    if (!isInside(root, candidate)) {
      throw new AppError(400, "INVALID_AGENT_PATH", "Agent 文件路径不能离开数据工作区。 ");
    }
    const info = await lstat(candidate).catch(() => undefined);
    if (!info || info.isSymbolicLink()) {
      throw new AppError(404, "AGENT_FILE_NOT_FOUND", "Agent 数据工作区中没有这个路径。 ");
    }
    const resolved = await realpath(candidate);
    if (!isInside(root, resolved)) {
      throw new AppError(400, "INVALID_AGENT_PATH", "Agent 文件路径不能离开数据工作区。 ");
    }
    if (expected === "file" ? !info.isFile() : !info.isDirectory()) {
      throw new AppError(400, "INVALID_AGENT_PATH", `目标不是${expected === "file" ? "文件" : "目录"}。`);
    }
    return resolved;
  }

  private async ensureSafeParents(root: string, targetDirectory: string): Promise<void> {
    const relative = path.relative(root, targetDirectory);
    if (!isInside(root, targetDirectory)) {
      throw new AppError(400, "INVALID_AGENT_PATH", "Agent 文件路径不能离开数据工作区。 ");
    }
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const info = await lstat(current).catch(() => undefined);
      if (info?.isSymbolicLink() || (info && !info.isDirectory())) {
        throw new AppError(400, "INVALID_AGENT_PATH", "Agent 文件路径包含不安全的目录。 ");
      }
      if (!info) await mkdir(current);
    }
  }

  private async walk(
    root: string,
    directory: string,
    output: WorkspaceEntry[],
    limit: number,
  ): Promise<void> {
    if (output.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (!isInside(root, absolute)) continue;
      if (entry.isDirectory()) {
        output.push({ path: toPortablePath(root, absolute), type: "directory" });
        await this.walk(root, absolute, output, limit);
      } else if (entry.isFile()) {
        const info = await stat(absolute).catch(() => undefined);
        output.push({
          path: toPortablePath(root, absolute),
          type: "file",
          size: info?.size ?? 0,
          mimeType: this.mimeType(absolute),
          updatedAt: info?.mtime.toISOString(),
        });
      }
    }
  }

  private mimeType(filePath: string): string {
    return WORKSPACE_MIME_TYPES[path.extname(filePath).toLocaleLowerCase("en-US")] ??
      "application/octet-stream";
  }

  private async calculateUsage(directory: string): Promise<{
    bytes: number;
    files: number;
  }> {
    let bytes = 0;
    let files = 0;
    const visit = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await visit(absolute);
        } else if (entry.isFile()) {
          const info = await stat(absolute).catch(() => undefined);
          if (!info) continue;
          bytes += info.size;
          files += 1;
        }
      }
    };
    await visit(directory);
    return { bytes, files };
  }

  private async serializedWrite<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writeQueues.get(accountId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.writeQueues.set(accountId, settled);
    try {
      return await result;
    } finally {
      if (this.writeQueues.get(accountId) === settled) {
        this.writeQueues.delete(accountId);
      }
    }
  }
}
