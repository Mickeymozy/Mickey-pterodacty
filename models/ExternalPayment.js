const mongoose = require('mongoose');

const externalPaymentSchema = new mongoose.Schema({
  merchantOrderId: { type: String, required: true, unique: true, index: true },
  providerOrderId: { type: String, required: true, unique: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, enum: ['TZS'], default: 'TZS' },
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true },
  customerPhone: { type: String, required: true },
  description: { type: String, default: 'External website payment' },
  paymentUrl: String,
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending', index: true },
  providerMessage: String,
  notes: String,
  completedAt: Date,
  webhookSentAt: Date,
  confirmationSmsStatus: String,
  confirmationSmsReason: String,
  confirmationSmsMessageId: { type: String, index: true },
  confirmationSmsDeliveryStatus: String,
  confirmationSmsDeliveryReason: String,
  confirmationSmsDeliveredAt: Date,
  confirmationSmsAttemptedAt: Date,
  confirmationSmsSentAt: Date
}, { timestamps: true });

module.exports = mongoose.model('ExternalPayment', externalPaymentSchema);