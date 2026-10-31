const mongoose = require('mongoose');

const eggAvailabilitySchema = new mongoose.Schema({
  eggId: { type: Number, required: true, unique: true, min: 1 },
  isAvailable: { type: Boolean, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('EggAvailability', eggAvailabilitySchema);