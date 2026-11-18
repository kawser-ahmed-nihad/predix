const { z } = require("zod");
const { prisma } = require("../Prisma/Db");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");
const { syncMatches, ensureMarkets } = require("../lib/services/matchSync");

const createMatchBody = z.object({
  sport: z.enum(["cricket", "football"]).default("cricket"),
  tournament: z.string().max(100).optional(),
  teamA: z.string().min(1).max(60),
  teamB: z.string().min(1).max(60),
  teamALogo: z.string().url().optional(),
  teamBLogo: z.string().url().optional(),
  startTime: z.coerce.date(),
});

const createMarketBody = z.object({
  type: z.enum([
    "TOSS",
    "WINNER",
    "TOP_SCORER",
    "OVER_UNDER",
    "NEXT_OVER_BOUNDARY",
  ]),
  question: z.string().min(3).max(200),
  options: z.array(z.string().min(1).max(60)).min(2).max(20),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("EASY"),
  reward: z.number().int().min(1).max(1000),
  locksAt: z.coerce.date(),
});

const resolveBody = z.object({ result: z.string().min(1).max(60) });

async function adminRoutes(app) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);

  // POST /admin/sync  -> run the cricket API sync right now (uses 1 API hit)
  app.post("/sync", async (req, reply) => {
    try {
      return await syncMatches(req.log);
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
  });

  // POST /admin/matches  -> create a match by hand (football, or API backup)
  app.post("/matches", async (req, reply) => {
    const b = createMatchBody.safeParse(req.body);
    if (!b.success) {
      return reply.code(400).send({ error: "bad_request", details: b.error.issues });
    }
    const match = await prisma.match.create({ data: b.data });
    await ensureMarkets(match);
    return { id: match.id };
  });

  // POST /admin/matches/:id/markets  -> add TOP_SCORER, OVER_UNDER, ...
  app.post("/matches/:id/markets", async (req, reply) => {
    const matchId = Number(req.params.id);
    const b = createMarketBody.safeParse(req.body);
    if (!Number.isInteger(matchId) || !b.success) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return reply.code(404).send({ error: "match_not_found" });

    try {
      const mk = await prisma.market.create({ data: { matchId, ...b.data } });
      return { id: mk.id };
    } catch (e) {
      if (e.code === "P2002") {
        return reply.code(409).send({ error: "market_type_exists_for_match" });
      }
      throw e;
    }
  });

  // POST /admin/markets/:id/resolve  { result }
  // Prediction payout happens in step 5 (settlement worker).
  app.post("/markets/:id/resolve", async (req, reply) => {
    const id = Number(req.params.id);
    const b = resolveBody.safeParse(req.body);
    if (!Number.isInteger(id) || !b.success) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const mk = await prisma.market.findUnique({ where: { id } });
    if (!mk) return reply.code(404).send({ error: "not_found" });
    if (!["OPEN", "LOCKED"].includes(mk.status)) {
      return reply.code(409).send({ error: "already_" + mk.status.toLowerCase() });
    }
    const options = Array.isArray(mk.options) ? mk.options : [];
    if (!options.includes(b.data.result)) {
      return reply.code(400).send({ error: "result_not_in_options", options });
    }
    await prisma.market.update({
      where: { id },
      data: { status: "RESOLVED", result: b.data.result },
    });
    return { ok: true };
  });

  // POST /admin/matches/:id/cancel  -> cancel match, markets get refunded in step 5
  app.post("/matches/:id/cancel", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });
    await prisma.$transaction([
      prisma.match.update({ where: { id }, data: { status: "CANCELLED" } }),
      prisma.market.updateMany({
        where: { matchId: id, status: { in: ["OPEN", "LOCKED"] } },
        data: { status: "CANCELLED" },
      }),
    ]);
    return { ok: true };
  });
}

module.exports = { adminRoutes };