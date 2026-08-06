import path from "node:path";
import { createHash } from "node:crypto";
import { AppError } from "../core/errors.js";
import type {
  GatewayAttachment,
  GatewayMessage,
} from "../providers/provider.js";
import { AgentDataWorkspace } from "../agent/data-workspace.js";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function attachmentPath(attachment: GatewayAttachment): string {
  const identity = createHash("sha256")
    .update(attachment.id, "utf8")
    .digest("hex")
    .slice(0, 16);
  const extension = path.extname(attachment.name).slice(0, 12);
  const baseName = safeSegment(
    path.basename(attachment.name, path.extname(attachment.name)),
    "attachment",
  );
  return `attachments/${identity}-${baseName}${extension}`;
}

function decodeDataUrl(value: string): { mimeType: string; buffer: Buffer } {
  const match = value.match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) {
    throw new AppError(400, "INVALID_ATTACHMENT_DATA", "附件不是有效的 Base64 Data URL。");
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AppError(413, "ATTACHMENT_TOO_LARGE", "单个聊天附件不能超过 12 MiB。");
  }
  return {
    mimeType: match[1] || "application/octet-stream",
    buffer,
  };
}

export async function storeWorkspaceAttachment(
  accountId: string,
  attachment: GatewayAttachment,
  buffer: Buffer,
  workspace: AgentDataWorkspace,
): Promise<GatewayAttachment> {
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AppError(413, "ATTACHMENT_TOO_LARGE", "单个聊天附件不能超过 12 MiB。");
  }
  const stored = await workspace.writeBinary(
    accountId,
    attachmentPath(attachment),
    buffer,
  );
  return {
    ...attachment,
    size: buffer.byteLength,
    dataUrl: undefined,
    url: undefined,
    workspacePath: stored.path,
  };
}

export async function externalizeGatewayAttachment(
  accountId: string,
  attachment: GatewayAttachment,
  workspace: AgentDataWorkspace,
): Promise<GatewayAttachment> {
  if (!attachment.dataUrl) return attachment;
  const decoded = decodeDataUrl(attachment.dataUrl);
  return storeWorkspaceAttachment(
    accountId,
    {
      ...attachment,
      mimeType: attachment.mimeType || decoded.mimeType,
    },
    decoded.buffer,
    workspace,
  );
}

export async function externalizeAccountStateAttachments(
  accountId: string,
  value: unknown,
  workspace: AgentDataWorkspace,
): Promise<{ state: any; changed: boolean }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { state: value, changed: false };
  }
  const state = value as Record<string, any>;
  if (!Array.isArray(state.conversations)) return { state, changed: false };
  let changed = false;
  const conversations = [];
  for (const conversation of state.conversations) {
    if (!conversation || typeof conversation !== "object" || !Array.isArray(conversation.messages)) {
      conversations.push(conversation);
      continue;
    }
    const messages = [];
    for (const message of conversation.messages) {
      if (!message || typeof message !== "object" || !Array.isArray(message.attachments)) {
        messages.push(message);
        continue;
      }
      const attachments = [];
      for (const attachment of message.attachments) {
        if (attachment?.dataUrl && typeof attachment.dataUrl === "string") {
          attachments.push(
            await externalizeGatewayAttachment(accountId, attachment, workspace),
          );
          changed = true;
        } else {
          attachments.push(attachment);
        }
      }
      messages.push({ ...message, attachments });
    }
    conversations.push({ ...conversation, messages });
  }
  return {
    state: changed ? { ...state, conversations } : state,
    changed,
  };
}

export async function hydrateGatewayMessages(
  accountId: string,
  messages: GatewayMessage[],
  workspace: AgentDataWorkspace,
): Promise<GatewayMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user" || !message.attachments?.length) return message;
      return {
        ...message,
        attachments: await Promise.all(
          message.attachments.map(async (attachment) => {
            if (!attachment.workspacePath) return attachment;
            const buffer = await workspace.readBinary(
              accountId,
              attachment.workspacePath,
              MAX_ATTACHMENT_BYTES,
            );
            return {
              ...attachment,
              dataUrl: `data:${attachment.mimeType};base64,${buffer.toString("base64")}`,
              url: undefined,
            };
          }),
        ),
      };
    }),
  );
}
