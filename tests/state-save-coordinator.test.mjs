import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

test("state saves are suppressed while streaming, serialized, coalesced and hash-deduplicated", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-save-build-"));
  try {
    await writeFile(join(outputDirectory, "package.json"), JSON.stringify({ type: "commonjs" }));
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "src/state-save-coordinator.ts",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--target",
        "es2022",
        "--lib",
        "es2022,dom",
        "--outDir",
        outputDirectory,
        "--skipLibCheck",
      ],
      { cwd: resolve("."), stdio: "pipe" },
    );
    const { StateSaveCoordinator } = require(join(outputDirectory, "state-save-coordinator.js"));
    const saved = [];
    const coordinator = new StateSaveCoordinator(async (state) => {
      saved.push(structuredClone(state));
      await delay(5);
    });

    coordinator.setStreaming(true);
    coordinator.schedule({ value: "chunk-1" }, 1);
    coordinator.schedule({ value: "chunk-2" }, 1);
    await delay(15);
    assert.equal(saved.length, 0);

    await coordinator.flush({ value: "request-start" });
    coordinator.schedule({ value: "chunk-3" }, 1);
    await delay(15);
    assert.deepEqual(saved, [{ value: "request-start" }]);

    coordinator.setStreaming(false);
    coordinator.schedule({ value: "final" }, 1);
    await coordinator.waitForIdle();
    coordinator.schedule({ value: "final" }, 1);
    await coordinator.waitForIdle();
    assert.deepEqual(saved, [{ value: "request-start" }, { value: "final" }]);
    coordinator.dispose();
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
