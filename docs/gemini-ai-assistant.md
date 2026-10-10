# Gemini Shopping Assistant

The project now selects Google Gemini through `AI_PROVIDER=gemini`. Ollama remains an optional local provider; it is not used as an automatic fallback.

## Add the API key

1. Create an API key in https://aistudio.google.com/api-keys using your own Google project.
2. Restrict the key to the Generative Language API where the key settings allow it. Keep it in the backend; do not send it through chat, commit it, or put it in HTML/JavaScript.
3. Set these entries in the project's ignored `.env` file:

   ```dotenv
   AI_ASSISTANT_ENABLED=true
   AI_PROVIDER=gemini
   GEMINI_API_KEY=your_real_key_here
   GEMINI_MODEL=gemini-3.5-flash-lite
   ```

4. Restart the Node server. Sign in as a customer and open AI assistant.

The configured model must be available for your project. Free-tier quotas and model availability are controlled by Google. The application does not enable billing or automatically switch models/providers if quota is exhausted. Using a billing-enabled key may incur charges; use the project's intended free-tier key when testing without paid usage.

Google restricts Gemini 2.5 models to existing users. New projects should use a supported model such as the default above. A successful model metadata lookup does not prove generation access; test an actual non-sensitive question after restarting the server. See https://ai.google.dev/gemini-api/docs/deprecations and https://ai.google.dev/gemini-api/docs/pricing for current availability and quotas.

## Data and permissions

Requests go from the application backend to Google's fixed HTTPS API endpoint. The key travels in `x-goog-api-key`, not a URL or customer-visible response. Redirects are disabled. Only validated conversation text, published shop terms, and bounded public catalog fields are sent; no user account or private order records are retrieved for the AI.

Free/unpaid Gemini API content can be used by Google to improve products and may be reviewed by humans under its terms, with regional exceptions. The chat displays this disclosure and tells customers not to share personal, payment or account details. The server rejects some obvious emails, Philippine phone numbers, payment-number patterns and explicit secrets. This is a basic safeguard, not complete detection of personal information: names, addresses and other sensitive text can escape pattern checks. Use seller support for personal order concerns, and reassess using a paid service with suitable data-processing terms before handling sensitive customer content.

The AI has no tools or transaction permissions. It cannot approve payments, modify orders, cancel purchases, or decide warranty claims. It can still generate inaccurate text. Replies render as plain text. Conversations are kept in page memory; logout/account changes or an expired session clear them.

Requests need a verified customer session and same-origin writes. The AI endpoint accepts JSON bodies up to 48 KB, validates message lengths/roles, limits eight generation requests per customer per minute and two simultaneous requests globally, times out provider requests, and returns generic errors without leaking the API key or provider error body. These in-memory limits apply per Node process; deployments with multiple instances need a shared limiter.

## Deploying

Set the same environment variables in the hosting provider's server settings. Never publish `.env`. Deploy the shop with HTTPS. Unlike a local Ollama connection, the backend can reach Gemini from a hosted service without reaching your personal PC.

## Checks

```powershell
node --test tests/shop-assistant-api.test.cjs
node node_modules/@playwright/test/cli.js test tests/shop-assistant-ui.spec.js --workers=1
```

Automated tests mock cloud responses and do not modify the shop database. A live Gemini check requires a valid key and available quota.

Official references:

- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/text-generation
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/terms
