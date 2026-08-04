# Bing official search integration (2026-08)

## Status

The standalone Bing Search APIs were retired on 2025-08-11. Existing instances were decommissioned and new customer signup is unavailable. Microsoft directs customers to Bing-backed web grounding in Microsoft Foundry Agent Service.

## Current recommended route

Microsoft's current Foundry documentation recommends the **Web Search tool**. It uses Grounding with Bing Search behind the scenes and executes server-side through the Foundry Responses API. It returns a model-generated answer with inline URL citations rather than acting as a drop-in raw search-results endpoint.

Prerequisites:

- An Azure subscription and Microsoft Foundry project.
- A basic or standard agent environment.
- A model deployment in that Foundry project.
- Microsoft Entra authentication, normally `DefaultAzureCredential` or an access token scoped to `https://ai.azure.com/.default`.
- A Foundry project endpoint in the form `https://<resource>.ai.azure.com/api/projects/<project>`.

Recommended flow:

1. Create a Microsoft Foundry project and agent environment.
2. Deploy a supported model.
3. Authenticate the server with a managed identity, service principal, or Azure CLI during development.
4. Create a Foundry toolbox containing `{ "type": "web_search" }`.
5. Expose that toolbox through its MCP-compatible endpoint.
6. Attach it to a Foundry prompt agent and call the Foundry Responses API.
7. Read the generated answer and URL citation annotations.

The TypeScript SDK packages used by Microsoft's sample are `@azure/identity` and `@azure/ai-projects`.

## Explicit Grounding with Bing connection route

Foundry also documents a `bing_grounding` tool that uses a Grounding with Bing Search Azure resource and a Foundry project connection. This route requires:

- Registering the `Microsoft.Bing` Azure resource provider when needed.
- Creating a Grounding with Bing Search resource.
- Creating a connection from the Foundry project to that resource.
- Saving the Foundry project endpoint, deployed model name, and Bing project connection ID.
- Calling `<FOUNDRY_PROJECT_ENDPOINT>/openai/v1/responses` with a Microsoft Entra bearer token and a `bing_grounding` tool declaration.

This request still goes through Foundry and a deployed model; it is not a direct replacement for the retired `api.bing.microsoft.com/v7.0/search` response format.

## Fit for ModelDock

This integration is suitable if ModelDock should use a Microsoft-hosted Foundry model to both search and compose the grounded answer. It is not an ideal provider for ModelDock's current architecture, where an arbitrary selected model should receive a normalized `{title, url, snippet}` list. Brave Search or Tavily is a simpler fit for that architecture.

If official Bing is required, implement it as a separate Foundry-backed search/answer provider, not as a parser inside the existing raw web-search adapter.

## Official sources

- Bing Search API retirement: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
- Current Foundry Web Search tool: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/web-search
- Grounding with Bing Search tool and REST example: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/bing-tools
- Add a Foundry project connection: https://learn.microsoft.com/en-us/azure/foundry/how-to/connections-add
