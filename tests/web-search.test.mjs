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

const EMPTY_SEARCH_CONFIG = { braveApiKey: "", tavilyApiKey: "" };

test("web search uses Brave first and returns normalized direct URLs", async () => {
  const config = { braveApiKey: "brave-fixture", tavilyApiKey: "tavily-fixture" };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    assert.equal(url.startsWith("https://api.search.brave.com/res/v1/web/search"), true);
    assert.equal(new Headers(init?.headers).get("X-Subscription-Token"), "brave-fixture");
    return Response.json({
      web: {
        results: [{
          title: "Brave result",
          url: "https://openai.com/brave-result",
          description: "Brave result summary.",
        }],
      },
    });
  };
  try {
    const result = await searchWeb("gpt5.6sol", config);
    assert.equal(calls.length, 1);
    assert.deepEqual(result.results, [{
      title: "Brave result",
      url: "https://openai.com/brave-result",
      snippet: "Brave result summary.",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search falls back from Brave to Tavily", async () => {
  const config = { braveApiKey: "brave-fixture", tavilyApiKey: "tavily-fixture" };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://api.search.brave.com/")) {
      return new Response("unavailable", { status: 503 });
    }
    assert.equal(url, "https://api.tavily.com/search");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer tavily-fixture");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      query: "latest ModelDock",
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    });
    return Response.json({
      results: [{
        title: "Tavily result",
        url: "https://example.com/tavily",
        content: "Tavily result summary.",
      }],
    });
  };
  try {
    const result = await searchWeb("latest ModelDock", config);
    assert.equal(calls.length, 2);
    assert.equal(result.results[0].url, "https://example.com/tavily");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search uses Bing and DuckDuckGo together as the final fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://www.bing.com/")) {
      return new Response(
        bingFixture("https://openai.com/shared/?utm_source=bing"),
        { status: 200 },
      );
    }
    if (url.startsWith("https://html.duckduckgo.com/")) {
      return new Response(duckDuckGoFixture("https://openai.com/shared"), { status: 200 });
    }
    throw new Error(`Unexpected search source: ${url}`);
  };
  try {
    const result = await searchWeb("fallback query", EMPTY_SEARCH_CONFIG);
    assert.equal(calls.length, 2);
    assert.equal(calls.some((url) => url.startsWith("https://www.bing.com/")), true);
    assert.equal(calls.some((url) => url.startsWith("https://html.duckduckgo.com/")), true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].title, "Bing result");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search reports provider failure instead of a false empty result", async () => {
  const config = { braveApiKey: "brave-fixture", tavilyApiKey: "tavily-fixture" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("duckduckgo.com")) {
      return new Response('<input name="image-check_fixture">', { status: 202 });
    }
    return new Response("unavailable", { status: 503 });
  };
  try {
    await assert.rejects(
      searchWeb("OpenAI", config),
      (error) => error?.code === "WEB_SEARCH_UNAVAILABLE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
