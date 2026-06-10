#!/usr/bin/env node
"use strict";

/**
 * Read-only football-data.org feasibility check for World Cup 2026.
 *
 * Safety properties:
 * - Loads only the project-root .env file.
 * - Reads FOOTBALL_DATA_TOKEN from the environment.
 * - Sends GET requests only.
 * - Never contacts Supabase or writes project data.
 * - Never prints the provider token.
 */

const path = require("path");

try {
  require("dotenv").config({
    path: path.resolve(__dirname, "..", ".env"),
    quiet: true
  });
} catch (_) {
  // dotenv is optional when variables are supplied by the host environment.
}

const API_BASE_URL = "https://api.football-data.org";
const DEFAULT_COMPETITION = "WC";
const DEFAULT_SEASON = "2026";
const FIRST_MATCH_DATE = "2026-06-11";
const REQUEST_TIMEOUT_MS = 15000;

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function readConfig() {
  return {
    token: cleanEnv("FOOTBALL_DATA_TOKEN"),
    competition: cleanEnv("FOOTBALL_DATA_COMPETITION") || DEFAULT_COMPETITION,
    season: cleanEnv("FOOTBALL_DATA_SEASON") || DEFAULT_SEASON
  };
}

function validateConfig(config) {
  if (!config.token) {
    throw new ConfigError(
      "Missing FOOTBALL_DATA_TOKEN. Add it only to the gitignored root .env or the server environment."
    );
  }

  if (!/^[A-Za-z0-9_-]+$/.test(config.competition)) {
    throw new ConfigError("FOOTBALL_DATA_COMPETITION contains unsupported characters.");
  }

  if (!/^\d{4}$/.test(config.season)) {
    throw new ConfigError("FOOTBALL_DATA_SEASON must be a four-digit year.");
  }
}

function redactSecrets(text, config = readConfig()) {
  let output = String(text || "");
  if (config.token && config.token.length >= 4) {
    output = output.split(config.token).join("[redacted]");
  }
  return output;
}

function printHelp() {
  console.log(`
football-data.org World Cup 2026 feasibility check

Usage:
  node server/check-football-data.js
  npm --prefix server run check:football-data

Server-only environment variables:
  FOOTBALL_DATA_TOKEN        Required. Never place it in frontend code.
  FOOTBALL_DATA_COMPETITION  Optional. Defaults to WC.
  FOOTBALL_DATA_SEASON       Optional. Defaults to 2026.

The script makes read-only GET requests to football-data.org. It does not
contact Supabase, modify project data, or print the API token.
`.trim());
}

function endpointPaths(config) {
  const competition = encodeURIComponent(config.competition);
  const season = encodeURIComponent(config.season);

  return [
    {
      key: "competition",
      label: "Competition info",
      path: `/v4/competitions/${competition}`,
      required: true
    },
    {
      key: "matches",
      label: "Season matches",
      path: `/v4/competitions/${competition}/matches?season=${season}`,
      required: true
    },
    {
      key: "standings",
      label: "Season standings",
      path: `/v4/competitions/${competition}/standings?season=${season}`,
      required: false
    }
  ];
}

function providerErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    const candidate = payload.message || payload.error || payload.errorCode;
    if (candidate) return String(candidate).slice(0, 300);
  }
  return String(fallback || "Request failed.").slice(0, 300);
}

