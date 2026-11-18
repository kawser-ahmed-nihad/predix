const { prisma } = require("../Prisma/Db");
const { authenticate } = require("../middleware/authMiddleware");
const { dayStartBD } = require("../lib/quota");

const DAY = 24 * 3600 * 1000;

// Reward (points) for day 1..7 of a streak. Day 8 starts the cycle again.
const REWARDS = [10, 10, 15, 15, 20, 20, 50];

// The streak that is still alive: checked in today or yesterday, else 0.
function liveStreak(user, todayStart) {
  if (!user.lastCheckIn) return 0;
  const last = dayStartBD(user.lastCheckIn).getTime();
  const t = todayStart.getTime();
  return last === t || last === t - DAY ? user.streak : 0;
}

async function checkinRoutes(app) {
  app.addHook("preHandler", authenticate);

  // GET /checkin/status
  app.get("/status", async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.uid } });
    const todayStart = dayStartBD();
    const streak = liveStreak(user, todayStart);
    const checkedInToday =
      !!user.lastCheckIn &&
      dayStartBD(user.lastCheckIn).getTime() === todayStart.getTime();

    return {
      checkedInToday,
      streak,
      bestStreak: user.bestStreak,
      nextReward: REWARDS[streak % REWARDS.length], // reward of the next check-in
      rewards: REWARDS,
      resetsAt: new Date(todayStart.getTime() + DAY),
    };
  });

  // POST /checkin
  app.post("/", async (req, reply) => {
    const userId = req.user.uid;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });

      const now = new Date();
      const todayStart = dayStartBD(now);
      const lastDay = user.lastCheckIn ? dayStartBD(user.lastCheckIn).getTime() : null;

      if (lastDay === todayStart.getTime()) return { error: "already_checked_in" };

      // yesterday -> streak continues, otherwise it starts again from 1
      const newStreak =
        lastDay === todayStart.getTime() - DAY ? user.streak + 1 : 1;
      const reward = REWARDS[(newStreak - 1) % REWARDS.length];

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          streak: newStreak,
          bestStreak: Math.max(user.bestStreak, newStreak),
          lastCheckIn: now,
          points: { increment: reward },
        },
        select: { points: true },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: "DAILY_CHECKIN",
          currency: "POINTS",
          amount: reward,
          balanceAfter: updated.points,
          refType: "checkin",
          note: `day ${newStreak}`,
        },
      });

      return { ok: true, streak: newStreak, reward, points: updated.points };
    });

    if (result.error) return reply.code(409).send(result);
    return result;
  });
}

module.exports = { checkinRoutes };