#!/usr/bin/env node
"use strict";

/**
 * Conservative server-side score updater draft.
 *
 * Defaults:
 * - SCORE_PROVIDER=api-football
 * - DRY_RUN=1
 * - API-Football mock fixtures remain enabled while dry-run is active unless
 *   explicitly disabled
 *
 * football-data.org supports finished-score writes only. Live writes remain
 * disabled until live payload validation is complete.
 */

const fs = require("fs");
const https = require("https");
const path = require("path");

try {
  require("dotenv").config({
    path: path.resolve(__dirname, "..", ".env"),
    quiet: true
  });
} catch (_) {
  // Run `npm --prefix server install`, or provide env vars through the host.
}

const ISTANBUL_TZ = "Europe/Istanbul";
const MATCHES_FILE = path.join(__dirname, "matches.json");
const FIXTURE_MAP_FILE = path.join(__dirname, "fixture-map.json");
const BUDGET_FILE = path.join(__dirname, ".api-budget.json");
const DEFAULT_DAILY_BUDGET = 100;
const DEFAULT_RESERVE = 20;
const API_FOOTBALL_PROVIDER = "api-football";
const FOOTBALL_DATA_PROVIDER = "football-data";
const FOOTBALL_DATA_API_BASE = "https://api.football-data.org";
const PROVIDER_REQUEST_TIMEOUT_MS = 15000;
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
  const scoreProvider = cleanEnv("SCORE_PROVIDER").toLowerCase() || API_FOOTBALL_PROVIDER;

  return {
    scoreProvider,
    apiFootballKey: cleanEnv("API_FOOTBALL_KEY"),
    footballDataToken: cleanEnv("FOOTBALL_DATA_TOKEN"),
    footballDataCompetition: cleanEnv("FOOTBALL_DATA_COMPETITION") || "WC",
    footballDataSeason: cleanEnv("FOOTBALL_DATA_SEASON") || "2026",
    supabaseUrl: cleanEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: cleanEnv("SUPABASE_SERVICE_ROLE_KEY"),
    apiFootballLeagueId: cleanEnv("API_FOOTBALL_LEAGUE_ID"),
    apiFootballSeason: cleanEnv("API_FOOTBALL_SEASON"),
    dryRun,
    mockFixtures:
      scoreProvider === API_FOOTBALL_PROVIDER &&
      parseBool(process.env.MOCK_FIXTURES, dryRun),
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
  if (![API_FOOTBALL_PROVIDER, FOOTBALL_DATA_PROVIDER].includes(config.scoreProvider)) {
    throw new ConfigError(
      `Unsupported SCORE_PROVIDER "${config.scoreProvider}". Use api-football or football-data.`
    );
  }

  if (config.matchDate && !DATE_RE.test(config.matchDate)) {
    throw new ConfigError("MATCH_DATE must use YYYY-MM-DD format.");
  }

  if (config.discoverLeagues && config.scoreProvider !== API_FOOTBALL_PROVIDER) {
    throw new ConfigError("League discovery is available only for SCORE_PROVIDER=api-football.");
  }

  if (
    config.scoreProvider === API_FOOTBALL_PROVIDER &&
    !config.discoverLeagues &&
    config.apiFootballLeagueId &&
    !config.apiFootballSeason
  ) {
    throw new ConfigError("API_FOOTBALL_SEASON is required when API_FOOTBALL_LEAGUE_ID is set.");
  }

  if (!config.discoverFixtures && !config.discoverLeagues && !config.dryRun && config.mockFixtures) {
    throw new ConfigError("Refusing to write mock fixtures. Set MOCK_FIXTURES=0 before real Supabase writes.");
  }

  if (
    config.scoreProvider === API_FOOTBALL_PROVIDER &&
    !config.mockFixtures &&
    !config.apiFootballKey
  ) {
    throw new ConfigError("Missing API_FOOTBALL_KEY for non-mock score fetch.");
  }

  if (config.scoreProvider === FOOTBALL_DATA_PROVIDER && !config.footballDataToken) {
    throw new ConfigError("Missing FOOTBALL_DATA_TOKEN for football-data score fetch.");
  }

  if (
    config.scoreProvider === FOOTBALL_DATA_PROVIDER &&
    !/^[A-Za-z0-9_-]+$/.test(config.footballDataCompetition)
  ) {
    throw new ConfigError("FOOTBALL_DATA_COMPETITION contains unsupported characters.");
  }

  if (
    config.scoreProvider === FOOTBALL_DATA_PROVIDER &&
    !/^\d{4}$/.test(config.footballDataSeason)
  ) {
    throw new ConfigError("FOOTBALL_DATA_SEASON must be a four-digit year.");
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
  SCORE_PROVIDER=api-football
  DRY_RUN=1
  MOCK_FIXTURES=1 for API-Football dry-runs

Examples:
  Mock dry-run, no API-Football calls, no Supabase writes:
    npm --prefix server run update:scores:mock

  football-data.org dry-run, one read-only season request, no Supabase writes:
    SCORE_PROVIDER=football-data DRY_RUN=1 node server/update-scores.js

  Future real provider dry-run, may consume API-Football quota, still no Supabase writes:
    DRY_RUN=1 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

  Future league/season dry-run:
    DRY_RUN=1 MOCK_FIXTURES=0 API_FOOTBALL_LEAGUE_ID=YOUR_LEAGUE_ID API_FOOTBALL_SEASON=2026 node server/update-scores.js

  Future discovery report, never writes to Supabase:
    DISCOVER_FIXTURES=1 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

  Future league discovery, never writes to Supabase:
    DISCOVER_LEAGUES=1 MOCK_FIXTURES=0 LEAGUE_SEARCH="World Cup" node server/update-scores.js

  API-Football real write:
    DRY_RUN=0 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

  football-data finished-score write (live writes remain disabled):
    SCORE_PROVIDER=football-data DRY_RUN=0 MATCH_DATE=2026-06-11 node server/update-scores.js

Server-only env vars:
  SCORE_PROVIDER
  API_FOOTBALL_KEY
  API_FOOTBALL_LEAGUE_ID
  API_FOOTBALL_SEASON
  FOOTBALL_DATA_TOKEN
  FOOTBALL_DATA_COMPETITION
  FOOTBALL_DATA_SEASON
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

Never place API_FOOTBALL_KEY, FOOTBALL_DATA_TOKEN, or
SUPABASE_SERVICE_ROLE_KEY in frontend config.
`.trim());
}

function redactSecrets(text, config = readConfig()) {
  let out = String(text || "");
  const values = [
    config.apiFootballKey,
    config.footballDataToken,
    config.supabaseServiceRoleKey
  ].filter((v) => v && v.length >= 4);
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

function optionalClampedInt(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function mapStatus(short) {
  const code = String(short || "").toUpperCase();
  if (["NS", "TBD", "SCHEDULED", "TIMED"].includes(code)) return "upcoming";
  if (
    ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "IN_PLAY", "PAUSED"].includes(code)
  ) {
    return "live";
  }
  if (["FT", "AET", "PEN", "FINISHED", "AWARDED"].includes(code)) return "finished";
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
          apiFixtureId:
            value.apiFixtureId ??
            value.apiFootballFixtureId ??
            value.fixtureId ??
            value.fixture_id ??
            null,
          footballDataMatchId: value.footballDataMatchId ?? null
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

function kickoffDifferenceMinutes(fixture, matchLike) {
  const providerMs = fixtureDateMs(fixture);
  const internalMs = matchDateMs(matchLike);
  if (providerMs === null || internalMs === null) return null;
  return Math.round(Math.abs(providerMs - internalMs) / (60 * 1000));
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

function fixtureProvider(fixture) {
  return fixture?._provider || API_FOOTBALL_PROVIDER;
}

function fixtureMapProviderId(entry, provider) {
  return provider === FOOTBALL_DATA_PROVIDER
    ? entry.footballDataMatchId
    : entry.apiFixtureId;
}

function providerIdMappingLabel(provider) {
  return provider === FOOTBALL_DATA_PROVIDER
    ? "footballDataMatchId"
    : "apiFixtureId";
}

function matchFromFixtureId(fixture, matches, entries) {
  const fixtureId = fixture?.fixture?.id;
  if (!fixtureId) return null;
  const id = String(fixtureId);
  const provider = fixtureProvider(fixture);

  for (const entry of entries) {
    const providerId = fixtureMapProviderId(entry, provider);
    if (providerId === null || providerId === undefined || providerId === "") continue;
    if (String(providerId) === id) {
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
    provider: fixtureProvider(fixture),
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
  const provider = fixtureProvider(fixture);
  const idLabel = providerIdMappingLabel(provider);

  if (fixtureId !== null && fixtureId !== undefined && fixtureId !== "") {
    const idMatches = entries
      .filter((entry) => {
        const id = fixtureMapProviderId(entry, provider);
        return id !== null && id !== undefined && id !== "";
      })
      .filter((entry) => String(fixtureMapProviderId(entry, provider)) === String(fixtureId))
      .map((entry) => ({ entry, match: internalMatchForEntry(entry, matches) }))
      .filter((item) => item.match);

    if (idMatches.length) {
      const close = idMatches.filter((item) => dateCloseEnough(fixture, item.entry.utc ? item.entry : item.match));
      if (close.length === 1) {
        return {
          match: close[0].match,
          mappedBy: idLabel,
          ambiguous: false,
          candidates: [close[0].match]
        };
      }
      return {
        match: null,
        mappedBy: idLabel,
        ambiguous: close.length > 1,
        candidates: close.length ? close.map((item) => item.match) : idMatches.map((item) => item.match),
        reason:
          close.length > 1
            ? "Multiple fixture-map entries share this provider match id."
            : "Provider match id matched, but kickoff date was outside the safety window."
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
  if (!status) {
    return { row: null, reason: "Unsupported provider status." };
  }

  if (fixtureProvider(fixture) === API_FOOTBALL_PROVIDER) {
    return {
      row: {
        match_id: Number(internalMatch.id),
        home_score: clampInt(fixture?.goals?.home, 0, 20, 0),
        away_score: clampInt(fixture?.goals?.away, 0, 20, 0),
        status,
        minute: clampInt(fixture?.fixture?.status?.elapsed, 0, 130, 0)
      },
      reason: null
    };
  }

  if (status === "upcoming") {
    return {
      row: null,
      reason: "Upcoming fixture does not produce a score upsert."
    };
  }

  if (status === "live") {
    return {
      row: null,
      reason: "Live football-data writes remain disabled until live payload validation passes."
    };
  }

  const homeScore = optionalClampedInt(fixture?.goals?.home, 0, 20);
  const awayScore = optionalClampedInt(fixture?.goals?.away, 0, 20);
  if (homeScore === null || awayScore === null) {
    return {
      row: null,
      reason: "Finished fixture is missing full-time score; retry on next run."
    };
  }

  const providerMinute = optionalClampedInt(
    fixture?.fixture?.status?.elapsed,
    0,
    130
  );

  return {
    row: {
      match_id: Number(internalMatch.id),
      home_score: homeScore,
      away_score: awayScore,
      status,
      minute: providerMinute === null && status === "finished" ? 90 : providerMinute
    },
    reason: null
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

    report.mapped.push({
      ...summary,
      internalMatchId: Number(internalMatch.id),
      internalUtc: internalMatch.utc || null,
      kickoffDifferenceMinutes: kickoffDifferenceMinutes(fixture, internalMatch),
      mappedBy: mapping.mappedBy
    });

    const normalized = normalizeFixtureScore(fixture, internalMatch);
    const row = normalized.row;
    if (!row) {
      report.skipped.push({
        ...summary,
        internalMatchId: Number(internalMatch.id),
        mappedBy: mapping.mappedBy,
        reason: normalized.reason
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
      provider: summary.provider,
      provider_match_id: summary.providerFixtureId,
      provider_fixture_id: summary.providerFixtureId,
      mapped_by: mapping.mappedBy
    };

    rowsByMatchId.set(row.match_id, row);
    previewByMatchId.set(row.match_id, preview);
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

function footballDataPath(config) {
  const competition = encodeURIComponent(config.footballDataCompetition);
  const season = encodeURIComponent(config.footballDataSeason);
  return `/v4/competitions/${competition}/matches?season=${season}`;
}

function footballDataTeamName(team) {
  return team?.name || team?.shortName || team?.tla || null;
}

function adaptFootballDataMatch(match, config) {
  return {
    _provider: FOOTBALL_DATA_PROVIDER,
    fixture: {
      id: match?.id ?? null,
      date: match?.utcDate || null,
      status: {
        short: match?.status || null,
        elapsed: match?.minute ?? null
      }
    },
    teams: {
      home: { name: footballDataTeamName(match?.homeTeam) },
      away: { name: footballDataTeamName(match?.awayTeam) }
    },
    goals: {
      home: match?.score?.fullTime?.home ?? null,
      away: match?.score?.fullTime?.away ?? null
    },
    league: {
      id: match?.competition?.id ?? 2000,
      name: match?.competition?.name || "FIFA World Cup",
      season: Number(config.footballDataSeason)
    },
    footballData: {
      matchday: match?.matchday ?? null,
      stage: match?.stage ?? null,
      group: match?.group ?? null,
      duration: match?.score?.duration ?? null,
      regularTime: match?.score?.regularTime || null,
      penalties: match?.score?.penalties || null
    }
  };
}

function providerErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    const candidate = payload.message || payload.error || payload.errorCode;
    if (candidate) return String(candidate).slice(0, 300);
  }
  return String(fallback || "Request failed.").slice(0, 300);
}

async function fetchFootballDataFixtures(config) {
  const apiPath = footballDataPath(config);
  reserveApiCall(apiPath, config);
  log(`Fetching football-data.org path ${apiPath}.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${FOOTBALL_DATA_API_BASE}${apiPath}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Auth-Token": config.footballDataToken
      },
      redirect: "follow",
      signal: controller.signal
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        throw new Error("football-data.org returned invalid JSON.");
      }
    }

    if (!response.ok) {
      const message = providerErrorMessage(payload, response.statusText);
      throw new Error(
        `football-data.org request failed with status ${response.status}: ${message}`
      );
    }

    const rawMatches = Array.isArray(payload?.matches) ? payload.matches : [];
    const selected = config.matchDate
      ? rawMatches.filter((match) => String(match?.utcDate || "").startsWith(config.matchDate))
      : rawMatches;

    return {
      fixtures: selected.map((match) => adaptFootballDataMatch(match, config)),
      apiPaths: [apiPath],
      source: FOOTBALL_DATA_PROVIDER,
      providerMatchesFetched: rawMatches.length
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `football-data.org request timed out after ${PROVIDER_REQUEST_TIMEOUT_MS} ms.`
      );
    }
    throw new Error(redactSecrets(error.message, config));
  } finally {
    clearTimeout(timeout);
  }
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
  if (config.scoreProvider === FOOTBALL_DATA_PROVIDER) {
    return fetchFootballDataFixtures(config);
  }

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
  if (config.scoreProvider === FOOTBALL_DATA_PROVIDER) {
    return config.matchDate ? "season+local-date-filter" : "full-season";
  }
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
  if (config.scoreProvider === FOOTBALL_DATA_PROVIDER) {
    return [
      "FOOTBALL_DATA_COMPETITION or FOOTBALL_DATA_SEASON may be incorrect",
      "the account plan may not include this competition or season",
      "the provider may have returned an empty season"
    ];
  }

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

