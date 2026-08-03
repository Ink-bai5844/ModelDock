import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalSkillRuntime } from "../dist-server/skills/local-skill-runtime.js";
import {
  encryptMemoryFile,
  ensureSkillMemoryKey,
} from "../dist-server/skills/encrypted-memory.js";

let crcTable;

function crc32(value) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let current = index;
      for (let bit = 0; bit < 8; bit += 1) {
        current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
      }
      crcTable[index] = current >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoreZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

async function encryptedFixture(root) {
  const plaintextPath = join(root, `fixture-${Date.now()}-${Math.random()}.sqlite3`);
  const encryptedPath = `${plaintextPath}.enc`;
  await writeFile(plaintextPath, "fixture");
  const key = await ensureSkillMemoryKey(root);
  try {
    await encryptMemoryFile(plaintextPath, encryptedPath, key);
    return await readFile(encryptedPath);
  } finally {
    key.fill(0);
    await rm(plaintextPath, { force: true });
    await rm(encryptedPath, { force: true });
  }
}

function fixtureWorker(ownerReply = "private owner reply") {
  return [
    "let pending = Buffer.alloc(0);",
    "let databaseBytes;",
    "let ready = false;",
    "const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');",
    "const drain = () => {",
    "  if (databaseBytes === undefined) {",
    "    const newline = pending.indexOf(10);",
    "    if (newline < 0) return;",
    "    databaseBytes = JSON.parse(pending.subarray(0, newline).toString('utf8')).bytes;",
    "    pending = pending.subarray(newline + 1);",
    "  }",
    "  if (!ready) {",
    "    if (pending.length < databaseBytes) return;",
    "    pending = pending.subarray(databaseBytes);",
    "    ready = true;",
    "    emit({ type: 'ready' });",
    "  }",
    "  while (true) {",
    "    const newline = pending.indexOf(10);",
    "    if (newline < 0) return;",
    "    const request = JSON.parse(pending.subarray(0, newline).toString('utf8'));",
    "    pending = pending.subarray(newline + 1);",
    `    emit({ id: request.id, ok: true, result: { period: request.period, retrieval_mode: 'fixture', results: [{ peer_before: ['private peer context'], owner_reply: ${JSON.stringify(ownerReply)} }] } });`,
    "  }",
    "};",
    "process.stdin.on('data', (chunk) => { pending = Buffer.concat([pending, chunk]); drain(); });",
  ].join("\n");
}

async function createDigitalMeArchive(
  root,
  description = "Finished persona Skill.",
  prefix = "",
  ownerReply = "private owner reply",
) {
  const file = (name) => `${prefix}${name}`;
  return createStoreZip({
    [file("SKILL.md")]: [
      "---",
      "name: digital-me",
      `description: ${description}`,
      "---",
      "# Finished product instructions",
      "Reply naturally and use retrieved context privately.",
    ].join("\n"),
    [file("agents/openai.yaml")]: [
      "interface:",
      '  display_name: "墨白"',
      '  short_description: "调用相关记忆与时期人格"',
    ].join("\n"),
    [file("references/retrieval.json")]: JSON.stringify({
      database_path: "../private/memory.sqlite3.enc",
      database_encryption: "modeldock-aes-256-gcm-v1",
      default_period: "current",
      available_years: ["2021", "2023", "2026"],
    }),
    [file("private/memory.sqlite3.enc")]: await encryptedFixture(root),
    [file("scripts/retrieve_context.py")]: fixtureWorker(ownerReply),
  });
}

function createRuntime(root) {
  return new LocalSkillRuntime({
    enabled: true,
    directory: root,
    pythonExecutable: process.execPath,
    allowScriptExecution: true,
  });
}

test("administrator package lifecycle exposes only sanitized Skill metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-skills-lifecycle-"));
  try {
    const runtime = createRuntime(root);
    await runtime.initialize();
    const installed = await runtime.installArchive(await createDigitalMeArchive(root, undefined, "digital-me/"));
    assert.equal(installed.id, "digital-me");
    assert.equal(installed.displayName, "墨白");
    assert.equal(installed.requiresLocalExecution, true);
    assert.equal(installed.runtimeReady, true);
    assert.equal(installed.defaultInvocationPolicy, "always");
    assert.equal("sourcePath" in installed, false);
    assert.equal("availablePeriods" in installed, false);

    await assert.rejects(
      runtime.installArchive(await createDigitalMeArchive(root)),
      (error) => error?.code === "SKILL_ALREADY_EXISTS",
    );

    const updated = await runtime.installArchive(
      await createDigitalMeArchive(root, "Updated persona Skill."),
      "digital-me",
    );
    await runtime.setDefaultInvocationPolicy("digital-me", "manual");
    assert.equal(
      (await runtime.listCatalog())[0].defaultInvocationPolicy,
      "manual",
    );
    const reloaded = createRuntime(root);
    assert.equal(
      (await reloaded.listCatalog())[0].defaultInvocationPolicy,
      "manual",
      "administrator defaults must persist independently from the Skill package",
    );
    assert.equal(updated.description, "调用相关记忆与时期人格");
    assert.equal(updated.defaultInvocationPolicy, "always");

    const deleted = await runtime.deleteSkill("digital-me");
    assert.equal(deleted.id, "digital-me");
    assert.deepEqual(await runtime.listCatalog(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-persona Skills default to intelligent invocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-skills-default-policy-"));
  try {
    const runtime = createRuntime(root);
    const installed = await runtime.installArchive(createStoreZip({
      "SKILL.md": [
        "---",
        "name: docs-helper",
        "description: Organize product documentation.",
        "---",
        "# Documentation helper",
      ].join("\n"),
    }));
    assert.equal(installed.defaultInvocationPolicy, "auto");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Skill ZIP extraction rejects path traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-skills-traversal-"));
  try {
    const runtime = createRuntime(root);
    await assert.rejects(
      runtime.installArchive(createStoreZip({
        "SKILL.md": "---\nname: safe\ndescription: safe\n---\n",
        "../escape.txt": "escape",
      })),
      (error) => error?.code === "INVALID_SKILL_ARCHIVE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selected digital-me Skill retrieves period-aware context for one request", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-skills-context-"));
  try {
    const runtime = createRuntime(root);
    await runtime.installArchive(await createDigitalMeArchive(root));
    assert.deepEqual(await runtime.buildSystemMessages(undefined, []), []);

    const systemMessages = await runtime.buildSystemMessages(
      "digital-me",
      [{ role: "user", content: "切换到2023年的墨白，聊聊 API 设计" }],
    );
    assert.equal(systemMessages.length, 1);
    assert.equal(systemMessages[0].role, "system");
    assert.match(systemMessages[0].content, /Finished product instructions/);
    assert.match(systemMessages[0].content, /"period":"2023"/);
    assert.match(systemMessages[0].content, /private owner reply/);
    assert.doesNotMatch(systemMessages[0].content, /memory\.sqlite3/);
    await runtime.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("encrypted Skill worker preserves UTF-8 memory records", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-skills-utf8-"));
  try {
    const runtime = createRuntime(root);
    await runtime.installArchive(await createDigitalMeArchive(
      root,
      "UTF-8 retrieval fixture.",
      "",
      "👌 墨白",
    ));
    const context = await runtime.buildAgentBootstrap(
      "digital-me",
      [{ role: "user", content: "你认识天涯吗" }],
    );
    assert.equal(context.memory.results[0].owner_reply, "👌 墨白");
    await runtime.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
