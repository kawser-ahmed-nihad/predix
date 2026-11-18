const crypto = require("node:crypto");

/**
 * Verifies Telegram Mini App initData using HMAC-SHA256.
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns null if the data is invalid, tampered with, or too old.
 * On success returns { user, startParam }.
 */
function verifyInitData(initData, botToken, maxAgeSec = 60 * 60 * 24) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  // only "hash" is excluded from the check string
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculated = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;

  try {
    const user = JSON.parse(userRaw);
    if (!user.id) return null;
    return { user, startParam: params.get("start_param") };
  } catch {
    return null;
  }
}

/**
 * Is this Telegram user a member of the channel/group?
 * The bot must be an ADMIN of that channel, otherwise Telegram refuses.
 * chat: "@channelusername"
 */
async function isChannelMember(botToken, chat, telegramId) {
  try {
    const url =
      `https://api.telegram.org/bot${botToken}/getChatMember` +
      `?chat_id=${encodeURIComponent(chat)}&user_id=${telegramId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    if (!j.ok) return false;
    const s = j.result.status;
    return (
      ["creator", "administrator", "member"].includes(s) ||
      (s === "restricted" && j.result.is_member === true)
    );
  } catch {
    return false;
  }
}

module.exports = { verifyInitData, isChannelMember };