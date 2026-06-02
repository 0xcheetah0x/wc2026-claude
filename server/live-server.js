/**
 * WC2026 live score proxy - API-Football version
 *
 * Env:
 *   API_FOOTBALL_KEY - required for external API requests
 *   PORT - default 8787
 */

try {
  require("dotenv").config({ quiet: true });
} catch (_) {
  // dotenv is optional; production hosts should provide real environment vars.
}

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.API_FOOTBALL_KEY || "";
const DAILY_API_BUDGET = Math.max(1, Number(process.env.API_FOOTBALL_DAILY_BUDGET || 100));
const DAILY_BUDGET_RESERVE = Math.max(0, Number(process.env.API_FOOTBALL_BUDGET_RESERVE || 5));
const ISTANBUL_TZ = "Europe/Istanbul";
const SCORE_CACHE_FILE = path.join(__dirname, ".score-cache.json");
const BUDGET_FILE = path.join(__dirname, ".api-budget.json");
const MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000
};

// 14 planned checks for a normal group match: kickoff, key live minutes,
// stoppage-time, and final confirmation.
const MATCH_CHECKPOINT_MINUTES = [0, 5, 15, 30, 45, 50, 55, 65, 75, 85, 90, 100, 115, 130];

/* ===================== LOCAL STATE ===================== */

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (_) {
    // Runtime cache failures should not break the app.
  }
}

let scoreCache = readJson(SCORE_CACHE_FILE, null);
let budgetState = readJson(BUDGET_FILE, null);

/* ===================== MATCH DATA ===================== */