function mappingPreviewRow(item) {
  return {
    provider: item.provider,
    provider_match_id: item.providerFixtureId,
    kickoff_utc: item.fixtureUtc,
    provider_home: item.providerHome,
    provider_away: item.providerAway,
    internal_match_id: item.internalMatchId,
    kickoff_difference_minutes: item.kickoffDifferenceMinutes,
    mapped_by: item.mappedBy
  };
}

function printTargetMapping(report, internalMatchId, label) {
  const row = report.mapped.find(
    (item) => Number(item.internalMatchId) === Number(internalMatchId)
  );
  log(`${label}: ${row ? `mapped to internal match ${internalMatchId}` : "not mapped"}`);
  if (row) {
    console.log(JSON.stringify(mappingPreviewRow(row), null, 2));
  }
}

function printLimitedDetails(label, items) {
  if (!items.length) {
    log(`${label}: none`);
    return;
  }

  warn(`${label} (first ${Math.min(10, items.length)} of ${items.length}):`);
  console.log(JSON.stringify(items.slice(0, 10), null, 2));
}

function printScoreReport(context) {
  const { config, matchesToCheck, fetchResult, plan, budgetBefore, budgetAfter } = context;
  const report = plan.report;
  const kickoffDifferences = report.mapped.filter(
    (item) =>
      Number.isFinite(item.kickoffDifferenceMinutes) &&
      item.kickoffDifferenceMinutes > 0
  );
  const kickoffDiscrepancies = report.mapped.filter(
    (item) =>
      Number.isFinite(item.kickoffDifferenceMinutes) &&
      item.kickoffDifferenceMinutes > 60
  );

  log("--- Score updater report ---");
  log(`Score provider: ${config.scoreProvider}`);
  log(`Query mode: ${queryModeLabel(config)}`);
  log(`Selected match date: ${selectedDateLabel(config, matchesToCheck)}`);
  if (config.scoreProvider === FOOTBALL_DATA_PROVIDER) {
    log(`football-data competition: ${config.footballDataCompetition}`);
    log(`football-data season: ${config.footballDataSeason}`);
  } else {
    log(`API-Football league id: ${config.apiFootballLeagueId || "not set"}`);
    log(`API-Football season: ${config.apiFootballLeagueId ? config.apiFootballSeason : "not set"}`);
  }
  log(`Provider source: ${fetchResult.source}`);
  log(`API paths: ${fetchResult.apiPaths.length ? fetchResult.apiPaths.join(", ") : "none"}`);
  if (Number.isInteger(fetchResult.providerMatchesFetched)) {
    log(`Provider season matches fetched count: ${fetchResult.providerMatchesFetched}`);
  }
  log(`Provider fixtures fetched count: ${report.providerFixturesFetched}`);
  log(`Mapped fixtures count: ${report.mapped.length}`);
  log(`Unmapped fixtures count: ${report.unmapped.length}`);
  log(`Ambiguous fixtures count: ${report.ambiguous.length}`);
  log(`Kickoff differences over 0 minutes: ${kickoffDifferences.length}`);
  log(`Kickoff discrepancies over 60 minutes: ${kickoffDiscrepancies.length}`);
  log(`Skipped fixtures count: ${report.skipped.length}`);
  log(`Planned Supabase upserts: ${plan.rows.length}`);
  log(`Provider request budget before: ${budgetLine(budgetBefore)}`);
  log(`Provider request budget after: ${budgetLine(budgetAfter)}${config.mockFixtures ? " (mock mode did not touch budget file)" : ""}`);
  log(`Supabase writes: ${config.dryRun ? "skipped because DRY_RUN=1" : "enabled"}`);
  if (config.scoreProvider === FOOTBALL_DATA_PROVIDER) {
    log("football-data write scope: finished scores only; live writes remain disabled.");
  }

  if (report.providerFixturesFetched === 0 && !config.mockFixtures) {
    printZeroFixtureGuidance(config);
  }

  if (report.mapped.length) {
    log(`First ${Math.min(10, report.mapped.length)} mapping rows:`);
    console.table(report.mapped.slice(0, 10).map(mappingPreviewRow));
  } else {
    log("Mapping rows: none");
  }

  printTargetMapping(report, 1, "Mexico vs South Africa mapping");
  printTargetMapping(report, 2, "South Korea vs Czechia mapping");
  printLimitedDetails("Kickoff difference details", kickoffDifferences);
  printLimitedDetails("Kickoff discrepancy details", kickoffDiscrepancies);
  printLimitedDetails("Unmapped fixture details", report.unmapped);
  printLimitedDetails("Ambiguous fixture details", report.ambiguous);
  printLimitedDetails("Skipped fixture details", report.skipped);

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
    provider: summary.provider,
    provider_match_id: summary.providerFixtureId,
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
  log(`Score provider: ${config.scoreProvider}`);
  log(`Query mode: ${queryModeLabel(config)}`);
  log(`Selected match date: ${selectedDateLabel(config, matchesToCheck)}`);
  if (config.scoreProvider === FOOTBALL_DATA_PROVIDER) {
    log(`football-data competition: ${config.footballDataCompetition}`);
    log(`football-data season: ${config.footballDataSeason}`);
  } else {
    log(`API-Football league id: ${config.apiFootballLeagueId || "not set"}`);
    log(`API-Football season: ${config.apiFootballLeagueId ? config.apiFootballSeason : "not set"}`);
  }
  log(`API paths: ${fetchResult.apiPaths.length ? fetchResult.apiPaths.join(", ") : "none"}`);
  log(`Fixtures fetched count: ${rows.length}`);
  log(`Discovery mapped fixtures count: ${mappedCount}`);
  log(`Discovery unmapped fixtures count: ${unmappedCount}`);
  log(`Discovery ambiguous fixtures count: ${ambiguousCount}`);
  log(`Provider request budget before: ${budgetLine(budgetBefore)}`);
  log(`Provider request budget after: ${budgetLine(budgetAfter)}${config.mockFixtures ? " (mock mode did not touch budget file)" : ""}`);

  if (!rows.length && !config.mockFixtures) {
    printZeroFixtureGuidance(config);
  }

  if (rows.length) {
    log(`Provider fixture discovery rows (first ${Math.min(10, rows.length)} of ${rows.length}):`);
    console.table(rows.slice(0, 10));
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

async function fetchExistingScoresFromSupabase(rows, config) {
  const matchIds = Array.from(
    new Set(rows.map((row) => Number(row.match_id)).filter(Number.isInteger))
  ).sort((a, b) => a - b);
  if (!matchIds.length) return [];

  const baseUrl = config.supabaseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    select: "match_id,home_score,away_score,status,minute,source,provider_updated_at",
    match_id: `in.(${matchIds.join(",")})`
  });
  const response = await fetch(`${baseUrl}/rest/v1/scores?${params.toString()}`, {
    method: "GET",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Supabase existing-score read failed with status ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Supabase existing-score read returned an unexpected payload.");
  }
  return payload;
}

function reconcileFootballDataFinishedRows(providerRows, existingRows) {
  const existingByMatchId = new Map(
    existingRows.map((row) => [Number(row.match_id), row])
  );
  const rowsToWrite = [];
  const actions = [];
  const providerUpdatedAt = new Date().toISOString();

  for (const row of providerRows) {
    const matchId = Number(row.match_id);
    const validHomeScore =
      Number.isInteger(row.home_score) && row.home_score >= 0 && row.home_score <= 20;
    const validAwayScore =
      Number.isInteger(row.away_score) && row.away_score >= 0 && row.away_score <= 20;
    if (
      !Number.isInteger(matchId) ||
      row.status !== "finished" ||
      !validHomeScore ||
      !validAwayScore
    ) {
      actions.push({
        action: "skipped",
        match_id: matchId,
        reason: "Only valid finished football-data rows may be written."
      });
      continue;
    }

    const finishedRow = {
      match_id: matchId,
      home_score: row.home_score,
      away_score: row.away_score,
      status: "finished",
      minute:
        Number.isInteger(row.minute) && row.minute >= 0 && row.minute <= 130
          ? row.minute
          : 90,
      source: FOOTBALL_DATA_PROVIDER,
      provider_updated_at: providerUpdatedAt
    };
    const existing = existingByMatchId.get(matchId);
    if (!existing) {
      rowsToWrite.push(finishedRow);
      actions.push({ action: "inserted", match_id: matchId, row: finishedRow });
      continue;
    }

    const existingStatus = String(existing.status || "").toLowerCase();
    const existingScore = `${Number(existing.home_score)}-${Number(existing.away_score)}`;
    const providerScore = `${finishedRow.home_score}-${finishedRow.away_score}`;

    if (existingStatus === "finished" && existingScore === providerScore) {
      actions.push({
        action: "unchanged",
        match_id: matchId,
        row: finishedRow,
        existing
      });
      continue;
    }

    if (existingStatus === "finished") {
      actions.push({
        action: "conflict",
        match_id: matchId,
        row: finishedRow,
        existing,
        stored_score: existingScore,
        provider_score: providerScore,
        reason: "Stored final score differs from provider final score; automatic overwrite skipped."
      });
      continue;
    }

    rowsToWrite.push(finishedRow);
    actions.push({
      action: "corrected",
      match_id: matchId,
      row: finishedRow,
      existing
    });
  }

  return { rowsToWrite, actions };
}

function logFootballDataSyncActions(actions) {
  for (const item of actions) {
    if (item.action === "inserted") {
      log(
        `Match ${item.match_id}: inserted finished score ${item.row.home_score}-${item.row.away_score}.`
      );
    } else if (item.action === "unchanged") {
      log(
        `Match ${item.match_id}: unchanged/idempotent finished score ${item.row.home_score}-${item.row.away_score}.`
      );
    } else if (item.action === "corrected") {
      const oldScore = `${item.existing.home_score}-${item.existing.away_score}`;
      const oldStatus = item.existing.status || "unknown";
      log(
        `Match ${item.match_id}: finalized existing ${oldStatus} score ${oldScore} to finished ${item.row.home_score}-${item.row.away_score}.`
      );
    } else if (item.action === "conflict") {
      warn(
        `Match ${item.match_id}: conflict skipped; stored final ${item.stored_score}, provider final ${item.provider_score}.`
      );
    } else {
      warn(`Match ${item.match_id}: skipped. ${item.reason}`);
    }
  }
}

async function syncFootballDataFinishedScores(rows, config) {
  if (!rows.length) {
    log("No finished football-data score rows to reconcile.");
    return { written: 0, inserted: 0, unchanged: 0, corrected: 0, conflict: 0, skipped: 0 };
  }

  const existingRows = await fetchExistingScoresFromSupabase(rows, config);
  const reconciliation = reconcileFootballDataFinishedRows(rows, existingRows);
  const writeResult = await upsertScoresToSupabase(
    reconciliation.rowsToWrite,
    config
  );
  logFootballDataSyncActions(reconciliation.actions);

  return {
    written: writeResult.written,
    inserted: reconciliation.actions.filter((item) => item.action === "inserted").length,
    unchanged: reconciliation.actions.filter((item) => item.action === "unchanged").length,
    corrected: reconciliation.actions.filter((item) => item.action === "corrected").length,
    conflict: reconciliation.actions.filter((item) => item.action === "conflict").length,
    skipped: reconciliation.actions.filter((item) => item.action === "skipped").length
  };
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

  log(
    `Provider: ${config.scoreProvider}. Mode: ${config.dryRun ? "dry-run" : "write"}. Mock fixtures: ${config.mockFixtures ? "on" : "off"}.`
  );
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
  const result =
    config.scoreProvider === FOOTBALL_DATA_PROVIDER && !config.dryRun
      ? await syncFootballDataFinishedScores(plan.rows, config)
      : await upsertScoresToSupabase(plan.rows, config);
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
  adaptFootballDataMatch,
  analyzeFixtureMapping,
  buildScorePlan,
  buildScoreRows,
  fetchFixtures,
  handleCliError,
  loadFixtureMap,
  loadInternalMatches,
  main,
  mapFixtureToInternalMatch,
  mapStatus,
  normalizeFixtureScore,
  normalizeTeamName,
  printDiscoveryReport,
  printHelp,
  printLeagueDiscoveryReport,
  readConfig,
  reconcileFootballDataFinishedRows,
  selectMatchesToCheck
};
