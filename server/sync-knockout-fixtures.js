#!/usr/bin/env node
"use strict";

/**
 * Safe football-data.org knockout fixture sync planner.
 *
 * Defaults to dry-run. It never writes scores, predictions, leaderboard rows,
 * champion picks, or golden boot picks.
 */

const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({
    path: path.resolve(__dirname, "..", ".env"),
    quiet: true
  });
} catch (_) {
  // Run `npm --prefix server install`, or provide env vars through the host.
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MATCHES_FILE = path.join(__dirname, "matches.json");
const SERVER_FIXTURE_MAP_FILE = path.join(__dirname, "fixture-map.json");
const EDGE_FIXTURE_MAP_FILE = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "sync-finished-scores",
  "fixture-map.json"
);
const FOOTBALL_DATA_API_BASE = "https://api.football-data.org";
const PROVIDER_TIMEOUT_MS = 15000;
const DEFAULT_COMPETITION = "WC";
const DEFAULT_SEASON = "2026";

const SEEDED_TEAMS = new Set([
  "Meksika",
  "Kanada",
  "Brezilya",
  "ABD",
  "Almanya",
  "Hollanda",
  "Belçika",
  "İspanya",
  "Fransa",
  "Arjantin",
  "Portekiz",
  "İngiltere"
]);

const STAGE_DEFINITIONS = [
  {
    stage: "round_32",
    label: "Round of 32",
    startId: 73,
    count: 16,
    aliases: ["LAST_32", "ROUND_32", "ROUND_OF_32", "RO32", "R32"]
  },
  {
    stage: "round_16",
    label: "Round of 16",
    startId: 89,
    count: 8,
    aliases: ["LAST_16", "ROUND_16", "ROUND_OF_16", "RO16", "R16"]
  },
  {
    stage: "quarter_final",
    label: "Quarterfinal",
    startId: 97,
    count: 4,
    aliases: ["QUARTER_FINAL", "QUARTER_FINALS", "QUARTERFINAL", "QUARTERFINALS"]
  },
  {
    stage: "semi_final",
    label: "Semifinal",
    startId: 101,
    count: 2,
    aliases: ["SEMI_FINAL", "SEMI_FINALS", "SEMIFINAL", "SEMIFINALS"]
  },
  {
    stage: "third_place",
    label: "Third-place match",
    startId: 103,
    count: 1,
    aliases: ["THIRD_PLACE", "THIRD_PLACE_PLAYOFF", "THIRD_PLACE_MATCH"]
  },
  {
    stage: "final",
    label: "Final",
    startId: 104,
    count: 1,
    aliases: ["FINAL"]
  }
];

const STAGE_BY_NAME = new Map(STAGE_DEFINITIONS.map((item) => [item.stage, item]));
const STAGE_BY_ALIAS = new Map();
for (const def of STAGE_DEFINITIONS) {
  STAGE_BY_ALIAS.set(def.stage.toUpperCase(), def);
  for (const alias of def.aliases) STAGE_BY_ALIAS.set(alias, def);
}
STAGE_BY_ALIAS.set("GROUP_STAGE", { stage: "group" });
STAGE_BY_ALIAS.set("GROUP", { stage: "group" });

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function printHelp() {
  console.log(`
WC2026 knockout fixture sync

Usage:
  node server/sync-knockout-fixtures.js --dry-run
  node server/sync-knockout-fixtures.js --stage=round_32 --dry-run
  node server/sync-knockout-fixtures.js --write
  node server/sync-knockout-fixtures.js --help

Options:
  --dry-run                  Plan only. Default.
  --write                    Upsert safe fixture fields into public.matches.
  --stage=<stage|all>        round_32, round_16, quarter_final, semi_final,
                             third_place, final, or all. Default: all.
  --include-placeholders     Include missing/TBD teams in the plan. Default: off.
  --write-artifacts          Update server/matches.json plus fixture-map files.
  --provider-file=<path>     Read a saved football-data-like JSON payload.
  --competition=<code>       football-data competition. Default: WC.
  --season=<year>            football-data season. Default: 2026.

Write-mode env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  FOOTBALL_DATA_TOKEN

Dry-run with live provider data still needs FOOTBALL_DATA_TOKEN unless
--provider-file is used. Tokens are sent only as X-Auth-Token and are never
printed.
`.trim());
}

