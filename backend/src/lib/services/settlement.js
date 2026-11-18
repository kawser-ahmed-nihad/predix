const { prisma } = require("../../Prisma/Db");
const { notifyUser } = require("../bot");

// Win-streak bonus: 0 wins in a row = x1.0, 1 = x1.1 ... 5 or more = x1.5
const multiplierFor = (streak) => 1 + Math.min(streak, 5) * 0.1;

// set NOTIFY_LOSS=true if you also want a message when a prediction is wrong
const NOTIFY_LOSS = process.env.NOTIFY_LOSS === "true";

const lockUser = (tx, userId) =>
  tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

// ---------- one prediction: win / lose ----------
async function settleOne(predictionId, market) {
  const out = await prisma.$transaction(async (tx) => {
    const pred = await tx.prediction.findUnique({ where: { id: predictionId } });
    if (!pred || pred.status !== "PENDING") return null;

    await lockUser(tx, pred.userId);

    const won = pred.choice === market.result;

    // Atomic claim: if another worker got here first, count is 0 and we stop.
    // This is what guarantees a prediction is never paid twice.
    const claimed = await tx.prediction.updateMany({
      where: { id: predictionId, status: "PENDING" },
      data: { status: won ? "WON" : "LOST", settledAt: new Date() },
    });
    if (claimed.count === 0) return null;

    if (won) {
      const user = await tx.user.findUnique({
        where: { id: pred.userId },
        select: { winStreak: true },
      });
      const multiplier = multiplierFor(user.winStreak);
      const reward = Math.round(market.reward * multiplier);

      const updated = await tx.user.update({
        where: { id: pred.userId },
        data: { tokens: { increment: reward }, winStreak: { increment: 1 } },
        select: { tokens: true },
      });

      await tx.prediction.update({
        where: { id: predictionId },
        data: { reward, multiplier },
      });

      await tx.transaction.create({
        data: {
          userId: pred.userId,
          type: "PREDICTION_REWARD",
          currency: "TOKENS",
          amount: reward,
          balanceAfter: updated.tokens,
          refType: "prediction",
          refId: predictionId,
        },
      });
      return { won: true, userId: pred.userId, choice: pred.choice, reward, multiplier };
    }

    await tx.user.update({
      where: { id: pred.userId },
      data: { winStreak: 0 },
    });
    return { won: false, userId: pred.userId, choice: pred.choice };
  });

  // notifications go out only AFTER the money part is safely committed
  if (out?.won) {
    const bonus =
      out.multiplier > 1 ? ` (×${out.multiplier.toFixed(1)} স্ট্রিক বোনাস)` : "";
    notifyUser(
      out.userId,
      `🎉 সঠিক পূর্বাভাস!\n${market.question}\nআপনার উত্তর: ${out.choice}\n+${out.reward} টোকেন${bonus}`
    );
  } else if (out && !out.won && NOTIFY_LOSS) {
    notifyUser(
      out.userId,
      `এবার মেলেনি 😅\n${market.question}\nসঠিক উত্তর: ${market.result}\nপরের ম্যাচে আবার চেষ্টা করুন!`
    );
  }
}

// ---------- one prediction: refund (market cancelled) ----------
async function refundOne(predictionId, market) {
  const out = await prisma.$transaction(async (tx) => {
    const pred = await tx.prediction.findUnique({ where: { id: predictionId } });
    if (!pred || pred.status !== "PENDING") return null;

    await lockUser(tx, pred.userId);

    const claimed = await tx.prediction.updateMany({
      where: { id: predictionId, status: "PENDING" },
      data: { status: "REFUNDED", settledAt: new Date() },
    });
    if (claimed.count === 0) return null;

    // free predictions have nothing to refund (their daily slot is restored
    // automatically because refunded predictions are not counted)
    if (pred.cost > 0) {
      const updated = await tx.user.update({
        where: { id: pred.userId },
        data: { points: { increment: pred.cost } },
        select: { points: true },
      });
      await tx.transaction.create({
        data: {
          userId: pred.userId,
          type: "PREDICTION_REFUND",
          currency: "POINTS",
          amount: pred.cost,
          balanceAfter: updated.points,
          refType: "prediction",
          refId: predictionId,
        },
      });
    }
    return { userId: pred.userId, cost: pred.cost };
  });

  if (out) {
    notifyUser(
      out.userId,
      out.cost > 0
        ? `ℹ️ "${market.question}" বাতিল হয়েছে। ${out.cost} পয়েন্ট ফেরত দেওয়া হয়েছে।`
        : `ℹ️ "${market.question}" বাতিল হয়েছে। আপনার ফ্রি প্রেডিকশন ফেরত পেয়েছেন।`
    );
  }
}

// ---------- batch runners ----------
async function processMarket(market, fn, log) {
  for (;;) {
    const batch = await prisma.prediction.findMany({
      where: { marketId: market.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true },
    });
    if (batch.length === 0) return;

    let failed = 0;
    for (const p of batch) {
      try {
        await fn(p.id);
      } catch (e) {
        failed++;
        log.error?.(e, `settlement failed for prediction ${p.id}`);
      }
    }
    if (failed > 0) return; // retry on the next run instead of looping forever
  }
}

let running = false;

async function settleAll(log = console) {
  if (running) return;
  running = true;
  try {
    const resolved = await prisma.market.findMany({
      where: { status: "RESOLVED", predictions: { some: { status: "PENDING" } } },
      take: 20,
    });
    for (const mk of resolved) {
      await processMarket(mk, (id) => settleOne(id, mk), log);
    }

    const cancelled = await prisma.market.findMany({
      where: { status: "CANCELLED", predictions: { some: { status: "PENDING" } } },
      take: 20,
    });
    for (const mk of cancelled) {
      await processMarket(mk, (id) => refundOne(id, mk), log);
    }
  } finally {
    running = false;
  }
}

module.exports = { settleAll };