// routes/dashboard.js
const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Bet = require("../models/Bet");
const UserHistory = require("../models/UserHistory");

// helpers
const normalize = (a) => String(a || "").toLowerCase();

// sum helpers using Mongo aggregation
async function sumUserHistory(address, field, extraMatch = {}) {
  const rows = await UserHistory.aggregate([
    { $match: { address, ...extraMatch } },
    { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: [`$${field}`, 0] } } } } },
  ]);
  return rows[0]?.total || 0;
}

async function sumBets(match, field) {
  const rows = await Bet.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: [`$${field}`, 0] } } } } },
  ]);
  return rows[0]?.total || 0;
}

// GET /api/dashboard/summary/:address
// - totalXpEarned: sum of rewards (wins) for this address (all game types)
// - totalXpSpent: sum of all bet amounts (including pending) for this address
// - activeTickets: sum of pending bet amounts (result == null) for this address
router.get("/summary/:address", async (req, res) => {
  try {
    const address = normalize(req.params.address);
    if (!address || !address.startsWith("0x")) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // try to also match by userId if we have the User
    const user = await User.findOne({ wallet: address }, { _id: 1 }).lean();
    const betMatchAll = user
      ? { $or: [{ username: address }, { userId: user._id }] }
      : { username: address };

    const [totalXpEarned, totalXpSpent, activeTickets] = await Promise.all([
      // winners-only history
      sumUserHistory(address, "reward", { result: true }),
      // all bets including pending
      sumBets(betMatchAll, "amount"),
      // pending only
      sumBets({ ...betMatchAll, result: null }, "amount"),
    ]);

    res.json({
      address,
      totals: {
        totalXpEarned,  // winners' rewards
        totalXpSpent,   // all bet amounts (pending + settled)
        activeTickets,  // sum of pending amounts
      },
    });
  } catch (err) {
    console.error("[GET /api/dashboard/summary/:address] error:", err);
    res.status(500).json({ error: "Failed to compute dashboard summary" });
  }
});

// GET /api/dashboard/raiders?limit=30
// latest winners across all game types
router.get("/raiders", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 30));

    const rows = await UserHistory.aggregate([
      { $match: { result: true } },
      { $sort: { timestamp: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "address",
          foreignField: "wallet",
          as: "user",
        },
      },
      {
        $project: {
          address: 1,
          gameType: 1,
          timestamp: 1,
          xpAmount: { $toDouble: { $ifNull: ["$xpAmount", 0] } },
          reward: { $toDouble: { $ifNull: ["$reward", 0] } },
          username: { $first: "$user.username" },
        },
      },
    ]);

    const mapGame = (g) =>
      g === "challenge" ? "Coin Flip" : g === "pool" ? "Prize Pool" : g || "-";

    const data = rows.map((r) => ({
      address: r.address,
      username: r.username || r.address,
      game: mapGame(r.gameType),
      xp_used: r.xpAmount,
      profit: r.reward,
      timestamp: Number(r.timestamp) < 1e12 ? Number(r.timestamp) * 1000 : Number(r.timestamp),
    }));

    res.json(data);
  } catch (err) {
    console.error("[GET /api/dashboard/raiders] error:", err);
    res.status(500).json({ error: "Failed to fetch raiders" });
  }
});

// (Optional convenience) GET /api/dashboard/overview?address=0x...&limit=30
router.get("/overview", async (req, res) => {
  try {
    const address = normalize(req.query.address || "");
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 30));

    let summary = null;
    if (address && address.startsWith("0x")) {
      const sres = await fetch(`${req.protocol}://${req.get("host")}${req.baseUrl}/summary/${address}`);
      summary = await sres.json();
    }

    const rres = await fetch(`${req.protocol}://${req.get("host")}${req.baseUrl}/raiders?limit=${limit}`);
    const raiders = await rres.json();

    res.json({ summary, raiders });
  } catch (err) {
    // If you don't want to use self-fetch, remove this route or implement directly
    res.status(500).json({ error: "Failed to compute overview" });
  }
});

module.exports = router;
