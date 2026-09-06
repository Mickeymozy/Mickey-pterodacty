const mongoose = require('mongoose');

const botScriptSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  category: { type: String, trim: true, default: 'General', maxlength: 60 },
  tags: [{ type: String, trim: true, maxlength: 30 }],
  previewImageUrl: { type: String, trim: true, default: '' },
  zipUrl: { type: String, required: true, trim: true },
  priceTzs: { type: Number, required: true, min: 1 },
  priceCoins: { type: Number, min: 1, select: false },
  ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

botScriptSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('BotScript', botScriptSchema);