import { AppError } from "../core/errors.js";
import type {
  ChatGatewayRequest,
  GatewayAttachment,
  GatewayChunk,
  ProviderAdapter,
  ProviderConfig,
  ProviderModel,
} from "./provider.js";
import {
  createOutputAttachment,
  splitDataUrl,
} from "./media-mapping.js";
import {
  fetchChecked,
  joinEndpoint,
  readNdjson,
  readSseData,
} from "./http-utils.js";

interface CustomMapping {
  chatPath: string;
  modelsPath: string;
  authHeader: string;
  authScheme: string;
  requestModelField: string;
  requestMessagesField: string;
  requestMessagesMode:
    | "messages"
    | "last-user-text"
    | "last-message-text"
    | "joined-user-text"
    | "openai-responses-input";
  requestEncoding: "json" | "multipart";
  requestAttachmentsField: string;
  requestStreamField: string;
  requestTemperatureField: string;
  requestMaxTokensField: string;
  requestReasoningField: string;
  requestReasoningEnabledJson: string;
  requestReasoningDisabledJson: string;
  requestBodyJson: string;
  responseDeltaPath: string;
  responseReasoningPath: string;
  responseAttachmentsPath: string;
  responseAttachmentDataPath: string;
  responseAttachmentUrlPath: string;
  responseAttachmentMimeTypePath: string;
  responseAttachmentMimeTypeValue: string;
  responseAttachmentNamePath: string;
  responseAttachmentNameValue: string;
  responseModelsPath: string;
  responseModelIdPath: string;
  streamProtocol: "sse" | "ndjson" | "json";
  headersJson: string;
}

const DEFAULT_MAPPING: CustomMapping = {
  chatPath: "chat/completions",
  modelsPath: "models",
  authHeader: "Authorization",
  authScheme: "Bearer",
  requestModelField: "model",
  requestMessagesField: "messages",
  requestMessagesMode: "messages",
  requestEncoding: "json",
  requestAttachmentsField: "",
  requestStreamField: "stream",
  requestTemperatureField: "temperature",
  requestMaxTokensField: "max_tokens",
  requestReasoningField: "",
  requestReasoningEnabledJson: '"enabled"',
  requestReasoningDisabledJson: '"disabled"',
  requestBodyJson: "{}",
  responseDeltaPath: "choices.0.delta.content",
  responseReasoningPath: "choices.0.delta.reasoning_content",
  responseAttachmentsPath: "choices.0.delta.attachments",
  responseAttachmentDataPath: "data",
  responseAttachmentUrlPath: "url",
  responseAttachmentMimeTypePath: "mime_type",
  responseAttachmentMimeTypeValue: "",
  responseAttachmentNamePath: "name",
  responseAttachmentNameValue: "",
  responseModelsPath: "data",
  responseModelIdPath: "id",
  streamProtocol: "sse",
  headersJson: "{}",
};

function mappingFor(config: ProviderConfig): CustomMapping {
  return {
    ...DEFAULT_MAPPING,
    ...config.customMapping,
  };
}

function pathSegments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of pathSegments(path)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = pathSegments(path);
  if (!parts.length) return;
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function parseJsonObject(
  source: string,
  code: string,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source || "{}");
  } catch {
    throw new AppError(400, code, `${label}必须是有效的 JSON 对象。`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(400, code, `${label}必须是 JSON 对象。`);
  }
  return parsed as Record<string, unknown>;
}

function parseJsonValue(source: string, label: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    throw new AppError(
      400,
      "INVALID_CUSTOM_REASONING_VALUE",
      `${label}必须是有效的 JSON 值。`,
    );
  }
}

function extraHeaders(config: ProviderConfig, mapping: CustomMapping): Record<string, string> {
  const parsed = parseJsonObject(
    mapping.headersJson,
    "INVALID_CUSTOM_HEADERS",
    "附加 Headers",
  );
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new AppError(
        400,
        "INVALID_CUSTOM_HEADERS",
        "附加 Header 的名称和值都必须是字符串。",
      );
    }
    headers[name] = value.replaceAll("{API_KEY}", config.apiKey);
  }
  if (config.apiKey && mapping.authHeader) {
    headers[mapping.authHeader] = mapping.authScheme
      ? `${mapping.authScheme} ${config.apiKey}`
      : config.apiKey;
  }
  return headers;
}

