# Integrating External Payments (Mfano kwa Vercel URL)

Huu ni mwongozo mfupi wa jinsi ya kuunganisha malipo ya nje (mfano: PalmPesa/Zenopay) bila kuonyesha au kuandika API keys kwenye nyaraka. Mfano wa URL wa app: https://mickey-pterodacty.vercel.app

Kumbuka: nyaraka hizi hazina thamani ya key yoyote; badala yake zinaonyesha muundo wa maombi, webhook, na jinsi ya kushughulikia maombi kwa usalama bila kuandika keys hapa.

## Endpoints (mfano)

- Checkout (anzisha malipo kwa mtumiaji):

  POST https://mickey-pterodacty.vercel.app/api/payment/checkout

  Body (JSON):

  {
    "packageId": "<package-id>",
    "serverName": "MyBotServer",
    "paymentMethod": "palmpesa",
    "phone": "255744000000",
    "eggId": 16,
    "dockerImage": "ghcr.io/..../image:tag",
    "startupFile": "index.js",
    "startupCommand": "npm start",
    "botRepoUrl": "https://github.com/username/repo.git"
  }

  Example curl (no keys shown):

  curl -X POST "https://mickey-pterodacty.vercel.app/api/payment/checkout" \
    -H "Content-Type: application/json" \
    -d '{"packageId":"PKG123","serverName":"MyBot","paymentMethod":"palmpesa","phone":"255744000000"}'

  Response (success):

  {
    "success": true,
    "message": "Payment initialized",
    "data": {
      "paymentUrl": "https://checkout.gateway/abc123",
      "provider": "palmpesa",
      "transactionId": "64b8f..."
    }
  }

## Webhook (malipo callback)

- Gateway itatuma POST request kwa webhook URL ambayo umeweka kwenye gateway console. Kwa mfano:

  Webhook URL: https://mickey-pterodacty.vercel.app/api/payment/webhook

  Sample webhook body (JSON):

  {
    "order_id": "64b8f...",
    "reference": "XYZ-REF",
    "status": "completed",
    "amount": 2500,
    "currency": "TZS",
    "metadata": { "transactionId": "64b8f...", "type": "topup" }
  }

  Important: if the gateway sends a signature header (e.g., `x-palmpesa-signature`), configure your server to validate it using a shared secret stored in env (do NOT place secrets in docs).

  Minimal webhook handling (conceptual):

  1. Parse incoming JSON and extract `order_id` or `reference`.
 2. Find the matching `Transaction` in DB by `_id` or by `zenopayReference`.
 3. If found and gateway reports `completed`, set `status = 'completed'`, set `completedAt`, credit coins or create server.
 4. If not found, log and return 404.

  Example curl to simulate gateway POST (for testing):

  curl -X POST "https://mickey-pterodacty.vercel.app/api/payment/webhook" \
    -H "Content-Type: application/json" \
    -d '{"order_id":"64b8f...","status":"completed","amount":2500,"metadata":{"transactionId":"64b8f..."}}'

## Security notes (no keys in docs)

- Do not include API keys in public docs. Instead reference env vars (e.g., `PALMPESA_API_TOKEN`, `PALMPESA_WEBHOOK_SECRET`).
- If you cannot validate signatures (no shared secret), adopt defensive steps:
  - Match webhook `order_id` to local `Transaction`.
  - Cross-check amount/currency and userId in metadata.
  - Optionally call provider verification endpoint (if available) from server-side before marking completed.

## Admin flow

- Admin can review pending transactions at `GET /api/payment/admin/all` and approve via `POST /api/payment/admin/:transactionId/approve` (existing routes).
- For external totals, use `GET /api/payment/admin/summary` to get sums grouped by provider (this endpoint aggregates without exposing keys).

## Example deployment notes (Vercel)

- On Vercel, set environment variables in the project dashboard (do not commit them):
  - `PALMPESA_API_TOKEN` (if using Palmpesa API)
  - `PALMPESA_USER_ID`
  - `PALMPESA_VENDOR`
  - `PALMPESA_WEBHOOK_URL` (set to https://mickey-pterodacty.vercel.app/api/payment/webhook)
  - `APP_URL` = https://mickey-pterodacty.vercel.app

- The public docs and examples above use `https://mickey-pterodacty.vercel.app` as the base URL. Replace this with your site if different.

## Quick checklist for integrators

- [ ] Configure webhook URL in your payment gateway to `https://mickey-pterodacty.vercel.app/api/payment/webhook`.
- [ ] Ensure your server verifies incoming payloads (signature or by querying provider).
- [ ] Do not paste API keys into public docs; use env vars on the server.

If you want, I can also add a short example server-side verification snippet (Node/Express) that uses a placeholder secret (not the actual key) and show how to wire it into `/api/payment/webhook`.
