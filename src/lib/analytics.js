// lib/analytics.js
const UserHistory = require("../models/UserHistory");
const { broadcastAnalyticsUpdate } = require("../socket");

// ---------- constants / helpers ----------
const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const nowMs = () => Date.now();

// Max BSON Date range (ms since epoch) ≈ ±9.22e18
const MAX_BSON_DATE_MS = 9.22e18;
const MIN_BSON_DATE_MS = -MAX_BSON_DATE_MS;

let cache = { days: 7, data: null, at: 0 };
let debounceTimer = null;

/**
 * Safely convert a field to double with onError/onNull=0.
 * Usage: NUM("xpAmount")
 */
function NUM(field) {
  return {
    $let: {
      vars: { v: `$${field}` },
      in: {
        $cond: [
          { $in: [{ $type: "$$v" }, ["int", "long", "double", "decimal"]] },
          "$$v",
          {
            $convert: {
              input: "$$v",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
        ],
      },
    },
  };
}

/**
 * Base normalization stages:
 * - Convert timestamp (string/number/etc) -> tsRaw (double|null)
 * - Derive tsMs: if tsRaw < 1e12 treat as seconds (tsRaw*1000), else treat as ms
 * - Drop docs with null/invalid/out-of-range tsMs
 * - Prepare safe numeric fields (xpAmountNum, rewardNum)
 */
function baseNormalizeWindow(windowStartMs) {
  return [
    // Step 1: tsRaw as double or null
    {
      $addFields: {
        tsRaw: {
          $convert: {
            input: "$timestamp",
            to: "double",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    // Step 2: derive tsMs (seconds vs ms)
    {
      $addFields: {
        tsMs: {
          $switch: {
            branches: [
              {
                case: { $and: [{ $ne: ["$tsRaw", null] }, { $lt: ["$tsRaw", 1e12] }] },
                then: { $multiply: ["$tsRaw", 1000] },
              },
              {
                case: { $ne: ["$tsRaw", null] },
                then: "$tsRaw",
              },
            ],
            default: null,
          },
        },
      },
    },
    // Step 3: filter valid window + avoid BSON Date overflow
    {
      $match: {
        tsMs: {
          $ne: null,
          $gte: windowStartMs,
          $lte: MAX_BSON_DATE_MS,
          $gte: MIN_BSON_DATE_MS, // redundant with >= windowStart, but safe template
        },
      },
    },
    // Step 4: numeric fields
    {
      $addFields: {
        xpAmountNum: NUM("xpAmount"),
        rewardNum: NUM("reward"),
      },
    },
  ];
}

/**
 * Compute analytics for the last `days` days using UserHistory (winners).
 */
async function computeAnalytics(days = 7) {
  const now = nowMs();
  const windowStart = now - days * 86400000;

  // 1) Daily stats over window (count winners, sum xpAmountNum that won)
  const dailyAgg = await UserHistory.aggregate([
    ...baseNormalizeWindow(windowStart),
    {
      $project: {
        day: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$tsMs" } } },
        xpAmountNum: 1,
      },
    },
    {
      $group: {
        _id: "$day",
        wins: { $sum: 1 },
        volume: { $sum: "$xpAmountNum" },
      },
    },
    {
      $project: { _id: 0, date: "$_id", bets: "$wins", volume: 1 },
    },
    { $sort: { date: 1 } },
  ]);

  // Fill any missing days (for steady charts)
  const byDay = new Map(dailyAgg.map((d) => [d.date, d]));
  const filledDaily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    filledDaily.push(byDay.get(key) || { date: key, bets: 0, volume: 0 });
  }

  // 2) Game type distribution (winners over window)
  const gameAgg = await UserHistory.aggregate([
    ...baseNormalizeWindow(windowStart),
    { $group: { _id: "$gameType", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const gameTypes = gameAgg
    .filter((g) => g._id)
    .map((g) => ({
      name: g._id === "challenge" ? "Coin Flip" : g._id === "pool" ? "Prize Pool" : g._id,
      value: g.count,
      count: g.count,
    }));

  // 3) Lightweight growth (winners per month) for last 6 months
  const since6mo = new Date();
  since6mo.setMonth(since6mo.getMonth() - 5, 1);
  since6mo.setHours(0, 0, 0, 0);

  const growthAgg = await UserHistory.aggregate([
    ...baseNormalizeWindow(since6mo.getTime()),
    {
      $project: {
        ym: { $dateToString: { format: "%Y-%m", date: { $toDate: "$tsMs" } } },
        monthLabel: { $dateToString: { format: "%b", date: { $toDate: "$tsMs" } } },
      },
    },
    { $group: { _id: "$ym", month: { $first: "$monthLabel" }, users: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const growthMap = new Map(growthAgg.map((g) => [g._id, g]));
  const userGrowth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const label = d.toLocaleString("en-US", { month: "short" });
    const row = growthMap.get(ym) || { month: label, users: 0 };
    userGrowth.push({ month: row.month || label, users: row.users || 0 });
  }

  // 4) Live KPIs (today) — winners count
  const sod = new Date();
  sod.setHours(0, 0, 0, 0);

  const [betsTodayAgg, winsTodayAgg] = await Promise.all([
    UserHistory.aggregate([
      ...baseNormalizeWindow(sod.getTime()),
      { $count: "count" },
    ]),
    UserHistory.aggregate([
      ...baseNormalizeWindow(sod.getTime()),
      { $match: { result: true } },
      { $count: "count" },
    ]),
  ]);

  const winnersToday = winsTodayAgg[0]?.count || 0;
  const betsToday = betsTodayAgg[0]?.count || 0;
  const winRate = betsToday ? Number(((winnersToday / betsToday) * 100).toFixed(1)) : 0;

  return {
    dailyStats: filledDaily,
    gameTypes,
    userGrowth,
    live: { betsToday, winRate },
    computedAt: now,
    windowDays: days,
  };
}

async function getAnalytics(days = 7, maxAgeMs = 10_000) {
  if (cache.data && cache.days === days && nowMs() - cache.at < maxAgeMs) {
    return cache.data;
  }
  const data = await computeAnalytics(days);
  cache = { days, data, at: nowMs() };
  return data;
}

// Debounced recompute + broadcast
function scheduleRecomputeAndBroadcast(days = cache.days || 7) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const data = await computeAnalytics(days);
      cache = { days, data, at: nowMs() };
      broadcastAnalyticsUpdate(data);
    } catch (e) {
      console.error("[analytics] recompute error:", e);
    }
  }, 1500);
}

// Call when history changes (e.g., after winners)
function onNewHistoryRow() {
  scheduleRecomputeAndBroadcast();
}

module.exports = {
  getAnalytics,
  scheduleRecomputeAndBroadcast,
  onNewHistoryRow,
};
