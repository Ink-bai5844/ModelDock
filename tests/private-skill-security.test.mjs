import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  decryptMemoryFile,
  encryptMemoryFile,
  inspectEncryptedMemoryFile,
} from "../dist-server/skills/encrypted-memory.js";
import {
  extractPrivateTerms,
  PRIVATE_REASONING_NOTICE,
  PrivateResponseGuard,
  redactPrivateContent,
  redactPrivateValue,
} from "../dist-server/skills/privacy-guard.js";

test("private Skill memory uses authenticated encryption and rejects a wrong key", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-encrypted-memory-"));
  const plaintextPath = join(root, "memory.sqlite3");
  const encryptedPath = `${plaintextPath}.enc`;
  const plaintext = Buffer.from("SQLite format 3\0private-person@example.com 13800138000", "utf8");
  const key = randomBytes(32);
  try {
    await writeFile(plaintextPath, plaintext);
    await encryptMemoryFile(plaintextPath, encryptedPath, key);
    assert.equal(await inspectEncryptedMemoryFile(encryptedPath), true);
    const encrypted = await readFile(encryptedPath);
    assert.equal(encrypted.includes(Buffer.from("private-person@example.com")), false);

    const decrypted = await decryptMemoryFile(encryptedPath, key);
    assert.deepEqual(decrypted, plaintext);
    decrypted.fill(0);
    await assert.rejects(decryptMemoryFile(encryptedPath, randomBytes(32)));
  } finally {
    key.fill(0);
    plaintext.fill(0);
    await rm(root, { recursive: true, force: true });
  }
});

test("private Skill output preserves nicknames while redacting real identities and PII", () => {
  const messages = [{ role: "user", content: "你认识天涯吗？联系人是张三" }];
  const terms = extractPrivateTerms(messages);
  assert.equal(terms.includes("天涯"), false);
  assert.ok(terms.includes("张三"));
  const source = [
    "墨白和天涯让我联系张三先生。",
    "邮箱 person@example.com，手机 13800138000。",
    "地址：广东省深圳市南山区科技路88号。",
    "password: hunter2，Authorization: Bearer abcdefghijklmnop。",
    "身份证 110105199001011234。",
  ].join("\n");
  const redacted = redactPrivateContent(source, terms);
  assert.match(redacted, /墨白/);
  assert.match(redacted, /天涯/);
  assert.doesNotMatch(redacted, /张三|person@example\.com|13800138000|科技路88号|hunter2|abcdefghijklmnop|110105199001011234/);
  assert.match(redacted, /已隐藏姓名/);
  assert.match(redacted, /已隐藏联系方式/);
  assert.match(redacted, /已隐藏地址/);
  assert.match(redacted, /已隐藏敏感凭据/);
  assert.match(redacted, /已隐藏身份信息/);
  assert.equal(PRIVATE_REASONING_NOTICE, "思考过程已在隐私模式下隐藏。");
});

test("private memory payloads are sanitized recursively before provider use", () => {
  const payload = {
    results: [{
      peer_before: ["联系人：李四，邮箱 lisi@example.com"],
      owner_reply: "请寄到北京市朝阳区建国路12号，电话 13900139000",
    }],
  };
  const sanitized = redactPrivateValue(payload);
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /李四|lisi@example\.com|建国路12号|13900139000/);
});

test("private response guard catches PII split across stream chunks and hides raw reasoning", () => {
  const guard = new PrivateResponseGuard(["张三"]);
  guard.appendText("墨白请联系张三，邮箱 person@");
  guard.appendText("example.com，密码: hun");
  guard.appendText("ter2");
  assert.equal(guard.takeReasoningNotice(), PRIVATE_REASONING_NOTICE);
  assert.equal(guard.takeReasoningNotice(), undefined);
  const output = guard.flushText();
  assert.match(output, /墨白/);
  assert.doesNotMatch(output, /张三|person@example\.com|hunter2/);
});
