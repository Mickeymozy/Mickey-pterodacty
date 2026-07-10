# API Reference for Mickey Pterodacty

This project exposes a REST API for server access and integration with external websites.

## Base URL

Use this base URL for all requests:

- `https://mickey-pterodacty.vercel.app`

If you are running locally, use:

- `http://localhost:3000`

---

## External Server Info Endpoint

### GET /api/external/servers/:id

Returns server metadata and connection details for a Pterodactyl server.

### Authentication

This endpoint requires an API key. Provide the key in one of these ways:

- Header: `x-api-key: YOUR_KEY`
- Query string: `?apiKey=YOUR_KEY` or `?key=YOUR_KEY`

### Required environment variable

Set one of the following environment variables on the host application:

- `EXTERNAL_API_KEY` (recommended)
- if not set, the route will fallback to `PTERODACTYL_APP_API_KEY`

### Example request

```bash
curl -H "x-api-key: YOUR_KEY" \
  https://mickey-pterodacty.vercel.app/api/external/servers/123
```

### Successful response

```json
{
  "success": true,
  "server": {
    "id": 123,
    "uuid": "abcdef12-3456-7890-abcd-ef1234567890",
    "identifier": "abc123",
    "name": "my-server",
    "status": "online",
    "limits": {
      "memory": 2048,
      "swap": 0,
      "disk": 25600,
      "io": 500,
      "cpu": 30,
      "oom_disabled": false
    },
    "ipAddress": "45.32.123.45",
    "port": "25565",
    "sftpHost": "panel.example.com"
  }
}
```

### Error responses

- `401 Unauthorized` – API key is missing or invalid
- `404 Not Found` – Server reference was not found on the panel
- `500 Internal Server Error` – Pterodactyl panel or application error

### Supported server identifiers

The endpoint accepts any of these values for `:id`:

- numeric application server id
- UUID
- server identifier string

### Use case

This endpoint is designed for external websites or dashboard integrations that need to display server access details without requiring full Pterodactyl credentials.

### Notes

- The endpoint is read-only.
- It does not create, modify, or delete servers.
- Protect `EXTERNAL_API_KEY` carefully and do not expose it in public frontend code.

---

## Local development

When testing locally, set the API key and run your app normally.

```bash
export EXTERNAL_API_KEY="your-secret-key"
npm start
```

Then call:

```bash
curl -H "x-api-key: your-secret-key" http://localhost:3000/api/external/servers/123
```