function requestMessagesValue(
  request: ChatGatewayRequest,
  mapping: CustomMapping,
): unknown {
  if (mapping.requestMessagesMode === "messages") return request.messages;
  if (mapping.requestMessagesMode === "openai-responses-input") {
    const message = [...request.messages]
      .reverse()
      .find(
        (item) =>
          item.role === "user" &&
          (item.content.trim() || item.attachments?.length),
      );
    if (!message) {
      throw new AppError(
        400,
        "CUSTOM_REQUEST_CONTENT_REQUIRED",
        "OpenAI Responses 图文输入需要一条用户消息。",
      );
    }
    const content: Array<Record<string, unknown>> = [];
    if (message.content.trim()) {
      content.push({ type: "input_text", text: message.content });
    }
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind !== "image") continue;
      const imageUrl = attachment.dataUrl ?? attachment.url;
      if (imageUrl) {
        content.push({
          type: "input_image",
          image_url: imageUrl,
          detail: "auto",
        });
      }
    }
    if (!content.length) {
      throw new AppError(
        400,
        "CUSTOM_REQUEST_CONTENT_REQUIRED",
        "OpenAI Responses 图文输入中没有可发送的文本或图片。",
      );
    }
    return [{ role: "user", content }];
  }

  const candidates =
    mapping.requestMessagesMode === "last-user-text" ||
    mapping.requestMessagesMode === "joined-user-text"
      ? request.messages.filter((message) => message.role === "user")
      : request.messages;
  if (mapping.requestMessagesMode === "joined-user-text") {
    const text = candidates
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text) return text;
  } else {
    const text = [...candidates]
      .reverse()
      .find((message) => message.content.trim())?.content;
    if (text) return text;
  }

  throw new AppError(
    400,
    "CUSTOM_REQUEST_TEXT_REQUIRED",
    "当前请求内容取值方式需要至少一条非空文本消息。",
  );
}

