#!/usr/bin/env node
"use strict";

/**
 * Conservative server-side score updater draft.
 *
 * Defaults:
 * - DRY_RUN=1
 * - MOCK_FIXTURES=1 while dry-run is active unless explicitly set otherwise
 *
 * This keeps validation from calling API-Football or writing to Supabase.
 */

try {
  require("dotenv").config({ quiet: true });
} catch (_) {
  // dotenv is optional; scheduled hosts can provide real env vars directly.
}

const fs = require("fs");
const https = require("https");
const path = require("path");

const ISTANBUL_TZ = "Europe/Istanbul";
const MATCHES_FILE = path.join(__dirname, "matches.json");
const FIXTURE_MAP_FILE = path.join(__dirname, "fixture-map.json");
const BUDGET_FILE = path.join(__dirname, ".api-budget.json");
const DEFAULT_DAILY_BUDGET = 100;
const DEFAULT_RESERVE = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

class BudgetExhaustedError extends Error {
  constructor(snapshot) {
    super("Daily API budget limit reached");
    this.name = "BudgetExhaustedError";
    this.code = "BUDGET_EXHAUSTED";
    this.snapshot = snapshot;
  }
}

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readConfig() {
  const dryRun = parseBool(process.env.DRY_RUN, true);

  return {
    apiFootballKey: cleanEnv("API_FOOTBALL_KEY"),
    supabaseUrl: cleanEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: cleanEnv("SUPABASE_SERVICE_ROLE_KEY"),
    apiFootballLeagueId: cleanEnv("API_FOOTBALL_LEAGUE_ID"),
    apiFootballSeason: cleanEnv("API_FOOTBALL_SEASON"),
    dryRun,
    mockFixtures: parseBool(process.env.MOCK_FIXTURES, dryRun),
    discoverFixtures: parseBool(process.env.DISCOVER_FIXTURES, false),
    discoverLeagues: parseBool(process.env.DISCOVER_LEAGUES, false),
    leagueSearch: cleanEnv("LEAGUE_SEARCH"),
    leagueCountry: cleanEnv("LEAGUE_COUNTRY"),
    matchDate: cleanEnv("MATCH_DATE"),
    force: parseBool(process.env.FORCE, false),
    help: parseBool(process.env.HELP, false),
    dailyBudget: parsePositiveInt(
      cleanEnv("SCORE_UPDATE_BUDGET_DAILY") || cleanEnv("API_FOOTBALL_DAILY_BUDGET"),
      DEFAULT_DAILY_BUDGET
    ),
    reserve: Math.max(
      0,
      parsePositiveInt(
        cleanEnv("SCORE_UPDATE_RESERVE") || cleanEnv("API_FOOTBALL_BUDGET_RESERVE"),
        DEFAULT_RESERVE
      )
    )
  };
}

function validateConfig(config) {
  if (config.matchDate && !DATE_RE.test(config.matchDate)) {
    throw new ConfigError("MATCH_DATE must use YYYY-MM-DD format.");
  }

  if (!config.discoverLeagues && config.apiFootballLeagueId && !config.apiFootballSeason) {
    throw new ConfigError("API_FOOTBALL_SEASON is required when API_FOOTBALL_LEAGUE_ID is set.");
  }

  if (!config.discoverFixtures && !config.discoverLeagues && !config.dryRun && config.mockFixtures) {
    throw new ConfigError("Refusing to write mock fixtures. Set MOCK_FIXTURES=0 before real Supabase writes.");
  }

  if (!config.mockFixtures && !config.apiFootballKey) {
    throw new ConfigError("Missing API_FOOTBALL_KEY for non-mock score fetch.");
  }

  if (!config.discoverFixtures && !config.discoverLeagues && !config.dryRun) {
    const missing = [];
    if (!config.supabaseUrl) missing.push("SUPABASE_URL");
    if (!config.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) {
      throw new ConfigError(`Missing required server-only env var(s): ${missing.join(", ")}.`);
    }
  }
}

function log(message) {
  console.log(`[score-updater] ${message}`);
}

function warn(message) {
  console.warn(`[score-updater] ${message}`);
}

