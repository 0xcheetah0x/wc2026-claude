#!/usr/bin/env node
"use strict";

/**
 * Server-side manual score admin utility.
 *
 * This script writes only to public.scores, and only when --dry-run is not set.
 * The Supabase service role key is read from server-side environment only.
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

const MATCHES_FILE = path.join(__dirname, "matches.json");
const VALID_STATUSES = new Set(["upcoming", "live", "finished"]);

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
WC2026 manual score admin

Usage:
  node server/set-score.js --match=1 --home=2 --away=1 --status=finished --minute=90 --dry-run
  node server/set-score.js --match=1 --home=2 --away=1 --status=finished --minute=90

Required args:
  --match=<positive integer>
  --home=<non-negative integer>
  --away=<non-negative integer>
  --status=<upcoming|live|finished>

Optional args:
  --minute=<non-negative integer>
  --dry-run
  --help

Defaults:
  --minute=90 when --status=finished
  --minute=0 otherwise

Server-only env vars for real writes:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Safety:
  Use --dry-run first.
  Never put SUPABASE_SERVICE_ROLE_KEY in frontend code or config.
`.trim());
}

function parseArgs(argv) {
  const out = { dryRun: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new InputError(`Unexpected argument: ${arg}`);
    }

    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new InputError(`Missing value for --${key}`);
    }
    out[key] = next;
    i += 1;
  }

  return out;
}

function parseInteger(value, name, { positive = false } = {}) {
  if (value === undefined || value === null || value === "") {
    throw new InputError(`Missing required --${name}`);
  }

  if (!/^\d+$/.test(String(value))) {
    throw new InputError(`--${name} must be a non-negative integer.`);
  }

  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new InputError(`--${name} is too large.`);
  }

  if (positive && n <= 0) {
    throw new InputError(`--${name} must be a positive integer.`);
  }

  return n;
}

function validateScoreArgs(args) {
  const status = String(args.status || "").trim().toLowerCase();
  if (!VALID_STATUSES.has(status)) {
    throw new InputError("--status must be one of: upcoming, live, finished.");
  }

  const minuteRaw = args.minute === undefined ? (status === "finished" ? "90" : "0") : args.minute;

  return {
    matchId: parseInteger(args.match, "match", { positive: true }),
    homeScore: parseInteger(args.home, "home"),
    awayScore: parseInteger(args.away, "away"),
    status,
    minute: parseInteger(minuteRaw, "minute"),
    dryRun: Boolean(args.dryRun)
  };
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function loadLocalMatch(matchId) {
  const matches = readJson(MATCHES_FILE, []);
  if (!Array.isArray(matches)) return null;
  return matches.find((m) => Number(m.id) === Number(matchId)) || null;
}

function readSupabaseConfig() {
  return {
    supabaseUrl: cleanEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: cleanEnv("SUPABASE_SERVICE_ROLE_KEY")
  };
}

function validateSupabaseConfig(config) {
  const missing = [];
  if (!config.supabaseUrl) missing.push("SUPABASE_URL");
  if (!config.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new InputError(`Missing required server-only env var(s): ${missing.join(", ")}.`);
  }
}

function redactSecrets(text, config = readSupabaseConfig()) {
  let out = String(text || "");
  for (const secret of [config.supabaseServiceRoleKey].filter((v) => v && v.length >= 8)) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function scorePayload(score) {
  return {
    match_id: score.matchId,
    home_score: score.homeScore,
    away_score: score.awayScore,
    status: score.status,
    minute: score.minute
  };
}

async function supabaseRequest(restPath, options, config) {
  const baseUrl = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/${restPath}`, {
    ...options,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase request failed with status ${response.status}: ${body.slice(0, 300)}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchSupabaseMatch(matchId, config) {
  const rows = await supabaseRequest(
    `matches?id=eq.${encodeURIComponent(matchId)}&select=id,home_team,away_team,kickoff_at,stage`,
    { method: "GET" },
    config
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function upsertScore(payload, config) {
  return supabaseRequest("scores?on_conflict=match_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify([payload])
  }, config);
}

function printLocalMatch(localMatch) {
  if (!localMatch) {
    console.log("[set-score] Local match: not found in server/matches.json");
    return;
  }

  console.log("[set-score] Local match:");
  console.log(JSON.stringify({
    id: localMatch.id,
    home: localMatch.h,
    away: localMatch.a,
    utc: localMatch.utc
  }, null, 2));
}

function printSupabaseMatch(match) {
  if (!match) {
    console.log("[set-score] Supabase match: not found");
    return;
  }

  console.log("[set-score] Supabase match:");
  console.log(JSON.stringify(match, null, 2));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { ok: true, help: true };
  }

  const score = validateScoreArgs(args);
  const payload = scorePayload(score);
  const localMatch = loadLocalMatch(score.matchId);

  console.log(`[set-score] Mode: ${score.dryRun ? "dry-run" : "write"}`);
  printLocalMatch(localMatch);
  console.log("[set-score] Planned public.scores payload:");
  console.log(JSON.stringify(payload, null, 2));

  if (score.dryRun) {
    console.log("[set-score] Dry-run active. Supabase match check and score write skipped.");
    return { ok: true, dryRun: true, payload };
  }

  const config = readSupabaseConfig();
  validateSupabaseConfig(config);

  const supabaseMatch = await fetchSupabaseMatch(score.matchId, config);
  printSupabaseMatch(supabaseMatch);

  if (!supabaseMatch) {
    throw new InputError(`Match ${score.matchId} does not exist in Supabase public.matches. No score was written.`);
  }

  const result = await upsertScore(payload, config);
  console.log("[set-score] Score upserted into public.scores.");
  return { ok: true, payload, result };
}

function handleCliError(error) {
  const isInput = error instanceof InputError;
  const label = isInput ? "Input error" : "Manual score update failed";
  console.error(`[set-score] ${label}: ${redactSecrets(error.message)}`);
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
  main,
  parseArgs,
  scorePayload,
  validateScoreArgs
};
