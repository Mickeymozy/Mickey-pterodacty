const crypto = require('crypto');
const PaymentCredential = require('../models/PaymentCredential');

const CREDENTIAL_NAME = 'external-payment';

function getEncryptionKey() {
  const secret = process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error('PAYMENT_CREDENTIAL_ENCRYPTION_KEY or SESSION_SECRET is required for credential storage.');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decrypt(value) {
  const [ivValue, tagValue, encryptedValue, extra] = String(value).split('.');
  if (!ivValue || !tagValue || !encryptedValue || extra) throw new Error('Invalid encrypted credential.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}

async function rotatePaymentCredentials({ apiKey, webhookSecret, rotatedBy }) {
  const credential = await PaymentCredential.findOneAndUpdate(
    { name: CREDENTIAL_NAME },
    {
      name: CREDENTIAL_NAME,
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPrefix: apiKey.slice(0, 18),
      webhookSecretCiphertext: encrypt(webhookSecret),
      rotatedAt: new Date(),
      rotatedBy
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return credential;
}

async function getActiveApiKeyConfig() {
  const stored = await PaymentCredential.findOne({ name: CREDENTIAL_NAME }).select('+apiKeyHash +webhookSecretCiphertext').lean();
  if (stored) {
    return { apiKeyHash: stored.apiKeyHash, webhookSecret: decrypt(stored.webhookSecretCiphertext), source: 'database' };
  }
  return {
    apiKeyHash: process.env.EXTERNAL_PAYMENT_API_KEY ? hashApiKey(process.env.EXTERNAL_PAYMENT_API_KEY) : null,
    webhookSecret: process.env.EXTERNAL_PAYMENT_WEBHOOK_SECRET || null,
    source: 'environment'
  };
}

module.exports = { CREDENTIAL_NAME, decrypt, encrypt, getActiveApiKeyConfig, hashApiKey, rotatePaymentCredentials };
