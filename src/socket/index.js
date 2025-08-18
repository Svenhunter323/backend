const { Server } = require("socket.io");
const Leaderboard = require("../models/Leaderboard");

const connectedUsers = new Set();

function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", async (socket) => {
    connectedUsers.add(socket.id);
    console.log("✅ Socket connected:", socket.id);

    const leaderboard = await fetchLeaderboard();
    socket.emit("leaderboardUpdate", leaderboard);

    socket.on("disconnect", () => {
      connectedUsers.delete(socket.id);
      console.log("❌ Disconnected:", socket.id);
    });
  });

  io.on("new_bet", (bet) => {
    console.log("📢 New bet placed:", bet);
    // Optional: update local state here if needed
  });

  // 📡 Emit to all connected clients
  async function broadcastLeaderboardUpdate() {
    const leaderboard = await fetchLeaderboard();
    // console.log("📡 Broadcasting leaderboard to", connectedUsers.size, "users");
    io.emit("leaderboardUpdate", leaderboard);
  }

  // 📡 Emit new history entry to all clients
  async function broadcastLiveHistory(data) {
    // console.log("📡 Broadcasting live history:", data);
    io.emit("liveHistory", data);
  }

  // Helper for DB aggregation
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

  // ✅ Return all broadcast methods
  return {
    // io,
    // broadcastLeaderboardUpdate,
    // broadcastLiveHistory,
  };
}

module.exports = initSocket;
