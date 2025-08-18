const express = require("express");
const router = express.Router();
const Bet = require("../models/Bet");
const User = require("../models/User");

module.exports = (io) => {
  // POST /api/bets
  router.post("/", async (req, res) => {
    try {
      const { username, gameType, amount, result, payout, txHash } = req.body;

      let user = await User.findOne({ username });
      if (!user) {
        user = await User.create({ username, wallet: username });
      }

      const bet = await Bet.create({
        userId: user._id,
        username,
        gameType,
        amount,
        result,
        payout,
        txHash
      });

      // Emit real-time bet event to all clients
      io.emit("new_bet", bet);
      res.status(201).json(bet);
    } catch (err) {
      console.error("Bet error:", err);
      res.status(500).json({ error: "Failed to create bet" });
    }
  });

  router.get("/winners", async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const gameType = req.query.gameType || null; // optional
      const fromDate = req.query.from || null;
      const toDate = req.query.to || null;

      // Base filter: only winners
      const filter = { result: true };

      if (gameType) {
        filter.gameType = gameType;
      }

      if (fromDate || toDate) {
        filter.createdAt = {};
        if (fromDate) filter.createdAt.$gte = new Date(fromDate);
        if (toDate) filter.createdAt.$lte = new Date(toDate);
      }

      const [winners, totalCount] = await Promise.all([
        Bet.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select("username amount payout gameType challengeId createdAt"), // only necessary fields
        Bet.countDocuments(filter)
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({ winners, totalPages });
    } catch (err) {
      console.error("❌ Error fetching winners:", err);
      res.status(500).json({ error: "Failed to fetch winners" });
    }
  });

  router.get("/gamehistory", async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;

      // Get unique challengeIds sorted by most recent
      const uniqueChallenges = await Bet.aggregate([
        {
          $match: {
            result: { $ne: null } // Only include bets where result is not null
          }
        },
        {
          $group: {
            _id: "$challengeId",
            createdAt: { $max: "$createdAt" },
          }
        },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit }
      ]);

      const challengeIds = uniqueChallenges.map(c => c._id);

      // Fetch all Bet documents for these challenges
      const bets = await Bet.find({ challengeId: { $in: challengeIds } }).lean();

      // Group by challengeId
      const grouped = {};
      for (const bet of bets) {
        if (!grouped[bet.challengeId]) {
          grouped[bet.challengeId] = {
            challengeId: bet.challengeId,
            amount: bet.amount,
            createdAt: bet.createdAt,
            result: bet.result,
          };
        }

        const betInfo = {
          username: bet.username,
          role: bet.role,
          payout: bet.payout,
        };

        if (bet.result) {
          grouped[bet.challengeId].winner = betInfo;
        } else {
          grouped[bet.challengeId].loser = betInfo;
        }
      }

      // Only include complete matches (has both winner and loser)
      const results = Object.values(grouped).filter(entry => entry.winner && entry.loser);

      console.log("Game history results:", results, "entries");

      // Note: total pages should reflect only the filtered challenges
      const totalComplete = await Bet.aggregate([
        {
          $group: {
            _id: "$challengeId",
            resultCount: { $sum: { $cond: [{ $ifNull: ["$result", false] }, 1, 0] } }
          }
        },
        {
          $match: { resultCount: { $gte: 1 } } // assuming 1 winner and 1 loser per challenge
        },
        {
          $count: "total"
        }
      ]);
      const total = totalComplete[0]?.total || 0;

      res.json({
        history: results,
        totalPages: Math.ceil(total / limit),
      });

    } catch (err) {
      console.error("Game history error:", err);
      res.status(500).json({ error: "Failed to fetch game history" });
    }
  });


  return router;
};