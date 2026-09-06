const mongoose = require('mongoose');

const botScriptSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  previewImageUrl: { type: String, trim: true, default: '' },
  zipUrl: { type: String, required: true, trim: true },
  priceCoins: { type: Number, required: true, min: 1 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

botScriptSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('BotScript', botScriptSchema);