const mongoose = require("mongoose");

const BetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  username: {
    type: String,
    required: true
  },
  gameType: {
    type: String,
    enum: ["flip", "pool", "challenge"],
    required: true
  },
  role: {
    type: String,
    enum: ["creator", "challenger"],
    required: true
  },
  challengeId: {
    type: String,
    required: true,
    index: true // speeds up lookup
  },
  poolType : {
    type: Boolean,
    default: null,
  },
  amount: {
    type: Number,
    required: true
  },
  result: {
    type: Boolean,
    default: null // null until resolved
  },
  payout: {
    type: Number,
    default: 0
  },
  txHash: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Bet", BetSchema);
