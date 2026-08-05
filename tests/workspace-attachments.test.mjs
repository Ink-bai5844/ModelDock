import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("base64 chat attachments are externalized and hydrated through the account workspace", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-attachment-build-"));
  const dataDirectory = await mkdtemp(join(tmpdir(), "modeldock-attachment-data-"));
  try {
    await writeFile(join(outputDirectory, "package.json"), JSON.stringify({ type: "commonjs" }));
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "server/attachments/workspace-attachments.ts",
        "server/agent/data-workspace.ts",
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

    const { AgentDataWorkspace } = require(join(outputDirectory, "agent", "data-workspace.js"));
    const {
      externalizeAccountStateAttachments,
      hydrateGatewayMessages,
    } = require(join(outputDirectory, "attachments", "workspace-attachments.js"));
    const workspace = new AgentDataWorkspace(dataDirectory);
    const source = Buffer.from("attachment-content", "utf8");
    const state = {
      version: 9,
      conversations: [{
        id: "conversation-1",
        messages: [{
          id: "message-1",
          role: "user",
          content: "file",
          attachments: [{
            id: "attachment-1",
            kind: "text",
            name: "sample.txt",
            mimeType: "text/plain",
            size: source.length,
            dataUrl: `data:text/plain;base64,${source.toString("base64")}`,
          }],
        }],
      }],
    };

    const migrated = await externalizeAccountStateAttachments("account-1", state, workspace);
    assert.equal(migrated.changed, true);
    const reference = migrated.state.conversations[0].messages[0].attachments[0];
    assert.equal(reference.dataUrl, undefined);
    assert.match(reference.workspacePath, /^attachments\//);
    assert.deepEqual(await workspace.readBinary("account-1", reference.workspacePath), source);

    const hydrated = await hydrateGatewayMessages(
      "account-1",
      migrated.state.conversations[0].messages,
      workspace,
    );
    assert.equal(hydrated[0].attachments[0].dataUrl, `data:text/plain;base64,${source.toString("base64")}`);

    const repeated = await externalizeAccountStateAttachments("account-1", migrated.state, workspace);
    assert.equal(repeated.changed, false);
  } finally {
    await Promise.all([
      rm(outputDirectory, { recursive: true, force: true }),
      rm(dataDirectory, { recursive: true, force: true }),
    ]);
  }
});
