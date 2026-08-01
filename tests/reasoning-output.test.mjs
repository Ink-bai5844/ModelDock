import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { AnthropicAdapter } from "../dist-server/providers/anthropic.js";
import { GeminiAdapter } from "../dist-server/providers/gemini.js";
import { OllamaAdapter } from "../dist-server/providers/ollama.js";
import {
  normalizeReasoningStream,
  ReasoningTagParser,
} from "../dist-server/providers/reasoning-stream.js";

function startReasoningProvider() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : undefined;
    requests.push({ path: request.url, body });

    if (request.url === "/api/chat") {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end(
        '{"message":{"thinking":"先分析问题。","content":""}}\n' +
          '{"message":{"thinking":"","content":"最终回答。"}}\n',
      );
      return;
    }

    if (request.url?.startsWith("/v1beta/models/gemini-test:streamGenerateContent")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"candidates":[{"content":{"parts":[{"text":"思考摘要。","thought":true}]}}]}\n\n' +
          'data: {"candidates":[{"content":{"parts":[{"text":"Gemini 回答。"}]}}]}\n\n',
      );
      return;
    }

    if (request.url === "/v1/messages") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Claude 思考。"}}\n\n' +
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude 回答。"}}\n\n',
      );
      return;
    }

    response.writeHead(404);
    response.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function collect(iterable) {
  let reasoning = "";
  let text = "";
  for await (const chunk of iterable) {
    if (chunk.type === "reasoning-delta") reasoning += chunk.text;
    if (chunk.type === "text-delta") text += chunk.text;
  }
  return { reasoning, text };
}

test("reasoning tag parser handles tags split across stream chunks", () => {
  const parser = new ReasoningTagParser();
  const chunks = [
    ...parser.push("<thi"),
    ...parser.push("nk>先分析"),
    ...parser.push("问题</th"),
    ...parser.push("ink>最终回答"),
    ...parser.finish(),
  ];
  assert.deepEqual(chunks, [
    { type: "reasoning-delta", text: "先分析" },
    { type: "reasoning-delta", text: "问题" },
    { type: "text-delta", text: "最终回答" },
  ]);
});

test("disabled reasoning removes provider traces and local think tags", async () => {
  async function* source() {
    yield { type: "reasoning-delta", text: "隐藏的接口思考" };
    yield { type: "text-delta", text: "<think>隐藏的本地思考</think>最终回答" };
  }

  const chunks = [];
  for await (const chunk of normalizeReasoningStream(source(), false)) {
    chunks.push(chunk);
  }
  assert.deepEqual(chunks, [{ type: "text-delta", text: "最终回答" }]);
});

test("Ollama, Gemini and Anthropic adapters expose reasoning chunks", async () => {
  const provider = await startReasoningProvider();
  try {
    const request = {
      model: "test-model",
      messages: [{ role: "user", content: "测试" }],
      reasoning: true,
    };

    const ollama = await collect(
      new OllamaAdapter().streamChat(
        {
          id: "ollama",
          name: "Ollama",
          format: "ollama",
          endpoint: provider.endpoint,
          apiKey: "",
          enabled: true,
        },
        request,
      ),
    );
    const gemini = await collect(
      new GeminiAdapter().streamChat(
        {
          id: "gemini",
          name: "Gemini",
          format: "gemini",
          endpoint: provider.endpoint,
          apiKey: "",
          enabled: true,
        },
        { ...request, model: "gemini-test" },
      ),
    );
    const anthropic = await collect(
      new AnthropicAdapter().streamChat(
        {
          id: "anthropic",
          name: "Anthropic",
          format: "anthropic",
          endpoint: provider.endpoint,
          apiKey: "",
          enabled: true,
        },
        request,
      ),
    );

    assert.deepEqual(ollama, {
      reasoning: "先分析问题。",
      text: "最终回答。",
    });
    assert.deepEqual(gemini, {
      reasoning: "思考摘要。",
      text: "Gemini 回答。",
    });
    assert.deepEqual(anthropic, {
      reasoning: "Claude 思考。",
      text: "Claude 回答。",
    });

    assert.equal(
      provider.requests.find((entry) => entry.path === "/api/chat").body.think,
      true,
    );
    assert.equal(
      provider.requests.find((entry) =>
        entry.path.startsWith("/v1beta/models/gemini-test"),
      ).body.generationConfig.thinkingConfig.includeThoughts,
      true,
    );
    assert.equal(
      provider.requests.find((entry) => entry.path === "/v1/messages").body
        .thinking.type,
      "enabled",
    );

    await collect(
      new OllamaAdapter().streamChat(
        {
          id: "ollama",
          name: "Ollama",
          format: "ollama",
          endpoint: provider.endpoint,
          apiKey: "",
          enabled: true,
        },
        { ...request, reasoning: false },
      ),
    );
    const ollamaRequests = provider.requests.filter(
      (entry) => entry.path === "/api/chat",
    );
    assert.equal(ollamaRequests.at(-1).body.think, false);
  } finally {
    await provider.close();
  }
});
