#!/usr/bin/env node
"use strict";

/**
 * Server-side manual Champion winner admin utility.
 *
 * Writes only to public.app_settings (tournament.champion_winner).
 * Leaderboard scores update automatically via public.champion_bonus_points().
 */

const path = require("path");

try {
  require("dotenv").config({
    path: path.resolve(__dirname, "..", ".env"),
    quiet: true
  });
} catch (_) {
  // Run `npm --prefix server install`, or provide env vars through the host.
}

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
WC2026 Champion winner admin

Usage:
  node server/set-champion-winner.js --team="Spain" --dry-run
  node server/set-champion-winner.js --team="Spain"
  node server/set-champion-winner.js --clear --dry-run
  node server/set-champion-winner.js --clear

Required (one of):
  --team=<official Champion team>
  --clear

Optional args:
  --dry-run
  --help

Server-only env vars for real writes:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Safety:
  Use --dry-run first.
  Use the same team spelling shown in the Champion prediction UI.
  Team matching ignores case and repeated whitespace, but preserves accents.
  Never put SUPABASE_SERVICE_ROLE_KEY in frontend code or config.
`.trim());
}

function parseArgs(argv) {
  const out = { dryRun: false, help: false, clear: false };

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

    if (arg === "--clear") {
      out.clear = true;
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

function normalizeTeamName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function validateTeamName(name) {
  const team = normalizeTeamName(name);
  if (!team) {
    throw new InputError("Champion team cannot be blank.");
  }
  if (team.length > 100) {
    throw new InputError("Champion team must be 100 characters or fewer.");
  }
  if (/[\u0000-\u001f\u007f]/.test(team)) {
    throw new InputError("Champion team contains invalid control characters.");
  }
  return team;
}

function validateArgs(args) {
  if (args.clear && args.team) {
    throw new InputError("Use either --team or --clear, not both.");
  }

  if (!args.clear) {
    if (args.team == null) {
      throw new InputError("Missing required --team (or use --clear).");
    }
    return {
      team: validateTeamName(args.team),
      clear: false,
      dryRun: Boolean(args.dryRun)
    };
  }

  return { team: null, clear: true, dryRun: Boolean(args.dryRun) };
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
  for (const secret of [config.supabaseServiceRoleKey].filter((value) => value && value.length >= 8)) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
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

async function fetchTournamentSettings(config) {
  const rows = await supabaseRequest(
    "app_settings?key=eq.tournament&select=key,value",
    { method: "GET" },
    config
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function upsertChampionWinner(teamName, config) {
  const existing = await fetchTournamentSettings(config);
  const currentValue = existing?.value && typeof existing.value === "object" ? existing.value : {};
  const nextValue = {
    ...currentValue,
    champion_winner: teamName
  };

  if (existing) {
    return supabaseRequest("app_settings?key=eq.tournament", {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ value: nextValue })
    }, config);
  }

  return supabaseRequest("app_settings", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ key: "tournament", value: nextValue }])
  }, config);
}

async function clearChampionWinner(config) {
  const existing = await fetchTournamentSettings(config);
  if (!existing) {
    return null;
  }

  const currentValue = existing.value && typeof existing.value === "object" ? { ...existing.value } : {};
  delete currentValue.champion_winner;

  return supabaseRequest("app_settings?key=eq.tournament", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ value: currentValue })
  }, config);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { ok: true, help: true };
  }

  const input = validateArgs(args);
  console.log(`[set-champion-winner] Mode: ${input.dryRun ? "dry-run" : "write"}`);

  if (input.clear) {
    console.log("[set-champion-winner] Planned action: clear tournament.champion_winner");
  } else {
    console.log("[set-champion-winner] Planned official winner:");
    console.log(JSON.stringify({ champion_winner: input.team }, null, 2));
  }

  if (input.dryRun) {
    console.log("[set-champion-winner] Dry-run active. Supabase write skipped.");
    return { ok: true, dryRun: true, ...input };
  }

  const config = readSupabaseConfig();
  validateSupabaseConfig(config);

  const before = await fetchTournamentSettings(config);
  console.log("[set-champion-winner] Current tournament settings:");
  console.log(JSON.stringify(before || { key: "tournament", value: {} }, null, 2));

  const result = input.clear
    ? await clearChampionWinner(config)
    : await upsertChampionWinner(input.team, config);

  console.log("[set-champion-winner] Tournament settings updated.");
  console.log(JSON.stringify(result, null, 2));
  console.log("[set-champion-winner] Leaderboard bonus points will apply on next read of public.leaderboard.");
  return { ok: true, ...input, result };
}

function handleCliError(error) {
  const isInput = error instanceof InputError;
  const label = isInput ? "Input error" : "Champion winner update failed";
  console.error(`[set-champion-winner] ${label}: ${redactSecrets(error.message)}`);
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
  normalizeTeamName,
  validateTeamName,
  validateArgs
};
