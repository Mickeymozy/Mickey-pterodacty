---
name: testing-coin-display
description: Test coin balance reading and UI on the Pterodactyl dashboard/admin end-to-end. Use when verifying coin/balance display, /api/me changes, or admin user/coin stats locally without Pterodactyl or payment credentials.
---

# Testing coin display (dashboard + admin)

The app is an Express + MongoDB server (`node server.js`, port 3000) serving static pages
from `public/`. Coin balance shown in the UI comes from `GET /api/me` (`routes/api.js`),
which reads `User.coins`. Admin totals come from `GET /api/user/admin/stats`
(`totalCoinsDistributed`). Login is passport-local (username OR email + password).

## Local setup (no Pterodactyl / payment creds needed)
1. Start MongoDB: `docker run -d --name ptero-mongo -p 27017:27017 mongo:7`
   (re-use with `docker start ptero-mongo`).
2. Create `.env` (not committed) with at least:
   ```
   PORT=3000
   NODE_ENV=development          # keep non-production so session cookie works over http
   SESSION_SECRET=local-test-secret
   MONGODB_URI=mongodb://localhost:27017/pterodactyl-dashboard
   ```
3. `npm install` then `node server.js`. Look for "MongoDB Connected". DB connect is
   non-fatal if URI unset, but coins need the DB.

## Seed users with coins
Registration may require Pterodactyl, so seed directly via the Mongoose model (handles
password hashing). Example fields: `{ username, email, password, coins, pteroId, role,
isAdmin, isEmailVerified:true }`. The email `mickidadyhamza@gmail.com` is auto-promoted to
admin on login (see `middleware/auth` ADMIN_EMAILS), so use it to test the admin panel.
Give users distinct 4+ digit coin values (e.g. 12500/3400/750) so thousands-separator
formatting and the system total are visibly verifiable.

## What to verify
- Dashboard (`/dashboard.html`): header pill reads `Salio: <coins> Coins` formatted with
  commas (e.g. `12,500`), NOT `0`. A broken `/api/me` (missing `coins`) shows `0`.
- Admin (`/admin.html`): "Jumla ya Coins" stat card + "Jumla ya Coins (Mfumo)" overview row
  equal the sum of all users' coins; Watumiaji tab lists each user's coins formatted.

## Tips / gotchas
- Verify the API directly first: `curl -c cj -b cj -d 'username=...&password=...'
  localhost:3000/auth/login` then `curl -b cj localhost:3000/api/me` — expect `coins` present.
- Static pages are served before the auth-guarded routes, so `/dashboard.html` renders even
  unauthenticated (shows "Offline Account" / 0) — always log in via UI for real data.
- Clean up test artifacts (`.env`, seed scripts) before committing; never commit them.

## Devin Secrets Needed
None for coin-display testing (local seeded DB). Full registration/deploy flows would need
PTERODACTYL_URL + PTERODACTYL_APP_API_KEY and SONICPESA_* (not required here).
