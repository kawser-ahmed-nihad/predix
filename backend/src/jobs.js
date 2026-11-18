const cron = require("node-cron");
const { syncMatches, lockExpiredMarkets } = require("../src/lib/services/matchSync");
const { settleAll } = require("../src/lib/services/settlement");
const { sendMatchReminders, sendStreakReminders } = require("../src/lib/services/reminders");

function startJobs(log) {
  // every minute: lock markets whose time has passed (DB only, no API hit)
  cron.schedule("* * * * *", () => {
    lockExpiredMarkets().catch((e) => log.error(e, "lockExpiredMarkets failed"));
  });

  // every minute: pay winners, mark losers, refund cancelled markets (DB only)
  cron.schedule("* * * * *", () => {
    settleAll(log).catch((e) => log.error(e, "settleAll failed"));
  });

  // every 5 minutes: "match starts in 1 hour" reminders
  cron.schedule("*/5 * * * *", () => {
    sendMatchReminders().catch((e) => log.error(e, "sendMatchReminders failed"));
  });

  // every day 8 PM Bangladesh time: "don't lose your streak"
  cron.schedule(
    "0 20 * * *",
    () => {
      sendStreakReminders().catch((e) => log.error(e, "sendStreakReminders failed"));
    },
    { timezone: "Asia/Dhaka" }
  );

  // Free cricket API plan = ~100 hits/day. Every 20 minutes = 72 hits/day.
  // On a paid plan use e.g. "*/2 * * * *".
  const expr = process.env.MATCH_SYNC_CRON || "*/20 * * * *";
  cron.schedule(expr, () => {
    syncMatches(log).catch((e) => log.error(e, "syncMatches failed"));
  });

  log.info(`jobs started (match sync: ${expr})`);
}

module.exports = { startJobs };