function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    help: false,
    stage: "all",
    includePlaceholders: false,
    writeArtifacts: false,
    providerFile: null,
    dryRunArg: false,
    writeArg: false,
    competition: cleanEnv("FOOTBALL_DATA_COMPETITION") || DEFAULT_COMPETITION,
    season: cleanEnv("FOOTBALL_DATA_SEASON") || DEFAULT_SEASON
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRunArg = true;
      out.dryRun = true;
      continue;
    }
    if (arg === "--write") {
      out.writeArg = true;
      out.write = true;
      out.dryRun = false;
      continue;
    }
    if (arg === "--include-placeholders") {
      out.includePlaceholders = true;
      continue;
    }
    if (arg === "--write-artifacts") {
      out.writeArtifacts = true;
      continue;
    }

    if (!arg.startsWith("--")) throw new InputError(`Unexpected argument: ${arg}`);
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let value = eq === -1 ? null : arg.slice(eq + 1);
    if (value === null) {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new InputError(`Missing value for --${key}`);
      value = next;
      i += 1;
    }

    if (key === "stage") out.stage = value;
    else if (key === "provider-file" || key === "mock-provider-file") out.providerFile = value;
    else if (key === "competition") out.competition = value;
    else if (key === "season") out.season = value;
    else throw new InputError(`Unknown option: --${key}`);
  }

  return out;
}

