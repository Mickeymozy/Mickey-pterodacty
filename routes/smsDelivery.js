const crypto = require('crypto');
const express = require('express');
const Transaction = require('../models/Transaction');
const ExternalPayment = require('../models/ExternalPayment');
const { normalizeSmsDeliveryReport } = require('../services/smsService');

const router = express.Router();

function matchesWebhookToken(supplied, expected) {
  if (!supplied || !expected) return false;
  const suppliedBuffer = Buffer.from(String(supplied));
  const expectedBuffer = Buffer.from(String(expected));
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

router.post('/delivery/:token', async (req, res) => {
  const expectedToken = process.env.SMSTAPSA_DELIVERY_WEBHOOK_TOKEN;
  if (!expectedToken) {
    return res.status(503).json({ success: false, message: 'SMS delivery webhook is not configured.' });
  }
  if (!matchesWebhookToken(req.params.token, expectedToken)) {
    return res.status(401).json({ success: false, message: 'Invalid SMS delivery webhook token.' });
  }

  if (req.body?.event !== 'sms.delivery') {
    return res.status(400).json({ success: false, message: 'Unsupported SMS webhook event.' });
  }

  const report = normalizeSmsDeliveryReport(req.body);
  if (!report.messageId) {
    return res.status(400).json({ success: false, message: 'SMS delivery report is missing messageId.' });
  }

  try {
    const internalUpdate = Transaction.findOneAndUpdate(
      { 'metadata.confirmationSmsMessageId': report.messageId },
      {
        $set: {
          'metadata.confirmationSmsDeliveryStatus': report.deliveryStatus,
          'metadata.confirmationSmsDeliveryReason': report.failureReason,
          'metadata.confirmationSmsDeliveryAt': report.occurredAt
        }
      },
      { new: true }
    );
    const externalUpdate = ExternalPayment.findOneAndUpdate(
      { confirmationSmsMessageId: report.messageId },
      {
        $set: {
          confirmationSmsDeliveryStatus: report.deliveryStatus,
          confirmationSmsDeliveryReason: report.failureReason,
          ...(report.deliveryStatus === 'delivered' ? { confirmationSmsDeliveredAt: report.occurredAt } : {})
        }
      },
      { new: true }
    );
    const [transaction, externalPayment] = await Promise.all([internalUpdate, externalUpdate]);

    return res.json({ success: true, matched: Boolean(transaction || externalPayment) });
  } catch (error) {
    console.error('SMSTAPSA delivery report update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save SMS delivery report.' });
  }
});

module.exports = router;