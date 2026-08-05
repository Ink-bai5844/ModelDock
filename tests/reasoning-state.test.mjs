import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reasoning mode is persisted and restored per conversation", async () => {
  const [app, state, types] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/accountState.ts", "utf8"),
    readFile("src/types.ts", "utf8"),
  ]);

  assert.match(types, /reasoningEnabled\?: boolean/);
  assert.match(state, /reasoningEnabled: conversation\.reasoningEnabled === true/);
  assert.match(app, /initialConversation\?\.reasoningEnabled === true/);
  assert.match(app, /reasoningEnabled: reasoningEnabled/);
  assert.match(app, /setReasoningEnabled\(conversation\.reasoningEnabled === true\)/);

  const modelCapabilitySection = app.slice(
    app.indexOf("const reasoningActive ="),
    app.indexOf("const historyItems ="),
  );
  assert.doesNotMatch(
    modelCapabilitySection,
    /selectedModel\?\.supportsReasoning[\s\S]{0,240}setReasoningEnabled\(false\)/,
  );

  const newChat = app.slice(
    app.indexOf("const newChat ="),
    app.indexOf("const deleteHistory ="),
  );
  assert.match(newChat, /setReasoningEnabled\(false\)/);
});
