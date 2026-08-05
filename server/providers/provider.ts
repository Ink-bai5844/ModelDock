export type ProviderFormat =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";

export type ModelInputType = "text" | "image" | "video" | "audio";

export interface GatewayAttachment {
  id: string;
  kind: ModelInputType;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  url?: string;
  workspacePath?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  format: ProviderFormat;
  endpoint: string;
  apiKey: string;
  enabled: boolean;
  customMapping?: {
    chatPath?: string;
    modelsPath?: string;
    authHeader?: string;
    authScheme?: string;
    requestModelField?: string;
    requestMessagesField?: string;
    requestMessagesMode?:
      | "messages"
      | "last-user-text"
      | "last-message-text"
      | "joined-user-text"
      | "openai-responses-input";
    requestEncoding?: "json" | "multipart";
    requestAttachmentsField?: string;
    requestStreamField?: string;
    requestTemperatureField?: string;
    requestMaxTokensField?: string;
    requestReasoningField?: string;
    requestReasoningEnabledJson?: string;
    requestReasoningDisabledJson?: string;
    requestBodyJson?: string;
    responseDeltaPath?: string;
    responseReasoningPath?: string;
    responseAttachmentsPath?: string;
    responseAttachmentDataPath?: string;
    responseAttachmentUrlPath?: string;
    responseAttachmentMimeTypePath?: string;
    responseAttachmentMimeTypeValue?: string;
    responseAttachmentNamePath?: string;
    responseAttachmentNameValue?: string;
    responseModelsPath?: string;
    responseModelIdPath?: string;
    streamProtocol?: "sse" | "ndjson" | "json";
    headersJson?: string;
  };
}

export interface GatewayMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  attachments?: GatewayAttachment[];
}

export interface ChatGatewayRequest {
  model: string;
  messages: GatewayMessage[];
  temperature?: number;
  maxTokens?: number;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export interface ProviderModel {
  id: string;
  name: string;
}

export type GatewayChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "attachment"; attachment: GatewayAttachment };

export interface ProviderAdapter {
  readonly format: ProviderFormat;
  listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ProviderModel[]>;
  streamChat(
    config: ProviderConfig,
    request: ChatGatewayRequest,
  ): AsyncIterable<GatewayChunk>;
}
