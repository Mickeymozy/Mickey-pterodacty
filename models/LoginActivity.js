const mongoose = require('mongoose');

const loginActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  success: { type: Boolean, required: true },
  ip: String,
  userAgent: String,
  alerted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('LoginActivity', loginActivitySchema);