function multipartBody(
  body: Record<string, unknown>,
  request: ChatGatewayRequest,
  mapping: CustomMapping,
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.append(
      name,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  if (!mapping.requestAttachmentsField) return form;

  const message = [...request.messages]
    .reverse()
    .find(
      (item) =>
        item.role === "user" &&
        item.attachments?.some((attachment) => attachment.kind === "image"),
    );
  const images =
    message?.attachments?.filter((attachment) => attachment.kind === "image") ?? [];
  if (!images.length) {
    throw new AppError(
      400,
      "CUSTOM_REQUEST_IMAGE_REQUIRED",
      `Multipart 字段 ${mapping.requestAttachmentsField} 需要至少一张用户上传的图片。`,
    );
  }

  for (const attachment of images) {
    if (!attachment.dataUrl) {
      throw new AppError(
        400,
        "CUSTOM_REQUEST_INLINE_IMAGE_REQUIRED",
        `Multipart 上传要求图片 ${attachment.name} 使用内联数据，而不是远程 URL。`,
      );
    }
    const { data, mimeType } = splitDataUrl(attachment.dataUrl);
    form.append(
      mapping.requestAttachmentsField,
      new Blob([Buffer.from(data, "base64")], {
        type: attachment.mimeType || mimeType,
      }),
      attachment.name,
    );
  }
  return form;
}

function textFromPayload(payload: unknown, mapping: CustomMapping): string | undefined {
  const value = readPath(payload, mapping.responseDeltaPath);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function reasoningFromPayload(
  payload: unknown,
  mapping: CustomMapping,
): string | undefined {
  if (!mapping.responseReasoningPath) return undefined;
  const value = readPath(payload, mapping.responseReasoningPath);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function attachmentsFromPayload(
  payload: unknown,
  mapping: CustomMapping,
): GatewayAttachment[] {
  if (!mapping.responseAttachmentsPath) return [];
  const value = readPath(payload, mapping.responseAttachmentsPath);
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap((item) => {
    const data = readPath(item, mapping.responseAttachmentDataPath);
    const url = readPath(item, mapping.responseAttachmentUrlPath);
    const mimeType = readPath(item, mapping.responseAttachmentMimeTypePath);
    const name = readPath(item, mapping.responseAttachmentNamePath);
    const attachment = createOutputAttachment({
      data: typeof data === "string" ? data : undefined,
      url: typeof url === "string" ? url : undefined,
      mimeType:
        typeof mimeType === "string" && mimeType.trim()
          ? mimeType
          : mapping.responseAttachmentMimeTypeValue,
      name:
        typeof name === "string" && name.trim()
          ? name
          : mapping.responseAttachmentNameValue,
    });
    return attachment ? [attachment] : [];
  });
}

export class CustomAdapter implements ProviderAdapter {
  readonly format = "custom" as const;

  async listModels(
    config: ProviderConfig,
    signal?: AbortSignal,
  ): Promise<ProviderModel[]> {
    const mapping = mappingFor(config);
    const response = await fetchChecked(
      joinEndpoint(config.endpoint, mapping.modelsPath),
      {
        headers: extraHeaders(config, mapping),
        signal,
      },
      20_000,
    );
    const payload = (await response.json()) as unknown;
    const items = readPath(payload, mapping.responseModelsPath);
    if (!Array.isArray(items)) {
      throw new AppError(
        502,
        "CUSTOM_MODEL_MAPPING_FAILED",
        "模型数组响应路径没有指向数组。",
      );
    }
    return items.flatMap((item) => {
      const id = readPath(item, mapping.responseModelIdPath);
      return typeof id === "string" && id ? [{ id, name: id }] : [];
    });
  }

  async *streamChat(
    config: ProviderConfig,
    request: ChatGatewayRequest,
  ): AsyncIterable<GatewayChunk> {
    const mapping = mappingFor(config);
    const body = parseJsonObject(
      mapping.requestBodyJson,
      "INVALID_CUSTOM_REQUEST_BODY",
      "附加请求体",
    );
    writePath(body, mapping.requestModelField, request.model);
    if (mapping.requestMessagesField) {
      writePath(body, mapping.requestMessagesField, requestMessagesValue(request, mapping));
    }
    if (mapping.requestStreamField) {
      writePath(body, mapping.requestStreamField, mapping.streamProtocol !== "json");
    }
    if (request.temperature !== undefined && mapping.requestTemperatureField) {
      writePath(body, mapping.requestTemperatureField, request.temperature);
    }
    if (request.maxTokens !== undefined && mapping.requestMaxTokensField) {
      writePath(body, mapping.requestMaxTokensField, request.maxTokens);
    }
    if (
      request.reasoning !== undefined &&
      mapping.requestReasoningField
    ) {
      writePath(
        body,
        mapping.requestReasoningField,
        parseJsonValue(
          request.reasoning
            ? mapping.requestReasoningEnabledJson
            : mapping.requestReasoningDisabledJson,
          request.reasoning ? "深度思考开启值" : "深度思考关闭值",
        ),
      );
    }
    const headers = extraHeaders(config, mapping);
    const requestBody =
      mapping.requestEncoding === "multipart"
        ? multipartBody(body, request, mapping)
        : JSON.stringify(body);
    if (mapping.requestEncoding === "multipart") {
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === "content-type") delete headers[name];
      }
    } else {
      headers["content-type"] = "application/json";
    }

    const response = await fetchChecked(
      joinEndpoint(config.endpoint, mapping.chatPath),
      {
        method: "POST",
        headers,
        body: requestBody,
        signal: request.signal,
      },
      120_000,
    );
    const seenAttachments = new Set<string>();

    const mediaChunks = (payload: unknown): GatewayChunk[] =>
      attachmentsFromPayload(payload, mapping).flatMap((attachment) => {
        const key = `${attachment.mimeType}:${attachment.dataUrl ?? attachment.url}`;
        if (seenAttachments.has(key)) return [];
        seenAttachments.add(key);
        return [{ type: "attachment", attachment }];
      });

    if (mapping.streamProtocol === "json") {
      const payload = await response.json();
      const reasoning = reasoningFromPayload(payload, mapping);
      if (reasoning) yield { type: "reasoning-delta", text: reasoning };
      const text = textFromPayload(payload, mapping);
      if (text) yield { type: "text-delta", text };
      for (const chunk of mediaChunks(payload)) yield chunk;
      return;
    }

    if (mapping.streamProtocol === "ndjson") {
      for await (const event of readNdjson(response)) {
        const reasoning = reasoningFromPayload(event, mapping);
        if (reasoning) yield { type: "reasoning-delta", text: reasoning };
        const text = textFromPayload(event, mapping);
        if (text) yield { type: "text-delta", text };
        for (const chunk of mediaChunks(event)) yield chunk;
      }
      return;
    }

    for await (const data of readSseData(response)) {
      if (data === "[DONE]") return;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        throw new AppError(
          502,
          "CUSTOM_STREAM_MAPPING_FAILED",
          "SSE 数据不是有效 JSON，请检查响应协议设置。",
        );
      }
      const reasoning = reasoningFromPayload(event, mapping);
      if (reasoning) yield { type: "reasoning-delta", text: reasoning };
      const text = textFromPayload(event, mapping);
      if (text) yield { type: "text-delta", text };
      for (const chunk of mediaChunks(event)) yield chunk;
    }
  }
}
