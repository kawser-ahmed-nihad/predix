// Thin client for the CricketData (formerly CricAPI) API.
// Docs: https://cricketdata.org/how-to-use-cricket-data-api.aspx
//
// The FREE plan allows only ~100 hits per day, so every call goes through a
// local daily budget guard. If you move to a paid plan, raise CRICKET_DAILY_LIMIT
// and run the sync job more often.

const BASE = "https://api.cricapi.com/v1";
const DAILY_LIMIT = Number(process.env.CRICKET_DAILY_LIMIT || 90);

const today = () => new Date().toISOString().slice(0, 10);
let usage = { day: today(), count: 0 };

async function fetchCurrentMatches() {
  const key = process.env.CRICKET_API_KEY;
  if (!key) throw new Error("CRICKET_API_KEY is missing");

  if (usage.day !== today()) usage = { day: today(), count: 0 };
  if (usage.count >= DAILY_LIMIT) {
    throw new Error(`cricket api daily budget used up (${DAILY_LIMIT})`);
  }
  usage.count++;

  const res = await fetch(`${BASE}/currentMatches?apikey=${key}&offset=0`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`cricket api http ${res.status}`);

  const json = await res.json();
  if (json.status !== "success") {
    throw new Error(`cricket api error: ${json.reason || json.status}`);
  }
  return { matches: json.data || [], info: json.info, usedToday: usage.count };
}

module.exports = { fetchCurrentMatches };