import { AppError } from "../core/errors.js";

export function joinEndpoint(base: string, requestedPath: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new AppError(400, "INVALID_ENDPOINT", "Base URL 格式不正确。");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError(400, "INVALID_ENDPOINT", "Base URL 只能使用 HTTP 或 HTTPS。");
  }

  const current = url.pathname.replace(/\/+$/, "");
  let target = `/${requestedPath.replace(/^\/+/, "")}`;
  for (const version of ["/v1", "/v1beta"]) {
    if (current.endsWith(version) && target.startsWith(`${version}/`)) {
      target = target.slice(version.length);
    }
  }
  url.pathname = `${current}${target}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function fetchChecked(
  url: string,
  init: RequestInit,
  timeoutMs = 45_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Provider request timed out")), timeoutMs);
  const external = init.signal;
  const abort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 600);
      throw new AppError(
        502,
        "PROVIDER_ERROR",
        `上游接口返回 ${response.status}${details ? `：${details}` : ""}`,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) {
      throw new AppError(504, "PROVIDER_TIMEOUT", "连接上游模型接口超时或已取消。");
    }
    throw new AppError(
      502,
      "PROVIDER_UNREACHABLE",
      error instanceof Error ? `无法连接上游接口：${error.message}` : "无法连接上游接口。",
    );
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", abort);
  }
}

export async function* readSseData(response: Response): AsyncIterable<string> {
  if (!response.body) {
    throw new AppError(502, "EMPTY_PROVIDER_STREAM", "上游接口没有返回流式内容。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const data = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) yield data;
  }
}

export async function* readNdjson(response: Response): AsyncIterable<unknown> {
  if (!response.body) {
    throw new AppError(502, "EMPTY_PROVIDER_STREAM", "上游接口没有返回流式内容。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}
