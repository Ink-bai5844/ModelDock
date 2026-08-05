import type {
  ChatAttachment,
  ModelInputType,
} from "./types";

export const MODEL_INPUT_TYPE_LABELS: Record<ModelInputType, string> = {
  text: "文本",
  image: "图像",
  video: "视频",
  audio: "音频",
};

export const MODEL_INPUT_TYPES: ModelInputType[] = [
  "text",
  "image",
  "video",
  "audio",
];

const ACCEPT_BY_TYPE: Record<ModelInputType, string[]> = {
  text: [
    ".txt",
    ".md",
    ".json",
    ".jsonl",
    ".csv",
    ".tsv",
    ".pdf",
    ".html",
    ".css",
    ".xml",
    ".yaml",
    ".yml",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".java",
    ".go",
    ".rs",
    ".sql",
  ],
  image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"],
  audio: [
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/mp4",
    "audio/webm",
    "audio/flac",
  ],
};

const TEXT_EXTENSIONS = new Set(
  ACCEPT_BY_TYPE.text.map((value) => value.replace(/^\./, "")),
);

export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_DRAFT_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_DRAFT_ATTACHMENTS = 6;

export function acceptForInputTypes(inputTypes: ModelInputType[]): string {
  return [...new Set(inputTypes.flatMap((type) => ACCEPT_BY_TYPE[type]))].join(",");
}

export function inferAttachmentKind(file: Pick<File, "name" | "type">): ModelInputType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (
    file.type.startsWith("text/") ||
    ["application/json", "application/pdf", "application/xml"].includes(file.type) ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }
  return "text";
}

export async function fileToAttachment(
  file: File,
  allowedTypes: ModelInputType[],
): Promise<ChatAttachment> {
  const kind = inferAttachmentKind(file);
  if (!allowedTypes.includes(kind)) {
    throw new Error(`当前模型不接受${MODEL_INPUT_TYPE_LABELS[kind]}输入。`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`单个附件不能超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}。`);
  }
  const id = `attachment-${Date.now()}-${crypto.randomUUID()}`;
  const response = await fetch("/api/workspace/attachment", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type || mimeTypeFromName(file.name, kind),
      "x-modeldock-attachment-id": id,
      "x-modeldock-filename": encodeURIComponent(file.name),
      "x-modeldock-kind": kind,
    },
    body: file,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    attachment?: ChatAttachment;
    error?: { message?: string };
  };
  if (!response.ok || !payload.attachment?.workspacePath) {
    throw new Error(payload.error?.message ?? "附件保存到工作区失败。");
  }
  return payload.attachment;
}

export function attachmentSource(attachment: ChatAttachment): string | undefined {
  if (attachment.workspacePath) {
    const query = new URLSearchParams({ path: attachment.workspacePath });
    return `/api/workspace/file?${query.toString()}`;
  }
  return attachment.dataUrl ?? attachment.url;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mimeTypeFromName(name: string, kind: ModelInputType): string {
  const extension = name.split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    jsonl: "application/jsonl",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    mp4: kind === "audio" ? "audio/mp4" : "video/mp4",
    webm: kind === "audio" ? "audio/webm" : "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return (extension && known[extension]) || `${kind}/unknown`;
}
