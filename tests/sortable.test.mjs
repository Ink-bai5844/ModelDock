import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("moveItemById moves an item to the target position without mutating input", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "modeldock-sort-test-"));
  try {
    await writeFile(
      join(outputDirectory, "package.json"),
      JSON.stringify({ type: "commonjs" }),
    );
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "src/reorder.ts",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--target",
        "es2022",
        "--outDir",
        outputDirectory,
        "--skipLibCheck",
        "--esModuleInterop",
      ],
      { cwd: resolve("."), stdio: "pipe" },
    );

    const { getSortMoveIntent, moveItemById } = require(
      join(outputDirectory, "reorder.js"),
    );
    const original = [{ id: "a" }, { id: "b" }, { id: "c" }];

    assert.deepEqual(
      moveItemById(original, "a", "c").map((item) => item.id),
      ["b", "c", "a"],
    );
    assert.deepEqual(
      moveItemById(original, "c", "a").map((item) => item.id),
      ["c", "a", "b"],
    );
    assert.deepEqual(original.map((item) => item.id), ["a", "b", "c"]);

    let reversible = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ];
    let previousIntent;
    for (const targetId of ["b", "c", "d"]) {
      previousIntent = getSortMoveIntent(
        reversible.map((item) => item.id),
        "a",
        targetId,
      );
      reversible = moveItemById(reversible, "a", targetId);
    }

    const reverseIntent = getSortMoveIntent(
      reversible.map((item) => item.id),
      "a",
      "d",
    );
    assert.deepEqual(previousIntent, {
      key: "d:after",
      position: "after",
      targetId: "d",
    });
    assert.deepEqual(reverseIntent, {
      key: "d:before",
      position: "before",
      targetId: "d",
    });
    assert.notEqual(reverseIntent.key, previousIntent.key);
    assert.deepEqual(
      moveItemById(reversible, "a", "d").map((item) => item.id),
      ["b", "c", "a", "d"],
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("all three registries expose sortable scopes and drag grips", async () => {
  const { readFile } = await import("node:fs/promises");
  const [appSource, catalogSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ModelCatalogWorkspace.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /scope: "api-endpoints"/);
  assert.match(catalogSource, /scope: "model-groups"/);
  assert.match(catalogSource, /scope: "catalog-models"/);
  assert.match(appSource, /className="sort-grip"/);
  assert.match(catalogSource, /className="sort-grip"/);
});

test("sortable pointer handling stays active when a dragged DOM node is reordered", async () => {
  const { readFile } = await import("node:fs/promises");
  const sortableSource = await readFile(
    new URL("../src/sortable.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(sortableSource, /pointerType === "mouse"/);
  assert.doesNotMatch(sortableSource, /onDragStart:/);
  assert.doesNotMatch(sortableSource, /setPointerCapture/);
  assert.doesNotMatch(sortableSource, /onLostPointerCapture:/);
  assert.match(sortableSource, /window\.addEventListener\("pointermove"/);
  assert.match(sortableSource, /window\.addEventListener\("pointerup"/);
  assert.match(sortableSource, /elementFromPoint/);
});

test("sortable feedback renders the actual before or after insertion edge", async () => {
  const { readFile } = await import("node:fs/promises");
  const [sortableSource, appSource, catalogSource, stylesSource] =
    await Promise.all([
      readFile(new URL("../src/sortable.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/ModelCatalogWorkspace.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

  assert.match(sortableSource, /overPosition/);
  assert.match(sortableSource, /getSortMoveIntent/);
  assert.match(appSource, /sort-over-\$\{apiSorter\.overPosition\}/);
  assert.match(catalogSource, /sort-over-\$\{groupSorter\.overPosition\}/);
  assert.match(catalogSource, /sort-over-\$\{modelSorter\.overPosition\}/);
  assert.match(stylesSource, /\.sort-over-before::before/);
  assert.match(stylesSource, /\.sort-over-after::before/);
});
