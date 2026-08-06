import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { AgentRuntime } from "../dist-server/agent/agent-runtime.js";
import { AgentDataWorkspace } from "../dist-server/agent/data-workspace.js";
import { extractSkillArchive } from "../dist-server/skills/zip-package.js";

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

test("Agent data tools stay inside the account workspace under data", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-data-"));
  try {
    const workspace = new AgentDataWorkspace(root);
    const written = await workspace.write("account-a", "notes/plan.md", "hello Agent");
    assert.equal(written.path, "notes/plan.md");
    assert.equal((await workspace.read("account-a", "notes/plan.md")).content, "hello Agent");
    assert.deepEqual(await workspace.search("account-a", "agent"), [
      { path: "notes/plan.md", line: 1, text: "hello Agent" },
    ]);
    await assert.rejects(
      workspace.write("account-a", "../escape.txt", "blocked"),
      (error) => error?.code === "INVALID_AGENT_PATH",
    );
    await assert.rejects(
      workspace.read("account-a", isAbsolute("C:\\Windows") ? "C:\\Windows" : "/etc/passwd"),
      (error) => error?.code === "INVALID_AGENT_PATH",
    );
    await assert.rejects(
      workspace.read("account-b", "notes/plan.md"),
      (error) => error?.code === "AGENT_FILE_NOT_FOUND",
    );
    await assert.rejects(access(join(root, "escape.txt")));
    assert.equal(await readFile(join(root, "agent-workspaces", "account-a", "notes", "plan.md"), "utf8"), "hello Agent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asking about previously written code may read it without forcing a new download", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-code-followup-"));
  try {
    const workspace = new AgentDataWorkspace(root);
    await workspace.write(
      "account-a",
      "sieve.py",
      "def sieve(limit):\n    return []\n",
    );
    const runtime = new AgentRuntime(workspace, {
      enabled: false,
      async listCatalog() { return []; },
    });
    let modelTurn = 0;
    const events = await collect(runtime.run({
      accountId: "account-a",
      messages: [
        { role: "user", content: "写个素数筛" },
        { role: "assistant", content: "已经写入 sieve.py 并打包。" },
        { role: "user", content: "还记得你上次写的代码具体内容吗" },
      ],
      activeSkillIds: [],
      webSearchEnabled: false,
      codeModeEnabled: true,
      reasoningEnabled: false,
      async *streamModel(messages) {
        modelTurn += 1;
        if (modelTurn === 1) {
          yield {
            type: "text-delta",
            text: `<modeldock_tool>${JSON.stringify({
              name: "read_file",
              arguments: { path: "sieve.py" },
            })}</modeldock_tool>`,
          };
          return;
        }
        assert.match(messages.at(-1).content, /def sieve/);
        yield {
          type: "text-delta",
          text: "记得，sieve.py 定义了 sieve(limit) 函数。",
        };
      },
    }));

    assert.equal(modelTurn, 2);
    assert.ok(events.some(
      (event) =>
        event.type === "chunk" &&
        event.chunk.type === "text-delta" &&
        event.chunk.text.includes("sieve.py"),
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent writes respect each account workspace quota", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-quota-"));
  try {
    const workspace = new AgentDataWorkspace(root, {
      quotaBytes: () => 1024 * 1024,
    });
    const chunk = "x".repeat(256 * 1024);
    await workspace.write("account-a", "one.txt", chunk);
    await workspace.write("account-a", "two.txt", chunk);
    await workspace.write("account-a", "three.txt", chunk);
    await workspace.write("account-a", "four.txt", chunk);
    await assert.rejects(
      workspace.write("account-a", "over-quota.txt", "x"),
      (error) => error?.code === "WORKSPACE_QUOTA_EXCEEDED",
    );

    await workspace.write("account-b", "notes/one.txt", "hello");
    const snapshot = await workspace.snapshot("account-b");
    assert.equal(snapshot.usedBytes, 5);
    assert.equal(snapshot.quotaBytes, 1024 * 1024);
    assert.equal(snapshot.files[0].mimeType, "text/plain; charset=utf-8");
    assert.equal(snapshot.files[0].path, "notes/one.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser Agent forces requested files into one downloadable ZIP attachment", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-delivery-"));
  try {
    let modelTurn = 0;
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), {
      enabled: false,
      async listCatalog() { return []; },
    });
    const source = [
      "def factorial(n):",
      "    if n < 0:",
      "        raise ValueError('n must be non-negative')",
      "    result = 1",
      "    for value in range(2, n + 1):",
      "        result *= value",
      "    return result",
      "",
    ].join("\n");
    const readme = "# Factorial\n\n下载 ZIP 并解压后即可查看完整程序。\n";
    const events = await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "写一个计算阶乘的程序" }],
      activeSkillIds: [],
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel(messages) {
        modelTurn += 1;
        if (modelTurn === 1) {
          assert.match(messages[0].content, /ModelDock browser chat/);
          assert.match(messages[0].content, /automatically packaged.*ZIP attachment/);
          yield { type: "text-delta", text: "已创建 factorial.py。" };
        } else if (modelTurn === 2) {
          assert.match(messages.at(-1).content, /requires a downloadable file/);
          yield {
            type: "text-delta",
            text: `<modeldock_tool>${JSON.stringify({
              name: "write_file",
              arguments: { path: "factorial/factorial.py", content: source },
            })}</modeldock_tool>`,
          };
        } else if (modelTurn === 3) {
          assert.match(messages.at(-1).content, /factorial\.py/);
          yield {
            type: "text-delta",
            text: `<modeldock_tool>${JSON.stringify({
              name: "write_file",
              arguments: { path: "factorial/README.md", content: readme },
            })}</modeldock_tool>`,
          };
        } else {
          assert.match(messages.at(-1).content, /README\.md/);
          yield { type: "text-delta", text: "程序已打包，请下载聊天中的 ZIP 附件。" };
        }
      },
    }));

    assert.equal(modelTurn, 4);
    const attachmentEvent = events.find(
      (event) => event.type === "chunk" && event.chunk.type === "attachment",
    );
    assert.ok(attachmentEvent);
    assert.equal(attachmentEvent.chunk.attachment.name, "factorial.zip");
    assert.equal(attachmentEvent.chunk.attachment.mimeType, "application/zip");
    assert.equal(attachmentEvent.chunk.attachment.kind, "text");
    assert.match(attachmentEvent.chunk.attachment.dataUrl, /^data:application\/zip;base64,/);
    const archive = Buffer.from(
      attachmentEvent.chunk.attachment.dataUrl.split(",", 2)[1],
      "base64",
    );
    const extracted = join(root, "extracted");
    await extractSkillArchive(archive, extracted);
    assert.equal(await readFile(join(extracted, "factorial", "factorial.py"), "utf8"), source);
    assert.equal(await readFile(join(extracted, "factorial", "README.md"), "utf8"), readme);
    assert.equal(
      events.some(
        (event) =>
          event.type === "step" &&
          event.step.tool === "package_files" &&
          event.step.status === "completed",
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent loops through repeated Skill retrievals before returning the final answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-loop-"));
  try {
    const skillCalls = [];
    const skills = {
      enabled: true,
      async listCatalog() {
        return [{
          id: "digital-me",
          name: "digital-me",
          displayName: "墨白",
          description: "对话人格与记忆",
          requiresLocalExecution: true,
          runtimeReady: true,
          capabilities: ["instructions", "private-memory"],
        }];
      },
      async buildAgentToolResult(skillId, query, period) {
        skillCalls.push({ skillId, query, period });
        return {
          skill: { id: skillId, name: "墨白", description: "对话人格与记忆" },
          instructions: "每轮按需检索并自然回复。",
          period,
          memory: { results: [{ query }] },
        };
      },
      async buildAgentBootstrap(skillId) {
        return this.buildAgentToolResult(skillId, "当前对话", "current");
      },
    };
    let modelTurn = 0;
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), skills);
    const events = await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "结合过去的表达方式和我聊天" }],
      activeSkillIds: ["digital-me"],
      requiredSkillId: "digital-me",
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel(messages) {
        modelTurn += 1;
        if (modelTurn === 1) {
          yield {
            type: "text-delta",
            text: '<modeldock_tool>{"name":"skill_context","arguments":{"skill_id":"digital-me","query":"亲昵互动","period":"current"}}</modeldock_tool>',
          };
        } else if (modelTurn === 2) {
          assert.match(messages.at(-1).content, /亲昵互动/);
          yield {
            type: "text-delta",
            text: '<modeldock_tool>{"name":"skill_context","arguments":{"skill_id":"digital-me","query":"简短回应风格","period":"current"}}</modeldock_tool>',
          };
        } else {
          yield { type: "text-delta", text: "自然的最终回答" };
        }
      },
    }));

    assert.equal(modelTurn, 3);
    assert.equal(skillCalls.length, 3);
    assert.deepEqual(
      skillCalls.map((call) => call.query),
      ["当前对话", "亲昵互动", "简短回应风格"],
    );
    assert.equal(
      events.filter((event) => event.type === "chunk" && event.chunk.type === "text-delta")
        .map((event) => event.chunk.text)
        .join(""),
      "自然的最终回答",
    );
    assert.equal(
      events.filter((event) => event.type === "step" && event.step.tool === "skill_context" && event.step.status === "completed").length,
      3,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an active Skill remains optional on later Agent turns", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-persistent-skill-"));
  try {
    const skillCalls = [];
    const skills = {
      enabled: true,
      async listCatalog() {
        return [{
          id: "digital-me",
          name: "digital-me",
          displayName: "墨白",
          description: "对话人格与记忆",
          requiresLocalExecution: true,
          runtimeReady: true,
          capabilities: ["instructions", "private-memory"],
        }];
      },
      async buildAgentToolResult(skillId, query, period) {
        skillCalls.push({ skillId, query, period });
        return {
          skill: { id: skillId, name: "墨白", description: "对话人格与记忆" },
          instructions: "Before answering every turn, retrieve private memory.",
          period,
          memory: { results: [] },
        };
      },
      async buildAgentBootstrap(skillId) {
        return this.buildAgentToolResult(skillId, "你好 你认识天涯吗", "current");
      },
    };
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), skills);
    const events = await collect(runtime.run({
      accountId: "account-a",
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "嗯，你好" },
        { role: "user", content: "你认识天涯吗" },
      ],
      activeSkillIds: ["digital-me"],
      skillPolicies: { "digital-me": "auto" },
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel() {
        yield { type: "text-delta", text: "嗯……没什么印象。" };
      },
    }));

    assert.equal(skillCalls.length, 0);
    assert.equal(
      events.some((event) =>
        event.type === "step" &&
        event.step.tool === "skill_context" &&
        event.step.status === "completed"
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an always-invoked Skill is loaded before the model on every Agent turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-always-skill-"));
  try {
    const skillCalls = [];
    const skills = {
      enabled: true,
      async listCatalog() {
        return [{
          id: "digital-me",
          name: "digital-me",
          displayName: "墨白",
          description: "对话人格与记忆",
          defaultInvocationPolicy: "always",
          requiresLocalExecution: true,
          runtimeReady: true,
          capabilities: ["instructions", "private-memory"],
        }];
      },
      async buildAgentBootstrap(skillId) {
        skillCalls.push(skillId);
        return {
          skill: { id: skillId, name: "墨白", description: "对话人格与记忆" },
          instructions: "每轮检索后自然回复。",
          memory: { results: [{ owner_reply: "嗯" }] },
        };
      },
      async buildAgentToolResult() {
        throw new Error("unexpected discretionary retrieval");
      },
    };
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), skills);
    const events = await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "你好" }],
      activeSkillIds: ["digital-me"],
      skillPolicies: { "digital-me": "always" },
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel(messages) {
        assert.match(messages.at(-2).content, /每轮检索后自然回复/);
        yield { type: "text-delta", text: "嗯，你好" };
      },
    }));
    assert.deepEqual(skillCalls, ["digital-me"]);
    assert.equal(
      events.filter((event) =>
        event.type === "step" &&
        event.step.tool === "skill_context" &&
        event.step.status === "completed"
      ).length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a manual Skill runs only when explicitly selected for the current message", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-manual-skill-"));
  try {
    let bootstrapCalls = 0;
    const skills = {
      enabled: true,
      async listCatalog() {
        return [{
          id: "docs-helper",
          name: "docs-helper",
          displayName: "文档助手",
          description: "整理文档",
          defaultInvocationPolicy: "manual",
          requiresLocalExecution: false,
          runtimeReady: true,
          capabilities: ["instructions"],
        }];
      },
      async buildAgentBootstrap(skillId) {
        bootstrapCalls += 1;
        return {
          skill: { id: skillId, name: "文档助手", description: "整理文档" },
          instructions: "整理当前文档请求。",
        };
      },
      async buildAgentToolResult(skillId) {
        return this.buildAgentBootstrap(skillId);
      },
    };
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), skills);
    await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "继续聊天" }],
      activeSkillIds: ["docs-helper"],
      skillPolicies: { "docs-helper": "manual" },
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel(messages) {
        assert.doesNotMatch(messages[0].content, /docs-helper/);
        yield { type: "text-delta", text: "继续" };
      },
    }));
    assert.equal(bootstrapCalls, 0);

    await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "整理 README" }],
      activeSkillIds: ["docs-helper"],
      requiredSkillId: "docs-helper",
      skillPolicies: { "docs-helper": "manual" },
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel(messages) {
        assert.match(messages.at(-2).content, /整理当前文档请求/);
        yield { type: "text-delta", text: "已整理" };
      },
    }));
    assert.equal(bootstrapCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent can choose only the relevant Skill from multiple active candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-skill-choice-"));
  try {
    const skillCalls = [];
    const skills = {
      enabled: true,
      async listCatalog() {
        return [
          {
            id: "digital-me",
            name: "digital-me",
            displayName: "墨白",
            description: "对话人格与记忆",
            requiresLocalExecution: true,
            runtimeReady: true,
            capabilities: ["instructions", "private-memory"],
          },
          {
            id: "docs-helper",
            name: "docs-helper",
            displayName: "文档助手",
            description: "处理 README 和部署文档",
            requiresLocalExecution: false,
            runtimeReady: true,
            capabilities: ["instructions"],
          },
        ];
      },
      async buildAgentToolResult(skillId, query, period) {
        skillCalls.push({ skillId, query, period });
        return {
          skill: { id: skillId, name: skillId, description: "fixture" },
          instructions: "fixture instructions",
        };
      },
      async buildAgentBootstrap(skillId) {
        return this.buildAgentToolResult(skillId, "bootstrap", "current");
      },
    };
    let modelTurn = 0;
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), skills);
    await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "帮我整理 README" }],
      activeSkillIds: ["digital-me", "docs-helper"],
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel() {
        modelTurn += 1;
        if (modelTurn === 1) {
          yield {
            type: "text-delta",
            text: '<modeldock_tool>{"name":"skill_context","arguments":{"skill_id":"docs-helper","query":"README 部署","period":"current"}}</modeldock_tool>',
          };
        } else {
          yield { type: "text-delta", text: "整理完成" };
        }
      },
    }));
    assert.deepEqual(skillCalls.map((call) => call.skillId), ["docs-helper"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicit stop-Skill request clears the conversation candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-stop-skill-"));
  try {
    const skillCalls = [];
    const skills = {
      enabled: true,
      async listCatalog() {
        return [{
          id: "digital-me",
          name: "digital-me",
          displayName: "墨白",
          description: "对话人格与记忆",
          requiresLocalExecution: true,
          runtimeReady: true,
          capabilities: ["instructions", "private-memory"],
        }];
      },
      async buildAgentToolResult(skillId) {
        skillCalls.push(skillId);
        return { skill: { id: skillId }, instructions: "fixture" };
      },
      async buildAgentBootstrap(skillId) {
        return this.buildAgentToolResult(skillId);
      },
    };
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), skills);
    const events = await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "停止使用skill" }],
      activeSkillIds: ["digital-me"],
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel() {
        yield { type: "text-delta", text: "好的，已停止。" };
      },
    }));
    assert.deepEqual(skillCalls, []);
    assert.deepEqual(
      events.find((event) => event.type === "skills")?.activeSkillIds,
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("web_search is rejected inside Agent when the conversation toggle is off", async () => {
  const root = await mkdtemp(join(tmpdir(), "modeldock-agent-search-"));
  try {
    let modelTurn = 0;
    const runtime = new AgentRuntime(new AgentDataWorkspace(root), {
      enabled: false,
      async listCatalog() { return []; },
    });
    const events = await collect(runtime.run({
      accountId: "account-a",
      messages: [{ role: "user", content: "搜索今天的消息" }],
      activeSkillIds: [],
      webSearchEnabled: false,
      reasoningEnabled: false,
      async *streamModel(messages) {
        modelTurn += 1;
        if (modelTurn === 1) {
          yield {
            type: "text-delta",
            text: '<modeldock_tool>{"name":"web_search","arguments":{"query":"today"}}</modeldock_tool>',
          };
        } else {
          assert.match(messages.at(-1).content, /WEB_SEARCH_DISABLED/);
          yield { type: "text-delta", text: "无法联网，直接回答" };
        }
      },
    }));
    assert.equal(
      events.some((event) => event.type === "step" && event.step.tool === "web_search" && event.step.status === "failed"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
