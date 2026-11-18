require("dotenv").config();
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const jwt = require("@fastify/jwt");
const { authRoutes } = require("./src/routes/authRoutes");
const { referralRoutes } = require("./src//routes/referral");
const { matchesRoutes } = require("./src/routes/matches");
const { predictionsRoutes } = require("./src/routes/predictions");
const { checkinRoutes } = require("./src/routes/checkin");
const { tasksRoutes } = require("./src/routes/tasks");
const { withdrawalsRoutes } = require("./src/routes/withdrawals");
const { adminExtraRoutes } = require("./src/routes/adminExtra");
const { settingsRoutes } = require("./src/routes/settings");
const { startBot } = require("./src/lib/bot");
const { adminRoutes } = require("./src/routes/admin");
const { startJobs } = require("./src/jobs");

async function main() {
  for (const k of ["DATABASE_URL", "BOT_TOKEN", "JWT_SECRET"]) {
    if (!process.env[k]) throw new Error(`Missing env var: ${k}`);
  }

  const app = Fastify({ logger: true, trustProxy: true });

  const allowedOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: allowedOrigins.length ? allowedOrigins : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET });

  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(referralRoutes, { prefix: "/referral" });
  await app.register(matchesRoutes, { prefix: "/matches" });
  await app.register(predictionsRoutes, { prefix: "/predictions" });
  await app.register(checkinRoutes, { prefix: "/checkin" });
  await app.register(tasksRoutes, { prefix: "/tasks" });
  await app.register(withdrawalsRoutes, { prefix: "/withdrawals" });
  await app.register(adminExtraRoutes, { prefix: "/admin" });
  await app.register(settingsRoutes, { prefix: "/settings" });
  await app.register(adminRoutes, { prefix: "/admin" });

  await app.listen({ port: Number(process.env.PORT || 3000), host: "0.0.0.0" });
  startJobs(app.log);
  startBot(app.log);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});