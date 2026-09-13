const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  category: { type: String, enum: ['billing', 'server', 'bot-script', 'account', 'other'], default: 'other', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },
  status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  adminReply: { type: String, trim: true, maxlength: 4000, default: '' },
  resolvedAt: Date
}, { timestamps: true });

supportTicketSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);