function loadInternalMatches() {
  const p = path.join(__dirname, "matches.json");
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const INTERNAL = loadInternalMatches();

/* ===================== TIME HELPERS ===================== */

function istanbulDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function matchStartMs(match) {
  return new Date(match.utc).getTime();
}

function isTodayInIstanbul(match, now = new Date()) {
  return istanbulDayKey(new Date(match.utc)) === istanbulDayKey(now);
}

function todaysMatches(now = new Date()) {
  return INTERNAL.filter((m) => isTodayInIstanbul(m, now));
}

function hasCachedLiveScore(data) {
  const scores = data?.scores || {};
  return Object.values(scores).some((row) => row && row.status === "live");
}

function emptyScoresResponse(now = new Date(), extra = {}) {
  return {
    ok: true,
    source: "api-football",
    updatedAt: now.toISOString(),
    scores: {},
    ...extra
  };
}

/* ===================== BUDGET ===================== */

function normalizeBudget(now = new Date()) {
  const dayKey = istanbulDayKey(now);
  if (!budgetState || budgetState.dayKey !== dayKey) {
    budgetState = { dayKey, count: 0, updatedAt: now.toISOString() };
    writeJson(BUDGET_FILE, budgetState);
  }
  return budgetState;
}

function budgetLimitBeforeReserve() {
  return Math.max(0, DAILY_API_BUDGET - DAILY_BUDGET_RESERVE);
}

function budgetCanSpend(count = 1, now = new Date()) {
  const state = normalizeBudget(now);
  return state.count + count <= budgetLimitBeforeReserve();
}

function reserveApiCall(apiPath, now = new Date()) {
  const state = normalizeBudget(now);
  if (state.count + 1 > budgetLimitBeforeReserve()) {
    const err = new Error("Daily API budget limit reached");
    err.code = "BUDGET_EXHAUSTED";
    throw err;
  }
  state.count += 1;
  state.updatedAt = now.toISOString();
  state.lastPath = apiPath;
  writeJson(BUDGET_FILE, state);
}

function budgetSnapshot(now = new Date()) {
  const state = normalizeBudget(now);
  return {
    dayKey: state.dayKey,
    used: state.count,
    dailyBudget: DAILY_API_BUDGET,
    reserve: DAILY_BUDGET_RESERVE,
    spendLimit: budgetLimitBeforeReserve()
  };
}

/* ===================== API HELPERS ===================== */

function fetchApiFootballJson(apiPath, apiKey = API_KEY) {
  if (!apiKey) {
    const err = new Error("Missing API_FOOTBALL_KEY");
    err.code = "MISSING_API_KEY";
    return Promise.reject(err);
  }

  reserveApiCall(apiPath);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "v3.football.api-sports.io",
      path: apiPath,
      method: "GET",
      headers: {
        "x-apisports-key": apiKey
      }
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          const err = new Error(`API-Football request failed with status ${res.statusCode}`);
          err.code = "API_HTTP_ERROR";
          reject(err);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          e.code = "API_PARSE_ERROR";
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function safeExternalError(e) {
  if (e?.code === "MISSING_API_KEY") return "Missing API_FOOTBALL_KEY";
  if (e?.code === "BUDGET_EXHAUSTED") return "Daily API budget limit reached";
  return "External score provider unavailable";
}

function withCacheMeta(data, now = new Date(), extra = {}) {
  return {
    ...data,
    cached: true,
    cacheExpiresAt: scoreCache?.expiresAt || null,
    servedAt: now.toISOString(),
    budget: budgetSnapshot(now),
    ...extra
  };
}

function cachedOrSafeError(now, message) {
  if (scoreCache?.data) {
    return withCacheMeta(scoreCache.data, now, {
      ok: false,
      error: message,
      fallback: "cache"
    });
  }
  return emptyScoresResponse(now, {
    ok: false,
    error: message,
    cached: false,
    budget: budgetSnapshot(now)
  });
}

/* ===================== SCORE CACHE POLICY ===================== */

function scoreCacheFresh(now = new Date()) {
  if (!scoreCache?.data || !scoreCache.expiresAt) return false;
  return Date.parse(scoreCache.expiresAt) > now.getTime();
}

function nextCheckpointMs(match, now = new Date()) {
  const start = matchStartMs(match);
  const elapsed = (now.getTime() - start) / MS.minute;
  if (elapsed < 0) return start;

  for (const minute of MATCH_CHECKPOINT_MINUTES) {
    const checkAt = start + minute * MS.minute;
    if (checkAt > now.getTime()) return checkAt;
  }

  return null;
}

function computeScoreCacheExpiry(now = new Date(), scores = {}) {
  const nowMs = now.getTime();
  const today = todaysMatches(now);

  if (!today.length && !hasCachedLiveScore({ scores })) {
    return new Date(nowMs + 6 * MS.hour).toISOString();
  }

  if (hasCachedLiveScore({ scores })) {
    const next = Math.min(
      ...today
        .map((m) => nextCheckpointMs(m, now))
        .filter((ms) => typeof ms === "number")
    );
    const liveFloor = nowMs + 5 * MS.minute;
    const liveExpiry = Number.isFinite(next) ? Math.max(liveFloor, next) : liveFloor;
    return new Date(liveExpiry).toISOString();
  }

  const unfinished = today.filter((m) => scores[String(m.id)]?.status !== "finished");
  if (!unfinished.length) {
    return new Date(nowMs + 12 * MS.hour).toISOString();
  }

  let next = Infinity;
  for (const match of unfinished) {
    const start = matchStartMs(match);
    const diff = start - nowMs;

    if (diff > 6 * MS.hour) {
      next = Math.min(next, nowMs + 6 * MS.hour);
    } else if (diff > MS.hour) {
      next = Math.min(next, Math.min(start - MS.hour, nowMs + 2 * MS.hour));
    } else if (diff > 0) {
      next = Math.min(next, start);
    } else {
      const checkAt = nextCheckpointMs(match, now);
      if (checkAt) next = Math.min(next, Math.max(nowMs + 5 * MS.minute, checkAt));
    }
  }

  if (!Number.isFinite(next)) {
    return new Date(nowMs + 6 * MS.hour).toISOString();
  }

  return new Date(Math.max(nowMs + MS.minute, next)).toISOString();
}

function shouldSkipExternalScoreFetch(now = new Date()) {
  if (scoreCacheFresh(now)) return true;
  if (todaysMatches(now).length > 0) return false;
  if (scoreCache?.data && hasCachedLiveScore(scoreCache.data)) return false;
  return true;
}

function persistScoreCache(data, expiresAt, reason, paths) {
  scoreCache = {
    data,
    expiresAt,
    reason,
    paths,
    savedAt: new Date().toISOString()
  };
  writeJson(SCORE_CACHE_FILE, scoreCache);
}

function scoreApiPaths(now = new Date()) {
  const today = todaysMatches(now);
  if (!today.length) return ["/fixtures?live=all"];

  const dates = new Set(today.map((m) => utcDayKey(new Date(m.utc))));
  return Array.from(dates).sort().map((day) => `/fixtures?date=${day}`);
}

/* ===================== SCORE PARSING ===================== */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "");
}