function printHelp() {
  console.log(`
WC2026 score updater

Safe defaults:
  DRY_RUN=1
  MOCK_FIXTURES=1

Examples:
  Mock dry-run, no API-Football calls, no Supabase writes:
    npm --prefix server run update:scores:mock

  Future real provider dry-run, may consume API-Football quota, still no Supabase writes:
    DRY_RUN=1 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

  Future league/season dry-run:
    DRY_RUN=1 MOCK_FIXTURES=0 API_FOOTBALL_LEAGUE_ID=YOUR_LEAGUE_ID API_FOOTBALL_SEASON=2026 node server/update-scores.js

  Future discovery report, never writes to Supabase:
    DISCOVER_FIXTURES=1 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

  Future league discovery, never writes to Supabase:
    DISCOVER_LEAGUES=1 MOCK_FIXTURES=0 LEAGUE_SEARCH="World Cup" node server/update-scores.js

  Future real write, later and dangerous until mappings are reviewed:
    DRY_RUN=0 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

Server-only env vars:
  API_FOOTBALL_KEY
  API_FOOTBALL_LEAGUE_ID
  API_FOOTBALL_SEASON
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SCORE_UPDATE_BUDGET_DAILY
  SCORE_UPDATE_RESERVE
  DRY_RUN
  MOCK_FIXTURES
  DISCOVER_FIXTURES
  DISCOVER_LEAGUES
  LEAGUE_SEARCH
  LEAGUE_COUNTRY
  MATCH_DATE
  HELP

Never place API_FOOTBALL_KEY or SUPABASE_SERVICE_ROLE_KEY in frontend config.
`.trim());
}

