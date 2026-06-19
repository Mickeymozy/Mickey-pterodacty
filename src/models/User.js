const { Schema, model } = require("mongoose");

const userSchema = new Schema({
  discordId: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  pteroId: { type: Number, required: true },
});

module.exports = model("User", userSchema);
