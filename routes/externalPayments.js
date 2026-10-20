const crypto = require('crypto');
const express = require('express');
const palmPesaService = require('../services/palmPesaService');
const ExternalPayment = require('../models/ExternalPayment');
const { isAdminUser } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/auditLog');

const router = express.Router();

router.post('/admin/generate-secrets', async (req, res) => {
  if (!req.user || !isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }

  const secrets = {
    apiKey: `mp_live_${crypto.randomBytes(32).toString('hex')}`,
    webhookSecret: `mp_whsec_${crypto.randomBytes(32).toString('hex')}`
  };

  await writeAuditLog(req, 'payment.api_secrets.generated', { type: 'ExternalPayment' });
  return res.json({ success: true, data: secrets });
});

function authenticateMerchant(req, res, next) {
  const configuredKey = process.env.EXTERNAL_PAYMENT_API_KEY || '';
  const suppliedKey = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (!configuredKey) {
    return res.status(503).json({ success: false, message: 'External payment API is not configured.' });
  }

  const configuredBuffer = Buffer.from(configuredKey);
  const suppliedBuffer = Buffer.from(suppliedKey);
  if (configuredBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(configuredBuffer, suppliedBuffer)) {
    return res.status(401).json({ success: false, message: 'Invalid API key.' });
  }

  next();
}

router.use(authenticateMerchant);

router.post('/checkout', async (req, res) => {
  let payment;
  try {
    if (!process.env.EXTERNAL_PAYMENT_WEBHOOK_URL || !process.env.EXTERNAL_PAYMENT_WEBHOOK_SECRET) {
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
        completedAt: payment.completedAt || null
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not retrieve payment status.' });
  }
});

module.exports = router;