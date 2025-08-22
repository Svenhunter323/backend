// models/Leaderboard.js
const mongoose = require("mongoose");

const LeaderboardSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      lowercase: true,            // normalize to lowercase automatically
      trim: true,
    },
    gameType: {
      type: String,
      enum: ["challenge", "pool"], // challenge = coin flip, pool = prize pool
      required: true,
    },
    // For challenge rows, keep this as null.
    // For pool rows, set to true/false depending on the specific pool type you track.
    poolType: {
      type: Boolean,
      default: null,
    },

    wins:        { type: Number, default: 0, min: 0 },
    totalXP:     { type: Number, default: 0, min: 0 },
    totalReward: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false }
);

// ✅ One document per (address, gameType, poolType)
LeaderboardSchema.index(
  { address: 1, gameType: 1, poolType: 1 },
  { unique: true, name: "addr_game_pool_unique" }
);

// (Optional) Helpful secondary indexes for common queries
LeaderboardSchema.index({ gameType: 1, poolType: 1, totalXP: -1, wins: -1 });
LeaderboardSchema.index({ address: 1 });

module.exports = mongoose.model("Leaderboard", LeaderboardSchema);
