// routes/admin.js
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const UserHistory = require("../models/UserHistory");
const Leaderboard = require("../models/Leaderboard");
const AdminUser   = require("../models/AdminUser");
const User        = require("../models/User");
const Bet         = require("../models/Bet");

const { getAnalytics } = require("../lib/analytics");

const {
  broadcastUsersUpdated,
  broadcastAnalyticsUpdate
} = require("../socket");

const JWT_SECRET = process.env.JWT_SECRET;

// small helpers reused in /bets
const toNumber = (v) => {
  const n = Number(typeof v === "string" ? v : v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const normalizeTsMs = (ts) => {
  const n = Number(ts || 0);
  return n < 1e12 ? n * 1000 : n; // seconds -> ms
};

const router = express.Router();
router.use(express.json());

// ---- Auth middleware (kept) ----
router.use((req, res, next) => {
  if (req.path === "/login") return next(); // Skip for login route
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const token = auth.split(" ")[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Token invalid" });
  }
});

// ---- POST /api/admin/login ----
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const admin = await AdminUser.findOne({ username });

  if (!admin) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "2h" });
  res.json({ token });
});

// ---- GET /api/admin/history (kept) ----
router.get("/history", async (_req, res) => {
  const history = await UserHistory.find().sort({ timestamp: -1 }).limit(100);
  res.json(history);
});

// ---- POST /api/admin/withdraw (kept) ----
router.post("/withdraw", async (req, res) => {
  const { token, amount } = req.body;
  const { withdrawFunds } = require("../web3/admin");

  try {
    const tx = await withdrawFunds(token, amount);
    res.json({ txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- POST /api/admin/pause (kept) ----
router.post("/pause", async (req, res) => {
  const { pause } = req.body;
  const { pauseGame, unpauseGame } = require("../web3/admin");

  try {
    const tx = pause ? await pauseGame() : await unpauseGame();
    res.json({ txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH /api/admin/update (kept) ----
router.patch("/update", async (req, res) => {
  const { username } = req.admin; // from token
  const { currentPassword, newUsername, newPassword } = req.body;

  const admin = await AdminUser.findOne({ username });
  if (!admin) return res.status(404).json({ error: "Admin not found" });

  const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  if (newUsername) admin.username = newUsername;
  if (newPassword) admin.passwordHash = await bcrypt.hash(newPassword, 10);

  await admin.save();
  res.json({ success: true });
});

// ---- GET /api/admin/kpis (kept) ----
router.get("/kpis", async (_req, res) => {
  try {
    const [totalUsers, totalBets, totalVolumeResult] = await Promise.all([
      User.countDocuments(),
      Bet.countDocuments(),
      Bet.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]),
    ]);

    const totalVolume = totalVolumeResult[0]?.total || 0;

    res.json({
      totalUsers,
      totalBets,
      totalVolume: parseFloat(Number(totalVolume).toFixed(2)),
    });
  } catch (err) {
    console.error("KPI Error:", err);
    res.status(500).json({ error: "Failed to fetch KPIs" });
  }
});

// ---- GET /api/admin/stats (fix isBanned) ----
router.get("/stats", async (_req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalBanned = await User.countDocuments({ isBanned: true });
    const totalBets = await Bet.countDocuments();
    const totalVolumeAgg = await Bet.aggregate([{ $group: { _id: null, volume: { $sum: "$amount" } } }]);
    const totalVolume = totalVolumeAgg[0]?.volume || 0;

    res.json({
      totalUsers,
      totalBanned,
      totalActive: totalUsers - totalBanned,
      totalBets,
      totalVolume,
    });
  } catch (err) {
    console.error("[/api/admin/stats]", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ====================== NEW: Bets list for admin ======================
router.get("/bets", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));

    const rows = await UserHistory.aggregate([
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
      { $project: {
          address: 1, gameType: 1, result: 1, reward: 1, xpAmount: 1, timestamp: 1,
          user: { $first: "$user" }
        }
      },
    ]);

    const data = rows.map((r) => {
      const amount = toNumber(r.xpAmount);
      const payout = toNumber(r.reward);
      return {
        username: r.user?.username || r.address,
        gameType: r.gameType,
        amount,
        result: r.result ? "win" : "loss",
        payout: payout || undefined,
        timestamp: normalizeTsMs(r.timestamp),
        multiplier: (amount > 0 && payout > 0) ? Number((payout / amount).toFixed(2)) : null,
      };
    });

    res.json(data);
  } catch (err) {
    console.error("[GET /api/admin/bets] error:", err);
    res.status(500).json({ error: "Failed to fetch bets" });
  }
});

// ====================== Users management (no email; isBanned) ======================
router.get("/users", async (_req, res) => {
  try {
    const users = await User.find(
      {},
      { username: 1, wallet: 1, isBanned: 1, createdAt: 1, avatar: 1, lastActive: 1 }
    ).sort({ createdAt: -1 });

    const data = users.map((u) => ({
      id: u._id.toString(),
      username: u.username || "",
      wallet: u.wallet || "",
      isBanned: !!u.isBanned,
      joinedAt: u.createdAt ?? null,
      lastActive: u.lastActive ?? null,
      avatar: u.avatar || "",
    }));

    res.json(data);
  } catch (err) {
    console.error("[GET /api/admin/users] error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.patch("/users/:id/ban", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid user id" });

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { isBanned: true, bannedAt: new Date() } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    broadcastUsersUpdated();
    res.json({ id: user._id.toString(), isBanned: true });
  } catch (err) {
    console.error("[PATCH /api/admin/users/:id/ban] error:", err);
    res.status(500).json({ error: "Failed to ban user" });
  }
});

router.patch("/users/:id/unban", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid user id" });

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { isBanned: false }, $unset: { bannedAt: 1 } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    broadcastUsersUpdated();
    res.json({ id: user._id.toString(), isBanned: false });
  } catch (err) {
    console.error("[PATCH /api/admin/users/:id/unban] error:", err);
    res.status(500).json({ error: "Failed to unban user" });
  }
});

// ── NEW: /api/admin/analytics (cached + fast) ───────────────
router.get("/analytics", async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
    const data = await getAnalytics(days);
    res.json(data);
  } catch (err) {
    console.error("[/api/admin/analytics] error:", err);
    res.status(500).json({ error: "Failed to compute analytics" });
  }
});

module.exports = router;
