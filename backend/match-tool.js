// Helper for testing: add / list / resolve / cancel matches straight in the database.
// Put this file in backend/ (next to package.json) and run it from there.
//
//   node match-tool.js add "Bangladesh" "India" 120     (match starts in 120 minutes)
//   node match-tool.js list
//   node match-tool.js resolve <marketId> "Bangladesh"  (give the winning option)
//   node match-tool.js cancel <matchId>                 (markets cancelled, points refunded)
//   node match-tool.js sync                             (fetch real matches from the cricket API now)
//
// It uses DATABASE_URL from backend/.env, so that must be the SAME database Render uses.

require("dotenv").config();
const { prisma } = require("./src/lib/prisma");
const { ensureMarkets, syncMatches } = require("./src/services/matchSync");

async function add(teamA, teamB, minutes) {
  if (!teamA || !teamB) throw new Error('usage: add "TeamA" "TeamB" [minutesFromNow]');
  const mins = Number(minutes || 120);
  if (mins < 60) {
    console.log("note: the TOSS question locks 45 minutes before the start, so use 60+ minutes to see it open.");
  }
  const match = await prisma.match.create({
    data: {
      sport: "cricket",
      tournament: "টেস্ট ম্যাচ",
      teamA,
      teamB,
      startTime: new Date(Date.now() + mins * 60 * 1000),
    },
  });
  await ensureMarkets(match);
  const markets = await prisma.market.findMany({ where: { matchId: match.id } });
  console.log(`match #${match.id} created: ${teamA} vs ${teamB}, starts ${match.startTime.toISOString()}`);
  for (const m of markets) console.log(`  market #${m.id} ${m.type} -> options: ${JSON.stringify(m.options)}`);
}

async function list() {
  const matches = await prisma.match.findMany({
    orderBy: { id: "desc" },
    take: 10,
    include: { markets: true },
  });
  if (matches.length === 0) console.log("no matches yet");
  for (const m of matches) {
    console.log(`match #${m.id} ${m.teamA} vs ${m.teamB} [${m.status}] ${m.startTime.toISOString()}`);
    for (const k of m.markets) {
      console.log(`  market #${k.id} ${k.type} [${k.status}] options=${JSON.stringify(k.options)} result=${k.result ?? "-"}`);
    }
  }
}

async function resolve(marketId, result) {
  const id = Number(marketId);
  if (!id || !result) throw new Error('usage: resolve <marketId> "winning option"');
  const mk = await prisma.market.findUnique({ where: { id } });
  if (!mk) throw new Error("market not found");
  if (!["OPEN", "LOCKED"].includes(mk.status)) throw new Error(`market is already ${mk.status}`);
  const options = Array.isArray(mk.options) ? mk.options : [];
  if (!options.includes(result)) {
    throw new Error(`result must be exactly one of: ${JSON.stringify(options)}`);
  }
  await prisma.market.update({ where: { id }, data: { status: "RESOLVED", result } });
  if (mk.type === "WINNER") {
    await prisma.match.update({
      where: { id: mk.matchId },
      data: { status: "FINISHED", winner: result },
    });
  }
  console.log(`market #${id} resolved: ${result}. The server pays winners within about a minute.`);
}

async function cancel(matchId) {
  const id = Number(matchId);
  if (!id) throw new Error("usage: cancel <matchId>");
  await prisma.$transaction([
    prisma.match.update({ where: { id }, data: { status: "CANCELLED" } }),
    prisma.market.updateMany({
      where: { matchId: id, status: { in: ["OPEN", "LOCKED"] } },
      data: { status: "CANCELLED" },
    }),
  ]);
  console.log(`match #${id} cancelled. Predictions get refunded within about a minute.`);
}

(async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  try {
    if (cmd === "add") await add(a, b, c);
    else if (cmd === "list") await list();
    else if (cmd === "resolve") await resolve(a, b);
    else if (cmd === "cancel") await cancel(a);
    else if (cmd === "sync") console.log(await syncMatches());
    else console.log("commands: add | list | resolve | cancel | sync (see the top of this file)");
  } catch (e) {
    console.error("error:", e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();