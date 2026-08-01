import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API connection settings expose a controlled identification color input", async () => {
  const source = await readFile(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<span>识别颜色<\/span>/);
  assert.match(source, /type="color"\s+value=\{selected\.color\}/);
  assert.match(
    source,
    /onChange=\{\(event\) => patchSelected\(\{ color: event\.target\.value \}\)\}/,
  );
  assert.match(source, /--api-color": selected\.color/);
});
