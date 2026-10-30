const crypto = require('crypto');
const express = require('express');
const palmPesaService = require('../services/palmPesaService');
const ExternalPayment = require('../models/ExternalPayment');
const { isAdminUser } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/auditLog');
const PaymentCredential = require('../models/PaymentCredential');
const { getActiveApiKeyConfig, hashApiKey, rotatePaymentCredentials } = require('../utils/paymentCredentials');

const router = express.Router();

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  let source = origin;
  if (!source && req.get('referer')) {
    try {
      source = new URL(req.get('referer')).origin;
    } catch {
      return res.status(403).json({ success: false, message: 'Invalid request origin.' });
    }
  }
  const expected = `${req.protocol}://${req.get('host')}`;
  if (source && source !== expected) {
    return res.status(403).json({ success: false, message: 'Cross-site request blocked.' });
  }
  next();
}

router.post('/admin/generate-secrets', requireSameOrigin, async (req, res) => {
  if (!req.user || !isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }

  try {
    const secrets = {
      apiKey: `mp_live_${crypto.randomBytes(32).toString('hex')}`,
      webhookSecret: `mp_whsec_${crypto.randomBytes(32).toString('hex')}`
    };
    await rotatePaymentCredentials({ apiKey: secrets.apiKey, webhookSecret: secrets.webhookSecret, rotatedBy: req.user._id });
    await writeAuditLog(req, 'payment.api_secrets.rotated', { type: 'ExternalPayment' }, {
      apiKeyPrefix: secrets.apiKey.slice(0, 18)
    });
    return res.json({ success: true, data: secrets });
  } catch (error) {
    console.error('Payment credential rotation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Credentials could not be activated. Check the server encryption configuration.' });
  }
});

router.get('/admin/config', async (req, res) => {
  if (!req.user || !isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  const config = await PaymentCredential.findOne({ name: 'external-payment' }).select('apiKeyPrefix rotatedAt').lean();
  return res.json({
    success: true,
    data: {
      active: Boolean(config),
      source: config ? 'database' : 'environment',
      apiKeyPrefix: config?.apiKeyPrefix || null,
      rotatedAt: config?.rotatedAt || null,
      webhookUrlConfigured: /^https:\/\//i.test(process.env.EXTERNAL_PAYMENT_WEBHOOK_URL || '')
    }
  });
});

async function authenticateMerchant(req, res, next) {
  const suppliedKey = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  try {
    const { apiKeyHash } = await getActiveApiKeyConfig();
    if (!apiKeyHash) {
      return res.status(503).json({ success: false, message: 'External payment API is not configured.' });
    }

    const suppliedHash = hashApiKey(suppliedKey);
    const configuredBuffer = Buffer.from(apiKeyHash, 'hex');
    const suppliedBuffer = Buffer.from(suppliedHash, 'hex');
    if (!suppliedKey || configuredBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(configuredBuffer, suppliedBuffer)) {
      return res.status(401).json({ success: false, message: 'Invalid API key.' });
    }

    next();
  } catch (error) {
    console.error('Payment credential authentication failed:', error.message);
    return res.status(503).json({ success: false, message: 'External payment credentials are unavailable.' });
  }
}

router.use(authenticateMerchant);

router.post('/checkout', async (req, res) => {
  let payment;
  try {
    const activeCredential = await getActiveApiKeyConfig();
    if (!process.env.EXTERNAL_PAYMENT_WEBHOOK_URL || !activeCredential.webhookSecret) {
      return res.status(503).json({ success: false, message: 'Merchant webhook URL and secret must be configured.' });
    }
    if (process.env.NODE_ENV === 'production' && !process.env.PALMPESA_WEBHOOK_SECRET) {
      return res.status(503).json({ success: false, message: 'PalmPesa webhook signature verification is not configured.' });
    }

    const orderId = String(req.body.orderId || '').trim();
    const amount = Number(req.body.amount);
    const customerName = String(req.body.customerName || '').trim();
    const customerEmail = String(req.body.customerEmail || '').trim();
    const customerPhone = String(req.body.customerPhone || '').trim();
    const description = String(req.body.description || 'External website payment').trim().slice(0, 200);
    const configuredMaximum = Number(process.env.EXTERNAL_PAYMENT_MAX_TZS);
    const maximumAmount = Number.isSafeInteger(configuredMaximum) && configuredMaximum > 0
      ? configuredMaximum
      : 50000000;

    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(orderId)) {
      return res.status(400).json({ success: false, message: 'orderId must contain 1-100 letters, numbers, dots, underscores, colons, or hyphens.' });
    }
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > maximumAmount) {
      return res.status(400).json({ success: false, message: `amount must be an integer between 1 and ${maximumAmount} TZS.` });
    }
    if (!customerName || !customerEmail || !customerPhone) {
      return res.status(400).json({ success: false, message: 'customerName, customerEmail, and customerPhone are required.' });
    }
    if (await ExternalPayment.exists({ merchantOrderId: orderId })) {
      return res.status(409).json({ success: false, message: 'orderId has already been used.' });
    }

    const providerOrderId = `EXT-${crypto.randomBytes(12).toString('hex')}`;
    payment = await ExternalPayment.create({
      merchantOrderId: orderId,
      providerOrderId,
      amount,
      customerName,
      customerEmail,
      customerPhone,
      description
    });

    const result = await palmPesaService.createPayment({
      order_id: providerOrderId,
      amount,
      currency: 'TZS',
      customerName,
      customerEmail,
      customerPhone,
      description,
      webhookUrl: process.env.PALMPESA_WEBHOOK_URL || `${process.env.APP_URL || 'https://mickey-pterodacty.vercel.app'}/api/payment/webhook`
    });

    if (!result.success) {
      payment.status = 'failed';
      payment.notes = result.error || 'PalmPesa payment initialization failed';
      await payment.save();
      return res.status(502).json({ success: false, message: payment.notes });
    }

    payment.paymentUrl = result.paymentUrl || undefined;
    payment.providerMessage = result.paymentMessage || undefined;
    await payment.save();

    return res.status(201).json({
      success: true,
      data: {
        orderId: payment.merchantOrderId,
        paymentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        paymentUrl: payment.paymentUrl || null,
        paymentMessage: payment.providerMessage || null
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'orderId has already been used.' });
    }
    console.error('External payment checkout failed:', error.message);
    if (payment && payment.status === 'pending') {
      payment.status = 'failed';
      payment.notes = error.message;
      await payment.save().catch(() => {});
    }
    return res.status(500).json({ success: false, message: 'Could not create payment.' });
  }
});

router.get('/:orderId', async (req, res) => {
  try {
    const payment = await ExternalPayment.findOne({ merchantOrderId: req.params.orderId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

    return res.json({
      success: true,
      data: {
        orderId: payment.merchantOrderId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        completedAt: payment.completedAt || null,
        smsConfirmation: {
          sent: Boolean(payment.confirmationSmsSentAt),
          status: payment.confirmationSmsStatus || 'unknown',
          reason: payment.confirmationSmsReason || null
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not retrieve payment status.' });
  }
});

module.exports = router;