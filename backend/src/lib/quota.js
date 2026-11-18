// Daily prediction limits. All values can be changed from .env.

const FREE_PER_DAY = Number(process.env.FREE_PREDICTIONS_PER_DAY || 2);
const MAX_EXTRA_PER_DAY = Number(process.env.MAX_EXTRA_PREDICTIONS_PER_DAY || 10);
const EXTRA_COST = Number(process.env.EXTRA_PREDICTION_COST || 50); // points

const DAY = 24 * 3600 * 1000;
const BD_OFFSET = 6 * 3600 * 1000; // Bangladesh = UTC+6, no daylight saving

// Start of "today" in Bangladesh time (the daily reset is at 12:00 AM BD time)
function dayStartBD(now = new Date()) {
  return new Date(Math.floor((now.getTime() + BD_OFFSET) / DAY) * DAY - BD_OFFSET);
}

// `db` can be the prisma client or a transaction client.
// Refunded predictions (cancelled matches) do not use up the daily quota.
async function getQuota(db, userId) {
  const since = dayStartBD();
  const base = { userId, createdAt: { gte: since }, status: { not: "REFUNDED" } };

  const freeUsed = await db.prediction.count({ where: { ...base, isFree: true } });
  const extraUsed = await db.prediction.count({ where: { ...base, isFree: false } });

  return {
    freePerDay: FREE_PER_DAY,
    freeLeft: Math.max(0, FREE_PER_DAY - freeUsed),
    extraLeft: Math.max(0, MAX_EXTRA_PER_DAY - extraUsed),
    extraCost: EXTRA_COST,
    resetsAt: new Date(since.getTime() + DAY),
  };
}

module.exports = { getQuota, dayStartBD, FREE_PER_DAY, MAX_EXTRA_PER_DAY, EXTRA_COST };