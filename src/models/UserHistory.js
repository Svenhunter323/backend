const mongoose = require("mongoose");

const UserHistorySchema = new mongoose.Schema({
  address: String,
  gameType: String, // "flip", "prizepool", "challenge"
  result: Boolean,
  reward: String,
  xpAmount: String,
  timestamp: Number,
});

module.exports = mongoose.model("UserHistory", UserHistorySchema);
