import type {
  CustomMappingTemplate,
  CustomProviderMapping,
} from "./types";

export const DEFAULT_CUSTOM_MAPPING: CustomProviderMapping = {
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

function imageApiMapping(
  operation: "generations" | "edits",
): CustomProviderMapping {
  const editing = operation === "edits";
  return {
    ...DEFAULT_CUSTOM_MAPPING,
    chatPath: `images/${operation}`,
    requestMessagesField: "prompt",
    requestMessagesMode: "last-user-text",
    requestEncoding: editing ? "multipart" : "json",
    requestAttachmentsField: editing ? "image[]" : "",
    requestStreamField: "",
    requestTemperatureField: "",
    requestMaxTokensField: "",
    requestBodyJson: "{}",
    responseDeltaPath: "",
    responseReasoningPath: "",
    responseAttachmentsPath: "data",
    responseAttachmentDataPath: "b64_json",
    responseAttachmentUrlPath: "url",
    responseAttachmentMimeTypePath: "",
    responseAttachmentMimeTypeValue: "image/png",
    responseAttachmentNamePath: "",
    responseAttachmentNameValue: editing
      ? "edited-image.png"
      : "generated-image.png",
    streamProtocol: "json",
  };
}

function responsesApiMapping(
  action: "generate" | "edit",
): CustomProviderMapping {
  return {
    ...DEFAULT_CUSTOM_MAPPING,
    chatPath: "responses",
    requestMessagesField: "input",
    requestMessagesMode:
      action === "edit" ? "openai-responses-input" : "last-user-text",
    requestEncoding: "json",
    requestAttachmentsField: "",
    requestStreamField: "",
    requestTemperatureField: "",
    requestMaxTokensField: "",
    requestBodyJson: JSON.stringify({
      tools: [{ type: "image_generation", action }],
    }),
    responseDeltaPath: "",
    responseReasoningPath: "",
    responseAttachmentsPath: "output",
    responseAttachmentDataPath: "result",
    responseAttachmentUrlPath: "",
    responseAttachmentMimeTypePath: "",
    responseAttachmentMimeTypeValue: "image/png",
    responseAttachmentNamePath: "",
    responseAttachmentNameValue:
      action === "edit" ? "edited-image.png" : "generated-image.png",
    streamProtocol: "json",
  };
}

export const INITIAL_CUSTOM_MAPPING_TEMPLATES: CustomMappingTemplate[] = [
  {
    id: "builtin-openai-image-generate",
    name: "OpenAI · Image API · 生图",
    description:
      "POST /v1/images/generations，直接调用 GPT Image 模型生成单张或多张图片。",
    endpoint: "https://api.openai.com/v1",
    suggestedModel: "gpt-image-2",
    mapping: imageApiMapping("generations"),
  },
  {
    id: "builtin-openai-responses-generate",
    name: "OpenAI · Responses API · 生图",
    description:
      "POST /v1/responses，通过 image_generation 工具在对话流程中生成图片。",
    endpoint: "https://api.openai.com/v1",
    suggestedModel: "gpt-5.6",
    mapping: responsesApiMapping("generate"),
  },
  {
    id: "builtin-openai-image-edit",
    name: "OpenAI · Image API · 编辑图",
    description:
      "POST /v1/images/edits，使用 multipart/form-data 上传一张或多张参考图片。",
    endpoint: "https://api.openai.com/v1",
    suggestedModel: "gpt-image-2",
    mapping: imageApiMapping("edits"),
  },
  {
    id: "builtin-openai-responses-edit",
    name: "OpenAI · Responses API · 编辑图",
    description:
      "POST /v1/responses，将提示词和图片作为 input 内容并强制 image_generation 执行编辑。",
    endpoint: "https://api.openai.com/v1",
    suggestedModel: "gpt-5.6",
    mapping: responsesApiMapping("edit"),
  },
];
