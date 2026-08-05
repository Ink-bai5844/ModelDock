import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRuntime } from "../dist-server/agent/agent-runtime.js";
import { AgentDataWorkspace } from "../dist-server/agent/data-workspace.js";
import { createCodeModeSystemMessage } from "../dist-server/chat/code-mode.js";

test("code mode gives browser-safe implementation instructions with and without Agent", () => {
  const direct = createCodeModeSystemMessage(false);
  assert.equal(direct.role, "system");
  assert.match(direct.content, /Code mode is ENABLED/);
  assert.match(direct.content, /complete, runnable implementation/i);
  assert.match(direct.content, /fenced code block/i);
  assert.match(direct.content, /do not claim.*created/i);

  const agent = createCodeModeSystemMessage(true);
  assert.match(agent.content, /write_file/);
  assert.match(agent.content, /ZIP attachment/);
  assert.doesNotMatch(agent.content, /You do not have file or terminal tools/);
});

test("Agent forwards the active code-mode contract to the model", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-code-mode-"));
  try {
    let inspected = false;
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), {
      enabled: false,
      async listCatalog() { return []; },
    });
    for await (const _event of runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "解释这段代码为什么会死循环" }],
      activeSkillIds: [],
      webSearchEnabled: false,
      codeModeEnabled: true,
      reasoningEnabled: false,
      async *streamModel(messages) {
        inspected = true;
        assert.ok(messages.some((message) =>
          message.role === "system" &&
          message.content.includes("Code mode is ENABLED") &&
          message.content.includes("write_file")
        ));
        yield { type: "text-delta", text: "循环条件不会变。" };
      },
    })) {
      // Consume the full Agent event stream.
    }
    assert.equal(inspected, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("code mode is persisted per conversation and forwarded through the full chat request", async () => {
  const [app, api, state, types, server, runtime] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("src/accountState.ts", "utf8"),
    readFile("src/types.ts", "utf8"),
    readFile("server/index.ts", "utf8"),
    readFile("server/agent/agent-runtime.ts", "utf8"),
  ]);

  assert.match(types, /codeMode\?: boolean/);
  assert.match(state, /codeMode: conversation\.codeMode === true/);
  assert.match(app, /initialConversation\?\.codeMode === true/);
  assert.match(app, /codeMode: codeMode/);
  assert.match(app, /codeMode: useCodeMode/);
  assert.match(app, /setCodeMode\(conversation\.codeMode === true\)/);
  assert.match(api, /codeMode\?: boolean/);
  assert.match(server, /codeMode\?: boolean/);
  assert.match(server, /body\.codeMode === true/);
  assert.match(server, /createCodeModeSystemMessage/);
  assert.match(runtime, /codeModeEnabled/);
  assert.match(runtime, /createCodeModeSystemMessage\(true\)/);
});
