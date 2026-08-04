import { AppError } from "../core/errors.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 10;
const MAX_RESULTS_PER_SOURCE = 6;
const SEARCH_TIMEOUT_MS = 20_000;
const SOURCE_TIMEOUT_MS = 7_000;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchConfig {
  braveApiKey: string;
  tavilyApiKey: string;
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: unknown;
      url?: unknown;
      description?: unknown;
    }>;
  };
}

interface TavilySearchResponse {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    content?: unknown;
  }>;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLocaleLowerCase("en-US")] ?? `&${entity};`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDuckDuckGoUrl(value: string): string {
  const decoded = decodeHtml(value);
  try {
    const url = decoded.startsWith("//") ? new URL(`https:${decoded}`) : new URL(decoded);
    const redirectTarget = url.searchParams.get("uddg");
    return redirectTarget ? decodeURIComponent(redirectTarget) : url.toString();
  } catch {
    return decoded;
  }
}

function decodeBingUrl(value: string): string {
  const decoded = decodeHtml(value);
  try {
    const url = new URL(decoded);
    const encodedTarget = url.hostname.endsWith("bing.com")
      ? url.searchParams.get("u")
      : undefined;
    if (encodedTarget?.startsWith("a1")) {
      const target = Buffer.from(encodedTarget.slice(2), "base64url").toString("utf8");
      const targetUrl = new URL(target);
      if (/^https?:$/.test(targetUrl.protocol)) return targetUrl.toString();
    }
    return url.toString();
  } catch {
    return decoded;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function canonicalResultUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|msclkid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value;
  }
}

function mergeResultSets(
  resultSets: WebSearchResult[][],
): WebSearchResult[] {
  const merged: WebSearchResult[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...resultSets.map((results) => results.length));
  for (let index = 0; index < longest; index += 1) {
    for (const results of resultSets) {
      const result = results[index];
      if (!result) continue;
      const canonicalUrl = canonicalResultUrl(result.url);
      if (seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      merged.push(result);
      if (merged.length >= MAX_RESULTS) return merged;
    }
  }
  return merged;
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AppError(502, "WEB_SEARCH_TOO_LARGE", "联网搜索返回的数据过大。 ");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const resultPattern = /<a[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results: WebSearchResult[] = [];
  for (const match of html.matchAll(resultPattern)) {
    const url = decodeDuckDuckGoUrl(match[1]);
    if (!isHttpUrl(url)) continue;
    results.push({
      title: decodeHtml(match[2]),
      url,
      snippet: decodeHtml(match[3]),
    });
    if (results.length >= MAX_RESULTS_PER_SOURCE) return results;
  }
  if (results.length) return results;

  const linkPattern = /<a[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const url = decodeDuckDuckGoUrl(match[1]);
    if (!isHttpUrl(url)) continue;
    results.push({ title: decodeHtml(match[2]), url, snippet: "" });
    if (results.length >= MAX_RESULTS_PER_SOURCE) break;
  }
  return results;
}

function parseBingResults(html: string): WebSearchResult[] {
  const resultPattern = /<li[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*class=["'][^"']*\bb_caption\b[^"']*["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  const results: WebSearchResult[] = [];
  for (const match of html.matchAll(resultPattern)) {
    const url = decodeBingUrl(match[1]);
    if (!isHttpUrl(url)) continue;
    results.push({
      title: decodeHtml(match[2]),
      url,
      snippet: decodeHtml(match[3]),
    });
    if (results.length >= MAX_RESULTS_PER_SOURCE) break;
  }
  return results;
}

async function searchBrave(
  query: string,
  signal: AbortSignal,
  apiKeyInput: string,
): Promise<WebSearchResult[]> {
  const apiKey = apiKeyInput.trim();
  if (!apiKey) {
    throw new Error("Brave Search is not configured.");
  }
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("country", "CN");
  url.searchParams.set("search_lang", "zh-hans");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("spellcheck", "1");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal,
  });
  const source = await readLimitedBody(response);
  if (!response.ok) {
    throw new Error(`Brave Search returned HTTP ${response.status}.`);
  }
  let payload: BraveSearchResponse;
  try {
    payload = JSON.parse(source) as BraveSearchResponse;
  } catch {
    throw new Error("Brave Search returned invalid JSON.");
  }
  if (!Array.isArray(payload.web?.results)) return [];
  return payload.web.results.flatMap((item) => {
    if (
      typeof item.title !== "string" ||
      typeof item.url !== "string" ||
      !isHttpUrl(item.url)
    ) {
      return [];
    }
    return [{
      title: decodeHtml(item.title),
      url: item.url,
      snippet: typeof item.description === "string" ? decodeHtml(item.description) : "",
    }];
  }).slice(0, MAX_RESULTS);
}

async function searchTavily(
  query: string,
  signal: AbortSignal,
  apiKeyInput: string,
): Promise<WebSearchResult[]> {
  const apiKey = apiKeyInput.trim();
  if (!apiKey) {
    throw new Error("Tavily Search is not configured.");
  }
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: MAX_RESULTS,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal,
  });
  const source = await readLimitedBody(response);
  if (!response.ok) {
    throw new Error(`Tavily Search returned HTTP ${response.status}.`);
  }
  let payload: TavilySearchResponse;
  try {
    payload = JSON.parse(source) as TavilySearchResponse;
  } catch {
    throw new Error("Tavily Search returned invalid JSON.");
  }
  if (!Array.isArray(payload.results)) return [];
  return payload.results.flatMap((item) => {
    if (
      typeof item.title !== "string" ||
      typeof item.url !== "string" ||
      !isHttpUrl(item.url)
    ) {
      return [];
    }
    return [{
      title: decodeHtml(item.title),
      url: item.url,
      snippet: typeof item.content === "string" ? decodeHtml(item.content) : "",
    }];
  }).slice(0, MAX_RESULTS);
}

