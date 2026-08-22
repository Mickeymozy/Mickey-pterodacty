# API Reference

All JSON endpoints use the application base URL and require the authenticated session unless stated otherwise. Configure the panel with `PTERODACTYL_URL`; no panel hostname is hardcoded in the client.

## Health and servers

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Checks database and Pterodactyl availability |
| GET | `/api/servers` | Lists servers owned by the authenticated user |
| GET | `/api/servers/:id/details` | Returns status, resources, limits, connection and `panelUrl` |
| GET | `/api/servers/:id/access` | Returns panel access metadata; password is never returned |
| POST | `/api/servers/:id/power/:action` | Performs `start`, `stop`, or `restart` |
| DELETE | `/api/servers/:id` | Deletes an owned server after name confirmation |
| GET | `/api/servers/:id/console` | Returns the official Pterodactyl WebSocket URL/token |

Sensitive server endpoints verify that the resolved Pterodactyl server owner matches the logged-in user.

## Backups

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/servers/:id/backups` | Lists backups |
| POST | `/api/servers/:id/backups` | Creates a backup; optional body `{ "name": "before-update" }` |
| DELETE | `/api/servers/:id/backups/:backupId` | Deletes a backup |
| POST | `/api/servers/:id/backups/:backupId/restore` | Starts a restore |

Backup and console routes require a valid Pterodactyl Client API key beginning with `ptlc_`.

## Packages and deployment

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/packages` | Lists active packages |
| GET | `/api/eggs` | Lists panel eggs with Docker/startup defaults |
| POST | `/api/payment/checkout` | Starts a wallet or PalmPesa package purchase |
| POST | `/api/servers/from-package` | Creates a package server directly |

A package server configuration supports `eggId`, `eggName`, `dockerImage`, `startupFile`, and `startupCommand`. The selected Pterodactyl egg is authoritative for its runtime image and startup script. When `botRepoUrl` is used, the repository is validated and initialized in a temporary directory before starting the application.

## External generic payments

The generic payment UI is intentionally absent from the dashboard. External clients can use:

```http
POST /api/payment/generic
Content-Type: application/json
```

```json
{
  "amount": 5000,
  "description": "API service fee",
  "paymentMethod": "palmpesa",
  "phone": "255744000000"
}
```

Accepted payment methods are `palmpesa`, `admin`, and `review`. Amount must be finite and positive. A verified generic payment does not create a server or credit coins.

## Payment verification

```http
GET /api/payment/verify/:transactionId
POST /api/payment/webhook
```

The webhook must be configured at the payment provider using `PALMPESA_WEBHOOK_URL`. Keep `PALMPESA_API_TOKEN`, Pterodactyl keys, and session secrets in environment variables.

## Security requirements

- Use a long random `SESSION_SECRET` in production.
- Use a Pterodactyl application key (`ptla_...`) for provisioning.
- Use a Pterodactyl client key (`ptlc_...`) for resources, power, backups, and console access.
- Do not put repository credentials inside Git URLs.
- Passwords are validated with minimum length, mixed case, a number, and a special character.
- Auth and payment routes are rate limited; clients should retry after HTTP `429`.
