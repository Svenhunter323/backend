const mongoose = require("mongoose");

const LeaderboardSchema = new mongoose.Schema({
  address: { type: String, unique: true },
  wins: { type: Number, default: 0 },
  totalXP: { type: Number, default: 0 },
  totalReward: { type: Number, default: 0 },
});

module.exports = mongoose.model("Leaderboard", LeaderboardSchema);
