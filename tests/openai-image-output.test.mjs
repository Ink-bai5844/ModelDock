import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  extractOpenAiOutputChunks,
  OpenAiCompatibleAdapter,
} from "../dist-server/providers/openai-compatible.js";

function startImageProvider() {
  let requestBody;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: [{ b64_json: "eHl6", mime_type: "image/png" }],
      }),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${address.port}/v1`,
        requestBody: () => requestBody,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("OpenAI-compatible image JSON becomes persisted image attachments", () => {
  const chunks = extractOpenAiOutputChunks({
    data: [
      { b64_json: "eHl6", mime_type: "image/png", name: "generated.png" },
      { url: "https://example.com/generated.webp" },
    ],
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].type, "attachment");
  assert.equal(chunks[0].attachment.kind, "image");
  assert.equal(chunks[0].attachment.dataUrl, "data:image/png;base64,eHl6");
  assert.equal(chunks[0].attachment.name, "generated.png");
  assert.equal(chunks[1].attachment.url, "https://example.com/generated.webp");
});

test("OpenAI-compatible chat and Responses image fields are both recognized", () => {
  const chunks = extractOpenAiOutputChunks({
    choices: [
      {
        message: {
          content: [
            {
              type: "image_url",
              image_url: { url: "https://example.com/chat-image.png" },
            },
          ],
        },
      },
    ],
    output: [
      {
        type: "image_generation_call",
        result: "eHl6",
      },
    ],
  });

  assert.deepEqual(
    chunks.map((chunk) => chunk.attachment.url ?? chunk.attachment.dataUrl),
    [
      "https://example.com/chat-image.png",
      "data:image/png;base64,eHl6",
    ],
  );
});

test("OpenAI-compatible output keeps reasoning separate from the final answer", () => {
  const chunks = extractOpenAiOutputChunks({
    choices: [
      {
        delta: {
          reasoning_content: "先比较两个数字的整数部分。",
          content: "9.8 更大。",
        },
      },
    ],
  });

  assert.deepEqual(chunks, [
    { type: "reasoning-delta", text: "先比较两个数字的整数部分。" },
    { type: "text-delta", text: "9.8 更大。" },
  ]);
});

test("OpenAI-compatible adapter consumes non-streaming image JSON", async () => {
  const provider = await startImageProvider();
  try {
    const adapter = new OpenAiCompatibleAdapter();
    const chunks = [];
    for await (const chunk of adapter.streamChat(
      {
        id: "image-provider",
        name: "Image Provider",
        format: "openai-compatible",
        endpoint: provider.endpoint,
        apiKey: "test-key",
        enabled: true,
      },
      {
        model: "image-2",
        messages: [{ role: "user", content: "生成一只猫" }],
      },
    )) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].attachment.kind, "image");
    assert.equal(chunks[0].attachment.dataUrl, "data:image/png;base64,eHl6");
    assert.equal(provider.requestBody().model, "image-2");
    assert.equal(provider.requestBody().stream, true);
  } finally {
    await provider.close();
  }
});

test("DeepSeek-compatible requests explicitly toggle thinking mode", async () => {
  const provider = await startImageProvider();
  try {
    const adapter = new OpenAiCompatibleAdapter();
    const config = {
      id: "deepseek",
      name: "DeepSeek",
      format: "openai-compatible",
      endpoint: provider.endpoint,
      apiKey: "test-key",
      enabled: true,
    };
    const request = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "比较两个方案" }],
    };

    await collectChunks(adapter.streamChat(config, { ...request, reasoning: false }));
    assert.equal(provider.requestBody().thinking.type, "disabled");

    await collectChunks(adapter.streamChat(config, { ...request, reasoning: true }));
    assert.equal(provider.requestBody().thinking.type, "enabled");
    assert.equal(provider.requestBody().reasoning_effort, "high");
  } finally {
    await provider.close();
  }
});

async function collectChunks(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}
