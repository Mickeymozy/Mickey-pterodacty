const crypto = require('crypto');

// Mock axios before requiring the module
jest.mock('axios', () => ({
  post: jest.fn()
}));

// Reset modules so we can control env vars
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    SONICPESA_API_KEY: 'test-api-key',
    SONICPESA_BASE_URL: 'https://api.sonicpesa.com/api/v1',
    SONICPESA_WEBHOOK_SECRET: 'test-webhook-secret',
    APP_URL: 'https://test-app.com'
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('SonicPesaService', () => {
  let service;
  let axios;

  beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    service = require('../services/sonicPesaService');
  });

  describe('constructor', () => {
    test('initializes with environment variables', () => {
      expect(service.apiKey).toBe('test-api-key');
      expect(service.baseUrl).toBe('https://api.sonicpesa.com/api/v1');
      expect(service.webhookSecret).toBe('test-webhook-secret');
    });

    test('strips trailing slash from base URL', () => {
      jest.resetModules();
      process.env.SONICPESA_BASE_URL = 'https://api.sonicpesa.com/api/v1/';
      const svc = require('../services/sonicPesaService');
      expect(svc.baseUrl).toBe('https://api.sonicpesa.com/api/v1');
    });
  });

  describe('createPayment', () => {
    test('returns error when customer email is missing', async () => {
      const result = await service.createPayment({ amount: 1000 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('email is required');
    });

    test('returns success on successful API response', async () => {
      axios.post.mockResolvedValue({
        data: {
          status: 'success',
          data: {
            payment_url: 'https://pay.sonicpesa.com/order123',
            order_id: 'order123',
            reference: 'ref123'
          }
        }
      });

      const result = await service.createPayment({
        customerEmail: 'user@test.com',
        customerName: 'Test User',
        amount: 5000,
        currency: 'TZS'
      });

      expect(result.success).toBe(true);
      expect(result.paymentUrl).toBe('https://pay.sonicpesa.com/order123');
      expect(result.orderId).toBe('order123');
    });

    test('returns error on failed API response', async () => {
      axios.post.mockResolvedValue({
        data: {
          status: 'error',
          message: 'Invalid amount'
        }
      });

      const result = await service.createPayment({
        customerEmail: 'user@test.com',
        amount: -1
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid amount');
    });

    test('handles network errors gracefully', async () => {
      axios.post.mockRejectedValue(new Error('Network timeout'));

      const result = await service.createPayment({
        customerEmail: 'user@test.com',
        amount: 5000
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });

    test('sends correct payload to API', async () => {
      axios.post.mockResolvedValue({
        data: { status: 'success', data: {} }
      });

      await service.createPayment({
        customerEmail: 'user@test.com',
        customerName: 'Test User',
        customerPhone: '+255123456789',
        amount: 5000,
        currency: 'TZS'
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.sonicpesa.com/api/v1/payment/create_order',
        expect.objectContaining({
          buyer_email: 'user@test.com',
          buyer_name: 'Test User',
          buyer_phone: '+255123456789',
          amount: 5000,
          currency: 'TZS'
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-KEY': 'test-api-key'
          })
        })
      );
    });

    test('uses default values for optional fields', async () => {
      axios.post.mockResolvedValue({
        data: { status: 'success', data: {} }
      });

      await service.createPayment({
        customerEmail: 'user@test.com',
        amount: 1000
      });

      const payload = axios.post.mock.calls[0][1];
      expect(payload.buyer_name).toBe('Customer');
      expect(payload.currency).toBe('TZS');
    });
  });

  describe('verifyPayment', () => {
    test('returns payment status on success', async () => {
      axios.post.mockResolvedValue({
        data: {
          status: 'success',
          data: {
            payment_status: 'COMPLETED',
            amount: 5000,
            reference: 'ref123',
            order_id: 'order123'
          }
        }
      });

      const result = await service.verifyPayment('order123');
      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe('COMPLETED');
      expect(result.amount).toBe(5000);
    });

    test('returns error on verification failure', async () => {
      axios.post.mockResolvedValue({
        data: {
          status: 'error',
          message: 'Order not found'
        }
      });

      const result = await service.verifyPayment('invalid-order');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    test('handles network errors during verification', async () => {
      axios.post.mockRejectedValue(new Error('Connection refused'));

      const result = await service.verifyPayment('order123');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('validateWebhookSignature', () => {
    test('returns true when webhook secret is not configured', () => {
      service.webhookSecret = '';
      const result = service.validateWebhookSignature('payload', 'signature');
      expect(result).toBe(true);
    });

    test('returns true when signature is not provided', () => {
      const result = service.validateWebhookSignature('payload', '');
      expect(result).toBe(true);
    });

    test('validates correct signature', () => {
      const payload = '{"order_id":"123","status":"completed"}';
      const secret = 'test-webhook-secret';
      service.webhookSecret = secret;
      const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const result = service.validateWebhookSignature(payload, validSignature);
      expect(result).toBe(true);
    });

    test('rejects invalid signature', () => {
      service.webhookSecret = 'test-webhook-secret';
      const payload = '{"order_id":"123"}';
      const invalidSignature = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const result = service.validateWebhookSignature(payload, invalidSignature);
      expect(result).toBe(false);
    });
  });

  describe('generateReference', () => {
    test('generates a string starting with SP_', () => {
      const ref = service.generateReference();
      expect(ref).toMatch(/^SP_/);
    });

    test('generates unique references', () => {
      const ref1 = service.generateReference();
      const ref2 = service.generateReference();
      expect(ref1).not.toBe(ref2);
    });

    test('includes timestamp in reference', () => {
      const before = Date.now();
      const ref = service.generateReference();
      const parts = ref.split('_');
      const timestamp = parseInt(parts[1]);
      expect(timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getAvailablePaymentMethods', () => {
    test('returns array of payment methods', () => {
      const methods = service.getAvailablePaymentMethods();
      expect(Array.isArray(methods)).toBe(true);
      expect(methods.length).toBeGreaterThan(0);
    });

    test('each method has id, name, and icon', () => {
      const methods = service.getAvailablePaymentMethods();
      methods.forEach(method => {
        expect(method).toHaveProperty('id');
        expect(method).toHaveProperty('name');
        expect(method).toHaveProperty('icon');
      });
    });

    test('includes sonicpesa method', () => {
      const methods = service.getAvailablePaymentMethods();
      expect(methods.find(m => m.id === 'sonicpesa')).toBeDefined();
    });
  });
});
