import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("model catalog exposes Agent capability directly below reasoning", async () => {
  const [catalog, types, state] = await Promise.all([
    readFile("src/ModelCatalogWorkspace.tsx", "utf8"),
    readFile("src/types.ts", "utf8"),
    readFile("src/accountState.ts", "utf8"),
  ]);
  assert.ok(catalog.indexOf("深度思考模式") < catalog.indexOf("Agent 工具调用"));
  assert.match(catalog, /patchModel\(\{ supportsAgent: event\.target\.checked \}\)/);
  assert.match(types, /supportsAgent\?: boolean/);
  assert.match(state, /supportsAgent:/);
});

test("chat shows Agent and web toggles only through the model capability flow", async () => {
  const [app, api, styles, types] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("src/styles.css", "utf8"),
    readFile("src/types.ts", "utf8"),
  ]);
  assert.match(app, /agentAvailable && \(/);
  assert.match(app, /agentAvailable && agentEnabled && \(/);
  assert.match(app, /模型已被告知 Agent 模式已开启/);
  assert.match(app, /模型已被告知可在 Agent 模式中联网搜索/);
  assert.match(app, /skillIds: currentActiveSkillIds/);
  assert.match(app, /chunk\.type === "agent-skills"/);
  assert.match(app, /setActiveSkillIds\(currentActiveSkillIds\)/);
  assert.match(app, /agentEnabled: agentActive/);
  assert.match(app, /webSearchEnabled: webSearchActive/);
  assert.match(api, /type: "agent-step"/);
  assert.match(styles, /\.agent-activity/);
  assert.match(types, /"package_files"/);
});

test("chat mode controls sit before send in web, Agent, reasoning order", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const composerFooter = app.slice(
    app.indexOf('<div className="composer-footer">'),
    app.indexOf("</form>", app.indexOf('<div className="composer-footer">')),
  );
  const webSearchIndex = composerFooter.indexOf('data-mode="web-search"');
  const agentIndex = composerFooter.indexOf('data-mode="agent"');
  const reasoningIndex = composerFooter.indexOf('data-mode="reasoning"');
  const sendIndex = composerFooter.indexOf('className="send-button');

  assert.ok(webSearchIndex >= 0);
  assert.ok(webSearchIndex < agentIndex);
  assert.ok(agentIndex < reasoningIndex);
  assert.ok(reasoningIndex < sendIndex);
  assert.match(composerFooter, /className="composer-actions"/);
});

test("right-side chat mode controls preserve the rounded button shape", async () => {
  const styles = await readFile("src/styles.css", "utf8");
  const modeButtonRule = styles.slice(
    styles.indexOf(".composer-mode-tools button.composer-reasoning-toggle {"),
    styles.indexOf(
      ".composer-mode-tools button.composer-reasoning-toggle:hover",
    ),
  );

  assert.match(modeButtonRule, /border-radius:\s*8px/);
});

test("reopening history restores the saved Agent and web-search modes", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const openHistory = app.slice(
    app.indexOf("const openHistory ="),
    app.indexOf("const newChat ="),
  );
  assert.match(openHistory, /setAgentEnabled\(conversation\.agentEnabled === true\)/);
  assert.match(openHistory, /setWebSearchEnabled\(/);
  assert.match(openHistory, /setActiveSkillIds\(conversationActiveSkillIds\(conversation\)\)/);
  assert.doesNotMatch(openHistory, /setAgentEnabled\(false\)/);
  assert.doesNotMatch(openHistory, /setWebSearchEnabled\(false\)/);
});

test("conversation Skill candidates are persisted separately from message badges", async () => {
  const [app, api, state, types, server] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("src/accountState.ts", "utf8"),
    readFile("src/types.ts", "utf8"),
    readFile("server/index.ts", "utf8"),
  ]);
  assert.match(types, /activeSkillIds\?: string\[\]/);
  assert.match(state, /activeSkillIds:/);
  assert.match(app, /activeSkillIds: \[\.\.\.new Set\(nextActiveSkillIds\)\]/);
  assert.match(api, /type: "agent-skills"/);
  assert.match(server, /type: "agent-skills"/);
});
