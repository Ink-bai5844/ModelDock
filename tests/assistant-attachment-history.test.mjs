import assert from "node:assert/strict";
import test from "node:test";
import {
  toAnthropicContent,
  toGeminiParts,
  toOllamaMessage,
  toOpenAiMessages,
} from "../dist-server/providers/media-mapping.js";

test("OpenAI-compatible history never resends assistant ZIP attachments as file content parts", () => {
  const messages = toOpenAiMessages([
    {
      role: "user",
      content: "给我写个算阶乘的程序",
    },
    {
      role: "assistant",
      content: "程序已经生成，请下载附件。",
      attachments: [
        {
          id: "factorial-zip",
          kind: "text",
          name: "factorial.zip",
          mimeType: "application/zip",
          size: 4,
          dataUrl: "data:application/zip;base64,UEsDBA==",
        },
      ],
    },
    {
      role: "user",
      content: "还可以",
    },
  ]);

  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, "程序已经生成，请下载附件。");
  assert.equal(messages[2].content, "还可以");
});

test("other provider mappings also keep assistant output attachments out of model input", () => {
  const assistant = {
    role: "assistant",
    content: "文件已生成。",
    attachments: [
      {
        id: "result-file",
        kind: "text",
        name: "result.zip",
        mimeType: "application/zip",
        size: 4,
        dataUrl: "data:application/zip;base64,UEsDBA==",
      },
    ],
  };

  assert.equal(toAnthropicContent(assistant), "文件已生成。");
  assert.deepEqual(toGeminiParts(assistant), [{ text: "文件已生成。" }]);
  assert.deepEqual(toOllamaMessage(assistant), {
    role: "assistant",
    content: "文件已生成。",
  });
});
