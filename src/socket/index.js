// socket.js
const { Server } = require("socket.io");
const Leaderboard = require("../models/Leaderboard");

let io;
const connectedUsers = new Set();

function initSocket(server) {
  io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", async (socket) => {
    connectedUsers.add(socket.id);
    console.log("✅ Socket connected:", socket.id);

    try {
      const leaderboard = await fetchLeaderboard();
      socket.emit("leaderboardUpdate", leaderboard);
    } catch (e) {
      console.warn("Failed to send initial leaderboard:", e?.message || e);
    }

    // If you want per-user rooms for targeted emits (e.g., kick)
    const userId = socket.handshake.auth?.userId;
    if (userId) socket.join(`user:${userId}`);

    socket.on("disconnect", () => {
      connectedUsers.delete(socket.id);
      console.log("❌ Disconnected:", socket.id);
    });
  });
}

function getIO() {
  if (!io) throw new Error("Socket.io not initialized. Call initSocket(server) first.");
  return io;
}

// ---- Broadcast helpers ----
async function broadcastLeaderboardUpdate() {
  const leaderboard = await fetchLeaderboard();
  getIO().emit("leaderboardUpdate", leaderboard);
}

async function broadcastLiveHistory(payload) {
  getIO().emit("liveHistory", payload);
}

// For your Admin Bets page
function broadcastBetPlaced(row) {
  // row shape must match your React table
  // { username, gameType, amount, result: 'pending'|'win'|'loss', payout?, timestamp, multiplier? }
  getIO().emit("bet_placed", row);
}

// For your Admin Users page
function broadcastUsersUpdated() {
  getIO().emit("users_updated");
}

// Optional: kick a specific user by room
function broadcastKicked(userId) {
  getIO().to(`user:${userId}`).emit("kicked", { userId });
}

// NEW: live analytics push
function broadcastAnalyticsUpdate(payload) {
  getIO().emit("analytics_updated", payload);
}

// ---- Helpers ----
async function fetchLeaderboard() {
  return await Leaderboard.aggregate([
    {
      $group: {
        _id: "$address",
        wins: { $sum: "$wins" },
        totalXP: { $sum: "$totalXP" },
        totalReward: { $sum: "$totalReward" },
      },
    },
    { $sort: { wins: -1 } },
    { $limit: 50 },
  ]);
}

module.exports = {
  initSocket,
  getIO,
  broadcastLeaderboardUpdate,
  broadcastLiveHistory,
  broadcastBetPlaced,
  broadcastUsersUpdated,
  broadcastKicked,
  broadcastAnalyticsUpdate,
};
