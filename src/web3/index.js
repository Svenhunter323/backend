// web3Listeners.js
require("dotenv").config();
const { ethers, formatUnits } = require("ethers");

const wavePoolAbi = require("../abi/WavePrizePool.json").abi;
const waveChallengeAbi = require("../abi/WaveChallengeFlip.json").abi;

const User = require("../models/User");
const Bet = require("../models/Bet");
const UserHistory = require("../models/UserHistory");
const Leaderboard = require("../models/Leaderboard");

const {
  broadcastLeaderboardUpdate,
  broadcastLiveHistory,
  broadcastBetPlaced,
} = require("../socket");

// Live analytics hooks (debounced)
const { scheduleRecomputeAndBroadcast, onNewHistoryRow } = require("../lib/analytics");

const DECIMALS = Number(process.env.TOKEN_DECIMALS || 18);

/* ------------------------- tiny utils (robust) ------------------------- */

const normalizeAddr = (a) => String(a || "").toLowerCase();

const toStrBig = (v) => {
  try {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
    if (typeof v === "string") return v;
    if (v && typeof v.toString === "function") return v.toString();
    return "0";
  } catch {
    return "0";
  }
};

const toReadable = (v) => {
  try {
    if (typeof v === "bigint") return formatUnits(v, DECIMALS);
    const s = toStrBig(v);
    return formatUnits(BigInt(s), DECIMALS);
  } catch {
    return "0";
  }
};