async function fetchJson(endpoint, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint.path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Auth-Token": config.token
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
        return {
          ...endpoint,
          ok: false,
          status: response.status,
          payload: null,
          error: "Provider returned invalid JSON."
        };
      }
    }

    return {
      ...endpoint,
      ok: response.ok,
      status: response.status,
      payload,
      error: response.ok ? null : providerErrorMessage(payload, response.statusText)
    };
  } catch (error) {
    const message =
      error && error.name === "AbortError"
        ? `Request timed out after ${REQUEST_TIMEOUT_MS} ms.`
        : error.message;

    return {
      ...endpoint,
      ok: false,
      status: null,
      payload: null,
      error: redactSecrets(message, config)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamName(team) {
  return team?.name || team?.shortName || team?.tla || null;
}

function isNamedTeam(team, aliases) {
  const candidates = [team?.name, team?.shortName, team?.tla]
    .filter(Boolean)
    .map(normalizedName);
  return aliases.map(normalizedName).some((alias) => candidates.includes(alias));
}

function isTargetMatch(match, homeAliases, awayAliases) {
  return (
    isNamedTeam(match?.homeTeam, homeAliases) &&
    isNamedTeam(match?.awayTeam, awayAliases)
  );
}

function scoreSummary(match) {
  const score = match?.score;
  if (!score || typeof score !== "object") return null;

  const fullTime = score.fullTime || {};
  const regularTime = score.regularTime || {};
  const penalties = score.penalties || {};
  const hasAnyScore = [
    fullTime.home,
    fullTime.away,
    regularTime.home,
    regularTime.away,
    penalties.home,
    penalties.away
  ].some((value) => value !== null && value !== undefined);

  if (!hasAnyScore) return null;

  return {
    winner: score.winner ?? null,
    duration: score.duration ?? null,
    fullTime: {
      home: fullTime.home ?? null,
      away: fullTime.away ?? null
    },
    regularTime: {
      home: regularTime.home ?? null,
      away: regularTime.away ?? null
    },
    penalties: {
      home: penalties.home ?? null,
      away: penalties.away ?? null
    }
  };
}

function matchSummary(match) {
  return {
    match_id: match?.id ?? null,
    utc_date: match?.utcDate ?? null,
    home_team: teamName(match?.homeTeam),
    away_team: teamName(match?.awayTeam),
    status: match?.status ?? null,
    minute: match?.minute ?? null,
    score: scoreSummary(match),
    matchday: match?.matchday ?? null,
    stage: match?.stage ?? null,
    group: match?.group ?? null
  };
}

function hasOwn(object, property) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, property);
}

function analyzeFields(matches) {
  const stableMatchIds =
    matches.length > 0 &&
    matches.every((match) => match?.id !== null && match?.id !== undefined);
  const statusFieldAvailable = matches.some((match) => hasOwn(match, "status"));
  const minuteFieldAvailable = matches.some((match) => hasOwn(match, "minute"));
  const scoreFieldAvailable = matches.some(
    (match) =>
      match?.score &&
      typeof match.score === "object" &&
      hasOwn(match.score, "fullTime")
  );

  return {
    stable_match_ids_available: stableMatchIds,
    status_field_available: statusFieldAvailable,
    minute_field_available: minuteFieldAvailable,
    score_field_available: scoreFieldAvailable,
    fields_sufficient_for_public_scores:
      stableMatchIds &&
      statusFieldAvailable &&
      minuteFieldAvailable &&
      scoreFieldAvailable
  };
}

function competitionHasSeason(competition, season) {
  const year = String(season);
  const seasons = [
    competition?.currentSeason,
    ...(Array.isArray(competition?.seasons) ? competition.seasons : [])
  ].filter(Boolean);

  return seasons.some((item) => {
    const startYear = String(item?.startDate || "").slice(0, 4);
    const endYear = String(item?.endDate || "").slice(0, 4);
    return startYear === year || endYear === year;
  });
}

function safeEndpointReport(result) {
  return {
    label: result.label,
    endpoint: result.path,
    method: "GET",
    http_status: result.status,
    ok: result.ok,
    error: result.error || null
  };
}

