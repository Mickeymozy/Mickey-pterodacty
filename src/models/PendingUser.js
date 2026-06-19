const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  discordId: String,
  email: String,
  code: String,
  expiresAt: Number,
});

module.exports = mongoose.model("PendingUser", schema);
