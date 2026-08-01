import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("accounts marked version 4 still receive the missing ccode image edit template", async () => {
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
    const staleAccountState = createDefaultAppState();
    staleAccountState.version = 4;
    staleAccountState.customMappingTemplates =
      staleAccountState.customMappingTemplates.filter(
        (template) => template.id !== "builtin-ccode-image-edit",
      );

    const migrated = normalizeAppState(staleAccountState);

    assert.ok(
      migrated.customMappingTemplates.some(
        (template) => template.id === "builtin-ccode-image-edit",
      ),
      "version 4 account should receive the missing built-in template",
    );

    migrated.deletedBuiltInTemplateIds = ["builtin-ccode-image-edit"];
    migrated.customMappingTemplates = migrated.customMappingTemplates.filter(
      (template) => template.id !== "builtin-ccode-image-edit",
    );
    const deliberatelyDeleted = normalizeAppState(migrated);
    assert.equal(
      deliberatelyDeleted.customMappingTemplates.some(
        (template) => template.id === "builtin-ccode-image-edit",
      ),
      false,
      "an explicitly deleted built-in template should stay deleted",
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
