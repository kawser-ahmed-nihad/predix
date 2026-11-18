const { z } = require("zod");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../Prisma/Db");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");
const { broadcast, notifyUser } = require("../lib/bot");

const POOL_PERCENT = Number(process.env.POOL_PERCENT || 35);

const revenueBody = z.object({
  day: z.coerce.date(), // the day the ad income belongs to
  revenueBdt: z.number().positive(), // total ad income for that day (BDT)
  poolPercent: z.number().min(1).max(90).optional(),
});

const taskBody = z.object({
  title: z.string().min(2).max(100),
  description: z.string().max(300).optional(),
  type: z.enum(["WATCH_AD", "JOIN_CHANNEL", "SHARE", "CUSTOM"]),
  url: z.string().url().optional(),
  rewardPoints: z.number().int().min(1).max(1000),
  daily: z.boolean().default(true),
});

async function adminExtraRoutes(app) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);

  // ---------- daily reward pool ----------

  // POST /admin/revenue  { day, revenueBdt, poolPercent? }
  // pool = revenue x pool%   ;   token rate = pool / all active users' tokens
  app.post("/revenue", async (req, reply) => {
    const b = revenueBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request" });

    const agg = await prisma.user.aggregate({
      where: { banned: false },
      _sum: { tokens: true },
    });
    const totalTokens = agg._sum.tokens || 0;
    if (totalTokens <= 0) return reply.code(400).send({ error: "no_tokens_yet" });

    const percent = new Prisma.Decimal(b.data.poolPercent ?? POOL_PERCENT);
    const revenue = new Prisma.Decimal(b.data.revenueBdt);
    const pool = revenue.mul(percent).div(100).toDecimalPlaces(2);
    const rate = pool.div(totalTokens).toDecimalPlaces(6);

    const day = new Date(b.data.day.toISOString().slice(0, 10)); // date only
    const row = await prisma.adRevenueDaily.upsert({
      where: { day },
      create: {
        day,
        revenueBdt: revenue,
        poolPercent: percent,
        poolBdt: pool,
        totalTokens,
        tokenRate: rate,
      },
      update: {
        revenueBdt: revenue,
        poolPercent: percent,
        poolBdt: pool,
        totalTokens,
        tokenRate: rate,
      },
    });
    return {
      day: row.day,
      poolBdt: row.poolBdt.toString(),
      totalTokens,
      tokenRate: row.tokenRate.toString(),
    };
  });

  // ---------- withdrawals ----------

  // GET /admin/withdrawals?status=PENDING
  app.get("/withdrawals", async (req) => {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const rows = await prisma.withdrawal.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "asc" },
      take: 100,
      include: {
        user: {
          select: { id: true, username: true, firstName: true, telegramId: true },
        },
      },
    });
    return {
      items: rows.map((w) => ({
        id: w.id,
        status: w.status,
        tokens: w.tokens,
        amountBdt: w.amountBdt.toString(),
        method: w.method,
        account: w.account,
        createdAt: w.createdAt,
        user: {
          id: w.user.id,
          name: w.user.firstName || w.user.username,
          username: w.user.username,
          telegramId: w.user.telegramId.toString(),
        },
      })),
    };
  });

  // Moves a withdrawal forward only if it is currently in an allowed state.
  async function move(id, from, data) {
    const r = await prisma.withdrawal.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    return r.count === 1;
  }

  // Tell the user about a withdrawal status change (always delivered)
  async function tell(id, build) {
    const w = await prisma.withdrawal.findUnique({ where: { id } });
    if (w) notifyUser(w.userId, build(w), { essential: true });
  }

  // POST /admin/withdrawals/:id/processing
  app.post("/withdrawals/:id/processing", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });
    const ok = await move(id, ["PENDING"], { status: "PROCESSING" });
    if (ok) tell(id, () => "⏳ আপনার উইথড্রয়াল অনুরোধ প্রক্রিয়াধীন আছে।");
    return ok ? { ok: true } : reply.code(409).send({ error: "invalid_state" });
  });

  // POST /admin/withdrawals/:id/paid  { txRef }  (after you sent the money)
  app.post("/withdrawals/:id/paid", async (req, reply) => {
    const id = Number(req.params.id);
    const b = z.object({ txRef: z.string().min(3).max(100) }).safeParse(req.body);
    if (!Number.isInteger(id) || !b.success) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const ok = await move(id, ["PENDING", "PROCESSING"], {
      status: "PAID",
      txRef: b.data.txRef,
    });
    if (ok) {
      tell(
        id,
        (w) =>
          `✅ ${w.amountBdt} টাকা ${w.method} নম্বর ${w.account}-এ পাঠানো হয়েছে।\nট্রানজ্যাকশন আইডি: ${b.data.txRef}`
      );
    }
    return ok ? { ok: true } : reply.code(409).send({ error: "invalid_state" });
  });

  // POST /admin/withdrawals/:id/reject  { note }  -> tokens go back to the user
  app.post("/withdrawals/:id/reject", async (req, reply) => {
    const id = Number(req.params.id);
    const b = z.object({ note: z.string().min(2).max(200) }).safeParse(req.body);
    if (!Number.isInteger(id) || !b.success) {
      return reply.code(400).send({ error: "bad_request" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const w = await tx.withdrawal.findUnique({ where: { id } });
      if (!w) return { error: "not_found" };

      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${w.userId} FOR UPDATE`;

      const claimed = await tx.withdrawal.updateMany({
        where: { id, status: { in: ["PENDING", "PROCESSING"] } },
        data: { status: "REJECTED", adminNote: b.data.note },
      });
      if (claimed.count === 0) return { error: "invalid_state" };

      const updated = await tx.user.update({
        where: { id: w.userId },
        data: { tokens: { increment: w.tokens } },
        select: { tokens: true },
      });
      await tx.transaction.create({
        data: {
          userId: w.userId,
          type: "WITHDRAWAL_REFUND",
          currency: "TOKENS",
          amount: w.tokens,
          balanceAfter: updated.tokens,
          refType: "withdrawal",
          refId: id,
        },
      });
      return { ok: true };
    });

    if (result.error) {
      return reply.code(result.error === "not_found" ? 404 : 409).send(result);
    }
    tell(
      id,
      (w) =>
        `❌ আপনার উইথড্রয়াল অনুরোধ বাতিল হয়েছে।\nকারণ: ${b.data.note}\n${w.tokens} টোকেন আপনার ব্যালেন্সে ফেরত দেওয়া হয়েছে।`
    );
    return result;
  });

  // POST /admin/broadcast  { text }  -> message to all users (who allow it)
  app.post("/broadcast", async (req, reply) => {
    const b = z.object({ text: z.string().min(2).max(1000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request" });
    const queued = await broadcast(b.data.text);
    return { queued };
  });

  // ---------- tasks ----------

  // POST /admin/tasks
  app.post("/tasks", async (req, reply) => {
    const b = taskBody.safeParse(req.body);
    if (!b.success) {
      return reply.code(400).send({ error: "bad_request", details: b.error.issues });
    }
    if (b.data.type === "JOIN_CHANNEL" && !/t\.me\/[A-Za-z0-9_]{4,}/.test(b.data.url || "")) {
      return reply.code(400).send({ error: "join_channel_needs_public_t.me_url" });
    }
    const t = await prisma.task.create({ data: b.data });
    return { id: t.id };
  });

  // POST /admin/tasks/:id/active  { active: true|false }
  app.post("/tasks/:id/active", async (req, reply) => {
    const id = Number(req.params.id);
    const b = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!Number.isInteger(id) || !b.success) {
      return reply.code(400).send({ error: "bad_request" });
    }
    await prisma.task.update({ where: { id }, data: { active: b.data.active } });
    return { ok: true };
  });
}

module.exports = { adminExtraRoutes };