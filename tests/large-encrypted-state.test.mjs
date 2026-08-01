import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("large encrypted account states are validated without regex stack overflow", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-base64-test-"));
  try {
    await writeFile(
      join(outputDirectory, "package.json"),
      JSON.stringify({ type: "commonjs" }),
    );
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "server/core/base64.ts",
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
        "--types",
        "node",
      ],
      { cwd: resolve("."), stdio: "pipe" },
    );

    const { decodeBase64 } = require(join(outputDirectory, "base64.js"));
    const source = Buffer.alloc(11 * 1024 * 1024, 0xa5);
    const encoded = source.toString("base64");
    const decoded = decodeBase64(encoded, "ciphertext");

    assert.equal(decoded.byteLength, source.byteLength);
    assert.equal(decoded.subarray(0, 64).equals(source.subarray(0, 64)), true);
    assert.throws(() => decodeBase64(`${encoded.slice(0, -1)}!`, "ciphertext"));
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
