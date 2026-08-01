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
  toOpenAiMessages,
} from "./media-mapping.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function fileNameFromUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const name = new URL(value).pathname.split("/").pop();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function outputAttachmentChunk(input: {
  data?: string;
  url?: string;
  mimeType?: string;
  name?: string;
}): GatewayChunk | undefined {
  const attachment = createOutputAttachment(input);
  return attachment ? { type: "attachment", attachment } : undefined;
}

function imageChunk(
  value: unknown,
  index: number,
  fallbackName = "模型图像输出",
): GatewayChunk | undefined {
  if (typeof value === "string") {
    const isInline = value.startsWith("data:");
    return outputAttachmentChunk({
      data: isInline ? value : undefined,
      url: isInline ? undefined : value,
      mimeType: isInline
        ? undefined
        : mimeTypeFromFileName(fileNameFromUrl(value)) ?? "image/png",
      name: fileNameFromUrl(value) ?? `${fallbackName}-${index + 1}.png`,
    });
  }

  const record = asRecord(value);
  if (!record) return undefined;
  const base64 =
    stringValue(record.b64_json) ??
    stringValue(record.base64) ??
    (record.type === "image_generation_call"
      ? stringValue(record.result)
      : undefined);
  const dataUrl = stringValue(record.data_url);
  const url =
    stringValue(record.url) ??
    stringValue(asRecord(record.image_url)?.url);
  const name =
    stringValue(record.name) ??
    stringValue(record.filename) ??
    fileNameFromUrl(url) ??
    `${fallbackName}-${index + 1}.png`;
  const mimeType =
    stringValue(record.mime_type) ??
    stringValue(record.mimeType) ??
    mimeTypeFromFileName(name) ??
    "image/png";

  return outputAttachmentChunk({
    data: dataUrl ?? base64,
    url: dataUrl || base64 ? undefined : url,
    mimeType,
    name,
  });
}