async function searchDuckDuckGo(
  query: string,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": BROWSER_USER_AGENT,
    },
    body: new URLSearchParams({ q: query }),
    redirect: "follow",
    signal,
  });
  const html = await readLimitedBody(response);
  if (
    response.status === 202 ||
    /(?:challenge-form|image-check_|anomaly-modal)/i.test(html)
  ) {
    throw new Error("DuckDuckGo returned a verification page.");
  }
  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}.`);
  }
  return parseDuckDuckGoResults(html);
}

async function searchBing(
  query: string,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("setlang", "zh-hans");
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
      "user-agent": BROWSER_USER_AGENT,
    },
    redirect: "follow",
    signal,
  });
  const html = await readLimitedBody(response);
  if (!response.ok) {
    throw new Error(`Bing returned HTTP ${response.status}.`);
  }
  if (/(?:b_captcha|captcha-container)/i.test(html)) {
    throw new Error("Bing returned a verification page.");
  }
  const results = parseBingResults(html);
  if (!results.length && !/(?:id=["']b_results["']|class=["'][^"']*\bb_no\b)/i.test(html)) {
    throw new Error("Bing returned an unrecognized search page.");
  }
  return results;
}

export async function searchWeb(
  queryInput: unknown,
  config: WebSearchConfig,
  signal?: AbortSignal,
): Promise<{
  query: string;
  results: WebSearchResult[];
}> {
  if (typeof queryInput !== "string" || !queryInput.trim()) {
    throw new AppError(400, "INVALID_WEB_SEARCH", "联网搜索词不能为空。 ");
  }
  const query = queryInput.trim().slice(0, 300);
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let successfulSourceCount = 0;

  const apiProviders = [
    { search: searchBrave, apiKey: config.braveApiKey },
    { search: searchTavily, apiKey: config.tavilyApiKey },
  ];
  for (const provider of apiProviders) {
    try {
      const providerSignal = AbortSignal.any([
        combinedSignal,
        AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      ]);
      const results = await provider.search(query, providerSignal, provider.apiKey);
      successfulSourceCount += 1;
      if (results.length) return { query, results };
    } catch {
      if (combinedSignal.aborted) {
        throw new AppError(504, "WEB_SEARCH_TIMEOUT", "联网搜索超时或已取消。 ");
      }
    }
  }

  const htmlFallbackResults = await Promise.allSettled([
    searchBing(query, AbortSignal.any([
      combinedSignal,
      AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    ])),
    searchDuckDuckGo(query, AbortSignal.any([
      combinedSignal,
      AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    ])),
  ]);
  if (combinedSignal.aborted) {
    throw new AppError(504, "WEB_SEARCH_TIMEOUT", "联网搜索超时或已取消。 ");
  }
  successfulSourceCount += htmlFallbackResults.filter(
    (result) => result.status === "fulfilled",
  ).length;
  const mergedFallbackResults = mergeResultSets(htmlFallbackResults.map((result) =>
    result.status === "fulfilled" ? result.value : [],
  ));
  if (mergedFallbackResults.length) {
    return { query, results: mergedFallbackResults };
  }
  if (successfulSourceCount > 0) return { query, results: [] };

  throw new AppError(
    502,
    "WEB_SEARCH_UNAVAILABLE",
    "联网搜索源暂时不可用，请稍后重试。",
  );
}
