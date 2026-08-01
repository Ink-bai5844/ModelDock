import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { CustomAdapter } from "../dist-server/providers/custom.js";

function startMockProvider() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const contentType = request.headers["content-type"] ?? "";
    const body =
      rawBody && contentType.includes("application/json")
        ? JSON.parse(rawBody)
        : undefined;
    requests.push({
      path: request.url,
      authorization: request.headers.authorization,
      customHeader: request.headers["x-modeldock-test"],
      contentType,
      rawBody,
      body,
    });

    if (request.url === "/api/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ catalog: [{ invocation: "custom-model" }] }));
      return;
    }
    if (request.url === "/api/chat-sse") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"chunk":{"reasoning":"Think ","text":"Hello "}}\n\n' +
          'data: {"chunk":{"reasoning":"SSE","text":"SSE","media":[{"data":"aGVsbG8=","mime":"text/plain","name":"hello.txt"}]}}\n\n' +
          "data: [DONE]\n\n",
      );
      return;
    }
    if (request.url === "/api/chat-ndjson") {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end(
        '{"chunk":{"reasoning":"Think ","text":"Hello "}}\n{"chunk":{"reasoning":"NDJSON","text":"NDJSON","media":[{"data":"aGVsbG8=","mime":"text/plain","name":"hello.txt"}]}}\n',
      );
      return;
    }
    if (request.url === "/api/chat-json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          chunk: {
            reasoning: "Think JSON",
            text: "Hello JSON",
            media: [
              {
                data: "aGVsbG8=",
                mime: "text/plain",
                name: "hello.txt",
              },
            ],
          },
        }),
      );
      return;
    }
    if (request.url === "/api/images/generations") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          created: 1_753_900_000,
          data: [{ b64_json: "eHl6" }],
        }),
      );
      return;
    }
    if (request.url === "/api/images/edits") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          created: 1_753_900_001,
          data: [{ b64_json: "ZWRpdGVk" }],
        }),
      );
      return;
    }
    if (request.url === "/api/responses") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          output: [
            {
              type: "image_generation_call",
              result: "cmVzcG9uc2U=",
            },
          ],
        }),
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
        endpoint: `http://127.0.0.1:${address.port}/api`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function collect(iterable) {
  let text = "";
  let reasoning = "";
  const attachments = [];
  for await (const chunk of iterable) {
    if (chunk.type === "text-delta") text += chunk.text;
    else if (chunk.type === "reasoning-delta") reasoning += chunk.text;
    else attachments.push(chunk.attachment);
  }
  return { text, reasoning, attachments };
}

test("custom adapter maps model lists, auth, request fields and all stream protocols", async () => {
  const mock = await startMockProvider();
  try {
    const adapter = new CustomAdapter();
    const baseConfig = {
      id: "custom",
      name: "Custom",
      format: "custom",
      endpoint: mock.endpoint,
      apiKey: "test-secret",
      enabled: true,
      customMapping: {
        modelsPath: "models",
        authHeader: "Authorization",
        authScheme: "Token",
        requestModelField: "payload.model",
        requestMessagesField: "payload.messages",
        requestStreamField: "streaming",
        requestReasoningField: "payload.thinking.type",
        requestReasoningEnabledJson: '"enabled"',
        requestReasoningDisabledJson: '"disabled"',
        responseDeltaPath: "chunk.text",
        responseReasoningPath: "chunk.reasoning",
        responseAttachmentsPath: "chunk.media",
        responseAttachmentDataPath: "data",
        responseAttachmentUrlPath: "url",
        responseAttachmentMimeTypePath: "mime",
        responseAttachmentNamePath: "name",
        responseModelsPath: "catalog",
        responseModelIdPath: "invocation",
        headersJson: '{"X-ModelDock-Test":"mapped"}',
      },
    };
    const request = {
      model: "custom-model",
      messages: [
        {
          role: "user",
          content: "Hello",
          attachments: [
            {
              id: "input-1",
              kind: "image",
              name: "pixel.png",
              mimeType: "image/png",
              size: 3,
              dataUrl: "data:image/png;base64,eHl6",
            },
          ],
        },
      ],
      reasoning: true,
    };

    assert.deepEqual(await adapter.listModels(baseConfig), [
      { id: "custom-model", name: "custom-model" },
    ]);

    for (const [protocol, path, expected] of [
      ["sse", "chat-sse", "Hello SSE"],
      ["ndjson", "chat-ndjson", "Hello NDJSON"],
      ["json", "chat-json", "Hello JSON"],
    ]) {
      const config = {
        ...baseConfig,
        customMapping: {
          ...baseConfig.customMapping,
          chatPath: path,
          streamProtocol: protocol,
        },
      };
      const result = await collect(adapter.streamChat(config, request));
      assert.equal(result.text, expected);
      assert.equal(result.reasoning, `Think ${protocol.toUpperCase()}`);
      assert.equal(result.attachments.length, 1);
      assert.deepEqual(
        result.attachments[0],
        {
          id: result.attachments[0].id,
          kind: "text",
          name: "hello.txt",
          mimeType: "text/plain",
          size: 6,
          dataUrl: "data:text/plain;base64,aGVsbG8=",
          url: undefined,
        },
      );
    }

    const chatRequests = mock.requests.filter((entry) =>
      entry.path.startsWith("/api/chat-"),
    );
    assert.equal(chatRequests.length, 3);
    assert.ok(
      chatRequests.every(
        (entry) =>
          entry.authorization === "Token test-secret" &&
          entry.customHeader === "mapped" &&
          entry.body.payload.model === "custom-model" &&
          entry.body.payload.messages[0].content === "Hello" &&
          entry.body.payload.messages[0].attachments[0].kind === "image" &&
          entry.body.payload.thinking.type === "enabled",
      ),
    );

    await collect(
      adapter.streamChat(
        {
          ...baseConfig,
          customMapping: {
            ...baseConfig.customMapping,
            chatPath: "chat-json",
            streamProtocol: "json",
          },
        },
        { ...request, reasoning: false },
      ),
    );
    assert.equal(mock.requests.at(-1).body.payload.thinking.type, "disabled");
    assert.deepEqual(
      chatRequests.map((entry) => entry.body.streaming),
      [true, true, false],
    );
  } finally {
    await mock.close();
  }
});

