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

async function call(path, params = {}) {
  const key = process.env.CRICKET_API_KEY;
  if (!key) throw new Error("CRICKET_API_KEY is missing");

  if (usage.day !== today()) usage = { day: today(), count: 0 };
  if (usage.count >= DAILY_LIMIT) {
    throw new Error(`cricket api daily budget used up (${DAILY_LIMIT})`);
  }
  usage.count++;

  const qs = new URLSearchParams({ apikey: key, ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`cricket api http ${res.status}`);

  const json = await res.json();
  if (json.status !== "success") {
    throw new Error(`cricket api error: ${json.reason || json.status}`);
  }
  return json;
}

// The "matches" list contains finished AND upcoming matches (25 per page).
// ("currentMatches" only has live / just-finished ones, so it is not enough.)
async function fetchMatches(offset = 0) {
  const json = await call("matches", { offset });
  return { matches: json.data || [], usedToday: usage.count };
}

// One match in detail (toss winner, match winner ...). Costs 1 hit.
async function fetchMatchInfo(id) {
  const json = await call("match_info", { id });
  return json.data || null;
}

module.exports = { fetchMatches, fetchMatchInfo };