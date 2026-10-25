const mongoose = require('mongoose');

const paymentCredentialSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, default: 'external-payment' },
  apiKeyHash: { type: String, required: true },
  apiKeyPrefix: { type: String, required: true },
  webhookSecretCiphertext: { type: String, required: true },
  rotatedAt: { type: Date, default: Date.now },
  rotatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('PaymentCredential', paymentCredentialSchema);
