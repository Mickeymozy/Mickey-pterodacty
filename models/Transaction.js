/**
 * Transaction Model
 */

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  type: {
    type: String,
    enum: ['payment', 'refund', 'purchase', 'reward', 'admin_adjustment'],
    required: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  currency: {
    type: String,
    enum: ['USD', 'coins'],
    default: 'coins'
  },

  paymentMethod: {
    type: String,
    enum: ['palmpesa', 'zenopay', 'wallet', 'admin'],
    default: 'wallet'
  },

  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },

  packageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServerPackage'
  },

  serverId: {
    type: String
  },

  zenopayTransactionId: {
    type: String
  },

  zenopayReference: {
    type: String
  },

  paymentProvider: {
    type: String,
    enum: ['palmpesa', 'zenopay', 'wallet', 'admin'],
    default: 'wallet'
  },

  description: {
    type: String
  },

  metadata: {
    type: mongoose.Schema.Types.Mixed
  },

  notes: {
    type: String
  },

  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  completedAt: {
    type: Date
  }
});

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ zenopayTransactionId: 1 });

transactionSchema.methods.markCompleted = function() {
  this.status = 'completed';
  this.completedAt = Date.now();
  return this.save();
};

transactionSchema.methods.markFailed = function(reason = '') {
  this.status = 'failed';
  if (reason) this.notes = reason;
  return this.save();
};

module.exports = mongoose.model('Transaction', transactionSchema);
