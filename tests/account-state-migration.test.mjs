import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("new accounts omit ccode templates while existing template lists stay unchanged", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-state-test-"));
  try {
    await writeFile(
      join(outputDirectory, "package.json"),
      JSON.stringify({ type: "commonjs" }),
    );
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "src/accountState.ts",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--target",
        "es2022",
        "--outDir",
        outputDirectory,
        "--skipLibCheck",
        "--esModuleInterop",
      ],
      { cwd: resolve("."), stdio: "pipe" },
    );

    const { createDefaultAppState, normalizeAppState } = require(
      join(outputDirectory, "accountState.js"),
    );
    const newAccount = createDefaultAppState();
    assert.deepEqual(
      newAccount.customMappingTemplates.map((template) => template.id),
      [
        "builtin-openai-image-generate",
        "builtin-openai-responses-generate",
        "builtin-openai-image-edit",
        "builtin-openai-responses-edit",
      ],
    );

    const existingAccount = createDefaultAppState();
    existingAccount.version = 4;
    existingAccount.customMappingTemplates.push(
      {
        ...structuredClone(existingAccount.customMappingTemplates[0]),
        id: "builtin-ccode-image-generate",
        name: "ccode.vip · GPT Image 2 Fast · 生图",
      },
      {
        ...structuredClone(existingAccount.customMappingTemplates[2]),
        id: "builtin-ccode-image-edit",
        name: "ccode.vip · GPT Image 2 Fast · 编辑图",
      },
    );
    const existingIds = existingAccount.customMappingTemplates.map(
      (template) => template.id,
    );
    const normalizedExisting = normalizeAppState(existingAccount);
    assert.deepEqual(
      normalizedExisting.customMappingTemplates.map((template) => template.id),
      existingIds,
      "an existing account must keep its saved templates",
    );

    const existingWithoutCcode = createDefaultAppState();
    existingWithoutCcode.version = 4;
    const normalizedWithoutCcode = normalizeAppState(existingWithoutCcode);
    assert.deepEqual(
      normalizedWithoutCcode.customMappingTemplates.map((template) => template.id),
      existingWithoutCcode.customMappingTemplates.map((template) => template.id),
      "normalization must not add ccode templates to an existing account",
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
