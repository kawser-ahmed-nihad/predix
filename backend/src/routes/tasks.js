const { prisma } = require("../Prisma/Db");
const { authenticate } = require("../middleware/authMiddleware");
const { dayStartBD } = require("../lib/quota");
const { isChannelMember } = require("../lib/telegram");

const BD_OFFSET = 6 * 3600 * 1000;
const ONE_TIME_DAY = new Date("1970-01-01T00:00:00Z");

// The @db.Date column stores a calendar date. For daily tasks that is today's
// Bangladesh date; one-time tasks always use the same fixed date.
function dayKey(task) {
  if (!task.daily) return ONE_TIME_DAY;
  return new Date(dayStartBD().getTime() + BD_OFFSET); // UTC midnight of the BD date
}

// "https://t.me/mychannel" -> "@mychannel"  (public channels/groups only)
function chatFromUrl(url) {
  const m = /t\.me\/([A-Za-z0-9_]{4,})/.exec(url || "");
  return m ? `@${m[1]}` : null;
}

async function tasksRoutes(app) {
  app.addHook("preHandler", authenticate);

  // GET /tasks
  app.get("/", async (req) => {
    const userId = req.user.uid;
    const tasks = await prisma.task.findMany({
      where: { active: true },
      orderBy: { id: "asc" },
    });

    const items = [];
    for (const t of tasks) {
      const ut = await prisma.userTask.findUnique({
        where: { userId_taskId_day: { userId, taskId: t.id, day: dayKey(t) } },
      });
      items.push({
        id: t.id,
        title: t.title,
        description: t.description,
        type: t.type,
        url: t.url,
        rewardPoints: t.rewardPoints,
        daily: t.daily,
        completed: !!ut?.completed,
        claimed: !!ut?.claimed,
      });
    }
    return { items };
  });

  // POST /tasks/:id/complete  -> verify the task is done
  app.post("/:id/complete", async (req, reply) => {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task || !task.active) return reply.code(404).send({ error: "not_found" });

    if (task.type === "JOIN_CHANNEL") {
      const chat = chatFromUrl(task.url);
      if (!chat) return reply.code(500).send({ error: "task_misconfigured" });

      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      });
      const ok = await isChannelMember(
        process.env.BOT_TOKEN,
        chat,
        me.telegramId.toString()
      );
      if (!ok) return reply.code(409).send({ error: "not_joined" });
    } else if (task.type === "SHARE") {
      // A share cannot be verified by Telegram. Keep SHARE rewards small.
    } else {
      // WATCH_AD must be completed by the ad network's server callback (phase 2)
      return reply.code(501).send({ error: "not_available_yet" });
    }

    const day = dayKey(task);
    await prisma.userTask.upsert({
      where: { userId_taskId_day: { userId, taskId: id, day } },
      create: { userId, taskId: id, day, completed: true },
      update: { completed: true },
    });
    return { ok: true, completed: true };
  });

  // POST /tasks/:id/claim  -> get the reward
  app.post("/:id/claim", async (req, reply) => {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task || !task.active) return reply.code(404).send({ error: "not_found" });

    const day = dayKey(task);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      // Atomic: only a completed and not yet claimed task can be claimed, once.
      const claimed = await tx.userTask.updateMany({
        where: { userId, taskId: id, day, completed: true, claimed: false },
        data: { claimed: true, claimedAt: new Date() },
      });
      if (claimed.count === 0) return { error: "not_claimable" };

      const updated = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: task.rewardPoints } },
        select: { points: true },
      });
      await tx.transaction.create({
        data: {
          userId,
          type: "TASK_REWARD",
          currency: "POINTS",
          amount: task.rewardPoints,
          balanceAfter: updated.points,
          refType: "task",
          refId: id,
        },
      });
      return { ok: true, reward: task.rewardPoints, points: updated.points };
    });

    if (result.error) return reply.code(409).send(result);
    return result;
  });
}

module.exports = { tasksRoutes };