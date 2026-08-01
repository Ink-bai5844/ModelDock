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
  toGeminiParts,
} from "./media-mapping.js";

function thinkingConfig(model: string, reasoning?: boolean) {
  if (reasoning === undefined) return undefined;
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini-3")) {
    return {
      thinkingLevel: reasoning ? "medium" : "low",
      includeThoughts: reasoning,
    };
  }
  if (!reasoning && normalized.includes("2.5") && normalized.includes("pro")) {
    return { includeThoughts: false };
  }
  return {
    thinkingBudget: reasoning ? -1 : 0,
    includeThoughts: reasoning,
  };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly format = "gemini" as const;

  async listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ProviderModel[]> {
    const url = new URL(joinEndpoint(config.endpoint, "v1beta/models"));
    if (config.apiKey) url.searchParams.set("key", config.apiKey);
    const response = await fetchChecked(url.toString(), { signal }, 20_000);
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; displayName?: string }>;
    };
    return (payload.models ?? [])
      .filter((model): model is { name: string; displayName?: string } => typeof model.name === "string")
      .map((model) => ({
        id: model.name.replace(/^models\//, ""),
        name: model.displayName ?? model.name,
      }));
  }

  async *streamChat(
    config: ProviderConfig,
    request: ChatGatewayRequest,
  ): AsyncIterable<GatewayChunk> {
    const model = request.model.replace(/^models\//, "");
    const url = new URL(
      joinEndpoint(
        config.endpoint,
        `v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`,
      ),
    );
    url.searchParams.set("alt", "sse");
    if (config.apiKey) url.searchParams.set("key", config.apiKey);

    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const contents = request.messages
      .filter((message) => message.role !== "system" && message.role !== "tool")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: toGeminiParts(message),
      }));
    const response = await fetchChecked(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          thinkingConfig: thinkingConfig(model, request.reasoning),
        },
      }),
      signal: request.signal,
    }, 120_000);

    for await (const data of readSseData(response)) {
      const event = JSON.parse(data) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              thought?: boolean;
              inlineData?: {
                data?: string;
                mimeType?: string;
                displayName?: string;
              };
              fileData?: {
                fileUri?: string;
                mimeType?: string;
                displayName?: string;
              };
            }>;
          };
        }>;
      };
      for (const part of event.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
          yield {
            type: part.thought ? "reasoning-delta" : "text-delta",
            text: part.text,
          };
        }
        if (part.thought) continue;
        const attachment = createOutputAttachment({
          data: part.inlineData?.data,
          url: part.fileData?.fileUri,
          mimeType: part.inlineData?.mimeType ?? part.fileData?.mimeType,
          name: part.inlineData?.displayName ?? part.fileData?.displayName,
        });
        if (attachment) yield { type: "attachment", attachment };
      }
    }
  }
}
