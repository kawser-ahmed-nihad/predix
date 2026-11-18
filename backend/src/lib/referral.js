const { prisma } = require("../Prisma/Db");
const { notifyUser } = require("./bot");

// Referral conditions (change from .env without touching code)
const MIN_PREDICTIONS = Number(process.env.REFERRAL_MIN_PREDICTIONS || 3);
const REWARD_POINTS = Number(process.env.REFERRAL_REWARD_POINTS || 50);

/**
 * Call this after a user places a prediction (and after any other action that
 * counts toward the "active friend" condition).
 *
 * A referral becomes SUCCESSFUL only when the invited friend has made at least
 * MIN_PREDICTIONS predictions. The referrer then gets REWARD_POINTS once.
 * Returns true if a reward was given in this call.
 */
async function completeReferralIfEligible(userId) {
  const referral = await prisma.referral.findUnique({
    where: { referredId: userId },
  });
  if (!referral || referral.status !== "PENDING") return false;

  const predictionCount = await prisma.prediction.count({ where: { userId } });
  if (predictionCount < MIN_PREDICTIONS) return false;

  const referrer = await prisma.user.findUnique({
    where: { id: referral.referrerId },
    select: { banned: true },
  });
  if (!referrer || referrer.banned) return false;

  // Anti-fraud: no reward if both accounts used the same device
  const [a, b] = await Promise.all([
    prisma.deviceLog.findMany({
      where: { userId: referral.referrerId },
      select: { deviceHash: true },
    }),
    prisma.deviceLog.findMany({
      where: { userId },
      select: { deviceHash: true },
    }),
  ]);
  const referrerDevices = new Set(a.map((d) => d.deviceHash));
  if (b.some((d) => referrerDevices.has(d.deviceHash))) return false;

  const done = await prisma.$transaction(async (tx) => {
    // Atomic claim: only one concurrent call can flip PENDING -> SUCCESSFUL,
    // so the reward can never be paid twice.
    const claimed = await tx.referral.updateMany({
      where: { id: referral.id, status: "PENDING" },
      data: {
        status: "SUCCESSFUL",
        rewardPoints: REWARD_POINTS,
        completedAt: new Date(),
      },
    });
    if (claimed.count === 0) return false;

    const updated = await tx.user.update({
      where: { id: referral.referrerId },
      data: { points: { increment: REWARD_POINTS } },
      select: { points: true },
    });

    await tx.transaction.create({
      data: {
        userId: referral.referrerId,
        type: "REFERRAL_REWARD",
        currency: "POINTS",
        amount: REWARD_POINTS,
        balanceAfter: updated.points,
        refType: "referral",
        refId: referral.id,
      },
    });

    return true;
  });

  if (done) {
    notifyUser(
      referral.referrerId,
      `🎉 আপনার আমন্ত্রিত বন্ধু সক্রিয় হয়েছে! রেফারেল পুরস্কার: +${REWARD_POINTS} পয়েন্ট।`
    );
  }
  return done;
}

module.exports = { completeReferralIfEligible, MIN_PREDICTIONS, REWARD_POINTS };