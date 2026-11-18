const { z } = require("zod");
const { prisma } = require("../Prisma/Db");
const { authenticate } = require("../middleware/authMiddleware");

const body = z.object({
  notifications: z.boolean().optional(),
  language: z.enum(["bn", "en"]).optional(),
});

async function settingsRoutes(app) {
  app.addHook("preHandler", authenticate);

  // GET /settings
  app.get("/", async (req) => {
    const u = await prisma.user.findUnique({
      where: { id: req.user.uid },
      select: { notifications: true, language: true },
    });
    return u;
  });

  // POST /settings  { notifications?, language? }
  app.post("/", async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request" });
    const u = await prisma.user.update({
      where: { id: req.user.uid },
      data: b.data,
      select: { notifications: true, language: true },
    });
    return u;
  });
}

module.exports = { settingsRoutes };