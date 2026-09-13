const normalizePhone = (phone) => {
  const value = String(phone || '').replace(/\D/g, '');
  if (!value) return '';
  if (value.startsWith('255')) return value;
  if (value.startsWith('0') && value.length === 10) return `255${value.slice(1)}`;
  if ((value.startsWith('6') || value.startsWith('7')) && value.length === 9) return `255${value}`;
  return value;
};

let sdkPromise;

async function getClient() {
  if (!process.env.TAPSA_API_KEY) return null;
  sdkPromise ||= import('sms-bulk-tz').then(({ TapsaSMS }) => new TapsaSMS({
    apiKey: process.env.TAPSA_API_KEY,
    baseUrl: process.env.TAPSA_BASE_URL || undefined,
    timeout: Number(process.env.TAPSA_TIMEOUT_MS || 30000)
  }));
  return sdkPromise;
}

async function sendPaymentConfirmation({ phone, amount, transactionId, product }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { sent: false, skipped: true, reason: 'No customer phone number.' };

  const client = await getClient();
  if (!client) return { sent: false, skipped: true, reason: 'TAPSA_API_KEY is not configured.' };

  const message = `Malipo yamepokelewa kwa mafanikio. Kiasi: TZS ${Number(amount || 0).toLocaleString('en-US')}. Huduma: ${product || 'Mickey Pterodactyl'}. Ref: ${transactionId}. Asante.`;
  const result = await client.sendSMS({
    phoneNumbers: [normalizedPhone],
    message,
    senderId: process.env.TAPSA_SENDER_ID || 'TAPSA'
  });

  return { sent: true, phone: normalizedPhone, result };
}

module.exports = { normalizePhone, sendPaymentConfirmation };
