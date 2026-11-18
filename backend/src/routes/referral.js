const { prisma } = require("../Prisma/Db");
const { authenticate } = require("../middleware/authMiddleware");
const { MIN_PREDICTIONS, REWARD_POINTS } = require("../lib/referral");

function buildLink(code) {
  const bot = process.env.BOT_USERNAME; // without @
  const app = process.env.MINIAPP_SHORT_NAME; // short name from BotFather /newapp
  return `https://t.me/${bot}/${app}?startapp=ref_${code}`;
}

async function referralRoutes(app) {
  app.addHook("preHandler", authenticate);

  // GET /referral/summary
  app.get("/summary", async (req) => {
    const userId = req.user.uid;

    const [me, total, successful, earned] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      }),
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.referral.count({
        where: { referrerId: userId, status: "SUCCESSFUL" },
      }),
      prisma.referral.aggregate({
        where: { referrerId: userId, status: "SUCCESSFUL" },
        _sum: { rewardPoints: true },
      }),
    ]);

    const link = buildLink(me.referralCode);
    const shareText = "PredictX BD-তে জয়েন করো, ফ্রি প্রেডিকশন করো!";

    return {
      referralCode: me.referralCode,
      link,
      shareUrl: `https://t.me/share/url?url=${encodeURIComponent(
        link
      )}&text=${encodeURIComponent(shareText)}`,
      totalInvited: total,
      successful,
      pending: total - successful,
      pointsEarned: earned._sum.rewardPoints || 0,
      rules: { minPredictions: MIN_PREDICTIONS, rewardPoints: REWARD_POINTS },
    };
  });

  // GET /referral/history?page=1
  app.get("/history", async (req) => {
    const userId = req.user.uid;
    const page = Math.max(1, Number(req.query.page) || 1);
    const take = 20;

    const rows = await prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: {
        referred: { select: { firstName: true, username: true } },
      },
    });

    return {
      page,
      items: rows.map((r) => ({
        id: r.id,
        name: r.referred.firstName || r.referred.username || "User",
        status: r.status, // PENDING | SUCCESSFUL
        rewardPoints: r.rewardPoints,
        joinedAt: r.createdAt,
        completedAt: r.completedAt,
      })),
      hasMore: rows.length === take,
    };
  });
}

module.exports = { referralRoutes };