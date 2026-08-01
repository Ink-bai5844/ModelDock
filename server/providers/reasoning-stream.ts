import type { GatewayChunk } from "./provider.js";

const THINK_TAGS = [
  { value: "<think>", opens: true },
  { value: "</think>", opens: false },
] as const;

function chunkFor(text: string, reasoning: boolean): GatewayChunk[] {
  if (!text) return [];
  return [
    {
      type: reasoning ? "reasoning-delta" : "text-delta",
      text,
    },
  ];
}

function retainedTagPrefixLength(value: string): number {
  const lower = value.toLowerCase();
  const maxLength = Math.min(
    value.length,
    Math.max(...THINK_TAGS.map((tag) => tag.value.length)) - 1,
  );
  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = lower.slice(-length);
    if (THINK_TAGS.some((tag) => tag.value.startsWith(suffix))) {
      return length;
    }
  }
  return 0;
}

/** Splits local-model <think> traces even when the tags span stream chunks. */
export class ReasoningTagParser {
  private buffer = "";
  private reasoning = false;

  push(text: string): GatewayChunk[] {
    this.buffer += text;
    const chunks: GatewayChunk[] = [];

    while (this.buffer) {
      const lower = this.buffer.toLowerCase();
      const matches = THINK_TAGS.map((tag) => ({
        tag,
        index: lower.indexOf(tag.value),
      })).filter((match) => match.index >= 0);
      const nearest = matches.sort((left, right) => left.index - right.index)[0];

      if (nearest) {
        chunks.push(
          ...chunkFor(this.buffer.slice(0, nearest.index), this.reasoning),
        );
        this.buffer = this.buffer.slice(nearest.index + nearest.tag.value.length);
        this.reasoning = nearest.tag.opens;
        continue;
      }

      const retained = retainedTagPrefixLength(this.buffer);
      const readyLength = this.buffer.length - retained;
      chunks.push(...chunkFor(this.buffer.slice(0, readyLength), this.reasoning));
      this.buffer = this.buffer.slice(readyLength);
      break;
    }

    return chunks;
  }

  finish(): GatewayChunk[] {
    const chunks = chunkFor(this.buffer, this.reasoning);
    this.buffer = "";
    return chunks;
  }
}

export async function* normalizeReasoningStream(
  source: AsyncIterable<GatewayChunk>,
  reasoningEnabled: boolean,
): AsyncIterable<GatewayChunk> {
  const parser = new ReasoningTagParser();
  for await (const chunk of source) {
    if (chunk.type === "text-delta") {
      for (const parsed of parser.push(chunk.text)) {
        if (parsed.type !== "reasoning-delta" || reasoningEnabled) {
          yield parsed;
        }
      }
    } else if (chunk.type !== "reasoning-delta" || reasoningEnabled) {
      yield chunk;
    }
  }
  for (const parsed of parser.finish()) {
    if (parsed.type !== "reasoning-delta" || reasoningEnabled) {
      yield parsed;
    }
  }
}