// Always return a finite Number for $inc (fallback to 0)
function toIncNumber(v) {
  try {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "bigint") {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    const s = toStrBig(v);
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Convert to plain Number for UI broadcast (non-fatal if not finite)
function toNumberOr0(v) {
  try {
    const s = toStrBig(v);
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// timestamp to ms if needed
const tsMs = (t) => {
  const n = Number(t || 0);
  return n < 1e12 ? n * 1000 : n;
};

/* ---------------------------------------------------------------------- */

function initWeb3Listeners() {
  const url = process.env.WS_RPC_URL;
  if (!url) throw new Error("WS_RPC_URL missing");

  let provider = new ethers.WebSocketProvider(url, "sepolia");

  function attach() {
    const wavePool = new ethers.Contract(process.env.WAVE_POOL_ADDR, wavePoolAbi, provider);
    const waveChallenge = new ethers.Contract(process.env.WAVE_CHALLENGE_ADDR, waveChallengeAbi, provider);

    // Emit a row that matches the Bets admin page
    async function emitBetRow({ address, gameType, xpAmount, reward, result, timestamp }) {
      const wallet = normalizeAddr(address);
      const user = await User.findOne({ wallet }, { username: 1 }).lean();

      const amountNum = toNumberOr0(xpAmount);
      const payoutNum = toNumberOr0(reward);
      const resultStr = (result === true) ? "win" : (result === false) ? "loss" : "pending";

      broadcastBetPlaced({
        username: user?.username || wallet,
        gameType,
        amount: amountNum,
        result: resultStr,
        payout: payoutNum || undefined,
        timestamp: tsMs(timestamp),
        multiplier: (amountNum > 0 && payoutNum > 0)
          ? Number((payoutNum / amountNum).toFixed(2))
          : null,
      });
    }

    // Safe winner handler (no NaN increments)
    async function handleWinner({ gameType, winner, reward, xpAmount, timestamp }) {
      // ensure defined
      const incReward = toIncNumber(reward);
      const incXP = toIncNumber(xpAmount);

      // persist history (stringify bigs)
      await UserHistory.create({
        address: winner,
        gameType,
        result: true,
        reward: toStrBig(reward),
        xpAmount: toStrBig(xpAmount),
        timestamp: Number(timestamp),
      });

      // leaderboard increments (never NaN)
      try {
        await Leaderboard.findOneAndUpdate(
          { address: winner },
          {
            $inc: {
              wins: 1,
              totalReward: incReward,
              totalXP: incXP,
            },
          },
          { upsert: true }
        );
      } catch (e) {
        console.error("❌ Leaderboard increment failed (guarded):", e?.message || e);
      }

      await broadcastLeaderboardUpdate();
      await broadcastLiveHistory({
        gameType,
        winner,
        reward: toStrBig(reward),
        xpAmount: toStrBig(xpAmount),
        timestamp: Number(timestamp),
      });

      // also emit a settled row to Bets feed
      await emitBetRow({
        address: winner,
        gameType,
        xpAmount: toStrBig(xpAmount),
        reward: toStrBig(reward),
        result: true,
        timestamp,
      });

      // analytics recompute (debounced)
      onNewHistoryRow();
    }

    async function getBlockTimestampFromTx(txHash) {
      const rcpt = await provider.getTransactionReceipt(txHash);
      const block = await provider.getBlock(rcpt.blockNumber);
      return Number(block.timestamp);
    }

    /* ======================= WAVE CHALLENGE ======================= */

    waveChallenge.on("ChallengeCreated", async (challengeId, creator, xpAmount, event) => {
      try {
        const creatorAddr = normalizeAddr(creator);
        await User.findOneAndUpdate(
          { wallet: creatorAddr },
          { username: creatorAddr, wallet: creatorAddr },
          { upsert: true, new: true }
        );

        const existing = await Bet.findOne({ challengeId: String(challengeId), role: "creator" });
        if (!existing) {
          await Bet.create({
            userId: (await User.findOne({ wallet: creatorAddr }))._id,
            username: creatorAddr,
            gameType: "challenge",
            amount: toStrBig(xpAmount),
            result: null,
            payout: "0",
            txHash: event?.log?.transactionHash || null,
            role: "creator",
            challengeId: String(challengeId),
          });
        }

        const rcpt = await provider.getTransactionReceipt(event.log.transactionHash);
        const block = await provider.getBlock(rcpt.blockNumber);
        await emitBetRow({
          address: creatorAddr,
          gameType: "challenge",
          xpAmount: toStrBig(xpAmount),
          reward: "0",
          result: null,
          timestamp: block.timestamp,
        });

        scheduleRecomputeAndBroadcast();
      } catch (err) {
        console.error("❌ ChallengeCreated error:", err);
      }
    });

    waveChallenge.on("EnteredChallenge", async (challengeId, userAddr, xpAmount, event) => {
      try {
        const addr = normalizeAddr(userAddr);
        await User.findOneAndUpdate(
          { wallet: addr },
          { username: addr, wallet: addr },
          { upsert: true, new: true }
        );

        const existing = await Bet.findOne({ challengeId: String(challengeId), role: "challenger" });
        if (!existing) {
          await Bet.create({
            userId: (await User.findOne({ wallet: addr }))._id,
            username: addr,
            gameType: "challenge",
            amount: toStrBig(xpAmount),
            result: null,
            payout: "0",
            txHash: event?.log?.transactionHash || null,
            role: "challenger",
            challengeId: String(challengeId),
          });
        }

        const rcpt = await provider.getTransactionReceipt(event.log.transactionHash);
        const block = await provider.getBlock(rcpt.blockNumber);
        await emitBetRow({
          address: addr,
          gameType: "challenge",
          xpAmount: toStrBig(xpAmount),
          reward: "0",
          result: null,
          timestamp: block.timestamp,
        });

        scheduleRecomputeAndBroadcast();
      } catch (err) {
        console.error("❌ EnteredChallenge error:", err);
      }
    });

    waveChallenge.on(
      "WinnerDrawn",
      async (challengeId, p1, p2, wager, _resultFromEvent, winner, time, reward, _event) => {
        try {
          const challengeIdStr = String(challengeId);
          const winnerAddr = normalizeAddr(winner);

          await User.findOneAndUpdate(
            { wallet: winnerAddr },
            { username: winnerAddr, wallet: winnerAddr },
            { upsert: true, new: true }
          );

          const bets = await Bet.find({ challengeId: challengeIdStr });
          if (bets.length) {
            await Promise.all(
              bets.map(async (bet) => {
                const isWinner = normalizeAddr(bet.username) === winnerAddr;
                bet.result = isWinner;
                bet.payout = isWinner ? toStrBig(reward) : "0";
                await bet.save();
              })
            );
          }

          // ensure xpAmount defaults to 0n if somehow undefined
          await handleWinner({
            gameType: "challenge",
            winner: winnerAddr,
            reward,
            xpAmount: (typeof wager === "bigint" || typeof wager === "number" || typeof wager === "string")
              ? wager
              : 0n,
            timestamp: time, // on-chain timestamp
          });

          console.log(`✅ Challenge WinnerDrawn handled: ${winnerAddr}`);
        } catch (err) {
          console.error("❌ Error handling WinnerDrawn:", err);
        }
      }
    );

    /* ========================= WAVE POOL ========================= */

    wavePool.on("PoolCreated", async (poolId, baseToken, limitAmount, ticketPrice, poolType) => {
      try {
        await broadcastLiveHistory({
          type: "pool_created",
          data: {
            poolId: String(poolId),
            baseToken: normalizeAddr(baseToken),
            limitAmount: toStrBig(limitAmount),
            ticketPrice: toStrBig(ticketPrice),
            poolType: !!poolType,
          },
        });
        scheduleRecomputeAndBroadcast();
      } catch (err) {
        console.error("❌ PoolCreated error:", err);
      }
    });

    wavePool.on("EnteredPool", async (poolId, userAddr, xpAmount, event) => {
      const poolIdStr = String(poolId);
      const addr = normalizeAddr(userAddr);
      try {
        await User.findOneAndUpdate(
          { wallet: addr },
          { username: addr, wallet: addr },
          { upsert: true, new: true }
        );

        await Bet.create({
          userId: (await User.findOne({ wallet: addr }))._id,
          username: addr,
          gameType: "pool",
          amount: toStrBig(xpAmount),
          result: null,
          payout: "0",
          txHash: event?.log?.transactionHash || null,
          role: "entrant",
          challengeId: poolIdStr,
        });

        const rcpt = await provider.getTransactionReceipt(event.log.transactionHash);
        const block = await provider.getBlock(rcpt.blockNumber);
        await emitBetRow({
          address: addr,
          gameType: "pool",
          xpAmount: toStrBig(xpAmount),
          reward: "0",
          result: null,
          timestamp: block.timestamp,
        });

        scheduleRecomputeAndBroadcast();
      } catch (err) {
        console.error("❌ EnteredPool error:", err);
      }
    });

    wavePool.on("WinnerDrawn", async (poolId, winnerAddr, rewardAmount, poolType, event) => {
      const poolIdStr = String(poolId);
      const winner = normalizeAddr(winnerAddr);
      try {
        await User.findOneAndUpdate(
          { wallet: winner },
          { username: winner, wallet: winner },
          { upsert: true, new: true }
        );

        // pessimistic: mark all as lost; (optional) later match exact winning entry
        const bets = await Bet.find({ challengeId: poolIdStr });
        for (const bet of bets) {
          bet.result = false;
          bet.payout = "0";
        }
        await Promise.all(bets.map((b) => b.save()));

        const block = await provider.getBlock(event.log.blockNumber);

        await handleWinner({
          gameType: "pool",
          winner,
          reward: rewardAmount,
          xpAmount: 0n, // unknown here → default to 0 to avoid NaN
          timestamp: block.timestamp,
        });

        console.log(`✅ Pool WinnerDrawn handled: ${winner}`);
      } catch (err) {
        console.error("❌ Pool WinnerDrawn error:", err);
      }
    });

    wavePool.on("PayoutClaimed", async (poolId, winner, amount, event) => {
      try {
        const block = await provider.getBlock(event.log.blockNumber);
        await broadcastLiveHistory({
          type: "payout_claimed",
          data: {
            gameType: "pool",
            poolId: String(poolId),
            winner: normalizeAddr(winner),
            amount: toStrBig(amount),
            timestamp: block.timestamp,
          },
        });
        scheduleRecomputeAndBroadcast();
      } catch (err) {
        console.error("❌ PayoutClaimed handler error:", err);
      }
    });
  }

  // attach + reconnect
  attach();

  provider._websocket?.on("error", (err) => {
    console.error("WS provider error:", err?.message || err);
  });
  provider._websocket?.on("close", () => {
    console.warn("WS provider closed. Reconnecting in 2s…");
    setTimeout(() => {
      provider = new ethers.WebSocketProvider(url, "sepolia");
      attach();
    }, 2000);
  });
}

module.exports = initWeb3Listeners;
