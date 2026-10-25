# External PalmPesa Payment API

This API lets a merchant website create PalmPesa payment links through this app. PalmPesa credentials stay on this server. A merchant API key stays on the merchant backend; never put it in browser JavaScript or a public mobile app.

Base URL: `https://mickey-pterodacty.vercel.app/api/integration/payments`

## 1. Configure server settings once

Set these Vercel environment variables:

- `PALMPESA_API_TOKEN`: PalmPesa API token.
- `PALMPESA_USER_ID`: PalmPesa user ID.
- `PALMPESA_VENDOR`: PalmPesa vendor/Till identifier.
- `PALMPESA_WEBHOOK_URL`: `https://mickey-pterodacty.vercel.app/api/payment/webhook`.
- `PALMPESA_WEBHOOK_SECRET`: a strong secret shared with PalmPesa callback validation.
- `APP_URL`: `https://mickey-pterodacty.vercel.app`.
- `EXTERNAL_PAYMENT_WEBHOOK_URL`: the merchant's HTTPS callback endpoint.
- `PAYMENT_CREDENTIAL_ENCRYPTION_KEY`: a strong random key used to encrypt the stored webhook secret.
- `EXTERNAL_PAYMENT_MAX_TZS`: optional maximum order amount, default `50000000`.

Redeploy after setting these variables for the first time. Existing merchant API credentials no longer require redeploy after rotation because they are stored securely in MongoDB and loaded at runtime.

The API key and webhook secret are generated together in **Admin > Payment API**. The server:

1. Generates 256-bit cryptographically random values.
2. Stores only a SHA-256 hash of the API key.
3. Encrypts the webhook secret with AES-256-GCM.
4. Activates the new credentials immediately.
5. Records only an API key prefix and rotation metadata in audit logs.

The generated values are shown once. Store the API key in the merchant backend and the webhook secret in both sides. Generating a second pair deactivates the old API key and old webhook secret immediately, so rotate during a maintenance window or update the merchant backend first.

The provider callback is automatic at `/api/payment/webhook`. It validates the PalmPesa signature, then the app validates the amount and forwards a signed event to `EXTERNAL_PAYMENT_WEBHOOK_URL`.

## Create a payment

Call this endpoint from your merchant backend:

```http
POST /api/integration/payments/checkout
Authorization: Bearer YOUR_EXTERNAL_PAYMENT_API_KEY
Content-Type: application/json
```

```json
{
  "orderId": "ORDER-2026-001",
  "amount": 15000,
  "customerName": "Customer Name",
  "customerEmail": "customer@example.com",
  "customerPhone": "255712345678",
  "description": "Order 2026-001"
}
```

`amount` is an integer in TZS. `orderId` must be unique per merchant. The response includes `data.paymentUrl` when PalmPesa returns a hosted link; redirect the customer to it. If PalmPesa sends a mobile-money prompt instead, show `data.paymentMessage` and poll the status endpoint from your backend.

## Check payment status

```http
GET /api/integration/payments/ORDER-2026-001
Authorization: Bearer YOUR_EXTERNAL_PAYMENT_API_KEY
```

Possible statuses are `pending`, `completed`, and `failed`. Treat only `completed` as paid. Do not trust the browser redirect as proof of payment.

## Merchant webhook

Your configured HTTPS endpoint receives a JSON body such as:

```json
{
  "event": "payment.completed",
  "data": {
    "orderId": "ORDER-2026-001",
    "paymentId": "...",
    "amount": 15000,
    "currency": "TZS",
    "status": "completed",
    "completedAt": "..."
  }
}
```

Verify `X-Payment-Signature` as `sha256=` plus the lowercase hex HMAC-SHA256 of the exact raw request body, using `EXTERNAL_PAYMENT_WEBHOOK_SECRET`. Use `X-Payment-Event-Id` to deduplicate events. Return a 2xx response after accepting the event. PalmPesa also calls this app's webhook; the merchant site does not need PalmPesa credentials.

## Example browser integration

The merchant browser should submit its order to the merchant's own backend. That backend calls this API with the API key, then returns only the `paymentUrl` to the browser. Never embed `EXTERNAL_PAYMENT_API_KEY` or PalmPesa credentials in the website frontend.