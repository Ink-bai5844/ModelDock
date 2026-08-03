import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace navigation sits between chat and API connections", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const navigation = app.slice(
    app.indexOf('<nav className="primary-nav"'),
    app.indexOf("</nav>", app.indexOf('<nav className="primary-nav"')),
  );
  assert.ok(navigation.indexOf("对话") < navigation.indexOf("工作区"));
  assert.ok(navigation.indexOf("工作区") < navigation.indexOf("API 连接"));
  assert.match(app, /<WorkspaceFiles onToast=\{setToast\} \/>/);
  assert.match(app, /WORKSPACE \/ FILES/);
});

test("workspace page supports preview, download, search and confirmed deletion", async () => {
  const [workspace, api, styles] = await Promise.all([
    readFile("src/WorkspaceFiles.tsx", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("src/styles.css", "utf8"),
  ]);
  assert.match(workspace, /loadWorkspace\(\)/);
  assert.match(workspace, /loadWorkspaceFile\(previewFile\.path\)/);
  assert.match(workspace, /deleteWorkspaceFile\(deletingFile\.path\)/);
  assert.match(workspace, /application\/pdf/);
  assert.match(workspace, /text\/markdown/);
  assert.match(workspace, /workspaceFileUrl\(file\.path, true\)/);
  assert.match(api, /\/api\/workspace/);
  assert.match(styles, /\.workspace-preview-dialog/);
  assert.match(styles, /\.workspace-quota-track/);
});

test("workspace APIs bind file access to the authenticated session", async () => {
  const [server, workspace] = await Promise.all([
    readFile("server/index.ts", "utf8"),
    readFile("server/agent/data-workspace.ts", "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('url.pathname === "/api/workspace"'),
    server.indexOf('url.pathname === "/api/state"'),
  );
  assert.match(route, /vault\.getSession\(sessionToken\(request\)\)/);
  assert.match(route, /agentWorkspace\.snapshot\(user\.id\)/);
  assert.match(route, /agentWorkspace\.fileDescriptor\(user\.id, requestedPath\)/);
  assert.match(route, /agentWorkspace\.deleteFile\(user\.id, requestedPath\)/);
  assert.doesNotMatch(route, /searchParams\.get\("accountId"\)/);
  assert.match(workspace, /WORKSPACE_QUOTA_EXCEEDED/);
  assert.match(workspace, /isInside\(root, target\)/);
  assert.match(workspace, /info\.isSymbolicLink\(\)/);
});

test("administrator accounts expose individual workspace quota controls", async () => {
  const [admin, api, vault, storage] = await Promise.all([
    readFile("src/AdminApp.tsx", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("server/auth/account-vault.ts", "utf8"),
    readFile("server/storage/account-storage.ts", "utf8"),
  ]);
  assert.match(admin, /function AdminQuotaControl/);
  assert.match(admin, /工作区容量/);
  assert.match(api, /updateAdminWorkspaceQuota/);
  assert.match(vault, /updateWorkspaceQuotaAsAdmin/);
  assert.match(storage, /DEFAULT_WORKSPACE_QUOTA_BYTES = 100 \* 1024 \* 1024/);
});
