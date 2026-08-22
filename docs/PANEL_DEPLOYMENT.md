# Panel Deployment and External Payments

This document describes the supported deployment flow for Mickey Pterodactyl.

## Required environment

Set these values on the application server or Vercel project. Never commit real secrets.

```dotenv
PTERODACTYL_URL=https://your-panel.example.com
PTERODACTYL_APP_API_KEY=ptla_your-application-key
PTERODACTYL_CLIENT_API_KEY=ptlc_your-client-key
```

`PTERODACTYL_URL` is the single source of truth for panel links. The backend normalizes it and returns it as `panelUrl` in server access and server list responses. The frontend does not contain a panel domain fallback.

## Server deployment with a GitHub repository

1. The user selects a package and an egg/engine.
2. The backend resolves the selected egg from Pterodactyl.
3. Docker image, startup script, and egg environment defaults are taken from that resolved egg.
4. If `botRepoUrl` is provided, it is validated as an HTTPS Git repository URL.
5. The package purchase is processed:
   - wallet payments create the server after the balance is reserved;
   - PalmPesa payments save deployment metadata on the transaction and wait for verification.
6. Pterodactyl starts the server using the egg startup command.
7. The startup script initializes the repository and then runs the command from `/home/container`.

### Repository startup behavior

The generated startup script uses this order:

```text
set -e
if BOT_REPO_URL is missing: fail
if /home/container/.git exists: pull main, otherwise pull master
else: clone into /tmp/mickey-bot-repo
copy repository contents into /home/container
remove the temporary directory
cd /home/container
run the resolved egg startup command
```

Cloning into `/tmp` avoids the common failure caused by cloning into a non-empty Pterodactyl container directory. `set -e` prevents the bot from starting when repository initialization fails.

Use a public repository URL without embedded credentials, for example:

```text
https://github.com/owner/repository.git
```

Private repositories require credentials configured on the node or another secure deployment mechanism. Do not put tokens in `botRepoUrl`.

## Server details and panel access

The authenticated endpoints are:

```text
GET /api/servers
GET /api/servers/:id/access
GET /api/servers/:id/details
```

The response contains the server status, resource limits, connection details, login information, and `panelUrl`. The UI reads `panelUrl` from the API, which in turn reads `PTERODACTYL_URL` from the environment.

If `PTERODACTYL_URL` is missing, the panel button remains unavailable and the API reports that the panel is not configured. Set the environment variable and restart/redeploy the application.

## Generic payments as an external API

Generic payments are intentionally not rendered as a dashboard tab. Integrations can call the authenticated API directly:

```text
POST /api/payment/generic
```

Request:

```json
{
  "amount": 5000,
  "description": "API service fee",
  "paymentMethod": "palmpesa",
  "phone": "255744000000"
}
```

Supported methods are `palmpesa`, `admin`, and `review`. Amount must be a finite positive number and description is required. PalmPesa responses may include a `paymentUrl` and `transactionId`.

Poll the existing authenticated verification endpoint when a transaction ID is returned:

```text
GET /api/payment/verify/:transactionId
```

A verified generic payment is marked complete but does not add coins and does not create a server.

## External payment server purchase

Use the package checkout endpoint for a server purchase:

```text
POST /api/payment/checkout
```

Include `packageId`, `serverName`, `paymentMethod`, and optional `eggId`, `startupFile`, and `botRepoUrl`. The selected Pterodactyl egg remains authoritative for its Docker image and startup script.

For PalmPesa, deployment options are stored in transaction metadata. The server is created only after the payment is verified. The webhook endpoint is:

```text
POST /api/payment/webhook
```

Configure the gateway with `PALMPESA_WEBHOOK_URL` and keep provider credentials in environment variables only.

## Troubleshooting checklist

- Confirm `PTERODACTYL_URL` has no trailing path or slash problem.
- Confirm the application API key can create servers and read nodes, locations, eggs, and allocations.
- Confirm the client API key starts with `ptlc_` for live status and power controls.
- Confirm the selected egg Docker image contains `git` when a repository is used.
- Check Pterodactyl startup logs for `[BOT_REPO]` messages.
- Check that the repository URL is public and reachable from the node.
- Check the transaction status before retrying a PalmPesa deployment.
