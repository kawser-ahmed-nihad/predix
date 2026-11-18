const { z } = require("zod");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../Prisma/Db");
const { authenticate } = require("../middleware/authMiddleware");

const DAY = 24 * 3600 * 1000;
const METHODS = ["bKash", "Nagad", "Rocket"];
const MIN_TOKENS = Number(process.env.MIN_WITHDRAW_TOKENS || 500);
const MIN_ACCOUNT_DAYS = Number(process.env.WITHDRAW_MIN_ACCOUNT_DAYS || 3);
const MIN_PREDICTIONS = Number(process.env.WITHDRAW_MIN_PREDICTIONS || 3);

class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const body = z.object({
  tokens: z.number().int().positive(),
  method: z.enum(METHODS),
  // Bangladesh mobile number, e.g. 01712345678
  account: z.string().regex(/^01[3-9]\d{8}$/),
});

const money = (tokens, rate) =>
  new Prisma.Decimal(tokens)
    .mul(rate)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

async function latestRate(db) {
  return db.adRevenueDaily.findFirst({ orderBy: { day: "desc" } });
}

// same device used by more than 2 accounts -> hold for manual review
async function deviceFlagged(db, userId) {
  const mine = await db.deviceLog.findMany({
    where: { userId },
    distinct: ["deviceHash"],
    select: { deviceHash: true },
  });
  if (mine.length === 0) return false;
  const users = await db.deviceLog.findMany({
    where: { deviceHash: { in: mine.map((d) => d.deviceHash) } },
    distinct: ["userId"],
    select: { userId: true },
  });
  return users.length > 2;
}

async function withdrawalsRoutes(app) {
  app.addHook("preHandler", authenticate);

  // GET /withdrawals/info  -> everything the withdraw screen needs
  app.get("/info", async (req) => {
    const me = await prisma.user.findUnique({
      where: { id: req.user.uid },
      select: { tokens: true, createdAt: true },
    });
    const r = await latestRate(prisma);
    const availableAt = new Date(me.createdAt.getTime() + MIN_ACCOUNT_DAYS * DAY);

    return {
      tokens: me.tokens,
      minTokens: MIN_TOKENS,
      methods: METHODS,
      rate: r ? r.tokenRate.toString() : null, // BDT per token, changes daily
      rateDay: r ? r.day : null,
      estimatedBdt: r ? money(me.tokens, r.tokenRate).toString() : null,
      accountAgeOk: availableAt <= new Date(),
      availableAt,
      notice:
        "টোকেনের মূল্য দৈনিক বিজ্ঞাপন আয়ের উপর নির্ভর করে এবং প্রতিদিন পরিবর্তিত হতে পারে।",
    };
  });

  // GET /withdrawals  -> history
  app.get("/", async (req) => {
    const rows = await prisma.withdrawal.findMany({
      where: { userId: req.user.uid },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      items: rows.map((w) => ({
        id: w.id,
        tokens: w.tokens,
        amountBdt: w.amountBdt.toString(),
        rate: w.rate.toString(),
        method: w.method,
        account: w.account,
        status: w.status, // PENDING -> PROCESSING -> PAID | REJECTED
        adminNote: w.status === "REJECTED" ? w.adminNote : null,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
    };
  });

  // POST /withdrawals  { tokens, method, account }
  app.post("/", async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request" });
    const userId = req.user.uid;
    const { tokens, method, account } = b.data;

    try {
      const w = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: userId } });

        if (tokens < MIN_TOKENS) {
          throw new ApiError(400, "below_minimum", { min: MIN_TOKENS });
        }
        if (user.tokens < tokens) {
          throw new ApiError(402, "insufficient_tokens", { have: user.tokens });
        }

        const availableAt = new Date(user.createdAt.getTime() + MIN_ACCOUNT_DAYS * DAY);
        if (availableAt > new Date()) {
          throw new ApiError(403, "account_too_new", { availableAt });
        }

        const played = await tx.prediction.count({
          where: { userId, status: { not: "REFUNDED" } },
        });
        if (played < MIN_PREDICTIONS) {
          throw new ApiError(403, "not_enough_predictions", { need: MIN_PREDICTIONS });
        }

        const open = await tx.withdrawal.count({
          where: { userId, status: { in: ["PENDING", "PROCESSING"] } },
        });
        if (open > 0) throw new ApiError(409, "withdrawal_in_progress");

        if (await deviceFlagged(tx, userId)) {
          throw new ApiError(403, "under_review");
        }

        const r = await latestRate(tx);
        if (!r) throw new ApiError(503, "rate_unavailable");

        const amount = money(tokens, r.tokenRate);
        if (amount.lt(1)) throw new ApiError(400, "amount_too_small");

        // Tokens leave the balance NOW, so the same tokens can never be
        // withdrawn twice. They come back only if the request is rejected.
        const updated = await tx.user.update({
          where: { id: userId },
          data: { tokens: { decrement: tokens } },
          select: { tokens: true },
        });

        const created = await tx.withdrawal.create({
          data: { userId, tokens, rate: r.tokenRate, amountBdt: amount, method, account },
        });

        await tx.transaction.create({
          data: {
            userId,
            type: "WITHDRAWAL",
            currency: "TOKENS",
            amount: -tokens,
            balanceAfter: updated.tokens,
            refType: "withdrawal",
            refId: created.id,
          },
        });
        return created;
      });

      return {
        ok: true,
        id: w.id,
        status: w.status,
        amountBdt: w.amountBdt.toString(),
      };
    } catch (e) {
      if (e instanceof ApiError) {
        return reply.code(e.status).send({ error: e.code, ...e.extra });
      }
      throw e;
    }
  });
}

module.exports = { withdrawalsRoutes };