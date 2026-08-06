import { AppError } from "../core/errors.js";
import type {
  GatewayAttachment,
  GatewayMessage,
  ModelInputType,
} from "./provider.js";

export function mediaKindFromMime(mimeType: string): ModelInputType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "text";
}

export function splitDataUrl(dataUrl: string): {
  mimeType: string;
  data: string;
} {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    throw new AppError(
      400,
      "INVALID_ATTACHMENT_DATA",
      "附件必须使用 base64 data URL。",
    );
  }
  return {
    mimeType: match[1] || "application/octet-stream",
    data: match[2],
  };
}

export function attachmentSource(attachment: GatewayAttachment): string {
  const source = attachment.dataUrl ?? attachment.url;
  if (!source) {
    throw new AppError(
      400,
      "ATTACHMENT_SOURCE_REQUIRED",
      `附件 ${attachment.name} 没有可发送的数据或地址。`,
    );
  }
  return source;
}

export function attachmentBase64(attachment: GatewayAttachment): string {
  if (!attachment.dataUrl) {
    throw new AppError(
      400,
      "INLINE_ATTACHMENT_REQUIRED",
      `当前接口要求附件 ${attachment.name} 使用内联数据。`,
    );
  }
  return splitDataUrl(attachment.dataUrl).data;
}

export function textFromAttachment(attachment: GatewayAttachment): string {
  const { data } = splitDataUrl(attachment.dataUrl ?? "");
  try {
    return Buffer.from(data, "base64").toString("utf8");
  } catch {
    throw new AppError(
      400,
      "INVALID_TEXT_ATTACHMENT",
      `无法读取文本附件 ${attachment.name}。`,
    );
  }
}

function inputAttachments(message: GatewayMessage): GatewayAttachment[] {
  return message.role === "user" ? message.attachments ?? [] : [];
}

export function toOpenAiMessages(messages: GatewayMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const attachments = inputAttachments(message);
    if (!attachments.length) {
      return { role: message.role, content: message.content };
    }
    const content: Array<Record<string, unknown>> = [];
    if (message.content) content.push({ type: "text", text: message.content });
    for (const attachment of attachments) {
      if (attachment.kind === "image") {
        content.push({
          type: "image_url",
          image_url: { url: attachmentSource(attachment) },
        });
        continue;
      }
      if (attachment.kind === "audio") {
        const format = audioFormat(attachment.mimeType);
        content.push({
          type: "input_audio",
          input_audio: {
            data: attachmentBase64(attachment),
            format,
          },
        });
        continue;
      }
      content.push({
        type: "file",
        file: {
          filename: attachment.name,
          file_data: attachmentSource(attachment),
        },
      });
    }
    return { role: message.role, content };
  });
}

export function toAnthropicContent(
  message: GatewayMessage,
): string | Array<Record<string, unknown>> {
  const attachments = inputAttachments(message);
  if (!attachments.length) return message.content;
  const content: Array<Record<string, unknown>> = [];
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: attachmentBase64(attachment),
        },
      });
      continue;
    }
    if (attachment.kind === "text") {
      if (attachment.mimeType === "application/pdf") {
        content.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: attachmentBase64(attachment),
          },
          title: attachment.name,
        });
      } else {
        content.push({
          type: "document",
          source: {
            type: "text",
            media_type: "text/plain",
            data: textFromAttachment(attachment),
          },
          title: attachment.name,
        });
      }
      continue;
    }
    throw new AppError(
      400,
      "ANTHROPIC_MEDIA_UNSUPPORTED",
      `Anthropic Messages 适配器暂不支持${attachment.kind === "audio" ? "音频" : "视频"}附件 ${attachment.name}。`,
    );
  }
  if (message.content) content.push({ type: "text", text: message.content });
  return content;
}

export function toGeminiParts(message: GatewayMessage): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (message.content) parts.push({ text: message.content });
  for (const attachment of inputAttachments(message)) {
    if (attachment.dataUrl) {
      const { data, mimeType } = splitDataUrl(attachment.dataUrl);
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType || mimeType,
          data,
          displayName: attachment.name,
        },
      });
    } else if (attachment.url) {
      parts.push({
        fileData: {
          mimeType: attachment.mimeType,
          fileUri: attachment.url,
          displayName: attachment.name,
        },
      });
    }
  }
  return parts;
}

export function toOllamaMessage(message: GatewayMessage): Record<string, unknown> {
  const images: string[] = [];
  const textAttachments: string[] = [];
  for (const attachment of inputAttachments(message)) {
    if (attachment.kind === "image") {
      images.push(attachmentBase64(attachment));
    } else if (attachment.kind === "text") {
      textAttachments.push(
        `--- ${attachment.name} ---\n${textFromAttachment(attachment)}\n--- END ---`,
      );
    } else {
      throw new AppError(
        400,
        "OLLAMA_MEDIA_UNSUPPORTED",
        `Ollama /api/chat 适配器暂不支持${attachment.kind === "audio" ? "音频" : "视频"}附件 ${attachment.name}。`,
      );
    }
  }
  return {
    role: message.role,
    content: [message.content, ...textAttachments].filter(Boolean).join("\n\n"),
    ...(images.length ? { images } : {}),
  };
}

export function createOutputAttachment(input: {
  data?: string;
  url?: string;
  mimeType?: string;
  name?: string;
}): GatewayAttachment | undefined {
  const mimeType = input.mimeType?.trim() || mimeFromDataUrl(input.data) || "";
  const dataUrl = input.data
    ? input.data.startsWith("data:")
      ? input.data
      : mimeType
        ? `data:${mimeType};base64,${input.data}`
        : undefined
    : undefined;
  const url = input.url?.trim();
  if ((!dataUrl && !url) || !mimeType) return undefined;
  const kind = mediaKindFromMime(mimeType);
  return {
    id: `output-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    kind,
    name: input.name?.trim() || `模型输出.${extensionForMime(mimeType)}`,
    mimeType,
    size: dataUrl ? Math.floor((dataUrl.split(",")[1]?.length ?? 0) * 0.75) : 0,
    dataUrl,
    url,
  };
}

function audioFormat(mimeType: string): "wav" | "mp3" {
  if (["audio/wav", "audio/x-wav"].includes(mimeType)) return "wav";
  if (mimeType === "audio/mpeg") return "mp3";
  throw new AppError(
    400,
    "OPENAI_AUDIO_FORMAT_UNSUPPORTED",
    "OpenAI-compatible 音频输入当前仅支持 WAV 或 MP3。",
  );
}

function mimeFromDataUrl(value?: string): string | undefined {
  return value?.startsWith("data:") ? /^data:([^;,]+)/.exec(value)?.[1] : undefined;
}

function extensionForMime(mimeType: string): string {
  const known: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  return known[mimeType] ?? "bin";
}