test("custom adapter maps the latest user text and fixed attachment metadata for image generation", async () => {
  const mock = await startMockProvider();
  try {
    const adapter = new CustomAdapter();
    const config = {
      id: "image-generator",
      name: "Image Generator",
      format: "custom",
      endpoint: mock.endpoint,
      apiKey: "image-secret",
      enabled: true,
      customMapping: {
        chatPath: "images/generations",
        authHeader: "Authorization",
        authScheme: "Bearer",
        requestModelField: "model",
        requestMessagesField: "prompt",
        requestMessagesMode: "last-user-text",
        requestStreamField: "",
        requestTemperatureField: "",
        requestMaxTokensField: "",
        requestBodyJson: '{"size":"1024x1024"}',
        responseDeltaPath: "",
        responseAttachmentsPath: "data",
        responseAttachmentDataPath: "b64_json",
        responseAttachmentUrlPath: "url",
        responseAttachmentMimeTypePath: "",
        responseAttachmentMimeTypeValue: "image/png",
        responseAttachmentNamePath: "",
        responseAttachmentNameValue: "generated-cat.png",
        streamProtocol: "json",
      },
    };
    const result = await collect(
      adapter.streamChat(config, {
        model: "gpt-image-2",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "First prompt" },
          { role: "assistant", content: "Previous result" },
          { role: "user", content: "Generate a cat" },
        ],
        temperature: 0.7,
        maxTokens: 512,
      }),
    );

    assert.equal(result.text, "");
    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0].kind, "image");
    assert.equal(result.attachments[0].mimeType, "image/png");
    assert.equal(result.attachments[0].name, "generated-cat.png");
    assert.equal(result.attachments[0].dataUrl, "data:image/png;base64,eHl6");

    const imageRequest = mock.requests.find(
      (entry) => entry.path === "/api/images/generations",
    );
    assert.equal(imageRequest.authorization, "Bearer image-secret");
    assert.deepEqual(imageRequest.body, {
      size: "1024x1024",
      model: "gpt-image-2",
      prompt: "Generate a cat",
    });
  } finally {
    await mock.close();
  }
});