function contentChunks(content: unknown): GatewayChunk[] {
  if (typeof content === "string") {
    if (content.startsWith("data:image/")) {
      const attachment = imageChunk(content, 0);
      return attachment ? [attachment] : [];
    }
    return content ? [{ type: "text-delta", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const chunks: GatewayChunk[] = [];
  for (const [index, value] of content.entries()) {
    const part = asRecord(value);
    if (!part) continue;
    const text = stringValue(part.text) ?? stringValue(part.output_text);
    const partType = stringValue(part.type)?.toLowerCase();
    const reasoningPart = [
      "analysis",
      "reasoning",
      "reasoning_text",
      "thinking",
      "thought",
    ].includes(partType ?? "");
    if (text) {
      chunks.push({
        type: reasoningPart ? "reasoning-delta" : "text-delta",
        text,
      });
    }

    const imageUrl =
      stringValue(part.image_url) ??
      stringValue(asRecord(part.image_url)?.url);
    const image = imageUrl ? imageChunk(imageUrl, index) : undefined;
    if (image) chunks.push(image);

    const file = asRecord(part.file);
    if (file) {
      const fileData = stringValue(file.file_data);
      const fileUrl = stringValue(file.file_url);
      const fileName = stringValue(file.filename);
      const fileChunk = outputAttachmentChunk({
        data: fileData,
        url: fileUrl,
        name: fileName,
        mimeType: mimeTypeFromFileName(fileName),
      });
      if (fileChunk) chunks.push(fileChunk);
    }
  }
  return chunks;
}

function reasoningChunks(message: JsonRecord): GatewayChunk[] {
  const direct =
    stringValue(message.reasoning_content) ??
    stringValue(message.reasoning) ??
    stringValue(message.thinking) ??
    stringValue(asRecord(message.reasoning)?.content) ??
    stringValue(asRecord(message.reasoning)?.text);
  if (direct) return [{ type: "reasoning-delta", text: direct }];

  const details = Array.isArray(message.reasoning_details)
    ? message.reasoning_details
    : [];
  return details.flatMap((value): GatewayChunk[] => {
    if (typeof value === "string" && value) {
      return [{ type: "reasoning-delta", text: value }];
    }
    const detail = asRecord(value);
    if (!detail) return [];
    const text =
      stringValue(detail.text) ??
      stringValue(detail.content) ??
      stringValue(detail.summary);
    return text ? [{ type: "reasoning-delta", text }] : [];
  });
}

export function extractOpenAiOutputChunks(payload: unknown): GatewayChunk[] {
  const root = asRecord(payload);
  if (!root) return [];
  const chunks: GatewayChunk[] = [];

  if (Array.isArray(root.choices)) {
    for (const choiceValue of root.choices) {
      const choice = asRecord(choiceValue);
      if (!choice) continue;
      for (const messageValue of [choice.delta, choice.message]) {
        const message = asRecord(messageValue);
        if (!message) continue;
        chunks.push(...reasoningChunks(message));
        chunks.push(...contentChunks(message.content));
        if (Array.isArray(message.images)) {
          for (const [index, imageValue] of message.images.entries()) {
            const image = imageChunk(imageValue, index);
            if (image) chunks.push(image);
          }
        }
      }
    }
  }

  for (const key of ["data", "images"] as const) {
    const values = root[key];
    if (!Array.isArray(values)) continue;
    for (const [index, value] of values.entries()) {
      const image = imageChunk(value, index);
      if (image) chunks.push(image);
    }
  }

  if (Array.isArray(root.output)) {
    for (const [index, value] of root.output.entries()) {
      const output = asRecord(value);
      if (!output) continue;
      if (output.type === "image_generation_call") {
        const image = imageChunk(output, index);
        if (image) chunks.push(image);
      }
      chunks.push(...contentChunks(output.content));
    }
  }

  return chunks;
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly format = "openai-compatible" as const;

  async listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ProviderModel[]> {
    const response = await fetchChecked(
      joinEndpoint(config.endpoint, "models"),
      {
        headers: this.headers(config),
        signal,
      },
      20_000,
    );
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return (payload.data ?? [])
      .filter((model): model is { id: string } => typeof model.id === "string")
      .map((model) => ({ id: model.id, name: model.id }));
  }

  async *streamChat(
    config: ProviderConfig,
    request: ChatGatewayRequest,
  ): AsyncIterable<GatewayChunk> {
    const hasReasoningControl = request.reasoning !== undefined;
    const usesDeepSeekThinking = /deepseek/i.test(
      `${config.name} ${config.endpoint} ${request.model}`,
    );
    const response = await fetchChecked(joinEndpoint(config.endpoint, "chat/completions"), {
      method: "POST",
      headers: {
        ...this.headers(config),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: toOpenAiMessages(request.messages),
        temperature:
          usesDeepSeekThinking && request.reasoning
            ? undefined
            : request.temperature,
        max_tokens: request.maxTokens,
        reasoning_effort: hasReasoningControl
          ? request.reasoning
            ? usesDeepSeekThinking
              ? "high"
              : "medium"
            : usesDeepSeekThinking
              ? undefined
              : "none"
          : undefined,
        thinking:
          hasReasoningControl && usesDeepSeekThinking
            ? { type: request.reasoning ? "enabled" : "disabled" }
            : undefined,
        stream: true,
      }),
      signal: request.signal,
    }, 120_000);

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      for (const chunk of extractOpenAiOutputChunks(payload)) {
        yield chunk;
      }
      return;
    }

    let audioData = "";
    let audioTranscript = "";
    for await (const data of readSseData(response)) {
      if (data === "[DONE]") break;
      const event = JSON.parse(data) as JsonRecord;
      for (const chunk of extractOpenAiOutputChunks(event)) {
        yield chunk;
      }

      const firstChoice = Array.isArray(event.choices)
        ? asRecord(event.choices[0])
        : undefined;
      const delta = asRecord(firstChoice?.delta);
      const audio = asRecord(delta?.audio);
      const nextAudioData = stringValue(audio?.data);
      const nextTranscript = stringValue(audio?.transcript);
      if (nextAudioData) audioData += nextAudioData;
      if (nextTranscript) {
        const next = nextTranscript.slice(audioTranscript.length);
        audioTranscript = nextTranscript;
        if (next) yield { type: "text-delta", text: next };
      }
    }
    const audioAttachment = createOutputAttachment({
      data: audioData,
      mimeType: "audio/wav",
      name: "模型语音输出.wav",
    });
    if (audioAttachment) {
      yield { type: "attachment", attachment: audioAttachment };
    }
  }

  private headers(config: ProviderConfig): Record<string, string> {
    return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
  }
}

function mimeTypeFromFileName(name?: string): string | undefined {
  const extension = name?.split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    pdf: "application/pdf",
    txt: "text/plain",
  };
  return extension ? known[extension] : undefined;
}
