import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [appSource, cssSource] = await Promise.all([
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

test("chat images open an accessible full-image preview instead of downloading", () => {
  assert.match(appSource, /function ImagePreviewModal/);
  assert.match(appSource, /role="dialog"/);
  assert.match(appSource, /aria-modal="true"/);
  assert.match(appSource, /if \(event\.key === "Escape"\) onClose\(\)/);
  assert.match(appSource, /onClick=\{\(\) => onPreviewImage\(attachment\)\}/);
  assert.match(appSource, /aria-label=\{`全图预览：\$\{attachment\.name\}`\}/);
  assert.doesNotMatch(
    appSource,
    /className="message-media message-media-image"[\s\S]{0,240}download=/,
  );
});

test("preview owns the explicit image download action", () => {
  assert.match(appSource, /DownloadSimple/);
  assert.match(appSource, /下载原图/);
  assert.match(appSource, /link\.download = attachment\.name/);
  assert.match(appSource, /URL\.createObjectURL\(await response\.blob\(\)\)/);
  assert.match(cssSource, /\.image-preview-stage img\s*\{[\s\S]*?object-fit:\s*contain;/);
  assert.match(cssSource, /\.draft-attachment-preview-button\s*\{/);
});
