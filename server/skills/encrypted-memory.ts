import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createInterface } from "node:readline";
import { once } from "node:events";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const ENCRYPTED_MEMORY_FORMAT = "modeldock-aes-256-gcm-v1";
export const MEMORY_KEY_FILE = "memory.key";

const MAGIC = Buffer.from("MDMEM01\0", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const KEY_BYTES = 32;
const HKDF_INFO = Buffer.from("ModelDock/private-skill-memory/v1", "utf8");
const WORKER_TIMEOUT_MS = 20_000;

interface WorkerRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface WorkerResponse {
  type?: unknown;
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
}

function decodeKey(source: string): Buffer {
  const value = source.trim();
  const decoded = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (decoded.length !== KEY_BYTES) {
    decoded.fill(0);
    throw new Error("Skill memory key must decode to exactly 32 bytes.");
  }
  return decoded;
}

function deriveFileKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, salt, HKDF_INFO, KEY_BYTES));
}

function decodeEncryptedMemory(source: Buffer, masterKey: Buffer): Buffer {
  if (
    source.length <= HEADER_BYTES + TAG_BYTES ||
    !source.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    throw new Error("Encrypted Skill memory has an invalid header.");
  }
  const saltStart = MAGIC.length;
  const ivStart = saltStart + SALT_BYTES;
  const bodyStart = ivStart + IV_BYTES;
  const tagStart = source.length - TAG_BYTES;
  const salt = source.subarray(saltStart, ivStart);
  const iv = source.subarray(ivStart, bodyStart);
  const tag = source.subarray(tagStart);
  const fileKey = deriveFileKey(masterKey, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", fileKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(source.subarray(bodyStart, tagStart)),
      decipher.final(),
    ]);
  } finally {
    fileKey.fill(0);
  }
}

export async function readSkillMemoryKey(directory: string): Promise<Buffer> {
  const environmentKey = process.env.MODELDOCK_SKILLS_MEMORY_KEY;
  if (environmentKey) return decodeKey(environmentKey);
  return decodeKey(await readFile(path.join(directory, MEMORY_KEY_FILE), "utf8"));
}

