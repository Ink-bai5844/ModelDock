import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("/admin is an address-only admin entry with protected account deletion", async () => {
  const [mainSource, adminSource, appSource, stylesSource] = await Promise.all([
    readFile("src/main.tsx", "utf8"),
    readFile("src/AdminApp.tsx", "utf8"),
    readFile("src/App.tsx", "utf8"),
    readFile("src/styles.css", "utf8"),
  ]);

  assert.match(mainSource, /\^\\\/admin\\\/\?\$/);
  assert.match(mainSource, /isAdminRoute \? <AdminApp \/> : <App \/>/);
  assert.doesNotMatch(appSource, /href=["']\/admin/);
  assert.match(adminSource, /loginAdmin\(username, password\)/);
  assert.doesNotMatch(adminSource, />\s*注册\s*</);
  assert.match(adminSource, /confirmation === account\.username/);
  assert.match(adminSource, /disabled=\{account\.administrator\}/);
  assert.match(adminSource, /deleteAdminAccount\(deleting\.id\)/);
  assert.match(adminSource, /document\.title = "ModelDock Admin"/);
  assert.match(adminSource, /id="main-content"/);
  assert.match(
    stylesSource,
    /\.admin-delete-dialog\s*\{[\s\S]*background:\s*var\(--dialog-bg\)/,
  );
});
