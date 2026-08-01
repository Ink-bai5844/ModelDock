import type {
  ChatGatewayRequest,
  GatewayChunk,
  ProviderAdapter,
  ProviderConfig,
  ProviderModel,
} from "./provider.js";
import { fetchChecked, joinEndpoint, readSseData } from "./http-utils.js";
import {
  createOutputAttachment,
  toAnthropicContent,
} from "./media-mapping.js";

function thinkingConfig(model: string, reasoning?: boolean) {
  if (reasoning === undefined) return undefined;
  if (!reasoning) return { type: "disabled" };
  const normalized = model.toLowerCase();
  const supportsAdaptive =
    /claude.*-(?:[5-9])(?:-|$)/.test(normalized) ||
    /claude.*-4-(?:6|7|8|9)(?:-|$)/.test(normalized);
  return supportsAdaptive
    ? { type: "adaptive", display: "summarized" }
    : { type: "enabled", budget_tokens: 1024 };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly format = "anthropic" as const;

  async listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ProviderModel[]> {
    const response = await fetchChecked(joinEndpoint(config.endpoint, "v1/models"), {
      headers: this.headers(config),
      signal,
    }, 20_000);
    const payload = (await response.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
    };
    return (payload.data ?? [])
      .filter((model): model is { id: string; display_name?: string } => typeof model.id === "string")
      .map((model) => ({ id: model.id, name: model.display_name ?? model.id }));
  }

  async *streamChat(
    config: ProviderConfig,
    request: ChatGatewayRequest,
  ): AsyncIterable<GatewayChunk> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const messages = request.messages
      .filter((message) => message.role !== "system" && message.role !== "tool")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: toAnthropicContent(message),
      }));
    const response = await fetchChecked(joinEndpoint(config.endpoint, "v1/messages"), {
      method: "POST",
      headers: {
        ...this.headers(config),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        system: system || undefined,
        messages,
        temperature: request.reasoning ? undefined : request.temperature,
        max_tokens: request.reasoning
          ? Math.max(request.maxTokens ?? 4096, 2048)
          : request.maxTokens ?? 4096,
        thinking: thinkingConfig(request.model, request.reasoning),
        stream: true,
      }),
      signal: request.signal,
    }, 120_000);

    for await (const data of readSseData(response)) {
      const event = JSON.parse(data) as {
        type?: string;
        delta?: { type?: string; text?: string; thinking?: string };
        content_block?: {
          type?: string;
          thinking?: string;
          source?: {
            type?: string;
            media_type?: string;
            data?: string;
            url?: string;
          };
          name?: string;
        };
      };
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "thinking_delta" &&
        event.delta.thinking
      ) {
        yield { type: "reasoning-delta", text: event.delta.thinking };
      }
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "thinking" &&
        event.content_block.thinking
      ) {
        yield { type: "reasoning-delta", text: event.content_block.thinking };
      }
      if (event.type === "content_block_delta" && event.delta?.text) {
        yield { type: "text-delta", text: event.delta.text };
      }
      if (event.type === "content_block_start" && event.content_block?.source) {
        const source = event.content_block.source;
        const attachment = createOutputAttachment({
          data: source.data,
          url: source.url,
          mimeType: source.media_type,
          name: event.content_block.name,
        });
        if (attachment) yield { type: "attachment", attachment };
      }
    }
  }

  private headers(config: ProviderConfig): Record<string, string> {
    return {
      "anthropic-version": "2023-06-01",
      ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
    };
  }
}
