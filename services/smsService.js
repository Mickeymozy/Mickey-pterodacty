const normalizePhone = (phone) => {
  const value = String(phone || '').replace(/\D/g, '');
  if (!value) return '';
  if (value.startsWith('255')) return value;
  if (value.startsWith('0') && value.length === 10) return `255${value.slice(1)}`;
  if ((value.startsWith('6') || value.startsWith('7')) && value.length === 9) return `255${value}`;
  return value;
};

const MAX_SMS_LENGTH = 480;

function formatAmount(amount) {
  return Number(amount || 0).toLocaleString('en-TZ');
}

function buildPaymentMessage({ amount, transactionId, product }) {
  const message = `MickeyPanel: Malipo yako ya TZS ${formatAmount(amount)} yamepokelewa. Huduma: ${product || 'MickeyPanel'}. Kumbukumbu: ${transactionId || 'N/A'}. Asante.`;
  return message.length > MAX_SMS_LENGTH ? `${message.slice(0, MAX_SMS_LENGTH - 3).trim()}...` : message;
}

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
  if (!/^255[67]\d{8}$/.test(normalizedPhone)) return { sent: false, skipped: true, reason: 'Namba ya simu si sahihi.' };

  const client = await getClient();
  if (!client) return { sent: false, skipped: true, reason: 'TAPSA_API_KEY is not configured.' };

  const message = buildPaymentMessage({ amount, transactionId, product });
  let result;
  let lastError;
  const attempts = Math.max(1, Math.min(Number(process.env.TAPSA_RETRY_ATTEMPTS || 2), 3));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      result = await client.sendSMS({ phoneNumbers: [normalizedPhone], message, senderId: process.env.TAPSA_SENDER_ID || 'MICKEY' });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  if (!result) throw new Error(`SMS sending failed after ${attempts} attempt(s): ${lastError?.message || 'Unknown provider error'}`);

  return { sent: true, phone: normalizedPhone, message, result };
}

module.exports = { normalizePhone, buildPaymentMessage, sendPaymentConfirmation };
