const { Bot } = require("grammy");
const { prisma } = require("../Prisma/Db");

const bot = process.env.BOT_TOKEN ? new Bot(process.env.BOT_TOKEN) : null;
const WEBAPP_URL = process.env.WEBAPP_URL; // https URL of the deployed Mini App

const keyboard = () =>
  WEBAPP_URL
    ? { inline_keyboard: [[{ text: "🎯 অ্যাপ খুলুন", web_app: { url: WEBAPP_URL } }]] }
    : undefined;

// ---------- throttled send queue ----------
// Telegram allows ~30 messages/second. We send ~25/s so a big batch
// (e.g. 1000 reminders) never hits the limit.
const queue = [];
let timer = null;
let busy = false;
let pausedUntil = 0;

function enqueue(job) {
  queue.push(job);
  if (!timer) timer = setInterval(drain, 40);
}

async function drain() {
  if (busy || Date.now() < pausedUntil) return;
  const job = queue.shift();
  if (!job) {
    clearInterval(timer);
    timer = null;
    return;
  }
  busy = true;
  try {
    await bot.api.sendMessage(job.telegramId, job.text, {
      reply_markup: job.button ? keyboard() : undefined,
    });
  } catch (e) {
    if (e.error_code === 429) {
      // Telegram asked us to slow down: wait and retry this message
      pausedUntil = Date.now() + ((e.parameters?.retry_after || 5) + 1) * 1000;
      queue.unshift(job);
    } else if (e.error_code === 403) {
      // user blocked the bot: stop sending to them
      prisma.user
        .updateMany({
          where: { telegramId: BigInt(job.telegramId) },
          data: { notifications: false },
        })
        .catch(() => {});
    } else {
      console.error("sendMessage failed:", e.description || e.message);
    }
  } finally {
    busy = false;
  }
}

/** Queue a message to a Telegram id (no preference check). */
function sendTo(telegramId, text, { button = true } = {}) {
  if (!bot) return;
  enqueue({ telegramId: telegramId.toString(), text, button });
}

/**
 * Notify one of our users. Respects their notification setting, except for
 * essential messages (withdrawal updates).
 */
async function notifyUser(userId, text, { essential = false, button = true } = {}) {
  if (!bot) return;
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true, notifications: true, banned: true },
    });
    if (!u || u.banned) return;
    if (!essential && !u.notifications) return;
    sendTo(u.telegramId, text, { button });
  } catch (e) {
    console.error("notifyUser failed:", e.message);
  }
}

/** Message every active user who has notifications on. Returns how many were queued. */
async function broadcast(text) {
  if (!bot) return 0;
  let cursor = 0;
  let count = 0;
  for (;;) {
    const users = await prisma.user.findMany({
      where: { id: { gt: cursor }, banned: false, notifications: true },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true, telegramId: true },
    });
    if (users.length === 0) break;
    for (const u of users) {
      sendTo(u.telegramId, text);
      count++;
    }
    cursor = users[users.length - 1].id;
  }
  return count;
}

/** Long-polling bot: answers /start with an "open app" button. */
function startBot(log) {
  if (!bot) {
    log.warn("BOT_TOKEN missing, bot not started");
    return;
  }
  bot.command("start", (ctx) =>
    ctx.reply(
      "স্বাগতম! 🏏\nক্রিকেট ম্যাচের পূর্বাভাস দিন, টোকেন জিতুন।\nকোনো টাকা জমা দিতে হয় না, এটি বিনোদনমূলক।",
      { reply_markup: keyboard() }
    )
  );
  bot.catch((err) => log.error(err.error, "bot error"));
  bot.start({ drop_pending_updates: true }).catch((e) => log.error(e, "bot stopped"));
  log.info("bot started");
}

module.exports = { startBot, notifyUser, sendTo, broadcast };