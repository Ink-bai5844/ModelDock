import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function ruleBodies(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, "g"))]
    .map((match) => match[1]);
}

test("administrator dashboard owns a viewport-height vertical scroll container", () => {
  const bodyRule = ruleBodies("body").find((rule) => /overflow:\s*hidden\s*;/.test(rule));
  const adminRule = ruleBodies(".admin-shell")
    .find((rule) => /overflow:\s*hidden auto\s*;/.test(rule));

  assert.ok(bodyRule, "the application is expected to keep document scrolling locked");
  assert.ok(adminRule, "the administrator dashboard must own vertical scrolling");
  assert.match(
    adminRule,
    /(?:^|;)\s*height:\s*100dvh\s*;/,
    "the scroll container needs a bounded viewport height instead of min-height alone",
  );
});
