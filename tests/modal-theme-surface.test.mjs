import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("command and delete dialogs use opaque theme-specific surfaces", async () => {
  const css = await readFile("src/styles.css", "utf8");

  assert.match(css, /--dialog-bg:\s*#080a0a;/);
  assert.match(
    css,
    /:root\[data-theme="light"\][\s\S]*?--dialog-bg:\s*#ffffff;/,
  );
  assert.match(
    css,
    /\.history-delete-dialog\s*\{[\s\S]*?background:\s*var\(--dialog-bg\);/,
  );
  assert.match(
    css,
    /\.command-palette\s*\{[\s\S]*?background:\s*var\(--dialog-bg\);/,
  );
  assert.doesNotMatch(css, /var\(--(?:panel-solid|panel-soft|line-strong|line)\)/);
});
