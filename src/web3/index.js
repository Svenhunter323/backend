// web3Listeners.js
require("dotenv").config();
const { ethers, formatUnits } = require("ethers");

const wavePoolAbi = require("../abi/WavePrizePool.json").abi;
const waveChallengeAbi = require("../abi/WaveChallengeFlip.json").abi;

const User = require("../models/User");
const Bet = require("../models/Bet");
const UserHistory = require("../models/UserHistory");
const Leaderboard = require("../models/Leaderboard");
const { broadcastLeaderboardUpdate, broadcastLiveHistory } = require("../socket")();

const DECIMALS = Number(process.env.TOKEN_DECIMALS || 18);

function normalizeAddr(a) {
  return String(a || "").toLowerCase();
}
function toStrBig(v) {
  return typeof v === "bigint" ? v.toString() : String(v);
}
function toReadable(v) {
  return formatUnits(v, DECIMALS);
}

function initWeb3Listeners() {
  const url = process.env.WS_RPC_URL;
  if (!url) throw new Error("WS_RPC_URL missing");

  let provider = new ethers.WebSocketProvider(url, "sepolia");

  function attach() {
    const wavePool = new ethers.Contract(process.env.WAVE_POOL_ADDR, wavePoolAbi, provider);
    const waveChallenge = new ethers.Contract(process.env.WAVE_CHALLENGE_ADDR, waveChallengeAbi, provider);

    // -------------- Shared helpers --------------
    async function handleWinner({ gameType, winner, reward, xpAmount, timestamp }) {
      await UserHistory.create({
        address: winner,
        gameType,
        result: true,
        reward: toStrBig(reward),
        xpAmount: toStrBig(xpAmount),
        timestamp: Number(timestamp),
      });

      // If your totals may overflow JS Number, switch to Decimal128 in schema.
      await Leaderboard.findOneAndUpdate(
        { address: winner },
        {
          $inc: {
            wins: 1,
            totalReward: Number(toStrBig(reward)),
            totalXP: Number(toStrBig(xpAmount)),
          },
        },
        { upsert: true }
      );

      await broadcastLeaderboardUpdate();
      await broadcastLiveHistory({
        gameType,
        winner,
        reward: toStrBig(reward),
        xpAmount: toStrBig(xpAmount),
        timestamp: Number(timestamp),
      });
    }

    async function getBlockTimestampFromTx(txHash) {
      const rcpt = await provider.getTransactionReceipt(txHash);
      const block = await provider.getBlock(rcpt.blockNumber);
      return Number(block.timestamp);
    }

    // -------------- WAVE CHALLENGE (existing) --------------
    waveChallenge.on("ChallengeCreated", async (challengeId, creator, xpAmount, event) => {
      try {
        const creatorAddr = normalizeAddr(creator);

        const user = await User.findOneAndUpdate(
          { wallet: creatorAddr },
          { username: creatorAddr, wallet: creatorAddr },
          { upsert: true, new: true }
        );

        // Idempotent per role
        const existing = await Bet.findOne({ challengeId: String(challengeId), role: "creator" });
        if (!existing) {
          const bet = await Bet.create({
            userId: user._id,
            username: creatorAddr,
            gameType: "challenge",
            amount: toStrBig(xpAmount),
            result: null,
            payout: "0",
            txHash: event?.log?.transactionHash || null,
            role: "creator",
            challengeId: String(challengeId),
          });
          broadcastLiveHistory({ type: "new_bet", data: bet });
        }
      } catch (err) {
        console.error("❌ ChallengeCreated error:", err);
      }
    });

    waveChallenge.on("EnteredChallenge", async (challengeId, userAddr, xpAmount, event) => {
      try {
        const addr = normalizeAddr(userAddr);

        const user = await User.findOneAndUpdate(
          { wallet: addr },
          { username: addr, wallet: addr },
          { upsert: true, new: true }
        );

        const existing = await Bet.findOne({ challengeId: String(challengeId), role: "challenger" });
        if (!existing) {
          const bet = await Bet.create({
            userId: user._id,
            username: addr,
            gameType: "challenge",
            amount: toStrBig(xpAmount),
            result: null,
            payout: "0",
            txHash: event?.log?.transactionHash || null,
            role: "challenger",
            challengeId: String(challengeId),
          });
          broadcastLiveHistory({ type: "new_bet", data: bet });
        }
      } catch (err) {
        console.error("❌ EnteredChallenge error:", err);
      }
    });

    waveChallenge.on(
      "WinnerDrawn",
      async (challengeId, p1, p2, wager, resultFromEvent, winner, time, reward, event) => {
        try {
          const challengeIdStr = String(challengeId);
          const winnerAddr = normalizeAddr(winner);

          await User.findOneAndUpdate(
            { wallet: winnerAddr },
            { username: winnerAddr, wallet: winnerAddr },
            { upsert: true, new: true }
          );

          const bets = await Bet.find({ challengeId: challengeIdStr });
          if (!bets.length) {
            console.warn(`⚠️ No bets found for challengeId: ${challengeIdStr}`);
          } else {
            for (const bet of bets) {
              const isWinner = normalizeAddr(bet.username) === winnerAddr;
              bet.result = isWinner;
              bet.payout = isWinner ? toStrBig(reward) : "0";
              await bet.save();
            }
          }

          // Use on-chain "time" for this event (already emitted)
          await handleWinner({
            gameType: "challenge",
            winner: winnerAddr,
            reward,
            xpAmount: wager,
            timestamp: time,
          });

          console.log(`✅ Challenge WinnerDrawn handled: ${winnerAddr}`);
        } catch (err) {
          console.error("❌ Error handling WinnerDrawn:", err);
        }
      }
    );

    // -------------- WAVE POOL (new) --------------

    // PoolCreated(bytes32 poolId, address baseToken, uint256 limitAmount, uint256 ticketPrice, bool poolType)
    wavePool.on("PoolCreated", async (poolId, baseToken, limitAmount, ticketPrice, poolType) => {
      try {
        // Optional: broadcast to UI (no DB change needed)
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
      } catch (err) {
        console.error("❌ PoolCreated error:", err);
      }
    });

    // EnteredPool(bytes32 poolId, address user, uint256 xpAmount)
    wavePool.on("EnteredPool", async (poolId, userAddr, xpAmount, event) => {
      const poolIdStr = String(poolId);
      const addr = normalizeAddr(userAddr);
      try {
        const user = await User.findOneAndUpdate(
          { wallet: addr },
          { username: addr, wallet: addr },
          { upsert: true, new: true }
        );

        // Multiple entries allowed → one Bet per entry.
        const bet = await Bet.create({
          userId: user._id,
          username: addr,
          gameType: "pool",
          amount: toStrBig(xpAmount),
          result: null,
          payout: "0",
          txHash: event?.log?.transactionHash || null,
          role: "entrant",
          // Reuse existing field: store poolId here
          challengeId: poolIdStr,
        });

        broadcastLiveHistory({ type: "new_bet", data: bet });
      } catch (err) {
        console.error("❌ EnteredPool error:", err);
      }
    });

    // WinnerDrawn(bytes32 poolId, address winner, uint256 rewardAmount)
    wavePool.on("WinnerDrawn", async (poolId, winnerAddr, rewardAmount, event) => {
      const poolIdStr = String(poolId);
      const winner = normalizeAddr(winnerAddr);
      try {
        await User.findOneAndUpdate(
          { wallet: winner },
          { username: winner, wallet: winner },
          { upsert: true, new: true }
        );

        // 1) Mark all entries in the pool as lost by default
        const bets = await Bet.find({ challengeId: poolIdStr });
        for (const bet of bets) {
          bet.result = false;
          bet.payout = "0";
        }
        await Promise.all(bets.map((b) => b.save()));

        // 2) Resolve the single winning entry among winner's bets
        //    Use on-chain state to get winner snapshot (xpAmount, betTime)
        let winnerSnap;
        try {
          const res = await wavePool.getPoolState(poolId); // returns (totalXpAmount, users[], winner)
          // Ethers v6 returns both array indices and named props; prefer index access for safety.
          winnerSnap = res[2]; // winner
        } catch (e) {
          console.warn("⚠️ getPoolState failed, falling back to best-effort matching");
        }

        const winnerBets = await Bet.find({ challengeId: poolIdStr, username: winner });
        let chosen = null;

        if (winnerSnap) {
          const targetAmount = toStrBig(winnerSnap.rewardAmount) // not entry; rewardAmount!
          // We actually need the entry xpAmount & betTime from winnerSnap:
          const entryXpAmount = toStrBig(winnerSnap.xpAmount);
          const entryBetTime = Number(winnerSnap.betTime);

          // Match by (amount == entryXpAmount) and nearest tx timestamp to entryBetTime
          let bestDiff = Number.POSITIVE_INFINITY;
          for (const b of winnerBets) {
            if (toStrBig(b.amount) !== entryXpAmount) continue;
            if (!b.txHash) continue;
            try {
              const ts = await getBlockTimestampFromTx(b.txHash);
              const diff = Math.abs(ts - entryBetTime);
              if (diff < bestDiff) {
                bestDiff = diff;
                chosen = b;
              }
            } catch {
              // ignore and continue
            }
          }
        }

        // If not found (fallback): pick the most recent winner bet
        if (!chosen && winnerBets.length) {
          chosen = winnerBets[winnerBets.length - 1];
        }

        if (chosen) {
          chosen.result = true;
          chosen.payout = toStrBig(rewardAmount);
          await chosen.save();
        } else {
          console.warn(`⚠️ No matching winner Bet found for poolId=${poolIdStr}, winner=${winner}; (DB still updated via history/leaderboard)`);
        }

        // 3) Broadcast + history/leaderboard
        //    Use event block time for timestamp
        const block = await provider.getBlock(event.log.blockNumber);
        // For leaderboard XP, we count the winner’s own stake (entry xpAmount) if available; otherwise 0
        const xpForLb = winnerSnap ? winnerSnap.xpAmount : 0n;

        await handleWinner({
          gameType: "pool",
          winner,
          reward: rewardAmount,
          xpAmount: xpForLb,
          timestamp: block.timestamp,
        });

        console.log(`✅ Pool WinnerDrawn handled: ${winner}`);
      } catch (err) {
        console.error("❌ Pool WinnerDrawn error:", err);
      }
    });

    // PayoutClaimed(bytes32 poolId, address winner, uint256 amount)
    wavePool.on("PayoutClaimed", async (poolId, winnerAddr, amount, event) => {
      try {
        await broadcastLiveHistory({
          type: "payout_claimed",
          data: {
            gameType: "pool",
            poolId: String(poolId),
            winner: normalizeAddr(winnerAddr),
            amount: toStrBig(amount),
            timestamp: (await provider.getBlock(event.log.blockNumber)).timestamp,
          },
        });
      } catch (err) {
        console.error("❌ PayoutClaimed handler error:", err);
      }
    });

    // (Optional) You can listen to PlayStarted / PoolDrawRequested / RequestFulfilled similarly and broadcast to UI.
  }

  // Initial attach
  attach();

  // Reconnect logic
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