function findInternalMatch(home, away) {
  for (const m of INTERNAL) {
    if (norm(m.h) === norm(home) && norm(m.a) === norm(away)) {
      return m;
    }
  }
  return null;
}

function mapStatus(short) {
  if (!short) return null;
  if (["1H", "2H", "HT", "LIVE", "ET", "BT", "P"].includes(short)) return "live";
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  return null;
}

function addFixtureScores(payload, out) {
  for (const row of payload.response || []) {
    const status = mapStatus(row.fixture?.status?.short);
    if (!status) continue;

    const home = row.teams?.home?.name;
    const away = row.teams?.away?.name;
    const internal = findInternalMatch(home, away);
    if (!internal) continue;

    out.scores[String(internal.id)] = {
      h: row.goals?.home ?? 0,
      a: row.goals?.away ?? 0,
      status,
      minute: row.fixture?.status?.elapsed || 0
    };
  }
}

async function fetchFreshScores(now = new Date(), fetcher = fetchApiFootballJson) {
  const paths = scoreApiPaths(now);
  const out = emptyScoresResponse(now, { cached: false });

  for (const apiPath of paths) {
    const payload = await fetcher(apiPath);
    addFixtureScores(payload, out);
  }

  return { out, paths };
}

async function buildScores(options = {}) {
  const now = options.now || new Date();

  if (shouldSkipExternalScoreFetch(now)) {
    const base = scoreCache?.data || emptyScoresResponse(now, { cached: true });
    const expiresAt = scoreCache?.expiresAt && Date.parse(scoreCache.expiresAt) > now.getTime()
      ? scoreCache.expiresAt
      : computeScoreCacheExpiry(now, base.scores);
    if (!scoreCache?.data || scoreCache.expiresAt !== expiresAt) {
      persistScoreCache(base, expiresAt, "idle_or_fresh", []);
    }
    return withCacheMeta(base, now, { cacheReason: "idle_or_fresh" });
  }

  if (!API_KEY) {
    return cachedOrSafeError(now, "Missing API_FOOTBALL_KEY");
  }

  const paths = scoreApiPaths(now);
  if (!budgetCanSpend(paths.length, now)) {
    return cachedOrSafeError(now, "Daily API budget limit reached");
  }

  try {
    const fresh = await fetchFreshScores(now, options.fetcher || fetchApiFootballJson);
    const expiresAt = computeScoreCacheExpiry(now, fresh.out.scores);
    persistScoreCache(fresh.out, expiresAt, "fresh_api", fresh.paths);
    return {
      ...fresh.out,
      cacheExpiresAt: expiresAt,
      budget: budgetSnapshot(now)
    };
  } catch (e) {
    return cachedOrSafeError(now, safeExternalError(e));
  }
}

/* ===================== EVENTS ===================== */

async function buildEvents() {
  const out = {
    ok: true,
    source: "api-football",
    updatedAt: new Date().toISOString(),
    events: {}
  };

  if (!API_KEY) {
    out.ok = false;
    out.error = "Missing API_FOOTBALL_KEY";
    return out;
  }

  try {
    const data = await fetchApiFootballJson("/fixtures?live=all");

    for (const m of data.response || []) {
      const home = m.teams?.home?.name;
      const away = m.teams?.away?.name;

      const internal = findInternalMatch(home, away);
      if (!internal) continue;

      const fixtureId = m.fixture?.id;
      if (!fixtureId) continue;

      const evData = await fetchApiFootballJson(`/fixtures/events?fixture=${fixtureId}`);
      const parsed = [];

      for (const e of evData.response || []) {
        const type = e.type;
        const detail = e.detail;

        const event = {
          minute: e.time?.elapsed,
          team: e.team?.name,
          player: e.player?.name,
          type,
          detail
        };

        if (type === "Goal") {
          event.kind = "goal";
        } else if (type === "Goal" && detail === "Penalty") {
          event.kind = "penalty_goal";
        }

        parsed.push(event);
      }

      out.events[String(internal.id)] = parsed;
    }
  } catch (e) {
    out.ok = false;
    out.error = safeExternalError(e);
  }

  return out;
}

/* ===================== SERVER ===================== */

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    if (req.url.startsWith("/api/scores")) {
      const data = await buildScores();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(data));
    }

    if (req.url.startsWith("/api/events")) {
      const data = await buildEvents();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(data));
    }

    if (req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (_) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = {
  buildScores,
  computeScoreCacheExpiry,
  budgetSnapshot,
  server
};
