# Brave and Tavily API key signup (2026-08)

## Brave Search API

Official dashboard: https://api-dashboard.search.brave.com/

1. Sign up with an email address and verify the email.
2. Open **Available plans** and subscribe to the **Search** plan.
3. Brave requires payment-card details even when using the included free monthly credits; the card is used for anti-fraud verification.
4. Open **API Keys**, choose **Add API Key**, give the key a recognizable name, and copy the generated subscription token.

Current public Search pricing is $5 per 1,000 requests and includes $5 in monthly credits. ModelDock sends this token in the `X-Subscription-Token` request header.

Official sources:

- Signup quickstart: https://api-dashboard.search.brave.com/documentation/quickstart
- Authentication and key creation: https://api-dashboard.search.brave.com/documentation/guides/authentication
- Plans and current public pricing: https://brave.com/search/api/

## Tavily Search API

Official dashboard: https://app.tavily.com/home

1. Create or sign in to a Tavily account.
2. Open the dashboard/API Keys area.
3. Copy the API key shown for the account, or create a dedicated key if the dashboard offers key management for the account.

Tavily's free plan currently includes 1,000 API credits per month and does not require a credit card. A basic search costs one credit. ModelDock sends the key as an `Authorization: Bearer <key>` header.

Official sources:

- API introduction and authentication: https://docs.tavily.com/documentation/api-reference/introduction
- Credits and pricing: https://docs.tavily.com/documentation/api-credits
- Dashboard: https://app.tavily.com/home

## ModelDock `config.json`

```json
"search": {
  "braveApiKey": "<Brave subscription token>",
  "tavilyApiKey": "<Tavily API key>"
}
```

The values belong only in the ignored local `config.json`. They must not be copied into `config.example.json`, placed in browser-side API connection settings, committed to Git, included in screenshots, or sent through chat.
