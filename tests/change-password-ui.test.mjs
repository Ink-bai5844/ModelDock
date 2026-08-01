import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("account menu exposes an accessible password change flow", async () => {
  const [appSource, apiSource, serverSource, stylesSource] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/api.ts", "utf8"),
    readFile("server/index.ts", "utf8"),
    readFile("src/styles.css", "utf8"),
  ]);

  assert.match(appSource, />\s*修改密码\s*</);
  assert.match(appSource, /<PasswordChangeDialog/);
  assert.match(appSource, /autoComplete="current-password"/);
  assert.match(appSource, /autoComplete="new-password"/);
  assert.match(appSource, /role="dialog"/);
  assert.match(appSource, /role="alert"/);
  assert.match(apiSource, /\/api\/auth\/change-password/);
  assert.match(serverSource, /url\.pathname === "\/api\/auth\/change-password"/);
  assert.match(
    stylesSource,
    /\.password-change-dialog\s*\{[\s\S]*background:\s*var\(--dialog-bg\)/,
  );
  assert.doesNotMatch(stylesSource, /var\(--accent-(?:contrast|hover)\)/);
});
