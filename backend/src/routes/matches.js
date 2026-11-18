const { prisma } = require("../Prisma/Db");
const { authenticate } = require("../middleware/authMiddleware");

const STATUS = {
  live: ["LIVE"],
  upcoming: ["UPCOMING"],
  finished: ["FINISHED", "CANCELLED"],
};

async function matchesRoutes(app) {
  app.addHook("preHandler", authenticate);

  // GET /matches?status=live|upcoming|finished&sport=cricket
  app.get("/", async (req, reply) => {
    const key = String(req.query.status || "upcoming").toLowerCase();
    const statuses = STATUS[key];
    if (!statuses) return reply.code(400).send({ error: "bad_status" });

    const now = new Date();
    const where = { status: { in: statuses } };
    if (req.query.sport) where.sport = String(req.query.sport);
    if (key === "finished") {
      where.startTime = { gte: new Date(now.getTime() - 3 * 24 * 3600 * 1000) };
    }

    const rows = await prisma.match.findMany({
      where,
      orderBy: { startTime: key === "finished" ? "desc" : "asc" },
      take: 30,
      include: { markets: { select: { status: true, locksAt: true } } },
    });

    return {
      now, // send server time so the app can draw an accurate countdown
      items: rows.map((m) => {
        const open = m.markets.filter(
          (x) => x.status === "OPEN" && x.locksAt > now
        );
        const nextLockAt = open.length
          ? new Date(Math.min(...open.map((x) => x.locksAt.getTime())))
          : null;
        return {
          id: m.id,
          sport: m.sport,
          tournament: m.tournament,
          teamA: m.teamA,
          teamB: m.teamB,
          teamALogo: m.teamALogo,
          teamBLogo: m.teamBLogo,
          startTime: m.startTime,
          status: m.status,
          winner: m.winner,
          openMarkets: open.length,
          nextLockAt,
        };
      }),
    };
  });

  // GET /matches/:id  -> match + markets + the current user's predictions
  app.get("/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });

    const now = new Date();
    const m = await prisma.match.findUnique({
      where: { id },
      include: {
        markets: {
          orderBy: { id: "asc" },
          include: {
            predictions: {
              where: { userId: req.user.uid },
              select: { choice: true, status: true, reward: true, isFree: true },
            },
          },
        },
      },
    });
    if (!m) return reply.code(404).send({ error: "not_found" });

    return {
      now,
      match: {
        id: m.id,
        sport: m.sport,
        tournament: m.tournament,
        teamA: m.teamA,
        teamB: m.teamB,
        teamALogo: m.teamALogo,
        teamBLogo: m.teamBLogo,
        startTime: m.startTime,
        status: m.status,
        winner: m.winner,
      },
      markets: m.markets.map((mk) => ({
        id: mk.id,
        type: mk.type,
        question: mk.question,
        options: mk.options,
        difficulty: mk.difficulty,
        reward: mk.reward,
        locksAt: mk.locksAt,
        status: mk.status,
        isOpen: mk.status === "OPEN" && mk.locksAt > now,
        result: mk.result,
        myPrediction: mk.predictions[0] || null,
      })),
    };
  });
}

module.exports = { matchesRoutes };