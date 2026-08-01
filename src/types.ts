export type ProviderFormat =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";

export type ModelInputType = "text" | "image" | "video" | "audio";

export interface ChatAttachment {
  id: string;
  kind: ModelInputType;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  url?: string;
}

export interface ModelOption {
  id: string;
  catalogId?: string;
  name: string;
  family: string;
  context: string;
  capability: string;
  inputTypes: ModelInputType[];
  supportsReasoning?: boolean;
}

export interface ModelGroup {
  id: string;
  name: string;
  format: ProviderFormat;
  description: string;
  color: string;
}

export interface CatalogModel {
  id: string;
  name: string;
  invocationName: string;
  groupId: string;
  description: string;
  context: string;
  capability: string;
  inputTypes: ModelInputType[];
  supportsReasoning?: boolean;
}

export interface ApiConfig {
  id: string;
  name: string;
  format: ProviderFormat;
  endpoint: string;
  apiKey: string;
  enabled: boolean;
  color: string;
  models: ModelOption[];
  customMapping?: CustomProviderMapping;
  customTemplateId?: string;
}

export interface CustomProviderMapping {
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

export interface CustomMappingTemplate {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  suggestedModel: string;
  mapping: CustomProviderMapping;
}

export interface ChatHistory {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  group: "今天" | "昨天" | "更早";
  modelId: string;
  modelName: string;
  providerName: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  attachments?: ChatAttachment[];
  author?: string;
  meta?: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  configId?: string;
  modelId: string;
  modelName: string;
  providerName: string;
  messages: ChatMessage[];
}

export interface AuthUser {
  id: string;
  username: string;
}
