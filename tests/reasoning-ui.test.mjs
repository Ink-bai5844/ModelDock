import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chat UI separates reasoning from GFM Markdown answers", async () => {
  const [app, panel, markdown, catalog] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ReasoningPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/MarkdownContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ModelCatalogWorkspace.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(app, /chunk\.type === "reasoning-delta"/);
  assert.match(app, /<ReasoningPanel/);
  assert.match(app, /reasoningAvailable && \(/);
  assert.match(app, /aria-pressed=\{reasoningEnabled\}/);
  assert.match(app, /reasoning: useReasoning/);
  assert.match(app, /深度思考/);
  assert.match(panel, /思考过程/);
  assert.match(markdown, /remarkGfm/);
  assert.match(markdown, /markdown-code-block/);
  assert.match(catalog, /深度思考模式/);
});
