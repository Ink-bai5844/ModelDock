import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  ACCOUNT_THEME_CACHE_KEY,
  readAccountThemeCache,
  rememberAccountTheme,
} from "../src/accountThemeCache.ts";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bootstrapScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

test("initial loading screen inherits the active account theme", () => {
  assert.ok(bootstrapScript, "index.html must contain the synchronous theme bootstrap");

  const storage = new Map([
    ["modeldock-theme", "dark"],
    [
      "modeldock.account-theme-cache",
      JSON.stringify({ accountId: "account-ink", theme: "light" }),
    ],
  ]);
  const documentElement = { dataset: {}, style: {} };

  vm.runInNewContext(bootstrapScript, {
    document: { documentElement },
    localStorage: { getItem: (key) => storage.get(key) ?? null },
  });

  assert.equal(
    documentElement.dataset.theme,
    "light",
    "the loading screen must prefer the active account theme over stale global settings",
  );
  assert.equal(documentElement.style.colorScheme, "light");
});

test("the workspace cache records the active account and its latest theme", () => {
  const storage = new Map();
  const adapter = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };

  rememberAccountTheme(adapter, "account-ink", "dark");
  rememberAccountTheme(adapter, "account-ink", "light");

  assert.deepEqual(readAccountThemeCache(adapter), {
    accountId: "account-ink",
    theme: "light",
  });
  assert.equal(
    storage.get(ACCOUNT_THEME_CACHE_KEY),
    JSON.stringify({ accountId: "account-ink", theme: "light" }),
  );
});
