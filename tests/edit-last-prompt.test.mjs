import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("only the latest assistant message exposes retry and edit actions", () => {
  const latestOnlyActionGuards = appSource.match(
    /hidden=\{message\.id !== lastAssistantMessageId\}/g,
  );
  assert.equal(
    latestOnlyActionGuards?.length,
    2,
    "older assistant messages must expose neither retry nor edit",
  );
  assert.match(appSource, /aria-label="重新生成回答"/);
  assert.match(
    appSource,
    /aria-label="编辑并重发最后一条提示词"/,
    "the edit action must describe editing and resending the prompt",
  );
  assert.doesNotMatch(
    appSource,
    /editingMessageId|onUpdateMessage/,
    "assistant-response editing must stay removed",
  );
});

test("prompt editing restores attachments and replaces the prompt branch on send", () => {
  assert.match(appSource, /setDraft\(prompt\.content\)/);
  assert.match(appSource, /setDraftAttachments\(prompt\.attachments \?\? \[\]\)/);
  assert.match(
    appSource,
    /\[\.\.\.messagesRef\.current\.slice\(0, editingIndex\), nextUserMessage\]/,
    "resending must discard the old prompt and every response after it",
  );
});
