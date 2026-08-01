import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("only the configured administrator can list and delete other accounts", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-admin-test-"));
  const dataDirectory = await mkdtemp(join(tmpdir(), "modeldock-admin-data-"));
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
    const vault = new AccountVault(storage, sessions, "admin");
    await vault.initialize();

    const admin = await vault.register("admin", "admin-pass-123");
    const member = await vault.register("member-user", "member-pass-123");

    await assert.rejects(
      () => vault.loginAdmin("member-user", "member-pass-123"),
      (error) => error?.code === "ADMIN_ACCESS_DENIED",
    );
    const adminLogin = await vault.loginAdmin("admin", "admin-pass-123");
    const accounts = await vault.listAdminAccounts(adminLogin.token);
    assert.deepEqual(
      accounts.map((account) => ({
        username: account.username,
        administrator: account.administrator,
      })),
      [
        { username: "admin", administrator: true },
        { username: "member-user", administrator: false },
      ],
    );
    assert.equal("password" in accounts[0], false);
    assert.equal("vaultSalt" in accounts[0], false);

    await assert.rejects(
      () => vault.deleteAccountAsAdmin(adminLogin.token, admin.user.id),
      (error) => error?.code === "ADMIN_ACCOUNT_PROTECTED",
    );
    const deleted = await vault.deleteAccountAsAdmin(
      adminLogin.token,
      member.user.id,
    );
    assert.equal(deleted.username, "member-user");
    assert.equal(await storage.findById(member.user.id), null);
    assert.throws(
      () => vault.getSession(member.token),
      (error) => error?.code === "SESSION_EXPIRED",
    );
  } finally {
    await Promise.all([
      rm(outputDirectory, { recursive: true, force: true }),
      rm(dataDirectory, { recursive: true, force: true }),
    ]);
  }
});
