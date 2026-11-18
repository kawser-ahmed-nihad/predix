const { z } = require("zod");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../Prisma/Db");
const { authenticate } = require("../middleware/authMiddleware");
const { getQuota } = require("../lib/quota");
const { completeReferralIfEligible } = require("../lib/referral");

class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const submitBody = z.object({
  marketId: z.number().int().positive(),
  choice: z.string().min(1).max(60),
});

async function predictionsRoutes(app) {
  app.addHook("preHandler", authenticate);

  // GET /predictions/quota  -> how many free / extra predictions are left today
  app.get("/quota", async (req) => {
    const q = await getQuota(prisma, req.user.uid);
    const me = await prisma.user.findUnique({
      where: { id: req.user.uid },
      select: { points: true, tokens: true, winStreak: true },
    });
    return { ...q, ...me };
  });

  // POST /predictions  { marketId, choice }
  app.post("/", async (req, reply) => {
    const b = submitBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request" });

    const userId = req.user.uid;
    const { marketId, choice } = b.data;

    try {
      const out = await prisma.$transaction(async (tx) => {
        // Lock this user's row: two parallel requests from the same user are
        // processed one after another, so the daily limit and the balance
        // can never be beaten by sending requests at the same time.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

        const now = new Date(); // server time is the only clock that counts
        const market = await tx.market.findUnique({
          where: { id: marketId },
          include: { match: { select: { status: true } } },
        });
        if (!market) throw new ApiError(404, "market_not_found");

        if (
          market.status !== "OPEN" ||
          market.locksAt <= now ||
          !["UPCOMING", "LIVE"].includes(market.match.status)
        ) {
          throw new ApiError(409, "market_closed");
        }

        const options = Array.isArray(market.options) ? market.options : [];
        if (!options.includes(choice)) throw new ApiError(400, "invalid_choice");

        const dup = await tx.prediction.findUnique({
          where: { userId_marketId: { userId, marketId } },
        });
        if (dup) throw new ApiError(409, "already_predicted");

        // free or paid?
        const q = await getQuota(tx, userId);
        let isFree = true;
        let cost = 0;
        if (q.freeLeft <= 0) {
          if (q.extraLeft <= 0) throw new ApiError(429, "daily_limit_reached");
          isFree = false;
          cost = q.extraCost;
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { points: true },
        });
        if (!isFree && user.points < cost) {
          throw new ApiError(402, "insufficient_points", {
            need: cost,
            have: user.points,
          });
        }

        let pointsAfter = user.points;
        if (!isFree) {
          const u = await tx.user.update({
            where: { id: userId },
            data: { points: { decrement: cost } },
            select: { points: true },
          });
          pointsAfter = u.points;
        }

        const prediction = await tx.prediction.create({
          data: { userId, marketId, choice, cost, isFree },
        });

        await tx.transaction.create({
          data: {
            userId,
            type: isFree ? "FREE_PREDICTION" : "PREDICTION_COST",
            currency: "POINTS",
            amount: isFree ? 0 : -cost,
            balanceAfter: pointsAfter,
            refType: "prediction",
            refId: prediction.id,
          },
        });

        return {
          prediction,
          pointsAfter,
          quota: {
            freeLeft: q.freeLeft - (isFree ? 1 : 0),
            extraLeft: q.extraLeft - (isFree ? 0 : 1),
            extraCost: q.extraCost,
          },
        };
      });

      // a friend's 3rd prediction may complete a referral (don't block the reply)
      completeReferralIfEligible(userId).catch((e) =>
        req.log.error(e, "referral check failed")
      );

      return {
        ok: true,
        prediction: {
          id: out.prediction.id,
          marketId: out.prediction.marketId,
          choice: out.prediction.choice,
          cost: out.prediction.cost,
          isFree: out.prediction.isFree,
          status: out.prediction.status,
        },
        points: out.pointsAfter,
        quota: out.quota,
      };
    } catch (e) {
      if (e instanceof ApiError) {
        return reply.code(e.status).send({ error: e.code, ...e.extra });
      }
      // unique constraint safety net (userId + marketId)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return reply.code(409).send({ error: "already_predicted" });
      }
      throw e;
    }
  });

  // GET /predictions/mine?status=pending|won|lost&page=1
  app.get("/mine", async (req) => {
    const userId = req.user.uid;
    const page = Math.max(1, Number(req.query.page) || 1);
    const take = 20;

    const filter = { pending: "PENDING", won: "WON", lost: "LOST" }[
      String(req.query.status || "").toLowerCase()
    ];
    const where = { userId, ...(filter ? { status: filter } : {}) };

    const [rows, won, lost, total, me] = await Promise.all([
      prisma.prediction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
        include: {
          market: {
            select: {
              type: true,
              question: true,
              result: true,
              match: {
                select: { teamA: true, teamB: true, startTime: true, status: true },
              },
            },
          },
        },
      }),
      prisma.prediction.count({ where: { userId, status: "WON" } }),
      prisma.prediction.count({ where: { userId, status: "LOST" } }),
      prisma.prediction.count({ where: { userId, status: { not: "REFUNDED" } } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { winStreak: true },
      }),
    ]);

    return {
      page,
      stats: {
        total,
        won,
        lost,
        accuracy: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
        winStreak: me.winStreak,
      },
      items: rows.map((p) => ({
        id: p.id,
        choice: p.choice,
        status: p.status,
        isFree: p.isFree,
        cost: p.cost,
        reward: p.reward,
        multiplier: p.multiplier,
        createdAt: p.createdAt,
        market: {
          type: p.market.type,
          question: p.market.question,
          result: p.market.result,
        },
        match: p.market.match,
      })),
      hasMore: rows.length === take,
    };
  });
}

module.exports = { predictionsRoutes };