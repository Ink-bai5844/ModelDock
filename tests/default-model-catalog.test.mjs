import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("new accounts receive the five requested model groups and model catalog", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-defaults-test-"));
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

    const { createDefaultAppState } = require(
      join(outputDirectory, "accountState.js"),
    );
    const state = createDefaultAppState();
    const groups = new Map(
      state.modelGroups.map((group) => [group.id, group.name]),
    );
    const catalogByGroup = Object.fromEntries(
      [...groups].map(([groupId, groupName]) => [
        groupName,
        state.catalogModels
          .filter((model) => model.groupId === groupId)
          .map((model) => ({
            name: model.name,
            invocationName: model.invocationName,
            inputTypes: model.inputTypes,
            supportsReasoning: model.supportsReasoning,
          })),
      ]),
    );

    assert.deepEqual([...groups.values()], [
      "OpenAI · Main",
      "Anthropic · Direct",
      "Google · Gemini",
      "DeepSeek · CN",
      "Ollama · Studio",
    ]);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(catalogByGroup).map(([groupName, models]) => [
          groupName,
          models.map((model) => model.invocationName),
        ]),
      ),
      {
        "OpenAI · Main": [
          "gpt-5.6-sol",
          "gpt-5.5",
          "gpt-5.4-mini",
          "gpt-image-2",
        ],
        "Anthropic · Direct": [
          "claude-fable-5",
          "claude-opus-4-8",
          "claude-opus-4-6",
          "claude-sonnet-5",
        ],
        "Google · Gemini": ["gemini-3.1-pro", "gemini-3.6-flash"],
        "DeepSeek · CN": ["deepseek-v4-pro", "deepseek-v4-flash"],
        "Ollama · Studio": ["qwen3:32b", "llama3.3:70b", "gemma3:27b"],
      },
    );
    assert.deepEqual(catalogByGroup["Google · Gemini"][0].inputTypes, [
      "text",
      "image",
      "video",
      "audio",
    ]);
    assert.deepEqual(catalogByGroup["DeepSeek · CN"][0].inputTypes, ["text"]);
    assert.equal(
      catalogByGroup["DeepSeek · CN"][0].supportsReasoning,
      true,
    );
    assert.equal(
      catalogByGroup["Ollama · Studio"][0].supportsReasoning,
      true,
    );
    assert.deepEqual(catalogByGroup["Ollama · Studio"][2].inputTypes, [
      "text",
      "image",
    ]);
    assert.equal(state.selectedModelId, "gpt-5.6-sol");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
