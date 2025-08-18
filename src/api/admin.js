const express = require("express");
const router = express.Router();
const { ethers } = require("ethers");
const UserHistory = require("../models/UserHistory");
const Leaderboard = require("../models/Leaderboard");
const AdminUser = require("../models/AdminUser");
const User = require("../models/User");
const Bet = require("../models/Bet");

const JWT_SECRET = process.env.JWT_SECRET;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");


// Middleware to verify token
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

// POST /api/admin/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const admin = await AdminUser.findOne({ username });

  if (!admin) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "2h" });
  res.json({ token });
});

// View all user history
router.get("/history", async (req, res) => {
  const history = await UserHistory.find().sort({ timestamp: -1 }).limit(100);
  res.json(history);
});

// Withdraw funds from contract
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

// Pause or unpause game
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

// PATCH /api/admin/update
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
// GET /api/admin/kpis
router.get("/kpis", async (req, res) => {
  try {
    // Optional: protect this route with JWT middleware

    const [totalUsers, totalBets, totalVolumeResult] = await Promise.all([
      User.countDocuments(),
      Bet.countDocuments(),
      Bet.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
    ]);

    const totalVolume = totalVolumeResult[0]?.total || 0;

    res.json({
      totalUsers,
      totalBets,
      totalVolume: parseFloat(totalVolume.toFixed(2)) // assuming amount is number
    });
  } catch (err) {
    console.error("KPI Error:", err);
    res.status(500).json({ error: "Failed to fetch KPIs" });
  }
});

// GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalBanned = await User.countDocuments({ banned: true });
    const totalBets = await Bet.countDocuments();
    const totalVolumeAgg = await Bet.aggregate([
      { $group: { _id: null, volume: { $sum: "$amount" } } },
    ]);
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

module.exports = router;
