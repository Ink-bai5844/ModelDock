# ModelDock Web Search Provider Options (2026-08)

## Context

ModelDock currently tries Google Custom Search when configured, then parses public Bing HTML, then falls back to DuckDuckGo HTML. The production server receives an alternate Bing response without normal result markup, while DuckDuckGo returns an anti-bot page. This is a search-source restriction, not a DNS, TLS, or general outbound-network failure.

Unauthenticated connectivity checks from the production container reached the official API endpoints for Brave Search, Tavily, Exa, and Serper. Their expected authentication or billing errors arrived quickly, so all four are viable at the network layer once valid credentials are supplied.

## Recommended options

| Provider | Best use | Integration | Current public pricing | Notes |
| --- | --- | --- | --- | --- |
| Brave Search API | Default general web search | `GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token` | $5/1,000 Search requests; $5 monthly credits | Best drop-in fit for ModelDock's `{title,url,snippet}` result model; independent search index. |
| Tavily Search API | Agent-oriented search and ready-to-use snippets | `POST https://api.tavily.com/search`, Bearer API key | 1,000 free credits/month; basic search is 1 credit; PAYG $0.008/credit | Very simple LLM integration; returns normalized result content and optional answer/context. |
| Exa Search API | Semantic and research-heavy retrieval | `POST https://api.exa.ai/search`, `x-api-key` | Free monthly credits; Search starts at $7/1,000 requests | Strong semantic search and optional highlights/full text, but more capability than ordinary search needs. |
| SearXNG (self-hosted) | Vendor-independent aggregation | Self-hosted `/search?q=...&format=json` | Software is self-hosted | It still calls upstream search engines from the server IP, so it can inherit the same blocks and should not be the only production provider. |
| Microsoft Foundry Grounding with Bing Search | Fully official Microsoft/Bing grounding | Foundry Agent Service connection and model/tool integration | Azure/Foundry billing | Official replacement path, but not a raw drop-in Bing results API and substantially heavier than ModelDock needs. |

## Suggested ModelDock design

1. Use Brave Search API as the primary general search provider.
2. Add Tavily as a configurable fallback for agent searches.
3. Keep Google only for existing eligible accounts.
4. Treat Bing and DuckDuckGo HTML parsing as best-effort legacy fallbacks, never as the production primary.
5. Normalize every provider to `{ title, url, snippet, source }`, deduplicate by canonical URL, and apply per-provider timeouts.
6. Store API keys only in server environment variables or encrypted administrator configuration; never expose them to the browser or logs.

Suggested `config.json` section:

```json
"search": {
  "braveApiKey": "...",
  "tavilyApiKey": "..."
}
```

## Primary sources

- Brave Search API overview and pricing: https://brave.com/search/api/
- Brave Search API reference: https://api-dashboard.search.brave.com/api-reference/web/search/get
- Tavily Search reference: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Tavily credits and pricing: https://docs.tavily.com/documentation/api-credits
- Exa Search reference: https://exa.ai/docs/reference/search
- Exa API pricing: https://exa.ai/pricing?tab=api
- SearXNG Search API: https://docs.searxng.org/dev/search_api.html
- Bing Search API retirement: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
- Microsoft Foundry Bing tools: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/bing-tools
