require("dotenv").config();
const { ethers } = require("ethers");

const waveFlipAbi = require("../abi/WaveFlip.json").abi;
const wavePoolAbi = require("../abi/WavePrizePool.json").abi;
const waveChallengeAbi = require("../abi/WaveChallengeFlip.json").abi;

const User = require("../models/User");
const Bet = require("../models/Bet");
const UserHistory = require("../models/UserHistory");
const Leaderboard = require("../models/Leaderboard");
const { broadcastLeaderboardUpdate, broadcastLiveHistory } = require("../socket")();

function initWeb3Listeners() {
  // ✅ Use WebSocketProvider instead of JsonRpcProvider
  const provider = new ethers.WebSocketProvider(process.env.WS_RPC_URL, "sepolia");

  const waveFlip = new ethers.Contract(process.env.WAVE_FLIP_ADDR, waveFlipAbi, provider);
  const wavePool = new ethers.Contract(process.env.WAVE_POOL_ADDR, wavePoolAbi, provider);
  const waveChallenge = new ethers.Contract(process.env.WAVE_CHALLENGE_ADDR, waveChallengeAbi, provider);

  // ✅ Leaderboard/History Update Helper
  async function handleWinner({ gameType, winner, reward, xpAmount, timestamp }) {
    await UserHistory.create({
      address: winner,
      gameType,
      result: true,
      reward: reward.toString(),
      xpAmount: xpAmount.toString(),
      timestamp: Number(timestamp)
    });

    await Leaderboard.findOneAndUpdate(
      { address: winner },
      {
        $inc: {
          wins: 1,
          totalReward: Number(reward),
          totalXP: Number(xpAmount)
        }
      },
      { upsert: true }
    );

    await broadcastLeaderboardUpdate();
    await broadcastLiveHistory({
      gameType,
      winner,
      reward: Number(reward),
      xpAmount: Number(xpAmount),
      timestamp: Number(timestamp)
    });
  }

  // ✅ ChallengeCreated
  waveChallenge.on("ChallengeCreated", async (challengeId, creator, xpAmount) => {
    try {
      const user = await User.findOneAndUpdate(
        { username: creator.toLowerCase() },
        { username: creator.toLowerCase(), wallet: creator.toLowerCase() },
        { upsert: true, new: true }
      );

      const bet = await Bet.create({
        userId: user._id,
        username: creator.toLowerCase(),
        gameType: "challenge",
        amount: Number(xpAmount),
        result: null,
        payout: 0,
        txHash: null,
        role: "creator",
        challengeId
      });

      broadcastLiveHistory({ type: "new_bet", data: bet });
    } catch (err) {
      console.error("❌ ChallengeCreated error:", err);
    }
  });

  // ✅ EnteredChallenge
  waveChallenge.on("EnteredChallenge", async (challengeId, userAddr, xpAmount) => {
    try {
      const user = await User.findOneAndUpdate(
        { username: userAddr.toLowerCase() },
        { username: userAddr.toLowerCase(), wallet: userAddr.toLowerCase() },
        { upsert: true, new: true }
      );

      const bet = await Bet.create({
        userId: user._id,
        username: userAddr.toLowerCase(),
        gameType: "challenge",
        amount: Number(xpAmount),
        result: null,
        payout: 0,
        txHash: null,
        role: "challenger",
        challengeId
      });

      broadcastLiveHistory({ type: "new_bet", data: bet });
    } catch (err) {
      console.error("❌ EnteredChallenge error:", err);
    }
  });

  // ✅ WinnerDrawn
  waveChallenge.on(
    "WinnerDrawn",
    async (challengeId, p1, p2, wager, result, winner, time, reward) => {
      try {
        const winnerAddr = winner.toLowerCase();
        const p1Addr = p1.toLowerCase();
        const p2Addr = p2.toLowerCase();

        await User.findOneAndUpdate(
          { username: winnerAddr },
          { username: winnerAddr, wallet: winnerAddr },
          { upsert: true, new: true }
        );

        const bets = await Bet.find({ challengeId });

        if (!bets.length) {
          console.warn(`⚠️ No bets found for challengeId: ${challengeId}`);
          return;
        }

        for (const bet of bets) {
          // const isWinner = bet.username.toLowerCase() === winnerAddr;
          // bet.result = isWinner;
          bet.result = result; // Use the event result directly
          bet.payout = isWinner ? Number(reward) : 0;
          await bet.save();
        }

        await handleWinner({
          gameType: "challenge",
          winner: winnerAddr,
          reward,
          xpAmount: wager,
          timestamp: time
        });

        console.log(`✅ Challenge WinnerDrawn handled: ${winnerAddr}`);
      } catch (err) {
        console.error("❌ Error handling WinnerDrawn:", err);
      }
    }
  );

  // OPTIONAL: waveFlip / wavePool if needed
}

module.exports = initWeb3Listeners;
