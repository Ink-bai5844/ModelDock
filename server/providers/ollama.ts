import type {
  ChatGatewayRequest,
  GatewayChunk,
  ProviderAdapter,
  ProviderConfig,
  ProviderModel,
} from "./provider.js";
import { fetchChecked, joinEndpoint, readNdjson } from "./http-utils.js";
import {
  createOutputAttachment,
  toOllamaMessage,
} from "./media-mapping.js";

export class OllamaAdapter implements ProviderAdapter {
  readonly format = "ollama" as const;

  async listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ProviderModel[]> {
    const response = await fetchChecked(joinEndpoint(config.endpoint, "api/tags"), { signal }, 20_000);
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (payload.models ?? [])
      .map((model) => model.name ?? model.model)
      .filter((id): id is string => typeof id === "string")
      .map((id) => ({ id, name: id }));
  }

  async *streamChat(
    config: ProviderConfig,
    request: ChatGatewayRequest,
  ): AsyncIterable<GatewayChunk> {
    const response = await fetchChecked(joinEndpoint(config.endpoint, "api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(toOllamaMessage),
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
        think: request.reasoning,
        stream: true,
      }),
      signal: request.signal,
    }, 120_000);
    for await (const raw of readNdjson(response)) {
      const event = raw as {
        message?: { content?: string; thinking?: string; images?: string[] };
      };
      if (event.message?.thinking) {
        yield { type: "reasoning-delta", text: event.message.thinking };
      }
      if (event.message?.content) {
        yield { type: "text-delta", text: event.message.content };
      }
      for (const data of event.message?.images ?? []) {
        const attachment = createOutputAttachment({
          data,
          mimeType: "image/png",
          name: "Ollama 图像输出.png",
        });
        if (attachment) yield { type: "attachment", attachment };
      }
    }
  }
}
