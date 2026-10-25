const test = require('node:test');
const assert = require('node:assert/strict');
const { decrypt, encrypt, hashApiKey } = require('../utils/paymentCredentials');

test('API key hash is deterministic and does not expose the key', () => {
  const apiKey = 'mp_live_test_secret';
  assert.equal(hashApiKey(apiKey), hashApiKey(apiKey));
  assert.notEqual(hashApiKey(apiKey), apiKey);
  assert.match(hashApiKey(apiKey), /^[a-f0-9]{64}$/);
});

test('encrypted webhook secret round-trips and does not expose plaintext', () => {
  process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY = 'test-only-payment-key';
  const secret = 'mp_whsec_test_secret';
  const ciphertext = encrypt(secret);

  assert.notEqual(ciphertext, secret);
  assert.match(ciphertext, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(decrypt(ciphertext), secret);
});

test('tampering with encrypted webhook secret is rejected', () => {
  process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY = 'test-only-payment-key';
  const ciphertext = encrypt('original-secret');
  const parts = ciphertext.split('.');
  parts[2] = parts[2].startsWith('A') ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;

  assert.throws(() => decrypt(parts.join('.')));
});
