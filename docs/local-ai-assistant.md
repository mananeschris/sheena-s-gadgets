# Local AI Shopping Assistant

Ollama is an optional local provider. The project currently selects Gemini; see [Gemini setup](gemini-ai-assistant.md). To select local inference, set `AI_PROVIDER=ollama`. No paid API key is required for Ollama, but inference needs a running Ollama server and a downloaded model.

## Windows setup

1. Install Ollama from https://ollama.com/download/windows.
2. Open PowerShell and download the configured model:

   ```powershell
   ollama pull qwen2.5:3b
   ```

3. Ollama normally starts in the background after installation. If it is not running, start it with `ollama serve`.
4. Start the website with `npm start`, sign in as a customer, and open **AI assistant**.

To select the local provider, configure `.env`:

```dotenv
AI_ASSISTANT_ENABLED=true
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

Restart the Node server after changing environment variables. `AI_ASSISTANT_ENABLED=false` disables AI responses while keeping the contact-shop action available. The selected model must match an installed Ollama tag exactly. Model inference speed depends on the PC; requests time out after one minute.

## What it can answer

- Product information, stock, variant prices and warranty details from up to 30 recent catalog listings.
- Payment, delivery and support processes from the published shop terms.
- General questions in English or Filipino, with recent conversation context.

It cannot read personal order records or change transactions. **My orders** opens the customer's order list. **Contact the shop** opens seller support on an order page; elsewhere it opens My Orders so the customer can select the purchase. Chat text is not automatically forwarded to the seller.

Conversation history stays in memory in the current page, not in the database or browser storage. Reloading the page or starting a new chat clears it. No account names, addresses, passwords, or private order records are supplied to the model. Customers should not send sensitive information in their questions.

The API requires a server-verified customer session, limits requests to eight per minute per customer and two concurrent generations globally, validates conversation roles and length, and renders replies as plain text. AI can still make mistakes; shop approval and warranty decisions stay with the seller.

## Hosting

`127.0.0.1` refers to the computer running the Node server. The local integration accepts only loopback HTTP addresses and blocks redirects/cloud model tags. Ollama must run on the backend's own host or in a colocated container arrangement reachable on loopback. A deployed website does not automatically reach Ollama on your personal PC. Do not expose its unprotected port publicly. Local inference has no per-message API charge, but hardware and hosting may cost money.

## Verification

```powershell
node --test tests/shop-assistant-api.test.cjs
```

The tests mock model responses and do not change the application database. A real conversation still needs the model running.

References: https://docs.ollama.com/api/chat and https://docs.ollama.com/windows.
