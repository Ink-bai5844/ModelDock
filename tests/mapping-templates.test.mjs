import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the account template registry ships with six editable image API templates", async () => {
  const source = await readFile(
    new URL("../src/mappingTemplates.ts", import.meta.url),
    "utf8",
  );
  for (const id of [
    "builtin-openai-image-generate",
    "builtin-openai-responses-generate",
    "builtin-openai-image-edit",
    "builtin-openai-responses-edit",
    "builtin-ccode-image-generate",
    "builtin-ccode-image-edit",
  ]) {
    assert.match(source, new RegExp(`id: "${id}"`));
  }
  assert.match(source, /requestEncoding: editing \? "multipart" : "json"/);
  assert.match(source, /requestMessagesMode:\s+action === "edit" \? "openai-responses-input"/);
  assert.match(source, /requestAttachmentsField: "image"/);
});
