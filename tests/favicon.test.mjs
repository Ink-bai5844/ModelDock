import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser tab uses the ModelDock violet brand mark", async () => {
  const [html, favicon] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
  ]);

  assert.match(
    html,
    /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/,
  );
  assert.match(favicon, /viewBox="0 0 25 25"/);
  assert.match(
    favicon,
    /<rect x="0" y="0" width="25" height="25" rx="6" fill="#c8a4ff"\/>/,
  );
  assert.match(favicon, /<circle cx="22" cy="24" r="9" fill="#170d24"\/>/);
  assert.match(
    favicon,
    /<rect x="7\.5" y="7" width="2" height="11" rx="2" transform="rotate\(-32 8\.5 12\.5\)"\/>/,
  );
  assert.match(
    favicon,
    /<rect x="11\.5" y="5" width="2" height="15" rx="2" transform="rotate\(-32 12\.5 12\.5\)"\/>/,
  );
  assert.match(
    favicon,
    /<rect x="15\.5" y="8\.5" width="2" height="8" rx="2" transform="rotate\(-32 16\.5 12\.5\)"\/>/,
  );
  assert.doesNotMatch(favicon, /<path /);
});
