const crypto = require("node:crypto");
const { z } = require("zod");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../Prisma/Db");
const { verifyInitData } = require("../lib/telegram");
const { notifyUser } = require("../lib/bot");
const { authenticate } = require("../middleware/authMiddleware");

const loginBody = z.object({
  initData: z.string().min(10).max(4096),
  deviceHash: z.string().max(128).optional(),
});

const newReferralCode = () => crypto.randomBytes(4).toString("hex");

function publicUser(u) {
  return {
    id: u.id,
    telegramId: u.telegramId.toString(), // BigInt can't be JSON-serialized
    username: u.username,
    firstName: u.firstName,
    photoUrl: u.photoUrl,
    points: u.points,
    tokens: u.tokens,
    level: u.level,
    streak: u.streak,
    referralCode: u.referralCode,
  };
}

async function authRoutes(app) {
  // POST /auth/login  { initData, deviceHash? }
  app.post("/login", async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });

    const parsed = verifyInitData(body.data.initData, process.env.BOT_TOKEN);
    if (!parsed) return reply.code(401).send({ error: "invalid_init_data" });

    const tg = parsed.user;
    const telegramId = BigInt(tg.id);
    const profile = {
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      photoUrl: tg.photo_url ?? null,
    };

    let user = await prisma.user.findUnique({ where: { telegramId } });
    const isNew = !user;

    if (user) {
      // returning user: refresh Telegram profile info
      user = await prisma.user.update({ where: { id: user.id }, data: profile });
    } else {
      // new user: resolve referrer from start_param ("ref_<code>")
      let referrerId = null;
      const sp = parsed.startParam;
      if (sp && sp.startsWith("ref_")) {
        const ref = await prisma.user.findUnique({
          where: { referralCode: sp.slice(4) },
          select: { id: true },
        });
        if (ref) referrerId = ref.id;
      }

      try {
        user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              telegramId,
              ...profile,
              language: tg.language_code === "bn" ? "bn" : "en",
              referralCode: newReferralCode(),
              referrerId,
            },
          });
          if (referrerId) {
            // status stays PENDING until the friend meets the conditions
            await tx.referral.create({
              data: { referrerId, referredId: created.id },
            });
          }
          return created;
        });
        if (referrerId) {
          notifyUser(
            referrerId,
            "👋 আপনার রেফারেল লিংকে একজন বন্ধু জয়েন করেছে! সে কয়েকটা প্রেডিকশন করলে আপনি পুরস্কার পাবেন।"
          );
        }
      } catch (e) {
        // two parallel first-logins: the other one won, just load it
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          user = await prisma.user.findUnique({ where: { telegramId } });
        } else {
          throw e;
        }
      }
    }

    if (!user) return reply.code(500).send({ error: "login_failed" });
    if (user.banned) return reply.code(403).send({ error: "banned" });

    // device log for multi-account detection
    if (body.data.deviceHash) {
      await prisma.deviceLog.create({
        data: { userId: user.id, deviceHash: body.data.deviceHash, ip: req.ip },
      });
      const sameDevice = await prisma.deviceLog.findMany({
        where: { deviceHash: body.data.deviceHash },
        distinct: ["userId"],
        select: { userId: true },
      });
      if (sameDevice.length > 2) {
        req.log.warn(
          { deviceHash: body.data.deviceHash, accounts: sameDevice.length },
          "possible multi-account device"
        );
      }
    }

    const token = app.jwt.sign({ uid: user.id }, { expiresIn: "7d" });
    return { token, user: publicUser(user), isNew };
  });

  // GET /auth/me  (Authorization: Bearer <token>)
  app.get("/me", { preHandler: authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.uid } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    return { user: publicUser(user) };
  });
}

module.exports = { authRoutes };