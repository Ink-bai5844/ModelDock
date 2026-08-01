import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("chat messages use the same logged-in identity as the account avatar", () => {
  assert.doesNotMatch(
    appSource,
    /<span className="user-mark">MC<\/span>/,
    "the chat avatar must not contain a fixed account abbreviation",
  );
  assert.match(
    appSource,
    /<ChatWorkspace[\s\S]*?username=\{user\.username\}/,
    "the workspace must pass the logged-in username to the chat",
  );
  assert.match(
    appSource,
    /<UserAvatar className="user-mark" username=\{username\} \/>/,
    "chat messages must render the shared user avatar component",
  );
});
