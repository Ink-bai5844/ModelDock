import { createHash } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decryptMemoryFile,
  encryptMemoryFile,
  ensureSkillMemoryKey,
  inspectEncryptedMemoryFile,
} from "../dist-server/skills/encrypted-memory.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.resolve(
  process.argv[2] ?? path.join(
    projectRoot,
    "data",
    "skills",
    "packages",
    "digital-me",
  ),
);
const skillsDirectory = path.resolve(skillRoot, "..", "..");
const plaintextPath = path.join(skillRoot, "private", "chat-context.sqlite3");
const encryptedPath = `${plaintextPath}.enc`;

const exists = (filePath) => access(filePath).then(() => true, () => false);
const digest = (value) => createHash("sha256").update(value).digest("hex");

const masterKey = await ensureSkillMemoryKey(skillsDirectory);
try {
  if (!(await exists(plaintextPath))) {
    if (!(await inspectEncryptedMemoryFile(encryptedPath))) {
      throw new Error("没有找到可迁移的明文数据库或有效的加密数据库。");
    }
    const verified = await decryptMemoryFile(encryptedPath, masterKey);
    verified.fill(0);
    console.log("墨白记忆库已经是加密格式，无需重复迁移。");
    process.exit(0);
  }
  if (await exists(encryptedPath)) {
    throw new Error("目标加密数据库已经存在；为避免覆盖，请先确认并移走旧文件。");
  }

  const plaintext = await readFile(plaintextPath);
  const expectedDigest = digest(plaintext);
  plaintext.fill(0);
  await encryptMemoryFile(plaintextPath, encryptedPath, masterKey);

  const verified = await decryptMemoryFile(encryptedPath, masterKey);
  try {
    if (digest(verified) !== expectedDigest) {
      throw new Error("加密数据库回读校验失败，明文数据库仍被保留。");
    }
  } finally {
    verified.fill(0);
  }
  await rm(plaintextPath);
  console.log("墨白记忆库已转换为 AES-256-GCM 加密格式，明文副本已从 ModelDock Skill 包移除。");
} finally {
  masterKey.fill(0);
}
