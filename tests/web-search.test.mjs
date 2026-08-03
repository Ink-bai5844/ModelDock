import assert from "node:assert/strict";
import test from "node:test";
import { searchWeb } from "../dist-server/agent/web-search.js";

function bingFixture(targetUrl, title = "Bing result") {
  const encoded = Buffer.from(targetUrl, "utf8").toString("base64url");
  return `<!doctype html>
    <title>搜索</title>
    <ol id="b_results">
      <li class="b_algo">
        <h2><a href="https://www.bing.com/ck/a?u=a1${encoded}">${title}</a></h2>
        <div class="b_caption"><p>Bing result summary.</p></div>
      </li>
    </ol>`;
}

function duckDuckGoFixture(targetUrl) {
  return `<a class="result__a" href="${targetUrl}">DuckDuckGo result</a>
    <a class="result__snippet">DuckDuckGo fallback summary.</a>`;
}

function withGoogleConfig() {
  const previous = {
    key: process.env.MODELDOCK_GOOGLE_SEARCH_API_KEY,
    cx: process.env.MODELDOCK_GOOGLE_SEARCH_ENGINE_ID,
  };
  process.env.MODELDOCK_GOOGLE_SEARCH_API_KEY = "fixture-key";
  process.env.MODELDOCK_GOOGLE_SEARCH_ENGINE_ID = "fixture-cx";
  return () => {
    if (previous.key === undefined) delete process.env.MODELDOCK_GOOGLE_SEARCH_API_KEY;
    else process.env.MODELDOCK_GOOGLE_SEARCH_API_KEY = previous.key;
    if (previous.cx === undefined) delete process.env.MODELDOCK_GOOGLE_SEARCH_ENGINE_ID;
    else process.env.MODELDOCK_GOOGLE_SEARCH_ENGINE_ID = previous.cx;
  };
}

test("web search queries Google and Bing together and merges direct URLs", async () => {
  const restoreConfig = withGoogleConfig();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://customsearch.googleapis.com/")) {
      return Response.json({
        items: [{
          title: "Google result",
          link: "https://openai.com/google-result",
          snippet: "Google result summary.",
        }],
      });
    }
    if (url.startsWith("https://www.bing.com/")) {
      return new Response(
        bingFixture("https://openai.com/bing-result", "Bing result"),
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    throw new Error(`Unexpected search source: ${url}`);
  };
  try {
    const result = await searchWeb("gpt5.6sol");
    assert.equal(calls.length, 2);
    assert.equal(calls.some((url) => url.startsWith("https://customsearch.googleapis.com/")), true);
    assert.equal(calls.some((url) => url.startsWith("https://www.bing.com/")), true);
    assert.deepEqual(
      result.results.map((item) => item.url),
      ["https://openai.com/google-result", "https://openai.com/bing-result"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreConfig();
  }
});

test("web search deduplicates the same result returned by Google and Bing", async () => {
  const restoreConfig = withGoogleConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://customsearch.googleapis.com/")) {
      return Response.json({
        items: [{
          title: "Google title",
          link: "https://openai.com/shared/?utm_source=google",
          snippet: "Google summary.",
        }],
      });
    }
    return new Response(
      bingFixture("https://openai.com/shared", "Bing title"),
      { status: 200 },
    );
  };
  try {
    const result = await searchWeb("shared result");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].title, "Google title");
  } finally {
    globalThis.fetch = originalFetch;
    restoreConfig();
  }
});

test("web search falls back to DuckDuckGo only when Google and Bing fail", async () => {
  const restoreConfig = withGoogleConfig();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("duckduckgo.com")) {
      return new Response(duckDuckGoFixture("https://example.com/fallback"), {
        status: 200,
      });
    }
    return new Response("unavailable", { status: 503 });
  };
  try {
    const result = await searchWeb("fallback query");
    assert.equal(calls.length, 3);
    assert.equal(result.results[0].url, "https://example.com/fallback");
  } finally {
    globalThis.fetch = originalFetch;
    restoreConfig();
  }
});

test("web search reports provider failure instead of a false empty result", async () => {
  const restoreConfig = withGoogleConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    return url.includes("duckduckgo.com")
      ? new Response('<input name="image-check_fixture">', { status: 202 })
      : new Response("unavailable", { status: 503 });
  };
  try {
    await assert.rejects(
      searchWeb("OpenAI"),
      (error) => error?.code === "WEB_SEARCH_UNAVAILABLE",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreConfig();
  }
});
