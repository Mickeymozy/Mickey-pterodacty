const normalizePhone = (phone) => {
  const value = String(phone || '').replace(/\D/g, '');
  if (!value) return '';
  if (value.startsWith('255')) return value;
  if (value.startsWith('0') && value.length === 10) return `255${value.slice(1)}`;
  if ((value.startsWith('6') || value.startsWith('7')) && value.length === 9) return `255${value}`;
  return value;
};

const MAX_SMS_LENGTH = 160;

function formatAmount(amount) {
  return Number(amount || 0).toLocaleString('en-TZ');
}

function buildPaymentMessage({ amount, currency = 'TZS', transactionId, product }) {
  const safeProduct = String(product || 'MickeyPanel').replace(/\s+/g, ' ').trim().slice(0, 40);
  const normalizedCurrency = String(currency || 'TZS').toUpperCase();
  const amountLabel = normalizedCurrency === 'TZS'
    ? `TZS ${formatAmount(amount)}`
    : `${formatAmount(amount)} ${normalizedCurrency}`;
  const message = `MickeyPanel: Malipo ya ${amountLabel} yamepokelewa. Huduma: ${safeProduct}. Kumbukumbu: ${transactionId || 'N/A'}. Asante.`;
  return message.length > MAX_SMS_LENGTH ? message.slice(0, MAX_SMS_LENGTH - 3).trimEnd() + '...' : message;
}

let sdkPromise;

async function getClient() {
  const apiKey = process.env.SMSTAPSA_API_KEY || process.env.TAPSA_API_KEY;
  if (!apiKey) return null;
  sdkPromise ||= import('sms-bulk-tz').then((sdk) => {
    const SmsBulkTz = [sdk.default, sdk.SmsBulkTz, sdk.TapsaSMS].find((candidate) => typeof candidate === 'function');
    if (!SmsBulkTz) throw new Error('sms-bulk-tz SDK constructor was not found.');
    return new SmsBulkTz({
      apiKey,
      baseUrl: process.env.SMSTAPSA_BASE_URL || process.env.TAPSA_BASE_URL || undefined,
      timeout: Number(process.env.SMSTAPSA_TIMEOUT_MS || process.env.TAPSA_TIMEOUT_MS || 30000),
      retries: Number(process.env.SMSTAPSA_RETRIES || 2)
    });
  }).catch((error) => {
    sdkPromise = null;
    throw new Error(`SMS client initialization failed: ${error.message}`);
  });
  return sdkPromise;
}

function getSendSmsMethod(client) {
  const method = client.sendSms || client.sendSMS;
  if (typeof method !== 'function') throw new Error('SMSTAPSA client does not provide sendSms().');
  return method.bind(client);
}

function isSuccessfulRecipient(recipient) {
  return /^(success|sent|delivered)$/i.test(String(recipient?.status || ''));
}

function getSenderId() {
  return process.env.SMSTAPSA_SENDER_ID || process.env.TAPSA_SENDER_ID || 'TAPSA';
}

async function sendPaymentConfirmation({ phone, amount, currency = 'TZS', transactionId, product }) {
  const normalizedPhone = normalizePhone(phone);
  if (!/^255[67]\d{8}$/.test(normalizedPhone)) return { sent: false, skipped: true, reason: 'Namba ya simu si sahihi.' };

  const client = await getClient();
  if (!client) return { sent: false, skipped: true, reason: 'SMSTAPSA_API_KEY is not configured.' };

  const message = buildPaymentMessage({ amount, currency, transactionId, product });
  const result = await getSendSmsMethod(client)(
    { phoneNumbers: [normalizedPhone], message, senderId: getSenderId() }
  );
  const recipients = Array.isArray(result?.recipients) ? result.recipients : [];
  const sent = result?.success !== false && (!recipients.length || recipients.some(isSuccessfulRecipient));
  const failedRecipient = recipients.find((recipient) => !isSuccessfulRecipient(recipient));
  return {
    sent,
    phone: normalizedPhone,
    message,
    result,
    reason: sent ? null : failedRecipient?.failureReason || failedRecipient?.status || result?.message || 'SMS haikufika kwa mpokeaji.'
  };
}

async function sendTextMessage({ phoneNumbers, message }) {
  const normalizedPhones = [...new Set((Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers])
    .map(normalizePhone)
    .filter((phone) => /^255[67]\d{8}$/.test(phone)))];
  if (!normalizedPhones.length) return { sent: false, skipped: true, reason: 'Hakuna namba sahihi ya kupokea SMS.' };

  const text = String(message || '').trim();
  if (!text) return { sent: false, skipped: true, reason: 'Ujumbe wa SMS hauwezi kuwa tupu.' };
  if (text.length > MAX_SMS_LENGTH) return { sent: false, skipped: true, reason: `Ujumbe wa SMS usizidi herufi ${MAX_SMS_LENGTH}.` };

  const client = await getClient();
  if (!client) return { sent: false, skipped: true, reason: 'SMSTAPSA_API_KEY is not configured.' };

  const result = await getSendSmsMethod(client)(
    { phoneNumbers: normalizedPhones, message: text, senderId: getSenderId() }
  );
  const recipients = Array.isArray(result?.recipients) ? result.recipients : [];
  const successfulCount = recipients.length
    ? recipients.filter(isSuccessfulRecipient).length
    : result?.success === false ? 0 : normalizedPhones.length;
  return {
    sent: successfulCount > 0,
    count: successfulCount,
    phoneNumbers: normalizedPhones,
    result,
    reason: successfulCount > 0 ? null : result?.message || 'SMS hazikutumwa kwa wapokeaji.'
  };
}

module.exports = { normalizePhone, buildPaymentMessage, sendPaymentConfirmation, sendTextMessage };
