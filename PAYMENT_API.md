# External PalmPesa Payment API

This API lets a merchant website create PalmPesa payment links through this app. PalmPesa credentials remain on this server. The merchant API key must be kept on the merchant's backend; do not put it in browser JavaScript or a public mobile app. An unauthenticated payment-creation endpoint is intentionally not provided.

Base URL: `https://mickey-pterodacty.vercel.app/api/integration/payments`

## Server configuration

Set these environment variables in the Vercel project:

- `EXTERNAL_PAYMENT_API_KEY`: a long, random secret sent by your website backend as a Bearer token.
- `EXTERNAL_PAYMENT_WEBHOOK_URL`: your merchant backend's HTTPS endpoint for payment events.
- `EXTERNAL_PAYMENT_WEBHOOK_SECRET`: a separate random secret used to sign callbacks.
- `EXTERNAL_PAYMENT_MAX_TZS`: optional maximum order amount; defaults to `50000000`.
- `PALMPESA_API_TOKEN`, `PALMPESA_USER_ID`, `PALMPESA_VENDOR`: existing PalmPesa settings.
- `APP_URL`: set to `https://mickey-pterodacty.vercel.app` if not already set.
- `PALMPESA_WEBHOOK_URL`: set to `https://mickey-pterodacty.vercel.app/api/payment/webhook`.
- `PALMPESA_WEBHOOK_SECRET`: required in production so provider callbacks can be authenticated.

An admin can generate `EXTERNAL_PAYMENT_API_KEY` and `EXTERNAL_PAYMENT_WEBHOOK_SECRET` from **Admin > Payment API**. Each value is displayed only once. Copy them into the matching Vercel Environment Variables and redeploy; generating them in the admin panel does not change the running environment automatically.

The server-side PalmPesa callback is automatic at `/api/payment/webhook`. On a final payment status, this app posts a signed event to `EXTERNAL_PAYMENT_WEBHOOK_URL`. A failed merchant callback returns an error to PalmPesa so its retry policy can retry delivery; the merchant should still make event handling idempotent using `X-Payment-Event-Id`.

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