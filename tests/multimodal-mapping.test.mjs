import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutputAttachment,
  toAnthropicContent,
  toGeminiParts,
  toOllamaMessage,
  toOpenAiMessages,
} from "../dist-server/providers/media-mapping.js";

const attachments = {
  image: {
    id: "image-1",
    kind: "image",
    name: "diagram.png",
    mimeType: "image/png",
    size: 3,
    dataUrl: "data:image/png;base64,eHl6",
  },
  audio: {
    id: "audio-1",
    kind: "audio",
    name: "voice.mp3",
    mimeType: "audio/mpeg",
    size: 3,
    dataUrl: "data:audio/mpeg;base64,eHl6",
  },
  video: {
    id: "video-1",
    kind: "video",
    name: "clip.mp4",
    mimeType: "video/mp4",
    size: 3,
    dataUrl: "data:video/mp4;base64,eHl6",
  },
  text: {
    id: "text-1",
    kind: "text",
    name: "notes.txt",
    mimeType: "text/plain",
    size: 5,
    dataUrl: "data:text/plain;base64,aGVsbG8=",
  },
};

test("OpenAI-compatible mapping emits official image, audio and file content parts", () => {
  const [message] = toOpenAiMessages([
    {
      role: "user",
      content: "Review these files",
      attachments: Object.values(attachments),
    },
  ]);
  assert.deepEqual(message.content, [
    { type: "text", text: "Review these files" },
    {
      type: "image_url",
      image_url: { url: attachments.image.dataUrl },
    },
    {
      type: "input_audio",
      input_audio: { data: "eHl6", format: "mp3" },
    },
    {
      type: "file",
      file: {
        filename: "clip.mp4",
        file_data: attachments.video.dataUrl,
      },
    },
    {
      type: "file",
      file: {
        filename: "notes.txt",
        file_data: attachments.text.dataUrl,
      },
    },
  ]);
});

test("Anthropic mapping supports images and documents and rejects unsupported media", () => {
  const content = toAnthropicContent({
    role: "user",
    content: "Summarize",
    attachments: [attachments.image, attachments.text],
  });
  assert.equal(content[0].type, "image");
  assert.equal(content[0].source.data, "eHl6");
  assert.equal(content[1].type, "document");
  assert.equal(content[1].source.data, "hello");
  assert.deepEqual(content.at(-1), { type: "text", text: "Summarize" });

  assert.throws(
    () =>
      toAnthropicContent({
        role: "user",
        content: "",
        attachments: [attachments.audio],
      }),
    /暂不支持音频附件/,
  );
});

test("Gemini mapping preserves every media MIME type as inlineData", () => {
  const parts = toGeminiParts({
    role: "user",
    content: "Inspect",
    attachments: Object.values(attachments),
  });
  assert.deepEqual(parts[0], { text: "Inspect" });
  assert.deepEqual(
    parts.slice(1).map((part) => part.inlineData.mimeType),
    ["image/png", "audio/mpeg", "video/mp4", "text/plain"],
  );
});

test("Ollama mapping sends image bytes and folds text attachments into content", () => {
  const message = toOllamaMessage({
    role: "user",
    content: "Describe",
    attachments: [attachments.image, attachments.text],
  });
  assert.deepEqual(message.images, ["eHl6"]);
  assert.match(message.content, /Describe[\s\S]*notes\.txt[\s\S]*hello/);
  assert.throws(
    () =>
      toOllamaMessage({
        role: "user",
        content: "",
        attachments: [attachments.video],
      }),
    /暂不支持视频附件/,
  );
});

test("provider media output is normalized to a persisted attachment", () => {
  const attachment = createOutputAttachment({
    data: "eHl6",
    mimeType: "image/png",
    name: "result.png",
  });
  assert.deepEqual(attachment, {
    id: attachment.id,
    kind: "image",
    name: "result.png",
    mimeType: "image/png",
    size: 3,
    dataUrl: "data:image/png;base64,eHl6",
    url: undefined,
  });
});
