const { prisma } = require("../Prisma/Db");

/** Use as a preHandler on any route that needs a logged-in user. */
async function authenticate(req, reply) {
  try {
    await req.jwtVerify(); // sets req.user = { uid }
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }

  const u = await prisma.user.findUnique({
    where: { id: req.user.uid },
    select: { banned: true },
  });
  if (!u || u.banned) {
    return reply.code(403).send({ error: "forbidden" });
  }
}

/** Use AFTER authenticate on admin-only routes. */
async function requireAdmin(req, reply) {
  const u = await prisma.user.findUnique({
    where: { id: req.user.uid },
    select: { isAdmin: true },
  });
  if (!u || !u.isAdmin) {
    return reply.code(403).send({ error: "admin_only" });
  }
}

module.exports = { authenticate, requireAdmin };