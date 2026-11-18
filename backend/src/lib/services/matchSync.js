const { prisma } = require("../../Prisma/Db");
const { fetchMatches, fetchMatchInfo } = require("../cricketApi");

const MIN = 60 * 1000;

// ---------- helpers ----------

// CricAPI returns dateTimeGMT without a "Z" suffix, so add it.
function parseGmt(s) {
  if (!s) return null;
  const iso = /Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapStatus(m) {
  const text = String(m.status || "").toLowerCase();
  if (/(abandon|no result|cancel|called off)/.test(text)) return "CANCELLED";
  if (m.matchEnded) return "FINISHED";
  if (m.matchStarted) return "LIVE";
  return "UPCOMING";
}

function tournamentName(m) {
  // "India vs Australia, 1st T20I"  ->  "1st T20I"
  const part = String(m.name || "").split(",").slice(1).join(",").trim();
  return part || (m.matchType ? String(m.matchType).toUpperCase() : null);
}

// Finals / play-offs often have "Tbc vs Tbc" until the teams are known.
const isPlaceholder = (name) => /^(tbc|tbd|to be (confirmed|decided))\b/i.test(String(name || "").trim());

// "Bangladesh won by 5 wickets"  ->  "Bangladesh"
function winnerFromStatus(m) {
  const s = String(m.status || "").toLowerCase();
  return (m.teams || []).find((t) => s.startsWith(`${String(t).toLowerCase()} won`)) || null;
}

// Find the market option that equals `value` (ignoring upper/lower case).
function matchOption(options, value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  return options.find((o) => String(o).trim().toLowerCase() === v) || null;
}

// match_info costs one API hit, so it is cached and tried at most 3 times
// per match and state (live / finished).
const infoCache = new Map();
async function getInfo(match) {
  if (!match.externalId) return null; // hand-made match, no API data
  const key = `${match.id}:${match.status}`;
  const c = infoCache.get(key) || { info: null, tries: 0 };
  if (c.info) return c.info;
  if (c.tries >= 3) return null;
  c.tries++;
  infoCache.set(key, c);
  try {
    c.info = await fetchMatchInfo(match.externalId);
  } catch (e) {
    console.warn(`[sync] match_info failed for match ${match.id}: ${e.message}`);
  }
  return c.info;
}

// ---------- market creation ----------

/**
 * Creates the default markets for a match (safe to call repeatedly).
 * cricket  -> TOSS + WINNER
 * football -> WINNER (with a Draw option)
 * Other market types (TOP_SCORER, OVER_UNDER ...) are added from the admin API.
 */
async function ensureMarkets(match) {
  const teams = [match.teamA, match.teamB];
  const rows = [];

  if (match.sport === "cricket") {
    rows.push({
      matchId: match.id,
      type: "TOSS",
      question: "টস কে জিতবে?",
      options: teams,
      difficulty: "EASY",
      reward: 5,
      // the toss happens ~30 min before start; lock earlier so nobody can
      // predict after it
      locksAt: new Date(match.startTime.getTime() - 45 * MIN),
    });
    rows.push({
      matchId: match.id,
      type: "WINNER",
      question: "ম্যাচ কে জিতবে?",
      options: teams,
      difficulty: "MEDIUM",
      reward: 10,
      locksAt: match.startTime,
    });
  } else {
    rows.push({
      matchId: match.id,
      type: "WINNER",
      question: "ম্যাচের ফলাফল কী হবে?",
      options: [match.teamA, "Draw", match.teamB],
      difficulty: "MEDIUM",
      reward: 10,
      locksAt: match.startTime,
    });
  }

  // @@unique([matchId, type]) makes this idempotent
  await prisma.market.createMany({ data: rows, skipDuplicates: true });
}

// ---------- settlement of markets (NOT predictions; that is step 5) ----------

async function resolveMarkets(match, apiMatch) {
  const open = { in: ["OPEN", "LOCKED"] };

  if (match.status === "CANCELLED") {
    await prisma.market.updateMany({
      where: { matchId: match.id, status: open },
      data: { status: "CANCELLED" },
    });
    return;
  }

  const markets = await prisma.market.findMany({
    where: { matchId: match.id, status: open },
  });

  for (const mk of markets) {
    const options = Array.isArray(mk.options) ? mk.options : [];
    let raw = null;
    let mustSettle = false; // true = if we have no valid result, cancel (refund)

    if (mk.type === "TOSS") {
      // the toss is known as soon as the match has started
      if (match.status !== "UPCOMING") {
        raw = apiMatch.tossWinner || (await getInfo(match))?.tossWinner || null;
      }
      mustSettle = match.status === "FINISHED";
    } else if (mk.type === "WINNER") {
      if (match.status === "FINISHED") {
        raw =
          apiMatch.matchWinner ||
          winnerFromStatus(apiMatch) ||
          (await getInfo(match))?.matchWinner ||
          null;
        mustSettle = true;
      }
    } else {
      continue; // other types are resolved manually by an admin
    }

    const result = matchOption(options, raw);

    if (result) {
      await prisma.market.update({
        where: { id: mk.id },
        data: { status: "RESOLVED", result },
      });
    } else if (mustSettle) {
      // tie / no result / name mismatch -> cancel so predictions get refunded
      console.warn(
        `[sync] market ${mk.id} (${mk.type}) cancelled: no valid result`,
        { raw, options, status: apiMatch.status }
      );
      await prisma.market.update({
        where: { id: mk.id },
        data: { status: "CANCELLED" },
      });
    }
  }
}

// ---------- main sync ----------

let running = false;

async function syncMatches(log = console) {
  if (running) return { skipped: true };
  running = true;
  try {
    const { matches, usedToday } = await fetchMatches(0);
    let created = 0;
    let updated = 0;
    let placeholders = 0;

    for (const m of matches) {
      const teams = m.teams;
      if (!Array.isArray(teams) || teams.length !== 2) continue;
      if (isPlaceholder(teams[0]) || isPlaceholder(teams[1])) {
        placeholders++;
        continue;
      }
      const startTime = parseGmt(m.dateTimeGMT);
      if (!startTime || !m.id) continue;

      const logoOf = (name) =>
        (m.teamInfo || []).find((t) => t.name === name)?.img || null;

      const status = mapStatus(m);
      const data = {
        sport: "cricket",
        tournament: tournamentName(m),
        teamA: teams[0],
        teamB: teams[1],
        teamALogo: logoOf(teams[0]),
        teamBLogo: logoOf(teams[1]),
        startTime,
        status,
        winner: m.matchWinner || winnerFromStatus(m) || null,
      };

      const existing = await prisma.match.findUnique({
        where: { externalId: String(m.id) },
      });

      let match;
      if (existing) {
        match = await prisma.match.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        // only create matches we can still take predictions on
        if (status !== "UPCOMING") continue;
        match = await prisma.match.create({
          data: { ...data, externalId: String(m.id) },
        });
        created++;
      }

      if (match.status === "UPCOMING") {
        await ensureMarkets(match);

        // reschedule: keep OPEN markets' lock times in step with the start time
        if (existing && existing.startTime.getTime() !== startTime.getTime()) {
          await prisma.market.updateMany({
            where: { matchId: match.id, status: "OPEN", type: "WINNER" },
            data: { locksAt: startTime },
          });
          await prisma.market.updateMany({
            where: { matchId: match.id, status: "OPEN", type: "TOSS" },
            data: { locksAt: new Date(startTime.getTime() - 45 * MIN) },
          });
        }
      }

      await resolveMarkets(match, m);
    }

    const stats = { fetched: matches.length, created, updated, placeholders, usedToday };
    log.info?.(stats, "match sync done");
    return stats;
  } finally {
    running = false;
  }
}

// Runs every minute: OPEN -> LOCKED once locksAt has passed.
// (The prediction API also checks locksAt on server time, this is for display.)
async function lockExpiredMarkets() {
  return prisma.market.updateMany({
    where: { status: "OPEN", locksAt: { lte: new Date() } },
    data: { status: "LOCKED" },
  });
}

module.exports = { syncMatches, lockExpiredMarkets, ensureMarkets };