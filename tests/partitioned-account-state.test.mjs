import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

async function snapshotFiles(root) {
  const files = new Map();
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.set(relative(root, absolute), await readFile(absolute, "utf8"));
    }
  };
  await visit(root);
  return files;
}

test("account state partitions conversations and only rewrites changed messages", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-partition-build-"));
  const dataDirectory = await mkdtemp(join(tmpdir(), "modeldock-partition-data-"));
  try {
    await writeFile(join(outputDirectory, "package.json"), JSON.stringify({ type: "commonjs" }));
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "server/auth/account-vault.ts",
        "server/storage/file-account-storage.ts",
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

    const { AccountVault } = require(join(outputDirectory, "auth", "account-vault.js"));
    const { SessionManager } = require(join(outputDirectory, "auth", "session-manager.js"));
    const { FileAccountStorage } = require(join(outputDirectory, "storage", "file-account-storage.js"));
    const storage = new FileAccountStorage(dataDirectory);
    const vault = new AccountVault(storage, new SessionManager(60_000));
    await vault.initialize();

    const registered = await vault.register("partition-user", "password-123");
    const state = {
      version: 9,
      configs: [{ id: "api", apiKey: "secret" }],
      conversations: [
        {
          id: "conversation-1",
          title: "test",
          updatedAt: "2026-08-05T00:00:00.000Z",
          messages: [
            { id: "message-1", role: "user", content: "hello" },
            { id: "message-2", role: "assistant", content: "world" },
          ],
        },
      ],
    };

    await vault.writeState(registered.token, state);
    const first = await snapshotFiles(dataDirectory);
    assert.ok([...first.keys()].some((name) => name.includes("conversations")));
    assert.deepEqual(await vault.readState(registered.token), state);

    await vault.writeState(registered.token, structuredClone(state));
    const identical = await snapshotFiles(dataDirectory);
    assert.deepEqual(identical, first, "identical state must not re-encrypt or rewrite files");

    const changed = structuredClone(state);
    changed.conversations[0].messages[1].content = "updated";
    await vault.writeState(registered.token, changed);
    const second = await snapshotFiles(dataDirectory);
    const changedFiles = [...second.keys()].filter((name) => second.get(name) !== first.get(name));
    assert.equal(changedFiles.length, 1, `expected one changed message file, got ${changedFiles.join(", ")}`);
    assert.match(changedFiles[0], /messages/i);
    assert.deepEqual(await vault.readState(registered.token), changed);
  } finally {
    await Promise.all([
      rm(outputDirectory, { recursive: true, force: true }),
      rm(dataDirectory, { recursive: true, force: true }),
    ]);
  }
});
