import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ordinary Skill directory exposes per-account invocation policies without server paths", async () => {
  const [workspace, state, api, types] = await Promise.all([
    readFile("src/SkillWorkspace.tsx", "utf8"),
    readFile("src/accountState.ts", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("src/types.ts", "utf8"),
  ]);

  assert.match(workspace, /Skill目录/);
  assert.match(workspace, /始终调用/);
  assert.match(workspace, /智能判断/);
  assert.match(workspace, /仅手动/);
  assert.match(workspace, /onPolicyChange/);
  assert.match(workspace, /settings-workspace skill-directory-workspace/);
  assert.match(workspace, /skill-directory-layout/);
  assert.match(workspace, /skill-registry/);
  assert.match(workspace, /skill-detail-panel/);
  for (const forbidden of [
    "允许本地检索",
    "检索片段仅进入本轮请求",
    "默认时期",
    "当前时期",
    "加载到聊天",
    "移除",
    "sourcePath",
    "C:\\\\Users",
  ]) {
    assert.doesNotMatch(workspace, new RegExp(forbidden));
  }
  assert.match(state, /version: 9/);
  assert.match(state, /skillInvocationPolicies/);
  assert.doesNotMatch(state, /InstalledSkill/);
  assert.doesNotMatch(api, /\/api\/skills\/inspect/);
  assert.doesNotMatch(types, /sourcePath/);
});

test("chat title can be renamed inline and updates persisted conversation history", async () => {
  const [app, styles] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/styles.css", "utf8"),
  ]);

  assert.match(app, /renameCurrentConversation/);
  assert.match(app, /title: normalizedTitle/);
  assert.match(app, /aria-label="重命名对话标题"/);
  assert.match(app, /aria-label="对话标题"/);
  assert.match(app, /aria-label="保存对话标题"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(styles, /\.topbar-title-editor/);
  assert.match(styles, /\.topbar-rename-button/);
});

test("chat composer selects a Skill with slash commands and grows to five lines", async () => {
  const [app, styles] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/styles.css", "utf8"),
  ]);
  assert.match(app, /draft\.startsWith\("\/"\)/);
  assert.match(app, /skill-slash-picker/);
  assert.match(app, /streamChat\(\s*\{[\s\S]*?skillId,/);
  assert.match(app, /lineHeight \* 5 \+ 8/);
  assert.match(app, /textarea\.style\.height = "auto"/);
  assert.match(styles, /\.skill-slash-picker/);
  assert.match(styles, /\.composer-skill-chip/);
});

test("only the administrator interface exposes Skill package mutations", async () => {
  const [admin, api, server] = await Promise.all([
    readFile("src/AdminApp.tsx", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("server/index.ts", "utf8"),
  ]);
  assert.match(admin, /installAdminSkill/);
  assert.match(admin, /updateAdminSkill/);
  assert.match(admin, /deleteAdminSkill/);
  assert.match(admin, /updateAdminSkillPolicy/);
  assert.match(admin, /默认调用策略/);
  assert.match(admin, /accept="\.zip,application\/zip"/);
  assert.match(api, /\/api\/admin\/skills/);
  assert.match(server, /getAdminSession\(sessionToken\(request\)\)/);
  assert.match(server, /localSkills\.installArchive/);
  assert.match(server, /localSkills\.deleteSkill/);
  assert.match(server, /localSkills\.setDefaultInvocationPolicy/);
  assert.match(server, /skills\.filter\(\(skill\) => skill\.runtimeReady\)/);
});
