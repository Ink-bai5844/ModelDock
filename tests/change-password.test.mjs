import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("changing a password re-encrypts file state and revokes old sessions", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-password-test-"));
  const dataDirectory = await mkdtemp(join(tmpdir(), "modeldock-password-data-"));
  try {
    await writeFile(
      join(outputDirectory, "package.json"),
      JSON.stringify({ type: "commonjs" }),
    );
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

    const { AccountVault } = require(
      join(outputDirectory, "auth", "account-vault.js"),
    );
    const { SessionManager } = require(
      join(outputDirectory, "auth", "session-manager.js"),
    );
    const { FileAccountStorage } = require(
      join(outputDirectory, "storage", "file-account-storage.js"),
    );
    const storage = new FileAccountStorage(dataDirectory);
    const sessions = new SessionManager(60_000);
    const vault = new AccountVault(storage, sessions);
    await vault.initialize();

    const registered = await vault.register("password-user", "old-pass-123");
    const secretState = {
      version: 5,
      configs: [{ id: "api", apiKey: "sk-sensitive" }],
    };
    await vault.writeState(registered.token, secretState);
    const accountBefore = await storage.findById(registered.user.id);
    const stateBefore = await storage.readState(registered.user.id);

    await assert.rejects(
      () =>
        vault.changePassword(
          registered.token,
          "wrong-pass-123",
          "new-pass-456",
        ),
      (error) => error?.code === "CURRENT_PASSWORD_INCORRECT",
    );

    const changed = await vault.changePassword(
      registered.token,
      "old-pass-123",
      "new-pass-456",
    );
    const accountAfter = await storage.findById(registered.user.id);
    const stateAfter = await storage.readState(registered.user.id);

    assert.notEqual(accountAfter.vaultSalt, accountBefore.vaultSalt);
    assert.notEqual(accountAfter.password.hash, accountBefore.password.hash);
    assert.notEqual(stateAfter.ciphertext, stateBefore.ciphertext);
    assert.deepEqual(await vault.readState(changed.token), secretState);
    assert.throws(
      () => vault.getSession(registered.token),
      (error) => error?.code === "SESSION_EXPIRED",
    );
    await assert.rejects(
      () => vault.login("password-user", "old-pass-123"),
      (error) => error?.code === "INVALID_CREDENTIALS",
    );
    const relogged = await vault.login("password-user", "new-pass-456");
    assert.deepEqual(await vault.readState(relogged.token), secretState);
  } finally {
    await Promise.all([
      rm(outputDirectory, { recursive: true, force: true }),
      rm(dataDirectory, { recursive: true, force: true }),
    ]);
  }
});
