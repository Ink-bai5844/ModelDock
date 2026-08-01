import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace bootstrap mark shares the login violet brand colors", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(css, /--brand-violet:\s*#c8a4ff;/);
  assert.match(css, /--brand-violet-ink:\s*#170d24;/);
  assert.match(
    css,
    /:root\[data-theme="light"\][\s\S]*?--brand-violet:\s*#7042a3;[\s\S]*?--brand-violet-ink:\s*#ffffff;/,
  );
  assert.match(
    css,
    /\.bootstrap-screen \.brand-mark\s*\{[\s\S]*?background:\s*var\(--brand-violet\);/,
  );
  assert.match(
    css,
    /\.auth-shell\s*\{[\s\S]*?--auth-brand:\s*var\(--brand-violet\);[\s\S]*?--auth-brand-ink:\s*var\(--brand-violet-ink\);/,
  );
});
