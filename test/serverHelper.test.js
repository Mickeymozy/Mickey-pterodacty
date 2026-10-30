const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPteroLimitsFromPackage, isValidGitUrl, buildStartupCommand } = require('../utils/serverHelper');
const { normalizePanelBaseUrl } = require('../utils/panelUrl');
const { fetchPterodactylEggs } = require('../utils/pterodactylEggs');
const { fetchPaginatedApplicationData } = require('../utils/pterodactylPagination');
const { validatePasswordComplexity } = require('../utils/passwordValidator');
const { normalizePhone, buildPaymentMessage, normalizeSmsDeliveryReport } = require('../services/smsService');

test('accepts simple passwords with at least 8 characters', () => {
  assert.equal(validatePasswordComplexity('abcdefgh').isValid, true);
  assert.equal(validatePasswordComplexity('password').isValid, true);
});

test('rejects passwords shorter than 8 characters', () => {
  assert.equal(validatePasswordComplexity('abc123!').isValid, false);
});

test('normalizes Tanzanian mobile numbers for SMS account settings', () => {
  assert.equal(normalizePhone('0712 345 678'), '255712345678');
  assert.equal(normalizePhone('+255 712 345 678'), '255712345678');
  assert.equal(normalizePhone('712345678'), '255712345678');
  assert.equal(/^255[67]\d{8}$/.test(normalizePhone('12345')), false);
});

test('builds SMSTAPSA payment confirmations within the 160-character limit', () => {
  const message = buildPaymentMessage({
    amount: 12500,
    transactionId: '0123456789abcdef01234567',
    product: 'Bot script '.repeat(20)
  });
  assert.ok(message.includes('Malipo ya TZS'));
  assert.ok(message.length <= 160);
  assert.ok(buildPaymentMessage({ amount: 25, currency: 'coins' }).includes('25 COINS'));
});

test('maps SMSTAPSA delivery reports to delivered, failed, or unknown states', () => {
  const delivered = normalizeSmsDeliveryReport({ messageId: 'msg_1', status: 'Success', success: true });
  assert.equal(delivered.messageId, 'msg_1');
  assert.equal(delivered.deliveryStatus, 'delivered');
  assert.equal(delivered.failureReason, null);
  assert.ok(delivered.occurredAt instanceof Date);
  assert.equal(normalizeSmsDeliveryReport({ status: 'Undelivered', success: false }).deliveryStatus, 'failed');
  assert.equal(normalizeSmsDeliveryReport({ status: 'Success', success: false }).deliveryStatus, 'failed');
  assert.equal(normalizeSmsDeliveryReport({ status: 'Queued', success: null }).deliveryStatus, 'unknown');
});

test('validates public git repository URLs', () => {
  assert.equal(isValidGitUrl('https://github.com/example/bot.git'), true);
  assert.equal(isValidGitUrl('https://github.com/example/bot'), true);
  assert.equal(isValidGitUrl('https://github.com/example/bot?token=secret'), false);
  assert.equal(isValidGitUrl('not-a-url'), false);
});

test('converts package resources to Pterodactyl limits', () => {
  assert.deepEqual(buildPteroLimitsFromPackage({ cpu: 1, ram: 512, disk: 2 }), {
    memory: 512,
    swap: 0,
    disk: 2048,
    io: 500,
    cpu: 100,
    oom_disabled: false
  });
});

test('keeps package CPU percentages instead of multiplying them by 100', () => {
  assert.equal(buildPteroLimitsFromPackage({ cpu: 25 }).cpu, 25);
  assert.equal(buildPteroLimitsFromPackage({ cpu: 30 }).cpu, 30);
});

test('preserves zero package limits as unlimited', () => {
  assert.deepEqual(buildPteroLimitsFromPackage({ cpu: 0, ram: 0, disk: 0 }), {
    memory: 0,
    swap: 0,
    disk: 0,
    io: 500,
    cpu: 0,
    oom_disabled: false
  });
});

test('keeps the startup command unchanged when no repository is configured', () => {
  const startupCommand = 'npm start';
  assert.equal(buildStartupCommand(startupCommand), startupCommand);
});

test('initializes a repository before running the original startup command', () => {
  const startupCommand = 'npm start';
  const repositoryStartup = buildStartupCommand(startupCommand, 'https://github.com/example/bot.git');

  assert.match(repositoryStartup, /git clone --depth=1/);
  assert.ok(repositoryStartup.endsWith('cd /home/container\nnpm start'));
});

test('normalizes panel URLs with optional API path suffixes', () => {
  assert.equal(normalizePanelBaseUrl('https://panel.example.com/'), 'https://panel.example.com');
  assert.equal(normalizePanelBaseUrl('https://panel.example.com/api'), 'https://panel.example.com');
  assert.equal(normalizePanelBaseUrl('https://panel.example.com/api/application/'), 'https://panel.example.com');
  assert.equal(normalizePanelBaseUrl('https://panel.example.com/api/client'), 'https://panel.example.com');
  assert.equal(normalizePanelBaseUrl('https://panel.example.com/api/admin'), 'https://panel.example.com');
  assert.equal(normalizePanelBaseUrl('https://panel.example.com/panel/api/application'), 'https://panel.example.com/panel');
});

test('loads all eggs and variable defaults through the Admin API', async () => {
  const requests = [];
  const adminApi = {
    async get(path, { params }) {
      requests.push({ path, params });
      if (params.page === 1) {
        return {
          data: {
            data: [{
              id: 42,
              attributes: { name: 'Custom Node', docker_image: 'node:22', startup: 'node server.js' },
              relationships: { variables: { data: [{ type: 'egg_variable', id: '77' }] } }
            }],
            included: [{
              type: 'egg_variable',
              id: '77',
              attributes: { env_variable: 'NODE_ENV', default_value: 'production' }
            }],
            meta: { pagination: { total_pages: 2 } }
          }
        };
      }
      return { data: { data: [], meta: { pagination: { total_pages: 2 } } } };
    }
  };

  const eggs = await fetchPterodactylEggs(adminApi);
  assert.equal(eggs.length, 1);
  assert.equal(eggs[0].id, 42);
  assert.equal(eggs[0].name, 'Custom Node');
  assert.equal(eggs[0].environment.NODE_ENV, 'production');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ path, params }) => path === '/eggs' && params.include === 'variables'));
});

test('loads servers across all Application API pages', async () => {
  const requests = [];
  const api = {
    async get(path, { params }) {
      requests.push({ path, params });
      return {
        data: {
          data: [{ attributes: { id: params.page } }],
          meta: { pagination: { total_pages: 2 } }
        }
      };
    }
  };

  const servers = await fetchPaginatedApplicationData(api, '/servers');
  assert.deepEqual(servers.map((server) => server.attributes.id), [1, 2]);
  assert.deepEqual(requests.map(({ params }) => params.page), [1, 2]);
  assert.ok(requests.every(({ path, params }) => path === '/servers' && params.per_page === 100));
});