function printReport(config, results) {
  const byKey = Object.fromEntries(results.map((result) => [result.key, result]));
  const competition = byKey.competition?.payload || null;
  const matches = Array.isArray(byKey.matches?.payload?.matches)
    ? byKey.matches.payload.matches
    : [];
  const standings = Array.isArray(byKey.standings?.payload?.standings)
    ? byKey.standings.payload.standings
    : [];

  const mexicoSouthAfrica = matches.find((match) =>
    isTargetMatch(match, ["Mexico", "MEX"], ["South Africa", "RSA"])
  );
  const southKoreaCzechia = matches.find((match) =>
    isTargetMatch(
      match,
      ["South Korea", "Korea Republic", "Republic of Korea", "KOR"],
      ["Czechia", "Czech Republic", "CZE"]
    )
  );
  const firstDateMatches = matches.filter((match) =>
    String(match?.utcDate || "").startsWith(FIRST_MATCH_DATE)
  );
  const fieldAnalysis = analyzeFields(matches);
  const seasonAvailable =
    competitionHasSeason(competition, config.season) || matches.length > 0;

  console.log("# football-data.org feasibility report");
  console.log("");
  console.log(`Provider: football-data.org`);
  console.log(`Competition: ${config.competition}`);
  console.log(`Season: ${config.season}`);
  console.log("Safety: read-only GET requests; no Supabase access; token not printed.");
  console.log("");
  console.log("## Endpoints called");
  console.log(JSON.stringify(results.map(safeEndpointReport), null, 2));
  console.log("");
  console.log("## Competition");
  console.log(
    JSON.stringify(
      {
        id: competition?.id ?? null,
        name: competition?.name ?? null,
        code: competition?.code ?? null,
        current_season: competition?.currentSeason ?? null,
        season_2026_available: seasonAvailable
      },
      null,
      2
    )
  );
  console.log("");
  console.log(`## Matches count: ${matches.length}`);
  console.log("First 10 matches:");
  console.log(JSON.stringify(matches.slice(0, 10).map(matchSummary), null, 2));
  console.log("");
  console.log(`## Local date filter: ${FIRST_MATCH_DATE}`);
  console.log(`Matches found on date: ${firstDateMatches.length}`);
  console.log(JSON.stringify(firstDateMatches.map(matchSummary), null, 2));
  console.log("");
  console.log("## Required fixture checks");
  console.log(
    JSON.stringify(
      {
        mexico_vs_south_africa_found: Boolean(mexicoSouthAfrica),
        mexico_vs_south_africa: mexicoSouthAfrica
          ? matchSummary(mexicoSouthAfrica)
          : null,
        south_korea_vs_czechia_found: Boolean(southKoreaCzechia),
        south_korea_vs_czechia: southKoreaCzechia
          ? matchSummary(southKoreaCzechia)
          : null
      },
      null,
      2
    )
  );
  console.log("");
  console.log("## Integration field analysis");
  console.log(JSON.stringify(fieldAnalysis, null, 2));
  console.log("");
  console.log("## Standings");
  console.log(
    JSON.stringify(
      {
        endpoint_available: Boolean(byKey.standings?.ok),
        standings_sections: standings.length
      },
      null,
      2
    )
  );
  console.log("");
  console.log("## Feasibility result");
  console.log(
    JSON.stringify(
      {
        world_cup_2026_available: seasonAvailable,
        fixtures_available: matches.length > 0,
        matches_count: matches.length,
        stable_match_ids_available: fieldAnalysis.stable_match_ids_available,
        live_score_shape_appears_sufficient:
          fieldAnalysis.fields_sufficient_for_public_scores,
        note:
          "Free-plan score delay and live update latency cannot be measured before matches are in progress."
      },
      null,
      2
    )
  );
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return { ok: true, help: true };
  }

  const config = readConfig();
  validateConfig(config);

  const results = [];
  for (const endpoint of endpointPaths(config)) {
    results.push(await fetchJson(endpoint, config));
  }

  printReport(config, results);

  const requiredFailures = results.filter(
    (result) => result.required && !result.ok
  );
  if (requiredFailures.length) {
    process.exitCode = 1;
  }

  return {
    ok: requiredFailures.length === 0,
    results
  };
}

function handleCliError(error) {
  const label =
    error instanceof ConfigError ? "Configuration error" : "Feasibility check failed";
  console.error(`[football-data-check] ${label}: ${redactSecrets(error.message)}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch(handleCliError);
}

module.exports = {
  analyzeFields,
  endpointPaths,
  main,
  matchSummary,
  normalizedName,
  readConfig,
  redactSecrets
};