export async function ensureSkillMemoryKey(directory: string): Promise<Buffer> {
  try {
    return await readSkillMemoryKey(directory);
  } catch (error) {
    if (process.env.MODELDOCK_SKILLS_MEMORY_KEY) throw error;
    await mkdir(directory, { recursive: true });
    const keyPath = path.join(directory, MEMORY_KEY_FILE);
    const temporaryPath = `${keyPath}.${randomUUID()}.tmp`;
    const key = randomBytes(KEY_BYTES);
    await writeFile(temporaryPath, `${key.toString("base64")}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    try {
      await rename(temporaryPath, keyPath);
      return key;
    } catch (renameError) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      key.fill(0);
      try {
        return await readSkillMemoryKey(directory);
      } catch {
        throw renameError;
      }
    }
  }
}

export async function inspectEncryptedMemoryFile(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size <= HEADER_BYTES + TAG_BYTES) return false;
    handle = await open(filePath, "r");
    const header = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(MAGIC);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function encryptMemoryFile(
  sourcePath: string,
  destinationPath: string,
  masterKey: Buffer,
): Promise<void> {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error("Skill memory key must be exactly 32 bytes.");
  }
  const plaintext = await readFile(sourcePath);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const fileKey = deriveFileKey(masterKey, salt);
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    const cipher = createCipheriv("aes-256-gcm", fileKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const encrypted = Buffer.concat([
      MAGIC,
      salt,
      iv,
      ciphertext,
      cipher.getAuthTag(),
    ]);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, destinationPath);
    encrypted.fill(0);
    ciphertext.fill(0);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    plaintext.fill(0);
    fileKey.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

export async function decryptMemoryFile(
  encryptedPath: string,
  masterKey: Buffer,
): Promise<Buffer> {
  const source = await readFile(encryptedPath);
  try {
    return decodeEncryptedMemory(source, masterKey);
  } finally {
    source.fill(0);
  }
}

class RetrievalWorker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly requests = new Map<string, WorkerRequest>();
  private readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private stderr = "";
  private closed = false;

  private constructor(
    executable: string,
    scriptPath: string,
    cwd: string,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.child = spawn(executable, [scriptPath, "--serve-stdin"], {
      cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4096);
    });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on(
      "line",
      (line) => this.handleLine(line),
    );
    this.child.once("error", (error) => this.fail(error));
    this.child.once("close", (code) => {
      this.fail(new Error(
        `Skill memory worker stopped${code === null ? "" : ` (${code})`}${this.stderr ? `: ${this.stderr.trim()}` : "."}`,
      ));
    });
  }

  static async start(options: {
    executable: string;
    scriptPath: string;
    cwd: string;
    database: Buffer;
  }): Promise<RetrievalWorker> {
    const worker = new RetrievalWorker(
      options.executable,
      options.scriptPath,
      options.cwd,
    );
    const startupTimer = setTimeout(
      () => worker.fail(new Error("Skill memory worker startup timed out.")),
      WORKER_TIMEOUT_MS,
    );
    try {
      await worker.write(Buffer.from(`${JSON.stringify({
        type: "database",
        bytes: options.database.length,
      })}\n`, "utf8"));
      await worker.write(options.database);
      await worker.ready;
      return worker;
    } finally {
      clearTimeout(startupTimer);
      options.database.fill(0);
    }
  }

  async query(input: {
    query: string;
    period: string;
    limit: number;
  }): Promise<unknown> {
    await this.ready;
    if (this.closed) throw new Error("Skill memory worker is not running.");
    const id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("Skill memory query timed out."));
      }, WORKER_TIMEOUT_MS);
      this.requests.set(id, { resolve, reject, timer });
    });
    try {
      await this.write(Buffer.from(`${JSON.stringify({ id, ...input })}\n`, "utf8"));
    } catch (error) {
      const request = this.requests.get(id);
      if (request) {
        clearTimeout(request.timer);
        this.requests.delete(id);
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return result;
  }

  async dispose(): Promise<void> {
    const stopped = this.child.exitCode === null
      ? once(this.child, "close").then(() => undefined)
      : Promise.resolve();
    this.closed = true;
    if (this.child.exitCode === null) this.child.kill();
    this.fail(new Error("Skill memory worker was disposed."));
    await stopped;
  }

  private write(value: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child.stdin.write(value, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private handleLine(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.fail(new Error("Skill memory worker returned invalid JSON."));
      return;
    }
    if (response.type === "ready") {
      this.readyResolve();
      return;
    }
    if (typeof response.id !== "string") return;
    const request = this.requests.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.requests.delete(response.id);
    if (response.ok === true) request.resolve(response.result);
    else request.reject(new Error(
      typeof response.error === "string" ? response.error : "Skill memory query failed.",
    ));
  }

  private fail(error: Error): void {
    if (!this.closed) this.closed = true;
    this.readyReject(error);
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.requests.clear();
  }
}

export class EncryptedSkillMemoryRuntime {
  private readonly workers = new Map<string, Promise<RetrievalWorker>>();

  constructor(
    private readonly directory: string,
    private readonly executable: string,
  ) {}

  async ready(databasePath: string): Promise<boolean> {
    if (!(await inspectEncryptedMemoryFile(databasePath))) return false;
    try {
      const key = await readSkillMemoryKey(this.directory);
      key.fill(0);
      return true;
    } catch {
      return false;
    }
  }

  async query(options: {
    packageDirectory: string;
    databasePath: string;
    query: string;
    period: string;
    limit: number;
  }): Promise<unknown> {
    let workerPromise = this.workers.get(options.packageDirectory);
    if (!workerPromise) {
      workerPromise = this.startWorker(options.packageDirectory, options.databasePath);
      this.workers.set(options.packageDirectory, workerPromise);
      workerPromise.catch(() => {
        if (this.workers.get(options.packageDirectory) === workerPromise) {
          this.workers.delete(options.packageDirectory);
        }
      });
    }
    const worker = await workerPromise;
    return worker.query({
      query: options.query,
      period: options.period,
      limit: options.limit,
    });
  }

  async dispose(packageDirectory: string): Promise<void> {
    const worker = this.workers.get(packageDirectory);
    this.workers.delete(packageDirectory);
    await (await worker?.catch(() => undefined))?.dispose();
  }

  async disposeAll(): Promise<void> {
    const workers = [...this.workers.values()];
    this.workers.clear();
    const resolved = await Promise.all(workers.map((worker) => worker.catch(() => undefined)));
    await Promise.all(resolved.map((worker) => worker?.dispose()));
  }

  private async startWorker(
    packageDirectory: string,
    databasePath: string,
  ): Promise<RetrievalWorker> {
    const key = await readSkillMemoryKey(this.directory);
    let database: Buffer;
    try {
      database = await decryptMemoryFile(databasePath, key);
    } finally {
      key.fill(0);
    }
    return RetrievalWorker.start({
      executable: this.executable,
      scriptPath: path.join(packageDirectory, "scripts", "retrieve_context.py"),
      cwd: packageDirectory,
      database,
    });
  }
}