test("custom adapter sends OpenAI Image API edits as multipart image uploads", async () => {
  const mock = await startMockProvider();
  try {
    const adapter = new CustomAdapter();
    const result = await collect(
      adapter.streamChat(
        {
          id: "image-editor",
          name: "Image Editor",
          format: "custom",
          endpoint: mock.endpoint,
          apiKey: "edit-secret",
          enabled: true,
          customMapping: {
            chatPath: "images/edits",
            requestModelField: "model",
            requestMessagesField: "prompt",
            requestMessagesMode: "last-user-text",
            requestEncoding: "multipart",
            requestAttachmentsField: "image[]",
            requestStreamField: "",
            requestTemperatureField: "",
            requestMaxTokensField: "",
            responseDeltaPath: "",
            responseAttachmentsPath: "data",
            responseAttachmentDataPath: "b64_json",
            responseAttachmentMimeTypePath: "",
            responseAttachmentMimeTypeValue: "image/png",
            responseAttachmentNamePath: "",
            responseAttachmentNameValue: "edited.png",
            streamProtocol: "json",
          },
        },
        {
          model: "gpt-image-2",
          messages: [
            {
              role: "user",
              content: "Replace the sky with stars",
              attachments: [
                {
                  id: "source-image",
                  kind: "image",
                  name: "source.png",
                  mimeType: "image/png",
                  size: 3,
                  dataUrl: "data:image/png;base64,eHl6",
                },
              ],
            },
          ],
        },
      ),
    );

    assert.equal(result.attachments[0].dataUrl, "data:image/png;base64,ZWRpdGVk");
    const editRequest = mock.requests.find(
      (entry) => entry.path === "/api/images/edits",
    );
    assert.match(editRequest.contentType, /^multipart\/form-data; boundary=/);
    assert.match(editRequest.rawBody, /name="model"\r\n\r\ngpt-image-2/);
    assert.match(
      editRequest.rawBody,
      /name="prompt"\r\n\r\nReplace the sky with stars/,
    );
    assert.match(
      editRequest.rawBody,
      /name="image\[\]"; filename="source.png"/,
    );
    assert.match(editRequest.rawBody, /Content-Type: image\/png/);
  } finally {
    await mock.close();
  }
});

test("custom adapter maps OpenAI Responses generation and image editing inputs", async () => {
  const mock = await startMockProvider();
  try {
    const adapter = new CustomAdapter();
    const baseConfig = {
      id: "responses-image",
      name: "Responses Image",
      format: "custom",
      endpoint: mock.endpoint,
      apiKey: "responses-secret",
      enabled: true,
      customMapping: {
        chatPath: "responses",
        requestModelField: "model",
        requestMessagesField: "input",
        requestEncoding: "json",
        requestStreamField: "",
        requestTemperatureField: "",
        requestMaxTokensField: "",
        responseDeltaPath: "",
        responseAttachmentsPath: "output",
        responseAttachmentDataPath: "result",
        responseAttachmentMimeTypePath: "",
        responseAttachmentMimeTypeValue: "image/png",
        responseAttachmentNamePath: "",
        responseAttachmentNameValue: "response-image.png",
        streamProtocol: "json",
      },
    };

    await collect(
      adapter.streamChat(
        {
          ...baseConfig,
          customMapping: {
            ...baseConfig.customMapping,
            requestMessagesMode: "last-user-text",
            requestBodyJson:
              '{"tools":[{"type":"image_generation","action":"generate"}]}',
          },
        },
        {
          model: "gpt-5.6",
          messages: [{ role: "user", content: "Generate a lighthouse" }],
        },
      ),
    );
    await collect(
      adapter.streamChat(
        {
          ...baseConfig,
          customMapping: {
            ...baseConfig.customMapping,
            requestMessagesMode: "openai-responses-input",
            requestBodyJson:
              '{"tools":[{"type":"image_generation","action":"edit"}]}',
          },
        },
        {
          model: "gpt-5.6",
          messages: [
            {
              role: "user",
              content: "Make it a night scene",
              attachments: [
                {
                  id: "response-source",
                  kind: "image",
                  name: "lighthouse.png",
                  mimeType: "image/png",
                  size: 3,
                  dataUrl: "data:image/png;base64,eHl6",
                },
              ],
            },
          ],
        },
      ),
    );

    const responseRequests = mock.requests.filter(
      (entry) => entry.path === "/api/responses",
    );
    assert.equal(responseRequests.length, 2);
    assert.deepEqual(responseRequests[0].body, {
      tools: [{ type: "image_generation", action: "generate" }],
      model: "gpt-5.6",
      input: "Generate a lighthouse",
    });
    assert.deepEqual(responseRequests[1].body, {
      tools: [{ type: "image_generation", action: "edit" }],
      model: "gpt-5.6",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Make it a night scene" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,eHl6",
              detail: "auto",
            },
          ],
        },
      ],
    });
  } finally {
    await mock.close();
  }
});
