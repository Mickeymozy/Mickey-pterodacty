# Integrating External Payments with Bot Repo Deploy

Huu ni mwongozo mfupi wa jinsi ya kuunganisha malipo ya nje (mfano: PalmPesa/Zenopay) na kuundo server na bot repo bila kuonyesha au kuandika API keys kwenye nyaraka. Mfano wa URL wa app: https://mickey-pterodacty.vercel.app

Kumbuka: nyaraka hizi hazina thamani ya key yoyote; badala yake zinaonyesha muundo wa maombi, webhook, na jinsi ya kushughulikia maombi kwa usalama bila kuandika keys hapa.

## Kazi Kuu: Kuunda Server na Bot Repo Wakati wa Malipo ya Nje

Wakati mtumiaji anachagua kulipia server kwa PalmPesa (external payment), mfumo unataka:
1. Kusave taarifa za server (repo URL, startup command, n.k.) kwenye transaction metadata
2. Kusubiri malipo yajithibitishe kupitia gateway
3. Baada ya malipo kukamilika, kuunda server na kuinekeza bot repo ya mtumiaji

### Mtiririko wa Bot Repo:

```
User selects repo URL
    ↓
User clicks "Deploy with PalmPesa"
    ↓
System creates Transaction with botRepoUrl in metadata
    ↓
Gateway sends malipo link
    ↓
User completes payment via USSD/mobile
    ↓
Gateway sends webhook with payment status="completed"
    ↓
System verifies payment and creates server
    ↓
Server init script clones repo and runs startup command
```

## Endpoints (mfano)

- Checkout (anzisha malipo kwa mtumiaji na repo):

  POST https://mickey-pterodacty.vercel.app/api/payment/checkout

  Body (JSON):

  ```json
  {
    "packageId": "<package-id>",
    "serverName": "MyBotServer",
    "paymentMethod": "palmpesa",
    "phone": "255744000000",
    "eggId": 16,
    "dockerImage": "ghcr.io/parkervcp/yolks:nodejs_21",
    "startupFile": "index.js",
    "startupCommand": "npm start",
    "botRepoUrl": "https://github.com/username/my-bot.git"
  }
  ```

  Example curl (no keys shown):

  ```bash
  curl -X POST "https://mickey-pterodacty.vercel.app/api/payment/checkout" \
    -H "Content-Type: application/json" \
    -d '{"packageId":"PKG123","serverName":"MyBot","paymentMethod":"palmpesa","phone":"255744000000","botRepoUrl":"https://github.com/username/my-bot.git"}'
  ```

  Response (success):

  ```json
  {
    "success": true,
    "message": "Payment initiated",
    "data": {
      "paymentUrl": "https://checkout.gateway/abc123",
      "provider": "palmpesa",
      "transactionId": "64b8f..."
    }
  }
  ```

## Webhook (malipo callback)

- Gateway itatuma POST request kwa webhook URL ambayo umeweka kwenye gateway console:

  Webhook URL: `https://mickey-pterodacty.vercel.app/api/payment/webhook`

  Sample webhook body (JSON):

  ```json
  {
    "order_id": "64b8f...",
    "reference": "XYZ-REF",
    "status": "completed",
    "amount": 2500,
    "currency": "TZS",
    "metadata": { "transactionId": "64b8f...", "type": "topup" }
  }
  ```

  Important: if the gateway sends a signature header (e.g., `x-palmpesa-signature`), configure your server to validate it using a shared secret stored in env (do NOT place secrets in docs).

  Minimal webhook handling (conceptual):

  1. Parse incoming JSON and extract `order_id` or `reference`.
  2. Find the matching `Transaction` in DB by `_id` or by `zenopayReference`.
  3. If found and gateway reports `completed`, set `status = 'completed'`, set `completedAt`, and for server purchases, create server with botRepoUrl from transaction.metadata.botRepoUrl.
  4. If not found, log and return 404.

  Example curl to simulate gateway POST (for testing):

  ```bash
  curl -X POST "https://mickey-pterodacty.vercel.app/api/payment/webhook" \
    -H "Content-Type: application/json" \
    -d '{"order_id":"64b8f...","status":"completed","amount":2500,"metadata":{"transactionId":"64b8f..."}}'
  ```

## Bot Repo Initialization (Server-side)

When a server is created with `botRepoUrl`, the Pterodactyl server will:

