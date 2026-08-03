import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { AppError } from "../core/errors.js";
import type { GatewayMessage } from "../providers/provider.js";
import {
  ENCRYPTED_MEMORY_FORMAT,
  EncryptedSkillMemoryRuntime,
} from "./encrypted-memory.js";
import {
  extractPrivateTerms,
  redactPrivateValue,
} from "./privacy-guard.js";
import { extractSkillArchive } from "./zip-package.js";

const MAX_SKILL_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;

export interface LocalSkillsConfig {
  enabled: boolean;
  directory: string;
  pythonExecutable: string;
  allowScriptExecution: boolean;
}

export type SkillInvocationPolicy = "always" | "auto" | "manual";

export function isSkillInvocationPolicy(
  value: unknown,
): value is SkillInvocationPolicy {
  return value === "always" || value === "auto" || value === "manual";
}

export interface LocalSkillDescriptor {
  id: string;
  name: string;
  displayName: string;
  description: string;
  defaultInvocationPolicy: SkillInvocationPolicy;
  requiresLocalExecution: boolean;
  runtimeReady: boolean;
  capabilities: Array<"instructions" | "private-memory">;
}

export interface AgentSkillContext {
  skill: {
    id: string;
    name: string;
    description: string;
  };
  instructions: string;
  period?: string;
  memory?: RetrievalPayload;
}

interface InspectedSkill extends Omit<LocalSkillDescriptor, "defaultInvocationPolicy"> {
  packageDirectory: string;
  defaultPeriod: string;
}

interface RetrievalManifest {
  database_path?: unknown;
  database_encryption?: unknown;
  default_period?: unknown;
  available_years?: unknown;
}

interface RetrievalPayload {
  period?: unknown;
  retrieval_mode?: unknown;
  results?: unknown;
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).replace(/\\([\\"])/g, "$1");
  }
  return trimmed;
}

function frontmatterValue(source: string, key: string): string | undefined {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  const line = match[1]
    .split(/\r?\n/)
    .find((entry) => entry.match(new RegExp(`^${key}\\s*:`)));
  if (!line) return undefined;
  return stripYamlQuotes(line.slice(line.indexOf(":") + 1));
}

function yamlScalar(source: string, key: string): string | undefined {
  const line = source
    .split(/\r?\n/)
    .find((entry) => entry.match(new RegExp(`^\\s*${key}\\s*:`)));
  if (!line) return undefined;
  return stripYamlQuotes(line.slice(line.indexOf(":") + 1));
}

function safeSkillId(value: string): string {
  const id = value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id || id.length > 80) {
    throw new AppError(400, "INVALID_SKILL_MANIFEST", "Skill 名称不能转换为有效标识。 ");
  }
  return id;
}

function normalizeRequestedId(value: string): string {
  const id = safeSkillId(value);
  if (id !== value) {
    throw new AppError(400, "INVALID_SKILL_ID", "Skill 标识格式无效。 ");
  }
  return id;
}

async function readLimited(filePath: string, limit: number): Promise<string> {
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile()) {
    throw new AppError(400, "INVALID_SKILL_PACKAGE", "Skill 成品缺少可读取的文件。 ");
  }
  if (info.size > limit) {
    throw new AppError(400, "SKILL_FILE_TOO_LARGE", "Skill 文件超过加载上限。 ");
  }
  return readFile(filePath, "utf8");
}

function normalizePeriod(value: string | undefined, fallback = "current"): string {
  const period = (value || fallback).trim().toLocaleLowerCase("en-US");
  if (period === "current" || period === "all") return period;
  if (/^(?:19|20)\d{2}$/.test(period)) return period;
  if (/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(period)) return period;
  const range = period.match(/^((?:19|20)\d{2})-((?:19|20)\d{2})$/);
  if (range && Number(range[1]) <= Number(range[2])) return period;
  return fallback;
}

function detectRequestedPeriod(messages: GatewayMessage[], fallback: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = message.content.trim();
    if (!/(切换|切回|回到|时期|版本|年的|现在|当前|current|all)/i.test(text)) continue;
    if (/(切回|回到).{0,6}(现在|当前)|\bcurrent\b/i.test(text)) return "current";
    if (/\ball\b|全部时期/.test(text)) return "all";
    const range = text.match(/((?:19|20)\d{2})\s*[-–—至到]\s*((?:19|20)\d{2})/);
    if (range) return normalizePeriod(`${range[1]}-${range[2]}`, fallback);
    const month = text.match(/((?:19|20)\d{2})[-/.年](0?[1-9]|1[0-2])月?/);
    if (month) return `${month[1]}-${month[2].padStart(2, "0")}`;
    const year = text.match(/((?:19|20)\d{2})/);
    if (year) return year[1];
  }
  return fallback;
}

