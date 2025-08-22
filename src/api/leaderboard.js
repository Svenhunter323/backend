const express = require("express");
const router = express.Router();
const Leaderboard = require("../models/Leaderboard");
const User = require("../models/User");

// POST /api/leaderboard - Get leaderboard data by game type
router.post("/", async (req, res) => {
  try {
    const { gameType, poolType, page = 1, limit = 10 } = req.body;

    // Validate gameType parameter
    if (!gameType) {
      return res.status(400).json({
        success: false,
        message: "gameType is required (e.g., 'flip', 'prize_pool')"
      });
    }

    const skip = (page - 1) * limit;

    // Build match filter
    const matchFilter = { gameType };
    if (poolType !== undefined && poolType !== null) {
      matchFilter.poolType = poolType;
    }

    // Get leaderboard data with avatar using aggregation
    const leaderboardData = await Leaderboard.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'users',
          localField: 'address',
          foreignField: 'wallet',
          as: 'userInfo'
        }
      },
      {
        $addFields: {
          avatar: { $arrayElemAt: ['$userInfo.avatar', 0] },
          username: { $arrayElemAt: ['$userInfo.username', 0] }
        }
      },
      {
        $project: {
          address: 1,
          wins: 1,
          totalXP: 1,
          totalReward: 1,
          poolType: 1,
          gameType: 1,
          avatar: { $ifNull: ['$avatar', ''] },
          username: { $ifNull: ['$username', ''] }
        }
      },
      { $sort: { totalXP: -1, wins: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ]);

    // Get total count for pagination
    const totalCount = await Leaderboard.countDocuments(matchFilter);

    // Add rank to each entry
    const leaderboardWithRank = leaderboardData.map((entry, index) => ({
      ...entry,
      rank: skip + index + 1
    }));

    res.json({
      success: true,
      data: {
        leaderboard: leaderboardWithRank,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          hasNextPage: skip + limit < totalCount,
          hasPrevPage: page > 1
        },
        gameType
      }
    });

  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// POST /api/leaderboard/user - Get specific user's leaderboard position
router.post("/user", async (req, res) => {
  try {
    const { address, gameType, poolType } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: "User address is required"
      });
    }

    if (!gameType) {
      return res.status(400).json({
        success: false,
        message: "gameType is required (e.g., 'flip', 'prize_pool')"
      });
    }

    // Build match filter
    const matchFilter = { address, gameType };
    if (poolType !== undefined && poolType !== null) {
      matchFilter.poolType = poolType;
    }

    // Find user's data with avatar using aggregation
    const userDataResult = await Leaderboard.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'users',
          localField: 'address',
          foreignField: 'wallet',
          as: 'userInfo'
        }
      },
      {
        $addFields: {
          avatar: { $arrayElemAt: ['$userInfo.avatar', 0] },
          username: { $arrayElemAt: ['$userInfo.username', 0] }
        }
      },
      {
        $project: {
          address: 1,
          wins: 1,
          totalXP: 1,
          totalReward: 1,
          poolType: 1,
          gameType: 1,
          avatar: { $ifNull: ['$avatar', ''] },
          username: { $ifNull: ['$username', ''] }
        }
      }
    ]);

    if (!userDataResult.length) {
      return res.json({
        success: true,
        data: {
          user: null,
          rank: null,
          message: "User not found in leaderboard"
        }
      });
    }

    const userData = userDataResult[0];

    // Calculate user's rank
    const rankFilter = {
      gameType,
      $or: [
        { totalXP: { $gt: userData.totalXP } },
        { 
          totalXP: userData.totalXP,
          wins: { $gt: userData.wins }
        }
      ]
    };
    if (poolType !== undefined && poolType !== null) {
      rankFilter.poolType = poolType;
    }
    const rank = await Leaderboard.countDocuments(rankFilter) + 1;

    res.json({
      success: true,
      data: {
        user: {
          ...userData.toObject(),
          rank
        },
        gameType
      }
    });

  } catch (error) {
    console.error("Error fetching user leaderboard position:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// POST /api/leaderboard/top - Get top N users
router.post("/top", async (req, res) => {
  try {
    const { gameType, poolType, topCount = 10 } = req.body;

    if (!gameType) {
      return res.status(400).json({
        success: false,
        message: "gameType is required (e.g., 'flip', 'prize_pool')"
      });
    }

    // Build match filter
    const matchFilter = { gameType };
    if (poolType !== undefined && poolType !== null) {
      matchFilter.poolType = poolType;
    }

    // Get top users with avatar using aggregation
    const topUsers = await Leaderboard.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'users',
          localField: 'address',
          foreignField: 'wallet',
          as: 'userInfo'
        }
      },
      {
        $addFields: {
          avatar: { $arrayElemAt: ['$userInfo.avatar', 0] },
          username: { $arrayElemAt: ['$userInfo.username', 0] }
        }
      },
      {
        $project: {
          address: 1,
          wins: 1,
          totalXP: 1,
          totalReward: 1,
          poolType: 1,
          gameType: 1,
          avatar: { $ifNull: ['$avatar', ''] },
          username: { $ifNull: ['$username', ''] }
        }
      },
      { $sort: { totalXP: -1, wins: -1 } },
      { $limit: parseInt(topCount) }
    ]);

    // Add rank to each entry
    const topUsersWithRank = topUsers.map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));

    res.json({
      success: true,
      data: {
        topUsers: topUsersWithRank,
        gameType,
        count: topUsers.length
      }
    });

  } catch (error) {
    console.error("Error fetching top users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

module.exports = router;
