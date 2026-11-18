const { prisma } = require("../../Prisma/Db");
const { sendTo } = require("../bot");
const { dayStartBD } = require("../quota");

const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;

/**
 * Runs every 5 minutes. For matches starting in 55-60 minutes, remind users who
 * were active in the last 7 days and have not predicted this match yet.
 * The 5-minute window matches the schedule, so each match is picked up once.
 */
async function sendMatchReminders() {
  const now = Date.now();
  const matches = await prisma.match.findMany({
    where: {
      status: "UPCOMING",
      startTime: { gt: new Date(now + 55 * MIN), lte: new Date(now + 60 * MIN) },
    },
  });

  for (const m of matches) {
    const users = await prisma.user.findMany({
      where: {
        banned: false,
        notifications: true,
        predictions: { some: { createdAt: { gte: new Date(now - 7 * DAY) } } },
        NOT: { predictions: { some: { market: { matchId: m.id } } } },
      },
      select: { telegramId: true },
      take: 3000,
    });

    const text = `🏏 ${m.teamA} vs ${m.teamB}\nম্যাচ ১ ঘণ্টা পরে শুরু! টস ও বিজয়ীর প্রেডিকশন করে ফেলুন।`;
    for (const u of users) sendTo(u.telegramId, text);
  }
}

/**
 * Runs daily at 8 PM (Bangladesh time). Users with a streak of 2+ days who
 * checked in yesterday but not yet today get a reminder before they lose it.
 */
async function sendStreakReminders() {
  const todayStart = dayStartBD();
  const users = await prisma.user.findMany({
    where: {
      banned: false,
      notifications: true,
      streak: { gte: 2 },
      lastCheckIn: { gte: new Date(todayStart.getTime() - DAY), lt: todayStart },
    },
    select: { telegramId: true, streak: true },
    take: 5000,
  });

  for (const u of users) {
    sendTo(
      u.telegramId,
      `🔥 আপনার ${u.streak} দিনের স্ট্রিক আছে! আজ চেক-ইন না করলে স্ট্রিক শূন্য হয়ে যাবে।`
    );
  }
}

module.exports = { sendMatchReminders, sendStreakReminders };