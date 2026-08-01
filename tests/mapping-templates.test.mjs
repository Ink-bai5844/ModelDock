import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new accounts ship with only the four official OpenAI image templates", async () => {
  const source = await readFile(
    new URL("../src/mappingTemplates.ts", import.meta.url),
    "utf8",
  );
  for (const id of [
    "builtin-openai-image-generate",
    "builtin-openai-responses-generate",
    "builtin-openai-image-edit",
    "builtin-openai-responses-edit",
  ]) {
    assert.match(source, new RegExp(`id: "${id}"`));
  }
  assert.doesNotMatch(source, /builtin-ccode-image-generate/);
  assert.doesNotMatch(source, /builtin-ccode-image-edit/);
  assert.doesNotMatch(source, /api\.ccode\.vip/);
  assert.match(source, /requestEncoding: editing \? "multipart" : "json"/);
  assert.match(source, /requestMessagesMode:\s+action === "edit" \? "openai-responses-input"/);
});