function validateArgs(args) {
  if (args.help) return;
  if (args.dryRunArg && args.writeArg) {
    throw new InputError("Use either --dry-run or --write, not both.");
  }
  if (args.stage !== "all" && !STAGE_BY_NAME.has(args.stage)) {
    throw new InputError(
      `Unsupported --stage "${args.stage}". Use all, ${Array.from(STAGE_BY_NAME.keys()).join(", ")}.`
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(args.competition)) {
    throw new InputError("--competition contains unsupported characters.");
  }
  if (!/^\d{4}$/.test(String(args.season))) {
    throw new InputError("--season must be a four-digit year.");
  }
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function providerTeamName(team) {
  return team?.name || team?.shortName || team?.tla || "";
}

function providerTeamAliases(team) {
  return Array.from(
    new Set([team?.name, team?.shortName, team?.tla].map((v) => String(v || "").trim()).filter(Boolean))
  );
}

function isPlaceholderTeam(team) {
  const values = providerTeamAliases(team);
  if (!values.length) return true;
  return values.some((value) => {
    const normalized = normalizeName(value);
    if (!normalized) return true;
    return [
      "tbd",
      "tba",
      "tbc",
      "unknown",
      "tobedetermined",
      "winner",
      "runnerup",
      "runnerupgroup",
      "winnergroup"
    ].some((marker) => normalized === marker || normalized.startsWith(marker));
  });
}

function normalizeProviderStage(rawStage) {
  const normalized = String(rawStage || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  return STAGE_BY_ALIAS.get(normalized)?.stage || null;
}

function loadLocalState() {
  const matches = readJson(MATCHES_FILE, []);
  const fixtureMap = readJson(SERVER_FIXTURE_MAP_FILE, []);
  const edgeFixtureMap = readJson(EDGE_FIXTURE_MAP_FILE, []);
  return {
    matches: Array.isArray(matches) ? matches : [],
    fixtureMap: Array.isArray(fixtureMap) ? fixtureMap : [],
    edgeFixtureMap: Array.isArray(edgeFixtureMap) ? edgeFixtureMap : []
  };
}

function buildTeamAliasMap(fixtureMap, matches) {
  const aliasToCanonical = new Map();
  const add = (alias, canonical) => {
    const key = normalizeName(alias);
    if (key && canonical) aliasToCanonical.set(key, canonical);
  };

  for (const match of matches) {
    add(match.h, match.h);
    add(match.a, match.a);
  }

  for (const entry of fixtureMap) {
    const home = entry.home || entry.h;
    const away = entry.away || entry.a;
    add(home, home);
    add(away, away);
    for (const alias of Array.isArray(entry.homeAliases) ? entry.homeAliases : []) add(alias, home);
    for (const alias of Array.isArray(entry.awayAliases) ? entry.awayAliases : []) add(alias, away);
  }

  return aliasToCanonical;
}

function canonicalTeamName(team, aliasToCanonical) {
  const name = providerTeamName(team);
  const canonical = aliasToCanonical.get(normalizeName(name));
  return canonical || name;
}

function providerPath(args) {
  return `/v4/competitions/${encodeURIComponent(args.competition)}/matches?season=${encodeURIComponent(args.season)}`;
}

function extractProviderMatches(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.matches)) return payload.matches;
  throw new InputError("Provider payload did not contain a matches array.");
}

async function fetchProviderPayload(args) {
  if (args.providerFile) {
    const absolute = path.resolve(PROJECT_ROOT, args.providerFile);
    const payload = readJson(absolute, null);
    if (!payload) throw new InputError(`Could not read provider payload from ${args.providerFile}.`);
    return { payload, source: `file:${args.providerFile}`, requestCount: 0 };
  }

  const token = cleanEnv("FOOTBALL_DATA_TOKEN");
  if (!token) {
    throw new InputError("Missing FOOTBALL_DATA_TOKEN. Use --provider-file for local validation without a provider call.");
  }

  const apiPath = providerPath(args);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${FOOTBALL_DATA_API_BASE}${apiPath}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Auth-Token": token
      },
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    if (text) payload = JSON.parse(text);
    if (!response.ok) {
      const message = payload?.message || payload?.error || response.statusText;
      throw new Error(`football-data.org request failed with HTTP ${response.status}: ${String(message).slice(0, 200)}`);
    }
    return { payload, source: "football-data", requestCount: 1 };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`football-data.org request timed out after ${PROVIDER_TIMEOUT_MS} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sortProviderMatches(left, right) {
  const leftMs = Date.parse(left?.utcDate || "");
  const rightMs = Date.parse(right?.utcDate || "");
  const dateDiff = (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
  if (dateDiff) return dateDiff;
  return (Number(left?.id) || 0) - (Number(right?.id) || 0);
}

function existingInternalIdForProvider(providerId, fixtureMap, edgeFixtureMap) {
  const serverEntry = fixtureMap.find((entry) => String(entry.footballDataMatchId) === String(providerId));
  if (serverEntry && Number.isInteger(Number(serverEntry.id))) return Number(serverEntry.id);
  const edgeEntry = edgeFixtureMap.find((entry) => String(entry.footballDataMatchId) === String(providerId));
  if (edgeEntry && Number.isInteger(Number(edgeEntry.internalMatchId))) return Number(edgeEntry.internalMatchId);
  return null;
}

function buildKnockoutFixtures(providerMatches, localState, options = {}) {
  const aliasToCanonical = buildTeamAliasMap(localState.fixtureMap, localState.matches);
  const recognizedKnockout = [];
  const unmappedProviderFixtures = [];
  const stageBuckets = new Map(STAGE_DEFINITIONS.map((def) => [def.stage, []]));

  for (const match of providerMatches) {
    const providerId = Number(match?.id);
    const normalizedStage = normalizeProviderStage(match?.stage);
    if (!normalizedStage) {
      if (Date.parse(match?.utcDate || "") >= Date.parse("2026-06-28T00:00:00Z")) {
        unmappedProviderFixtures.push({
          provider_match_id: Number.isFinite(providerId) ? providerId : null,
          kickoff_utc: match?.utcDate || null,
          provider_stage: match?.stage || null,
          provider_home: providerTeamName(match?.homeTeam) || null,
          provider_away: providerTeamName(match?.awayTeam) || null,
          reason: "Provider stage is missing or not recognized."
        });
      }
      continue;
    }
    if (normalizedStage === "group") continue;
    if (!STAGE_BY_NAME.has(normalizedStage)) continue;
    if (options.stage && options.stage !== "all" && options.stage !== normalizedStage) continue;

    const item = {
      providerMatch: match,
      providerId,
      providerStage: match?.stage || null,
      stage: normalizedStage,
      kickoffAt: match?.utcDate || null,
      providerHome: providerTeamName(match?.homeTeam),
      providerAway: providerTeamName(match?.awayTeam),
      homeTeam: canonicalTeamName(match?.homeTeam, aliasToCanonical),
      awayTeam: canonicalTeamName(match?.awayTeam, aliasToCanonical),
      homeAliases: providerTeamAliases(match?.homeTeam),
      awayAliases: providerTeamAliases(match?.awayTeam),
      hasPlaceholder: isPlaceholderTeam(match?.homeTeam) || isPlaceholderTeam(match?.awayTeam),
      city: typeof match?.venue === "string" && match.venue.trim() ? match.venue.trim() : null
    };
    stageBuckets.get(normalizedStage).push(item);
    recognizedKnockout.push(item);
  }

  const warnings = [];
  const withInternalIds = [];
  for (const def of STAGE_DEFINITIONS) {
    if (options.stage && options.stage !== "all" && options.stage !== def.stage) continue;
    const bucket = (stageBuckets.get(def.stage) || []).sort((a, b) => sortProviderMatches(a.providerMatch, b.providerMatch));
    if (bucket.length > 0 && bucket.length !== def.count) {
      warnings.push(
        `${def.label}: provider returned ${bucket.length}/${def.count} fixture(s); new-ID ordering may be incomplete.`
      );
    }
    if (bucket.length > def.count) {
      warnings.push(`${def.label}: provider returned more fixtures than the configured ${def.count} slots.`);
    }

    bucket.forEach((item, index) => {
      const existingId = existingInternalIdForProvider(item.providerId, localState.fixtureMap, localState.edgeFixtureMap);
      const allocatedId = def.startId + index;
      const internalId = existingId || allocatedId;
      const insideRange = internalId >= def.startId && internalId < def.startId + def.count;
      withInternalIds.push({
        ...item,
        internalId,
        expectedInternalId: allocatedId,
        idSource: existingId ? "existing_fixture_map" : "stage_order",
        idWarning: insideRange ? null : `Internal ID ${internalId} is outside expected ${def.label} range.`
      });
      if (!insideRange) warnings.push(`Provider match ${item.providerId}: internal ID ${internalId} is outside ${def.label} range.`);
    });
  }

  return { recognizedKnockout, withInternalIds, unmappedProviderFixtures, warnings };
}

function isSafeFixtureForUpsert(item, includePlaceholders) {
  if (!Number.isInteger(Number(item.providerId))) return { ok: false, reason: "Missing provider match ID." };
  if (!Number.isInteger(Number(item.internalId))) return { ok: false, reason: "Missing internal match ID." };
  if (!item.kickoffAt || Number.isNaN(Date.parse(item.kickoffAt))) return { ok: false, reason: "Missing or invalid kickoff time." };
  if (!item.homeTeam || !item.awayTeam) return { ok: false, reason: "Missing home or away team." };
  if (item.hasPlaceholder && !includePlaceholders) return { ok: false, reason: "Placeholder team skipped." };
  if (item.homeTeam === item.awayTeam) return { ok: false, reason: "Home and away teams are identical." };
  return { ok: true, reason: null };
}

function supabaseMatchRow(item) {
  return {
    id: Number(item.internalId),
    group_code: null,
    stage: item.stage,
    home_team: item.homeTeam,
    away_team: item.awayTeam,
    home_seeded: SEEDED_TEAMS.has(item.homeTeam),
    away_seeded: SEEDED_TEAMS.has(item.awayTeam),
    kickoff_at: item.kickoffAt,
    city: item.city
  };
}

function appMatchRow(row) {
  return {
    id: row.id,
    grp: row.group_code || "",
    h: row.home_team,
    a: row.away_team,
    utc: row.kickoff_at,
    city: row.city || "",
    stage: row.stage
  };
}

function fixtureMapEntry(item) {
  const homeAliases = Array.from(new Set([item.homeTeam, item.providerHome, ...item.homeAliases].filter(Boolean)));
  const awayAliases = Array.from(new Set([item.awayTeam, item.providerAway, ...item.awayAliases].filter(Boolean)));
  return {
    id: Number(item.internalId),
    utc: item.kickoffAt,
    home: item.homeTeam,
    away: item.awayTeam,
    homeAliases,
    awayAliases,
    apiFixtureId: null,
    footballDataMatchId: Number(item.providerId)
  };
}

function edgeMapEntry(item) {
  return {
    internalMatchId: Number(item.internalId),
    footballDataMatchId: Number(item.providerId)
  };
}

function fieldsDiffer(existing, planned, pairs) {
  return pairs.some(([left, right]) => String(existing?.[left] ?? "") !== String(planned?.[right] ?? ""));
}

function generateFixtureSyncPlan(providerMatches, options = {}) {
  const localState = options.localState || loadLocalState();
  const includePlaceholders = Boolean(options.includePlaceholders);
  const stage = options.stage || "all";
  const knockout = buildKnockoutFixtures(providerMatches, localState, { stage });
  const existingMatchesById = new Map(localState.matches.map((match) => [Number(match.id), match]));
  const existingServerMapById = new Map(localState.fixtureMap.map((entry) => [Number(entry.id), entry]));
  const existingEdgeMapById = new Map(localState.edgeFixtureMap.map((entry) => [Number(entry.internalMatchId), entry]));

  const rows = [];
  const appMatches = [];
  const serverFixtureMapEntries = [];
  const edgeFixtureMapEntries = [];
  const skippedPlaceholders = [];
  const skippedUnsafe = [];

  for (const item of knockout.withInternalIds) {
    const safe = isSafeFixtureForUpsert(item, includePlaceholders);
    if (!safe.ok) {
      const skipped = {
        provider_match_id: item.providerId || null,
        internal_match_id: item.internalId || null,
        stage: item.stage,
        kickoff_utc: item.kickoffAt,
        provider_home: item.providerHome || null,
        provider_away: item.providerAway || null,
        reason: safe.reason
      };
      if (item.hasPlaceholder) skippedPlaceholders.push(skipped);
      else skippedUnsafe.push(skipped);
      continue;
    }

    const row = supabaseMatchRow(item);
    rows.push(row);
    appMatches.push(appMatchRow(row));
    serverFixtureMapEntries.push(fixtureMapEntry(item));
    edgeFixtureMapEntries.push(edgeMapEntry(item));
  }

  const plannedInserts = rows.filter((row) => !existingMatchesById.has(Number(row.id)));
  const plannedUpdates = rows.filter((row) => {
    const existing = existingMatchesById.get(Number(row.id));
    if (!existing) return false;
    return fieldsDiffer(existing, row, [
      ["h", "home_team"],
      ["a", "away_team"],
      ["utc", "kickoff_at"],
      ["grp", "group_code"],
      ["stage", "stage"],
      ["city", "city"]
    ]);
  });

  const plannedServerMapAdditions = serverFixtureMapEntries.filter((entry) => !existingServerMapById.has(Number(entry.id)));
  const plannedServerMapUpdates = serverFixtureMapEntries.filter((entry) => {
    const existing = existingServerMapById.get(Number(entry.id));
    if (!existing) return false;
    return (
      Number(existing.footballDataMatchId) !== Number(entry.footballDataMatchId) ||
      String(existing.utc || "") !== String(entry.utc || "") ||
      String(existing.home || "") !== String(entry.home || "") ||
      String(existing.away || "") !== String(entry.away || "")
    );
  });
  const plannedEdgeMapAdditions = edgeFixtureMapEntries.filter((entry) => !existingEdgeMapById.has(Number(entry.internalMatchId)));
  const plannedEdgeMapUpdates = edgeFixtureMapEntries.filter((entry) => {
    const existing = existingEdgeMapById.get(Number(entry.internalMatchId));
    return existing && Number(existing.footballDataMatchId) !== Number(entry.footballDataMatchId);
  });

  return {
    providerMatchesFetched: providerMatches.length,
    knockoutMatchesFound: knockout.recognizedKnockout.length,
    knownTeamFixtures: rows.length,
    placeholderFixturesSkipped: skippedPlaceholders.length,
    rows,
    appMatches,
    serverFixtureMapEntries,
    edgeFixtureMapEntries,
    plannedInserts,
    plannedUpdates,
    plannedServerMapAdditions,
    plannedServerMapUpdates,
    plannedEdgeMapAdditions,
    plannedEdgeMapUpdates,
    skippedPlaceholders,
    skippedUnsafe,
    unmappedProviderFixtures: knockout.unmappedProviderFixtures,
    warnings: knockout.warnings,
    localState
  };
}

function previewRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    stage: row.stage,
    group_code: row.group_code,
    home_team: row.home_team,
    away_team: row.away_team,
    kickoff_at: row.kickoff_at,
    city: row.city
  }));
}

function mapPreviewRows(rows) {
  return rows.map((row) => ({
    internal_match_id: row.id || row.internalMatchId,
    footballDataMatchId: row.footballDataMatchId,
    utc: row.utc || null,
    home: row.home || null,
    away: row.away || null
  }));
}

function printLimited(label, rows, limit = 20) {
  if (!rows.length) {
    console.log(`[sync-knockout-fixtures] ${label}: none`);
    return;
  }
  console.log(`[sync-knockout-fixtures] ${label} (${rows.length}, first ${Math.min(limit, rows.length)}):`);
  console.table(rows.slice(0, limit));
}

function artifactChangeCounts(plan) {
  const matches =
    plan.plannedInserts.length +
    plan.plannedUpdates.length;
  const serverFixtureMap =
    plan.plannedServerMapAdditions.length +
    plan.plannedServerMapUpdates.length;
  const edgeFixtureMap =
    plan.plannedEdgeMapAdditions.length +
    plan.plannedEdgeMapUpdates.length;
  return {
    matches,
    serverFixtureMap,
    edgeFixtureMap,
    total: matches + serverFixtureMap + edgeFixtureMap
  };
}

function localArtifactWriteStatus(plan, context) {
  if (!context.writeArtifacts) return "skipped";
  if (context.dryRun) return "skipped because dry-run is active";
  if (artifactChangeCounts(plan).total === 0) {
    return "skipped because there are no planned artifact changes";
  }
  return "enabled";
}

function noKnownFixtureImportMessage(plan) {
  if (plan.knownTeamFixtures === 0 && plan.placeholderFixturesSkipped > 0) {
    return "No known-team fixtures available from provider; nothing was imported.";
  }
  return null;
}

function printReport(plan, context) {
  console.log("[sync-knockout-fixtures] --- Knockout fixture sync report ---");
  console.log(`[sync-knockout-fixtures] Mode: ${context.dryRun ? "dry-run" : "write"}`);
  console.log(`[sync-knockout-fixtures] Provider source: ${context.source}`);
  console.log(`[sync-knockout-fixtures] Stage filter: ${context.stage}`);
  console.log(`[sync-knockout-fixtures] Include placeholders: ${context.includePlaceholders ? "yes" : "no"}`);
  console.log(`[sync-knockout-fixtures] Provider matches fetched: ${plan.providerMatchesFetched}`);
  console.log(`[sync-knockout-fixtures] Knockout matches found: ${plan.knockoutMatchesFound}`);
  console.log(`[sync-knockout-fixtures] Known-team fixtures: ${plan.knownTeamFixtures}`);
  console.log(`[sync-knockout-fixtures] Placeholder fixtures skipped: ${plan.placeholderFixturesSkipped}`);
  console.log(`[sync-knockout-fixtures] Planned inserts: ${plan.plannedInserts.length}`);
  console.log(`[sync-knockout-fixtures] Planned updates: ${plan.plannedUpdates.length}`);
  console.log(
    `[sync-knockout-fixtures] Planned fixture-map additions: server=${plan.plannedServerMapAdditions.length}, edge=${plan.plannedEdgeMapAdditions.length}`
  );
  console.log(
    `[sync-knockout-fixtures] Planned fixture-map updates: server=${plan.plannedServerMapUpdates.length}, edge=${plan.plannedEdgeMapUpdates.length}`
  );
  console.log(`[sync-knockout-fixtures] Unmapped provider fixtures: ${plan.unmappedProviderFixtures.length}`);
  console.log(`[sync-knockout-fixtures] Warnings: ${plan.warnings.length}`);
  console.log(`[sync-knockout-fixtures] Supabase writes: ${context.dryRun ? "skipped because dry-run is active" : "enabled"}`);
  console.log(`[sync-knockout-fixtures] Local artifact writes: ${localArtifactWriteStatus(plan, context)}`);
  if (!context.dryRun) {
    const importWarning = noKnownFixtureImportMessage(plan);
    if (importWarning) console.warn(`[sync-knockout-fixtures] ${importWarning}`);
  }

  printLimited("planned inserts", previewRows(plan.plannedInserts));
  printLimited("planned updates", previewRows(plan.plannedUpdates));
  printLimited("planned fixture-map additions", mapPreviewRows(plan.plannedServerMapAdditions));
  printLimited("placeholder fixtures skipped", plan.skippedPlaceholders);
  printLimited("unmapped provider fixtures", plan.unmappedProviderFixtures);
  printLimited("warnings", plan.warnings.map((warning) => ({ warning })));
}

function readSupabaseConfig(requireWrite) {
  const config = {
    supabaseUrl: cleanEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: cleanEnv("SUPABASE_SERVICE_ROLE_KEY")
  };
  if (requireWrite) {
    const missing = [];
    if (!config.supabaseUrl) missing.push("SUPABASE_URL");
    if (!config.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) throw new InputError(`Missing required server-only env var(s): ${missing.join(", ")}.`);
  }
  return config;
}

async function upsertMatchesToSupabase(rows, config) {
  if (!rows.length) {
    console.log("[sync-knockout-fixtures] No public.matches rows to upsert.");
    return { written: 0 };
  }
  const baseUrl = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/matches?on_conflict=id`, {
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
    throw new Error(`Supabase matches upsert failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  console.log(`[sync-knockout-fixtures] Upserted ${rows.length} row(s) into public.matches.`);
  return { written: rows.length };
}

function mergeById(existing, additions, idKey = "id") {
  const byId = new Map(existing.map((entry) => [Number(entry[idKey]), entry]));
  for (const entry of additions) byId.set(Number(entry[idKey]), entry);
  return Array.from(byId.values()).sort((a, b) => Number(a[idKey]) - Number(b[idKey]));
}

function writeArtifacts(plan, options = {}) {
  const changes = artifactChangeCounts(plan);
  if (changes.total === 0) {
    console.log("[sync-knockout-fixtures] Local artifact writes: skipped because there are no planned artifact changes.");
    return { skipped: true, reason: "no_changes", changes };
  }

  const writer = options.writeJson || writeJson;
  const files = {
    matches: options.matchesFile || MATCHES_FILE,
    serverFixtureMap: options.serverFixtureMapFile || SERVER_FIXTURE_MAP_FILE,
    edgeFixtureMap: options.edgeFixtureMapFile || EDGE_FIXTURE_MAP_FILE
  };
  const writtenFiles = [];
  const result = {
    skipped: false,
    changes,
    matches: plan.localState.matches.length,
    serverFixtureMap: plan.localState.fixtureMap.length,
    edgeFixtureMap: plan.localState.edgeFixtureMap.length,
    writtenFiles
  };

  if (changes.matches > 0) {
    const nextMatches = mergeById(plan.localState.matches, plan.appMatches, "id");
    writer(files.matches, nextMatches);
    result.matches = nextMatches.length;
    writtenFiles.push("server/matches.json");
  }

  if (changes.serverFixtureMap > 0) {
    const nextServerMap = mergeById(plan.localState.fixtureMap, plan.serverFixtureMapEntries, "id");
    writer(files.serverFixtureMap, nextServerMap);
    result.serverFixtureMap = nextServerMap.length;
    writtenFiles.push("server/fixture-map.json");
  }

  if (changes.edgeFixtureMap > 0) {
    const nextEdgeMap = mergeById(plan.localState.edgeFixtureMap, plan.edgeFixtureMapEntries, "internalMatchId");
    writer(files.edgeFixtureMap, nextEdgeMap);
    result.edgeFixtureMap = nextEdgeMap.length;
    writtenFiles.push("supabase/functions/sync-finished-scores/fixture-map.json");
  }

  console.log(`[sync-knockout-fixtures] Updated local artifact(s): ${writtenFiles.join(", ")}.`);
  return {
    ...result
  };
}

function redactSecrets(text) {
  let out = String(text || "");
  for (const secret of [
    cleanEnv("FOOTBALL_DATA_TOKEN"),
    cleanEnv("SUPABASE_SERVICE_ROLE_KEY")
  ].filter((value) => value && value.length >= 8)) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  validateArgs(args);
  if (args.help) {
    printHelp();
    return { ok: true, help: true };
  }

  if (args.write) {
    readSupabaseConfig(true);
    if (!cleanEnv("FOOTBALL_DATA_TOKEN")) {
      throw new InputError("FOOTBALL_DATA_TOKEN is required for --write.");
    }
  }

  const fetched = await fetchProviderPayload(args);
  const providerMatches = extractProviderMatches(fetched.payload);
  const plan = generateFixtureSyncPlan(providerMatches, {
    includePlaceholders: args.includePlaceholders,
    stage: args.stage
  });

  printReport(plan, {
    dryRun: args.dryRun,
    writeArtifacts: args.writeArtifacts,
    source: fetched.source,
    stage: args.stage,
    includePlaceholders: args.includePlaceholders
  });

  if (args.write && plan.warnings.length) {
    throw new InputError("Write refused while warnings are present. Review provider stage counts and mappings first.");
  }

  let supabaseResult = { written: 0 };
  if (args.write) {
    supabaseResult = await upsertMatchesToSupabase(plan.rows, readSupabaseConfig(true));
  }

  let artifactResult = null;
  if (args.writeArtifacts) {
    if (args.dryRun) {
      console.log("[sync-knockout-fixtures] --write-artifacts was supplied, but dry-run is active. No files changed.");
      artifactResult = { skipped: true, reason: "dry_run", changes: artifactChangeCounts(plan) };
    } else if (artifactChangeCounts(plan).total === 0) {
      console.log("[sync-knockout-fixtures] Local artifact writes: skipped because there are no planned artifact changes.");
      artifactResult = { skipped: true, reason: "no_changes", changes: artifactChangeCounts(plan) };
    } else {
      artifactResult = writeArtifacts(plan);
    }
  }

  return { ok: true, plan, supabaseResult, artifactResult };
}

function handleCliError(error) {
  const isInput = error instanceof InputError;
  const label = isInput ? "Input error" : "Fixture sync failed";
  console.error(`[sync-knockout-fixtures] ${label}: ${redactSecrets(error.message)}`);
  if (isInput) {
    console.error("");
    printHelp();
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch(handleCliError);
}

module.exports = {
  STAGE_DEFINITIONS,
  artifactChangeCounts,
  buildKnockoutFixtures,
  generateFixtureSyncPlan,
  isPlaceholderTeam,
  localArtifactWriteStatus,
  main,
  noKnownFixtureImportMessage,
  normalizeProviderStage,
  parseArgs,
  writeArtifacts
};