function buildRetrievalQuery(messages: GatewayMessage[]): string {
  const raw = messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content)
    .join(" ")
    .replace(/data:[^\s]+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(raw).slice(-320).join("") || "当前对话";
}

export class LocalSkillRuntime {
  private readonly packagesDirectory: string;
  private readonly stagingDirectory: string;
  private readonly policiesPath: string;
  private readonly memoryRuntime: EncryptedSkillMemoryRuntime;

  constructor(private readonly config: LocalSkillsConfig) {
    this.packagesDirectory = path.resolve(config.directory, "packages");
    this.stagingDirectory = path.resolve(config.directory, ".staging");
    this.policiesPath = path.resolve(config.directory, "policies.json");
    this.memoryRuntime = new EncryptedSkillMemoryRuntime(
      path.resolve(config.directory),
      config.pythonExecutable,
    );
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;
    await Promise.all([
      mkdir(this.packagesDirectory, { recursive: true }),
      mkdir(this.stagingDirectory, { recursive: true }),
    ]);
  }

  async dispose(): Promise<void> {
    await this.memoryRuntime.disposeAll();
  }

  async listCatalog(): Promise<LocalSkillDescriptor[]> {
    this.ensureEnabled();
    await this.initialize();
    const entries = await readdir(this.packagesDirectory, { withFileTypes: true });
    const inspected = await Promise.allSettled(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => this.inspectDirectory(path.join(this.packagesDirectory, entry.name))),
    );
    const policies = await this.readPolicies();
    return inspected
      .flatMap((result) => result.status === "fulfilled"
        ? [this.toPublic(result.value, this.policyFor(result.value.id, policies))]
        : [])
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  }

  async installArchive(
    archive: Buffer,
    expectedId?: string,
  ): Promise<LocalSkillDescriptor> {
    this.ensureEnabled();
    await this.initialize();
    const normalizedExpectedId = expectedId ? normalizeRequestedId(expectedId) : undefined;
    const stagingRoot = path.join(this.stagingDirectory, randomUUID());
    await mkdir(stagingRoot, { recursive: true });
    let backupDirectory: string | undefined;
    let destinationDirectory: string | undefined;
    try {
      await extractSkillArchive(archive, stagingRoot);
      const packageRoot = await this.locatePackageRoot(stagingRoot);
      const inspected = await this.inspectDirectory(packageRoot);
      if (normalizedExpectedId && inspected.id !== normalizedExpectedId) {
        throw new AppError(
          400,
          "SKILL_ID_MISMATCH",
          `更新包的 Skill 标识必须是 ${normalizedExpectedId}。`,
        );
      }
      destinationDirectory = this.packageDirectory(inspected.id);
      const exists = await access(destinationDirectory).then(() => true, () => false);
      if (!normalizedExpectedId && exists) {
        throw new AppError(409, "SKILL_ALREADY_EXISTS", "这个 Skill 已存在，请使用更新操作。 ");
      }
      if (normalizedExpectedId && !exists) {
        throw new AppError(404, "SKILL_NOT_FOUND", "没有找到要更新的 Skill。 ");
      }
      if (exists) {
        await this.memoryRuntime.dispose(destinationDirectory);
        backupDirectory = path.join(this.stagingDirectory, `${inspected.id}-${randomUUID()}.backup`);
        await rename(destinationDirectory, backupDirectory);
      }
      await rename(packageRoot, destinationDirectory);
      if (backupDirectory) {
        await rm(backupDirectory, { recursive: true, force: true });
      }
      backupDirectory = undefined;
      const saved = await this.inspectDirectory(destinationDirectory);
      const policy = await this.ensureStoredPolicy(saved.id);
      return this.toPublic(saved, policy);
    } catch (error) {
      if (backupDirectory && destinationDirectory) {
        await rm(destinationDirectory, { recursive: true, force: true }).catch(() => undefined);
        await rename(backupDirectory, destinationDirectory).catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async deleteSkill(id: string): Promise<LocalSkillDescriptor> {
    this.ensureEnabled();
    const normalizedId = normalizeRequestedId(id);
    const inspected = await this.inspectById(normalizedId);
    const policies = await this.readPolicies();
    const deleted = this.toPublic(inspected, this.policyFor(inspected.id, policies));
    await this.memoryRuntime.dispose(inspected.packageDirectory);
    await rm(inspected.packageDirectory, { recursive: true, force: false });
    if (Object.hasOwn(policies, normalizedId)) {
      delete policies[normalizedId];
      await this.writePolicies(policies);
    }
    return deleted;
  }

  async setDefaultInvocationPolicy(
    id: string,
    policy: SkillInvocationPolicy,
  ): Promise<LocalSkillDescriptor> {
    this.ensureEnabled();
    if (!isSkillInvocationPolicy(policy)) {
      throw new AppError(400, "INVALID_SKILL_POLICY", "Skill 调用策略无效。 ");
    }
    const normalizedId = normalizeRequestedId(id);
    const inspected = await this.inspectById(normalizedId);
    const policies = await this.readPolicies();
    policies[normalizedId] = policy;
    await this.writePolicies(policies);
    return this.toPublic(inspected, policy);
  }

  async buildSystemMessages(
    skillId: string | undefined,
    messages: GatewayMessage[],
  ): Promise<GatewayMessage[]> {
    if (!skillId) return [];
    this.ensureEnabled();
    const descriptor = await this.inspectById(normalizeRequestedId(skillId));
    if (!descriptor.runtimeReady) {
      throw new AppError(
        409,
        "SKILL_RUNTIME_UNAVAILABLE",
        `${descriptor.displayName} 的运行环境尚未就绪。`,
      );
    }
    const instructions = await readLimited(
      path.join(descriptor.packageDirectory, "SKILL.md"),
      MAX_SKILL_BYTES,
    );
    let content = [
      `The following administrator-installed Skill is active for this request: ${descriptor.displayName}.`,
      "Follow its instructions unless they conflict with the user's request or higher-priority instructions.",
      instructions,
    ].join("\n\n");

    if (descriptor.requiresLocalExecution) {
      const period = detectRequestedPeriod(messages, descriptor.defaultPeriod);
      const context = await this.retrieveDigitalMeContext(
        descriptor.packageDirectory,
        buildRetrievalQuery(messages),
        period,
      );
      content += [
        "",
        "Private context for this turn follows. Use it only to shape the response.",
        "Never quote peer messages, expose identifiers, mention retrieval, or copy this context into the visible answer. Public aliases, display nicknames, role names, and the Skill identity may be used normally. Never output a person's real or legal name, physical address, phone number, email address, password, API key, token, private account or login identifier, or other private identifier. Public display nicknames are not private identifiers. Use a nickname, neutral relationship label, or pronoun instead.",
        JSON.stringify(redactPrivateValue(context, extractPrivateTerms(messages))),
      ].join("\n\n");
    }
    return [{ role: "system", content }];
  }

  async buildAgentToolResult(
    skillId: string,
    queryInput: unknown,
    periodInput?: unknown,
  ): Promise<AgentSkillContext> {
    this.ensureEnabled();
    const descriptor = await this.inspectById(normalizeRequestedId(skillId));
    if (!descriptor.runtimeReady) {
      throw new AppError(
        409,
        "SKILL_RUNTIME_UNAVAILABLE",
        `${descriptor.displayName} 的运行环境尚未就绪。`,
      );
    }
    const instructions = await readLimited(
      path.join(descriptor.packageDirectory, "SKILL.md"),
      MAX_SKILL_BYTES,
    );
    const result: AgentSkillContext = {
      skill: {
        id: descriptor.id,
        name: descriptor.displayName,
        description: descriptor.description,
      },
      instructions,
    };
    if (descriptor.requiresLocalExecution) {
      const rawQuery = typeof queryInput === "string" ? queryInput : "当前对话";
      const query = rawQuery
        .replace(/data:[^\s]+/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320) || "当前对话";
      const period = normalizePeriod(
        typeof periodInput === "string" ? periodInput : undefined,
        descriptor.defaultPeriod,
      );
      result.period = period;
      result.memory = redactPrivateValue(
        await this.retrieveDigitalMeContext(
        descriptor.packageDirectory,
        query,
        period,
        ),
        extractPrivateTerms([{ role: "user", content: query }]),
      );
    }
    return result;
  }

  async buildAgentBootstrap(
    skillId: string,
    messages: GatewayMessage[],
  ): Promise<AgentSkillContext> {
    this.ensureEnabled();
    const descriptor = await this.inspectById(normalizeRequestedId(skillId));
    return this.buildAgentToolResult(
      descriptor.id,
      buildRetrievalQuery(messages),
      detectRequestedPeriod(messages, descriptor.defaultPeriod),
    );
  }

  async hasPrivateMemorySkill(skillIds: string[]): Promise<boolean> {
    if (!this.config.enabled) return false;
    for (const id of [...new Set(skillIds)]) {
      try {
        if ((await this.inspectById(normalizeRequestedId(id))).requiresLocalExecution) {
          return true;
        }
      } catch {
        // Invalid, missing, or unavailable Skills are handled by the normal request flow.
      }
    }
    return false;
  }

  private ensureEnabled(): void {
    if (!this.config.enabled) {
      throw new AppError(404, "SKILLS_DISABLED", "Skill 目录当前未启用。 ");
    }
  }

  private packageDirectory(id: string): string {
    const directory = path.resolve(this.packagesDirectory, id);
    const relative = path.relative(this.packagesDirectory, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AppError(400, "INVALID_SKILL_ID", "Skill 标识格式无效。 ");
    }
    return directory;
  }

  private async inspectById(id: string): Promise<InspectedSkill> {
    const directory = this.packageDirectory(id);
    const exists = await stat(directory).catch(() => undefined);
    if (!exists?.isDirectory()) {
      throw new AppError(404, "SKILL_NOT_FOUND", "没有找到这个 Skill。 ");
    }
    return this.inspectDirectory(directory);
  }

  private async locatePackageRoot(stagingRoot: string): Promise<string> {
    if (await access(path.join(stagingRoot, "SKILL.md")).then(() => true, () => false)) {
      return stagingRoot;
    }
    const entries = await readdir(stagingRoot, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    if (
      entries.length === 1 &&
      directories.length === 1 &&
      await access(path.join(stagingRoot, directories[0].name, "SKILL.md")).then(
        () => true,
        () => false,
      )
    ) {
      return path.join(stagingRoot, directories[0].name);
    }
    throw new AppError(
      400,
      "INVALID_SKILL_PACKAGE",
      "ZIP 根目录或唯一的一级目录中必须包含 SKILL.md。",
    );
  }

  private async inspectDirectory(packageDirectory: string): Promise<InspectedSkill> {
    const skillMarkdown = await readLimited(
      path.join(packageDirectory, "SKILL.md"),
      MAX_SKILL_BYTES,
    );
    const name = frontmatterValue(skillMarkdown, "name");
    const description = frontmatterValue(skillMarkdown, "description");
    if (!name || !description) {
      throw new AppError(
        400,
        "INVALID_SKILL_MANIFEST",
        "SKILL.md 必须包含 name 和 description。",
      );
    }
    let displayName = name;
    let shortDescription = description;
    try {
      const agentYaml = await readLimited(
        path.join(packageDirectory, "agents", "openai.yaml"),
        MAX_METADATA_BYTES,
      );
      displayName = yamlScalar(agentYaml, "display_name") || displayName;
      shortDescription = yamlScalar(agentYaml, "short_description") || shortDescription;
    } catch {
      // agents/openai.yaml is optional.
    }
    const id = safeSkillId(name);
    const privateMemory = id === "digital-me"
      ? await this.readRetrievalStatus(packageDirectory)
      : undefined;
    const requiresLocalExecution = privateMemory !== undefined;
    return {
      id,
      name,
      displayName,
      description: shortDescription,
      packageDirectory,
      requiresLocalExecution,
      runtimeReady:
        !requiresLocalExecution ||
        (this.config.allowScriptExecution && privateMemory.databaseReady),
      defaultPeriod: privateMemory?.defaultPeriod ?? "current",
      capabilities: requiresLocalExecution
        ? ["instructions", "private-memory"]
        : ["instructions"],
    };
  }

  private initialPolicy(id: string): SkillInvocationPolicy {
    return id === "digital-me" ? "always" : "auto";
  }

  private policyFor(
    id: string,
    policies: Record<string, SkillInvocationPolicy>,
  ): SkillInvocationPolicy {
    return policies[id] ?? this.initialPolicy(id);
  }

  private async ensureStoredPolicy(id: string): Promise<SkillInvocationPolicy> {
    const policies = await this.readPolicies();
    if (policies[id]) return policies[id];
    const policy = this.initialPolicy(id);
    policies[id] = policy;
    await this.writePolicies(policies);
    return policy;
  }

  private async readPolicies(): Promise<Record<string, SkillInvocationPolicy>> {
    try {
      const raw = await readFile(this.policiesPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([id, policy]) => /^[a-z0-9._-]{1,80}$/.test(id) && isSkillInvocationPolicy(policy),
        ),
      );
    } catch {
      return {};
    }
  }

  private async writePolicies(
    policies: Record<string, SkillInvocationPolicy>,
  ): Promise<void> {
    await mkdir(path.dirname(this.policiesPath), { recursive: true });
    const temporaryPath = `${this.policiesPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(policies, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await rename(temporaryPath, this.policiesPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private toPublic(
    skill: InspectedSkill,
    defaultInvocationPolicy: SkillInvocationPolicy,
  ): LocalSkillDescriptor {
    return {
      id: skill.id,
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      defaultInvocationPolicy,
      requiresLocalExecution: skill.requiresLocalExecution,
      runtimeReady: skill.runtimeReady,
      capabilities: skill.capabilities,
    };
  }

  private async readRetrievalStatus(packageDirectory: string): Promise<{
    databaseReady: boolean;
    defaultPeriod: string;
  }> {
    try {
      const raw = await readLimited(
        path.join(packageDirectory, "references", "retrieval.json"),
        MAX_METADATA_BYTES,
      );
      const manifest = JSON.parse(raw) as RetrievalManifest;
      const configuredPath =
        typeof manifest.database_path === "string" ? manifest.database_path : "";
      if (!configuredPath || path.isAbsolute(configuredPath)) {
        return { databaseReady: false, defaultPeriod: "current" };
      }
      const databasePath = path.resolve(packageDirectory, "references", configuredPath);
      const relativeDatabasePath = path.relative(packageDirectory, databasePath);
      if (
        relativeDatabasePath.startsWith("..") ||
        path.isAbsolute(relativeDatabasePath)
      ) {
        return { databaseReady: false, defaultPeriod: "current" };
      }
      const encrypted = manifest.database_encryption === ENCRYPTED_MEMORY_FORMAT;
      return {
        databaseReady:
          encrypted &&
          this.config.allowScriptExecution &&
          await this.memoryRuntime.ready(databasePath),
        defaultPeriod:
          typeof manifest.default_period === "string"
            ? normalizePeriod(manifest.default_period)
            : "current",
      };
    } catch {
      return { databaseReady: false, defaultPeriod: "current" };
    }
  }

  private async retrieveDigitalMeContext(
    packageDirectory: string,
    query: string,
    period: string,
  ): Promise<RetrievalPayload> {
    if (!this.config.allowScriptExecution) {
      throw new AppError(409, "SKILL_RUNTIME_UNAVAILABLE", "Skill 运行环境尚未启用。 ");
    }
    try {
      const manifest = JSON.parse(await readLimited(
        path.join(packageDirectory, "references", "retrieval.json"),
        MAX_METADATA_BYTES,
      )) as RetrievalManifest;
      if (
        manifest.database_encryption !== ENCRYPTED_MEMORY_FORMAT ||
        typeof manifest.database_path !== "string" ||
        path.isAbsolute(manifest.database_path)
      ) {
        throw new Error("Private memory manifest is not encrypted.");
      }
      const databasePath = path.resolve(
        packageDirectory,
        "references",
        manifest.database_path,
      );
      const relativeDatabasePath = path.relative(packageDirectory, databasePath);
      if (relativeDatabasePath.startsWith("..") || path.isAbsolute(relativeDatabasePath)) {
        throw new Error("Private memory database path escapes the Skill package.");
      }
      const payload = await this.memoryRuntime.query({
        packageDirectory,
        databasePath,
        query,
        period,
        limit: 8,
      }) as RetrievalPayload;
      return {
        period: typeof payload.period === "string" ? payload.period : period,
        retrieval_mode:
          typeof payload.retrieval_mode === "string" ? payload.retrieval_mode : undefined,
        results: Array.isArray(payload.results) ? payload.results : [],
      };
    } catch {
      throw new AppError(502, "SKILL_RETRIEVAL_FAILED", "Skill 上下文准备失败。 ");
    }
  }
}