1. Validate that the URL is an HTTPS Git repository URL before provisioning
2. Clone the repository into `/tmp/mickey-bot-repo` during first boot
3. Copy the repository contents into `/home/container` so existing container files do not break `git clone`
4. Pull `main` or `master` on later restarts when `/home/container/.git` exists
5. Run the resolved startup command from the selected Pterodactyl egg in `/home/container`

The generated script uses `set -e`, so a missing URL, failed clone, failed copy, or failed pull stops startup instead of launching a bot from an incomplete directory. The Docker image and startup script are resolved from the selected egg; client-supplied values are only fallbacks.

Example server environment:

```
BOT_REPO_URL="https://github.com/username/my-bot.git"
BOT_REPO_DIR="/home/container"
AUTO_UPDATE="1"
MAIN_FILE="index.js"
STARTUP_CMD="npm start"
```

Server startup logs will show:
```
[BOT_REPO] Starting repo initialization...
[BOT_REPO] Cloning repository: https://github.com/username/my-bot.git
[BOT_REPO] Initialization complete
[BOT_REPO] Running startup command: npm start
```

## Security notes (no keys in docs)

- Do not include API keys in public docs. Instead reference env vars (e.g., `PALMPESA_API_TOKEN`, `PALMPESA_WEBHOOK_SECRET`).
- If you cannot validate signatures (no shared secret), adopt defensive steps:
  - Match webhook `order_id` to local `Transaction`.
  - Cross-check amount/currency and userId in metadata.
  - Optionally call provider verification endpoint (if available) from server-side before marking completed.
- Bot repo URLs should be public (no credentials embedded) or use SSH keys configured in the Pterodactyl node.

## Admin flow

- Admin can review pending transactions at `GET /api/payment/admin/all` and approve via `POST /api/payment/admin/:transactionId/approve` (existing routes).
- When approving, system automatically reads botRepoUrl from transaction.metadata and passes it to server creation.
- For external totals, use `GET /api/payment/admin/summary` to get sums grouped by provider (this endpoint aggregates without exposing keys).

## Example deployment notes (Vercel)

- On Vercel, set environment variables in the project dashboard (do not commit them):
  - `PALMPESA_API_TOKEN` (if using Palmpesa API)
  - `PALMPESA_USER_ID`
  - `PALMPESA_VENDOR`
  - `PALMPESA_WEBHOOK_URL` (set to https://mickey-pterodacty.vercel.app/api/payment/webhook)
  - `APP_URL` = https://mickey-pterodacty.vercel.app
  - `PTERODACTYL_URL` = https://your-pterodactyl-panel.com
  - `PTERODACTYL_APP_API_KEY` = (app admin key from panel)
  - `PTERODACTYL_CLIENT_API_KEY` = (client API key from panel, for user endpoints)

- The public docs and examples above use `https://mickey-pterodacty.vercel.app` as the base URL. Replace this with your site if different.

## Troubleshooting

### Server created but repo not cloned
- Check `BOT_REPO_URL` is set in server environment
- Verify repo URL is publicly accessible or SSH key is configured in node
- Check server logs: `docker logs <container-id>`
- Ensure git is installed in the Docker image

### Payment shows as pending but server not created
- Admin must manually approve via `/api/payment/admin/:transactionId/approve`
- Or wait for webhook delivery from payment gateway
- Check payment gateway webhook logs for any failures

### Repo clone fails during startup
- Ensure git is installed in the Docker image
- Verify repo URL format (e.g., https://github.com/username/repo.git)
- Check for network/firewall issues preventing git clone
- Server logs will show `[BOT_REPO] ERROR: Failed to clone repository` if clone fails

### Server shows AUTO_UPDATE=1 but not pulling
- Verify server has `/home/container/.git` directory
- Check Pterodactyl server logs for git pull errors
- Ensure repo URL is accessible from the node

## Quick checklist for integrators

- [ ] Configure webhook URL in your payment gateway to `https://mickey-pterodacty.vercel.app/api/payment/webhook`.
- [ ] Ensure your server verifies incoming payloads (signature or by querying provider).
- [ ] Do not paste API keys into public docs; use env vars on the server.
- [ ] Test bot repo URLs with sample repos before deploying.
- [ ] Monitor server creation logs for repo clone errors.
- [ ] Verify git is available in Docker images used (nodejs, python, java yolks images include git).