function redactSecrets(text, config = readConfig()) {
  let out = String(text || "");
  const values = [config.apiFootballKey, config.supabaseServiceRoleKey].filter((v) => v && v.length >= 8);
  for (const secret of values) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadInternalMatches() {
  const matches = readJson(MATCHES_FILE, null);
  if (!Array.isArray(matches)) {
    throw new ConfigError(`Could not read internal matches from ${MATCHES_FILE}.`);
  }
  return matches;
}

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

function normalizeBudget(config, now = new Date()) {
  const dayKey = istanbulDayKey(now);
  const state = readJson(BUDGET_FILE, null);
  if (!state || state.dayKey !== dayKey) {
    return { dayKey, count: 0, updatedAt: now.toISOString() };
  }
  return {
    dayKey,
    count: Number(state.count || 0),
    updatedAt: state.updatedAt || now.toISOString(),
    lastPath: state.lastPath || null
  };
}

function budgetSnapshot(config, state = normalizeBudget(config)) {
  const spendLimit = Math.max(0, config.dailyBudget - config.reserve);
  return {
    dayKey: state.dayKey,
    used: state.count,
    dailyBudget: config.dailyBudget,
    reserve: config.reserve,
    spendLimit
  };
}

function reserveApiCall(apiPath, config, now = new Date()) {
  const state = normalizeBudget(config, now);
  const snapshot = budgetSnapshot(config, state);
  if (state.count + 1 > snapshot.spendLimit) {
    throw new BudgetExhaustedError(snapshot);
  }

  state.count += 1;
  state.updatedAt = now.toISOString();
  state.lastPath = apiPath;
  writeJson(BUDGET_FILE, state);
  return budgetSnapshot(config, state);
}

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function clampInt(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function mapStatus(short) {
  const code = String(short || "").toUpperCase();
  if (["NS", "TBD"].includes(code)) return "upcoming";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(code)) return "live";
  if (["FT", "AET", "PEN"].includes(code)) return "finished";
  return null;
}

function fixtureDateMs(fixture) {
  const raw = fixture?.fixture?.date;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function matchDateMs(match) {
  if (!match?.utc) return null;
  const ms = Date.parse(match.utc);
  return Number.isFinite(ms) ? ms : null;
}

function loadFixtureMap() {
  const explicit = cleanEnv("FIXTURE_MAP_FILE");
  const candidates = explicit ? [explicit] : [FIXTURE_MAP_FILE, path.join(__dirname, "api-football-fixtures.json")];
  for (const file of candidates) {
    const data = readJson(file, null);
    if (data && typeof data === "object") return data;
  }
  return [];
}

function normalizeFixtureMapEntries(fixtureMap) {
  if (Array.isArray(fixtureMap)) return fixtureMap;
  if (Array.isArray(fixtureMap?.matches)) return fixtureMap.matches;
  if (!fixtureMap || typeof fixtureMap !== "object") return [];

  return Object.entries(fixtureMap)
    .map(([key, value]) => {
      if (value && typeof value === "object") {
        return {
          id: Number(value.id || key),
          utc: value.utc,
          home: value.home || value.h,
          away: value.away || value.a,
          homeAliases: value.homeAliases || [],
          awayAliases: value.awayAliases || [],
          apiFixtureId: value.apiFixtureId ?? value.apiFootballFixtureId ?? value.fixtureId ?? value.fixture_id ?? null
        };
      }

      if (Number.isInteger(Number(value))) {
        return {
          id: Number(value),
          apiFixtureId: Number(key),
          homeAliases: [],
          awayAliases: []
        };
      }

      return null;
    })
    .filter((entry) => entry && Number.isInteger(Number(entry.id)));
}

function dateCloseEnough(fixture, matchLike) {
  const apiDateMs = fixtureDateMs(fixture);
  const internalMs = matchDateMs(matchLike);
  if (apiDateMs === null || internalMs === null) return true;
  const maxDistanceMs = 36 * 60 * 60 * 1000;
  return Math.abs(apiDateMs - internalMs) <= maxDistanceMs;
}

function aliasesMatch(providerName, aliases = []) {
  const normalized = normalizeTeamName(providerName);
  if (!normalized) return false;
  return aliases.map(normalizeTeamName).includes(normalized);
}

function entryAliases(entry, side) {
  const base = side === "home" ? entry.home : entry.away;
  const aliases = side === "home" ? entry.homeAliases : entry.awayAliases;
  return Array.from(new Set([base, ...(Array.isArray(aliases) ? aliases : [])].filter(Boolean)));
}

function internalMatchForEntry(entry, matches) {
  return matches.find((m) => Number(m.id) === Number(entry.id)) || null;
}

function matchFromFixtureId(fixture, matches, entries) {
  const fixtureId = fixture?.fixture?.id;
  if (!fixtureId) return null;
  const id = String(fixtureId);

  for (const entry of entries) {
    if (entry.apiFixtureId === null || entry.apiFixtureId === undefined || entry.apiFixtureId === "") continue;
    if (String(entry.apiFixtureId) === id) {
      const match = internalMatchForEntry(entry, matches);
      if (match && dateCloseEnough(fixture, entry.utc ? entry : match)) return match;
      return null;
    }
  }

  return null;
}

function matchFromAliases(fixture, matches, entries) {
  const home = fixture?.teams?.home?.name;
  const away = fixture?.teams?.away?.name;
  if (!home || !away) return null;

  const candidates = entries
    .filter((entry) => aliasesMatch(home, entryAliases(entry, "home")) && aliasesMatch(away, entryAliases(entry, "away")))
    .filter((entry) => dateCloseEnough(fixture, entry.utc ? entry : internalMatchForEntry(entry, matches)))
    .map((entry) => internalMatchForEntry(entry, matches))
    .filter(Boolean);

  return candidates.length === 1 ? candidates[0] : null;
}

function providerFixtureSummary(fixture) {
  return {
    providerFixtureId: fixture?.fixture?.id ?? null,
    providerHome: fixture?.teams?.home?.name || null,
    providerAway: fixture?.teams?.away?.name || null,
    fixtureUtc: fixture?.fixture?.date || null
  };
}

function uniqueMatches(matches) {
  const out = new Map();
  for (const match of matches.filter(Boolean)) {
    out.set(Number(match.id), match);
  }
  return Array.from(out.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

function candidateIds(matches) {
  return uniqueMatches(matches).map((m) => Number(m.id));
}

function analyzeFixtureMapping(fixture, matches, fixtureMap = {}) {
  const entries = normalizeFixtureMapEntries(fixtureMap);
  const fixtureId = fixture?.fixture?.id;

  if (fixtureId !== null && fixtureId !== undefined && fixtureId !== "") {
    const idMatches = entries
      .filter((entry) => entry.apiFixtureId !== null && entry.apiFixtureId !== undefined && entry.apiFixtureId !== "")
      .filter((entry) => String(entry.apiFixtureId) === String(fixtureId))
      .map((entry) => ({ entry, match: internalMatchForEntry(entry, matches) }))
      .filter((item) => item.match);

    if (idMatches.length) {
      const close = idMatches.filter((item) => dateCloseEnough(fixture, item.entry.utc ? item.entry : item.match));
      if (close.length === 1) {
        return { match: close[0].match, mappedBy: "apiFixtureId", ambiguous: false, candidates: [close[0].match] };
      }
      return {
        match: null,
        mappedBy: "apiFixtureId",
        ambiguous: close.length > 1,
        candidates: close.length ? close.map((item) => item.match) : idMatches.map((item) => item.match),
        reason: close.length > 1 ? "Multiple fixture-map entries share this provider fixture id." : "Provider fixture id matched, but kickoff date was outside the safety window."
      };
    }
  }

  const home = fixture?.teams?.home?.name;
  const away = fixture?.teams?.away?.name;
  if (!home || !away) {
    return {
      match: null,
      mappedBy: null,
      ambiguous: false,
      candidates: [],
      reason: "Provider fixture is missing home or away team name."
    };
  }

  const aliasMatches = entries
    .filter((entry) => aliasesMatch(home, entryAliases(entry, "home")) && aliasesMatch(away, entryAliases(entry, "away")))
    .map((entry) => ({ entry, match: internalMatchForEntry(entry, matches) }))
    .filter((item) => item.match);

  if (aliasMatches.length) {
    const close = aliasMatches.filter((item) => dateCloseEnough(fixture, item.entry.utc ? item.entry : item.match));
    if (close.length === 1) {
      return { match: close[0].match, mappedBy: "alias", ambiguous: false, candidates: [close[0].match] };
    }
    return {
      match: null,
      mappedBy: "alias",
      ambiguous: close.length > 1,
      candidates: close.length ? close.map((item) => item.match) : aliasMatches.map((item) => item.match),
      reason: close.length > 1 ? "Alias match produced multiple date-safe internal candidates." : "Alias matched, but kickoff date was outside the safety window."
    };
  }

  const normalizedHome = normalizeTeamName(home);
  const normalizedAway = normalizeTeamName(away);
  const normalizedMatches = matches.filter((m) => normalizeTeamName(m.h) === normalizedHome && normalizeTeamName(m.a) === normalizedAway);

  if (normalizedMatches.length) {
    const close = normalizedMatches.filter((m) => dateCloseEnough(fixture, m));
    if (close.length === 1) {
      return { match: close[0], mappedBy: "normalized", ambiguous: false, candidates: [close[0]] };
    }
    return {
      match: null,
      mappedBy: "normalized",
      ambiguous: close.length > 1,
      candidates: close.length ? close : normalizedMatches,
      reason: close.length > 1 ? "Normalized fallback produced multiple date-safe internal candidates." : "Normalized fallback matched, but kickoff date was outside the safety window."
    };
  }

  return {
    match: null,
    mappedBy: null,
    ambiguous: false,
    candidates: [],
    reason: "No fixture id, alias, or normalized team-name match found."
  };
}

function mapFixtureToInternalMatch(fixture, matches, fixtureMap = {}) {
  return analyzeFixtureMapping(fixture, matches, fixtureMap).match;
}

function normalizeFixtureScore(fixture, internalMatch) {
  const status = mapStatus(fixture?.fixture?.status?.short);
  if (!status) return null;

  return {
    match_id: Number(internalMatch.id),
    home_score: clampInt(fixture?.goals?.home, 0, 20, 0),
    away_score: clampInt(fixture?.goals?.away, 0, 20, 0),
    status,
    minute: clampInt(fixture?.fixture?.status?.elapsed, 0, 130, 0)
  };
}

function buildScorePlan(fixtures, matches, fixtureMap = {}) {
  const rowsByMatchId = new Map();
  const previewByMatchId = new Map();
  const report = {
    providerFixturesFetched: fixtures.length,
    mapped: [],
    unmapped: [],
    ambiguous: [],
    skipped: []
  };

  for (const fixture of fixtures) {
    const summary = providerFixtureSummary(fixture);
    const mapping = analyzeFixtureMapping(fixture, matches, fixtureMap);
    const internalMatch = mapping.match;

    if (!internalMatch) {
      const item = {
        ...summary,
        reason: mapping.reason || "Fixture could not be mapped safely.",
        candidateMatchIds: candidateIds(mapping.candidates || [])
      };
      if (mapping.ambiguous) report.ambiguous.push(item);
      else report.unmapped.push(item);
      continue;
    }

    const row = normalizeFixtureScore(fixture, internalMatch);
    if (!row) {
      report.skipped.push({
        ...summary,
        internalMatchId: Number(internalMatch.id),
        mappedBy: mapping.mappedBy,
        reason: "Unsupported provider status."
      });
      continue;
    }

    if (rowsByMatchId.has(row.match_id)) {
      report.skipped.push({
        ...summary,
        internalMatchId: row.match_id,
        mappedBy: mapping.mappedBy,
        reason: "Duplicate provider fixture mapped to an internal match that already has a planned row."
      });
      continue;
    }

    const preview = {
      match_id: row.match_id,
      home_score: row.home_score,
      away_score: row.away_score,
      status: row.status,
      minute: row.minute,
      provider_fixture_id: summary.providerFixtureId,
      mapped_by: mapping.mappedBy
    };

    rowsByMatchId.set(row.match_id, row);
    previewByMatchId.set(row.match_id, preview);
    report.mapped.push({
      ...summary,
      internalMatchId: row.match_id,
      mappedBy: mapping.mappedBy
    });
  }

  return {
    rows: Array.from(rowsByMatchId.values()).sort((a, b) => a.match_id - b.match_id),
    previewRows: Array.from(previewByMatchId.values()).sort((a, b) => a.match_id - b.match_id),
    report
  };
}

function buildScoreRows(fixtures, matches, fixtureMap = {}) {
  return buildScorePlan(fixtures, matches, fixtureMap).rows;
}

function makeMockFixtures(matches) {
  const byId = new Map(matches.map((m) => [Number(m.id), m]));
  const samples = [
    { id: 1, home: "Mexico", away: "South Africa", status: "FT", elapsed: 90, goals: [2, 1] },
    { id: 2, home: "South Korea", away: "Czechia", status: "1H", elapsed: 15, goals: [0, 0] },
    { id: 4, home: "USA", away: "Paraguay", status: "NS", elapsed: 0, goals: [0, 0] },
    { id: 11, home: "Ivory Coast", away: "Ecuador", status: "FT", elapsed: 90, goals: [1, 1] },
    { id: 13, home: "Spain", away: "Cape Verde", status: "2H", elapsed: 65, goals: [2, 0] },
    { id: 21, home: "Portugal", away: "DR Congo", status: "FT", elapsed: 90, goals: [3, 1] }
  ];

  return samples
    .map((sample, index) => {
      const internal = byId.get(sample.id);
      if (!internal) return null;
      return {
        fixture: {
          id: 900001 + index,
          date: internal.utc,
          status: { short: sample.status, elapsed: sample.elapsed }
        },
        teams: {
          home: { name: sample.home },
          away: { name: sample.away }
        },
        goals: { home: sample.goals[0], away: sample.goals[1] }
      };
    })
    .filter(Boolean);
}

function selectMatchesToCheck(matches, config, now = new Date()) {
  if (config.matchDate) {
    return matches.filter((m) => utcDayKey(new Date(m.utc)) === config.matchDate);
  }

  const today = istanbulDayKey(now);
  return matches.filter((m) => istanbulDayKey(new Date(m.utc)) === today);
}

function apiPathsForMatches(matchesToCheck, config) {
  if (config.apiFootballLeagueId) {
    const params = new URLSearchParams({
      league: config.apiFootballLeagueId,
      season: config.apiFootballSeason
    });
    if (config.matchDate) params.set("date", config.matchDate);
    return [`/fixtures?${params.toString()}`];
  }

  if (config.matchDate) return [`/fixtures?date=${encodeURIComponent(config.matchDate)}`];
  if (!matchesToCheck.length && config.force) return ["/fixtures?live=all"];
  const dates = new Set(matchesToCheck.map((m) => utcDayKey(new Date(m.utc))));
  return Array.from(dates).sort().map((day) => `/fixtures?date=${day}`);
}

function fetchApiFootballJson(apiPath, config) {
  reserveApiCall(apiPath, config);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "v3.football.api-sports.io",
        path: apiPath,
        method: "GET",
        headers: {
          "x-apisports-key": config.apiFootballKey
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`API-Football request failed with status ${res.statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`API-Football returned invalid JSON: ${e.message}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function leagueApiPaths(config) {
  const paths = [];
  const targetSeason = config.apiFootballSeason || "";

  function addPath(params) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    if (!Object.keys(clean).length) return;
    paths.push(`/leagues?${new URLSearchParams(clean).toString()}`);
  }

  if (config.leagueSearch && config.leagueCountry) {
    addPath({ search: config.leagueSearch, country: config.leagueCountry, season: targetSeason });
  }

  if (config.leagueSearch) {
    addPath({ search: config.leagueSearch, season: targetSeason });
  }

  if (config.leagueCountry) {
    addPath({ country: config.leagueCountry, season: targetSeason });
  }

  if (targetSeason) {
    addPath({ season: targetSeason });
  }

  return Array.from(new Set(paths));
}

function makeMockLeagues() {
  return [
    {
      league: { id: 1, name: "FIFA World Cup", type: "Cup" },
      country: { name: "World" },
      seasons: [{ year: 2022 }, { year: 2026 }]
    },
    {
      league: { id: 2, name: "Club World Cup", type: "Cup" },
      country: { name: "World" },
      seasons: [{ year: 2025 }]
    },
    {
      league: { id: 3, name: "World Cup Qualification", type: "Cup" },
      country: { name: "World" },
      seasons: [{ year: 2026 }]
    }
  ];
}

async function fetchLeagues(config) {
  if (config.mockFixtures) {
    log("Using mock leagues. No API-Football calls will be made.");
    return { leagues: makeMockLeagues(), apiPaths: [], source: "mock" };
  }

  const paths = leagueApiPaths(config);
  if (!paths.length) {
    throw new ConfigError("Set LEAGUE_SEARCH, LEAGUE_COUNTRY, or API_FOOTBALL_SEASON for league discovery.");
  }

  const byLeagueId = new Map();
  for (const apiPath of paths) {
    log(`Fetching API-Football path ${apiPath}.`);
    const payload = await fetchApiFootballJson(apiPath, config);
    for (const row of payload.response || []) {
      const id = row?.league?.id;
      byLeagueId.set(id ?? `${row?.league?.name || "unknown"}:${row?.country?.name || "unknown"}`, row);
    }
  }

  return { leagues: Array.from(byLeagueId.values()), apiPaths: paths, source: "api-football" };
}

async function fetchFixtures(config, matchesToCheck) {
  if (config.mockFixtures) {
    log("Using mock fixtures. No API-Football calls will be made.");
    return {
      fixtures: makeMockFixtures(matchesToCheck.length ? matchesToCheck : loadInternalMatches()),
      apiPaths: [],
      source: "mock"
    };
  }

  const paths = apiPathsForMatches(matchesToCheck, config);
  if (!paths.length) {
    log("No internal matches selected for an external API check.");
    return { fixtures: [], apiPaths: [], source: "api-football" };
  }

  const fixtures = [];
  for (const apiPath of paths) {
    log(`Fetching API-Football path ${apiPath}.`);
    const payload = await fetchApiFootballJson(apiPath, config);
    fixtures.push(...(payload.response || []));
  }
  return { fixtures, apiPaths: paths, source: "api-football" };
}

function budgetLine(snapshot) {
  const remaining = Math.max(0, snapshot.spendLimit - snapshot.used);
  return `day ${snapshot.dayKey}, used ${snapshot.used}/${snapshot.spendLimit}, reserve ${snapshot.reserve}, remaining ${remaining}`;
}

function queryModeLabel(config) {
  if (config.apiFootballLeagueId && config.matchDate) return "league+season+date";
  if (config.apiFootballLeagueId) return "league+season";
  if (config.matchDate) return "date";
  if (config.force) return "force/live";
  return "match-aware";
}

function selectedDateLabel(config, matchesToCheck) {
  if (config.matchDate) return config.matchDate;
  const dates = Array.from(new Set(matchesToCheck.map((m) => utcDayKey(new Date(m.utc))))).sort();
  if (dates.length) return dates.join(", ");
  return "none selected";
}

function zeroFixtureGuidance(config) {
  return [
    "fixtures not published by the provider yet",
    "wrong MATCH_DATE",
    "league/season parameters may be required",
    "API_FOOTBALL_LEAGUE_ID or API_FOOTBALL_SEASON may be incorrect",
    "API plan/provider coverage limitation",
    "tournament may not be available in API-Football yet"
  ].filter((reason) => config.apiFootballLeagueId || !reason.includes("incorrect"));
}

function printZeroFixtureGuidance(config) {
  warn("Provider returned 0 fixtures. Possible reasons:");
  for (const reason of zeroFixtureGuidance(config)) {
    warn(`- ${reason}`);
  }
}

function printScoreReport(context) {
  const { config, matchesToCheck, fetchResult, plan, budgetBefore, budgetAfter } = context;
  const report = plan.report;

  log("--- Score updater report ---");
  log(`Query mode: ${queryModeLabel(config)}`);
  log(`Selected match date: ${selectedDateLabel(config, matchesToCheck)}`);
  log(`API-Football league id: ${config.apiFootballLeagueId || "not set"}`);
  log(`API-Football season: ${config.apiFootballLeagueId ? config.apiFootballSeason : "not set"}`);
  log(`Provider source: ${fetchResult.source}`);
  log(`API paths: ${fetchResult.apiPaths.length ? fetchResult.apiPaths.join(", ") : "none"}`);
  log(`Provider fixtures fetched count: ${report.providerFixturesFetched}`);
  log(`Mapped fixtures count: ${report.mapped.length}`);
  log(`Unmapped fixtures count: ${report.unmapped.length}`);
  log(`Ambiguous fixtures count: ${report.ambiguous.length}`);
  log(`Skipped fixtures count: ${report.skipped.length}`);
  log(`Planned Supabase upserts: ${plan.rows.length}`);
  log(`API budget before: ${budgetLine(budgetBefore)}`);
  log(`API budget after: ${budgetLine(budgetAfter)}${config.mockFixtures ? " (mock mode did not touch budget file)" : ""}`);
  log(`Supabase writes: ${config.dryRun ? "skipped because DRY_RUN=1" : "enabled"}`);

  if (report.providerFixturesFetched === 0 && !config.mockFixtures) {
    printZeroFixtureGuidance(config);
  }

  if (report.unmapped.length) {
    warn("Unmapped fixture details:");
    console.log(JSON.stringify(report.unmapped, null, 2));
  } else {
    log("Unmapped fixture details: none");
  }

  if (report.ambiguous.length) {
    warn("Ambiguous fixture details:");
    console.log(JSON.stringify(report.ambiguous, null, 2));
  } else {
    log("Ambiguous fixture details: none");
  }

  if (report.skipped.length) {
    warn("Skipped fixture details:");
    console.log(JSON.stringify(report.skipped, null, 2));
  } else {
    log("Skipped fixture details: none");
  }

  if (plan.previewRows.length) {
    log("Planned Supabase upsert preview:");
    console.table(plan.previewRows);
  } else {
    log("Planned Supabase upsert preview: none");
  }
}

function discoveryRow(fixture, mapping) {
  const summary = providerFixtureSummary(fixture);
  return {
    provider_fixture_id: summary.providerFixtureId,
    provider_home: summary.providerHome,
    provider_away: summary.providerAway,
    kickoff_utc: summary.fixtureUtc,
    league_id: fixture?.league?.id ?? null,
    league_name: fixture?.league?.name || null,
    season: fixture?.league?.season ?? null,
    status: fixture?.fixture?.status?.short || null,
    internal_match_id: mapping.match ? Number(mapping.match.id) : null,
    mapped_by: mapping.match ? mapping.mappedBy : null,
    candidate_match_ids: candidateIds(mapping.candidates || []).join(","),
    mapping_note: mapping.match ? "mapped for review only" : mapping.reason || "not mapped"
  };
}

function printDiscoveryReport(context) {
  const { config, matches, matchesToCheck, fetchResult, fixtureMap, budgetBefore, budgetAfter } = context;
  const rows = fetchResult.fixtures.map((fixture) => discoveryRow(fixture, analyzeFixtureMapping(fixture, matches, fixtureMap)));
  const mappedCount = rows.filter((row) => row.internal_match_id !== null).length;
  const ambiguousCount = rows.filter((row) => row.candidate_match_ids && row.candidate_match_ids.includes(",")).length;
  const unmappedCount = rows.length - mappedCount;

  log("--- Fixture discovery report ---");
  log("Discovery mode: Supabase writes are disabled regardless of DRY_RUN.");
  log(`Query mode: ${queryModeLabel(config)}`);
  log(`Selected match date: ${selectedDateLabel(config, matchesToCheck)}`);
  log(`API-Football league id: ${config.apiFootballLeagueId || "not set"}`);
  log(`API-Football season: ${config.apiFootballLeagueId ? config.apiFootballSeason : "not set"}`);
  log(`API paths: ${fetchResult.apiPaths.length ? fetchResult.apiPaths.join(", ") : "none"}`);
  log(`Fixtures fetched count: ${rows.length}`);
  log(`Discovery mapped fixtures count: ${mappedCount}`);
  log(`Discovery unmapped fixtures count: ${unmappedCount}`);
  log(`Discovery ambiguous fixtures count: ${ambiguousCount}`);
  log(`API budget before: ${budgetLine(budgetBefore)}`);
  log(`API budget after: ${budgetLine(budgetAfter)}${config.mockFixtures ? " (mock mode did not touch budget file)" : ""}`);

  if (!rows.length && !config.mockFixtures) {
    printZeroFixtureGuidance(config);
  }

  if (rows.length) {
    log("Provider fixture discovery rows:");
    console.table(rows);
  } else {
    log("Provider fixture discovery rows: none");
  }
}

function leagueDiscoveryRow(row, targetSeason) {
  const seasons = Array.isArray(row?.seasons) ? row.seasons.map((season) => season?.year).filter(Boolean) : [];
  const text = `${row?.league?.name || ""} ${row?.country?.name || ""}`.toLowerCase();
  const hasTargetSeason = targetSeason ? seasons.map(String).includes(String(targetSeason)) : false;
  const possibleWorldCupCandidate =
    text.includes("world cup") ||
    text.includes("fifa") ||
    (text.includes("world") && text.includes("cup"));

  return {
    league_id: row?.league?.id ?? null,
    league_name: row?.league?.name || null,
    country_name: row?.country?.name || null,
    league_type: row?.league?.type || null,
    seasons_available: seasons.join(","),
    has_target_season: hasTargetSeason,
    possible_world_cup_candidate: possibleWorldCupCandidate
  };
}

function printZeroLeagueGuidance(config) {
  warn("Provider returned 0 leagues. Possible reasons:");
  warn("- search text is too narrow or unsupported");
  warn("- country filter does not match API-Football naming");
  warn("- season filter has no matching competitions");
  warn("- API plan/provider coverage limitation");
  warn("- tournament data is not available in API-Football yet");
  if (!config.leagueSearch && !config.leagueCountry) {
    warn("- LEAGUE_SEARCH or LEAGUE_COUNTRY may be needed to narrow the search");
  }
}

function printLeagueDiscoveryReport(context) {
  const { config, fetchResult, budgetBefore, budgetAfter } = context;
  const targetSeason = config.apiFootballSeason || "2026";
  const rows = fetchResult.leagues.map((row) => leagueDiscoveryRow(row, targetSeason));
  const candidates = rows.filter((row) => row.possible_world_cup_candidate || row.has_target_season);

  log("--- League discovery report ---");
  log("League discovery mode: Supabase writes are disabled.");
  log(`Provider source: ${fetchResult.source}`);
  log(`API paths: ${fetchResult.apiPaths.length ? fetchResult.apiPaths.join(", ") : "none"}`);
  log(`League search: ${config.leagueSearch || "not set"}`);
  log(`League country: ${config.leagueCountry || "not set"}`);
  log(`Target season: ${targetSeason}`);
  log(`Leagues returned count: ${rows.length}`);
  log(`Possible World Cup candidates count: ${candidates.length}`);
  log(`API budget before: ${budgetLine(budgetBefore)}`);
  log(`API budget after: ${budgetLine(budgetAfter)}${config.mockFixtures ? " (mock mode did not touch budget file)" : ""}`);

  if (!rows.length && !config.mockFixtures) {
    printZeroLeagueGuidance(config);
  }

  if (rows.length) {
    log("League discovery rows:");
    console.table(rows);
  } else {
    log("League discovery rows: none");
  }

  if (candidates.length) {
    log("Possible World Cup candidates:");
    console.table(candidates);
  } else {
    log("Possible World Cup candidates: none");
  }
}

async function upsertScoresToSupabase(rows, config) {
  if (!rows.length) {
    log("No score rows to upsert.");
    return { written: 0 };
  }

  if (config.discoverFixtures) {
    log("Discovery mode is active. Supabase write skipped.");
    return { written: 0 };
  }

  if (config.dryRun) {
    log("Dry-run is active. Supabase write skipped.");
    return { written: 0 };
  }

  const baseUrl = config.supabaseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/rest/v1/scores?on_conflict=match_id`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase scores upsert failed with status ${response.status}: ${body.slice(0, 300)}`);
  }

  log(`Upserted ${rows.length} score row(s) into public.scores.`);
  return { written: rows.length };
}

async function main() {
  const config = readConfig();
  if (config.help) {
    printHelp();
    return { ok: true, help: true };
  }

  validateConfig(config);

  if (config.discoverLeagues) {
    const budgetBefore = budgetSnapshot(config);
    let fetchResult;
    try {
      fetchResult = await fetchLeagues(config);
    } catch (e) {
      if (e?.code === "BUDGET_EXHAUSTED") {
        const b = e.snapshot || budgetSnapshot(config);
        warn(`Budget exhausted for ${b.dayKey}: used ${b.used}/${b.spendLimit} before reserve. No external call made.`);
        return { ok: false, reason: "budget_exhausted", leagues: [] };
      }
      throw e;
    }
    const budgetAfter = budgetSnapshot(config);
    printLeagueDiscoveryReport({ config, fetchResult, budgetBefore, budgetAfter });
    return { ok: true, discovery: "leagues", leagues: fetchResult.leagues };
  }

  const matches = loadInternalMatches();
  const matchesToCheck = selectMatchesToCheck(matches, config);
  const fixtureMap = loadFixtureMap();
  const budgetBefore = budgetSnapshot(config);

  log(`Mode: ${config.dryRun ? "dry-run" : "write"}. Mock fixtures: ${config.mockFixtures ? "on" : "off"}.`);
  log(`Loaded ${matches.length} internal match(es); selected ${matchesToCheck.length} for this run.`);

  let fetchResult;
  try {
    fetchResult = await fetchFixtures(config, matchesToCheck);
  } catch (e) {
    if (e?.code === "BUDGET_EXHAUSTED") {
      const b = e.snapshot || budgetSnapshot(config);
      warn(`Budget exhausted for ${b.dayKey}: used ${b.used}/${b.spendLimit} before reserve. No external call made.`);
      return { ok: false, reason: "budget_exhausted", rows: [] };
    }
    throw e;
  }

  const plan = buildScorePlan(fetchResult.fixtures, matches, fixtureMap);
  const budgetAfter = budgetSnapshot(config);

  if (config.discoverFixtures) {
    printDiscoveryReport({ config, matches, matchesToCheck, fetchResult, fixtureMap, budgetBefore, budgetAfter });
    return { ok: true, discovery: true, rows: [], report: plan.report };
  }

  printScoreReport({ config, matchesToCheck, fetchResult, plan, budgetBefore, budgetAfter });
  const result = await upsertScoresToSupabase(plan.rows, config);
  return { ok: true, rows: plan.rows, report: plan.report, result };
}

function handleCliError(e) {
  const isConfig = e instanceof ConfigError;
  const label = isConfig ? "Configuration error" : "Score update failed";
  console.error(`[score-updater] ${label}: ${redactSecrets(e.message)}`);
  if (isConfig) {
    console.error("");
    printHelp();
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch(handleCliError);
}

module.exports = {
  analyzeFixtureMapping,
  buildScorePlan,
  buildScoreRows,
  handleCliError,
  main,
  mapFixtureToInternalMatch,
  mapStatus,
  normalizeTeamName,
  printDiscoveryReport,
  printHelp,
  printLeagueDiscoveryReport,
  readConfig,
  selectMatchesToCheck
};
