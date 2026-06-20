const mongoose = require('mongoose');

const ServerSchema = new mongoose.Schema({
  pteroId: {
    type: Number,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  identifier: {
    type: String,
    required: true,
    unique: true
  },
  nodeId: {
    type: Number,
    required: true
  },
  eggId: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['installing', 'running', 'stopped', 'suspended'],
    default: 'installing'
  },
  limits: {
    cpu: { type: Number, default: 100 },
    memory: { type: Number, default: 1024 },
    disk: { type: Number, default: 2048 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

ServerSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Server', ServerSchema);