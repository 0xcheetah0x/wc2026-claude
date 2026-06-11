#!/usr/bin/env node
"use strict";

/**
 * Server-side manual Golden Boot winner admin utility.
 *
 * Writes only to public.app_settings (tournament.golden_boot_winner).
 * Leaderboard scores update automatically via public.golden_boot_bonus_points().
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
WC2026 Golden Boot winner admin

Usage:
  node server/set-golden-boot-winner.js --player="Kylian Mbappe" --dry-run
  node server/set-golden-boot-winner.js --player="Kylian Mbappe"
  node server/set-golden-boot-winner.js --clear --dry-run
  node server/set-golden-boot-winner.js --clear

Required (one of):
  --player=<official winner name>
  --clear

Optional args:
  --dry-run
  --help

Server-only env vars for real writes:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Safety:
  Use --dry-run first.
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

function normalizePlayerName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function validateArgs(args) {
  if (args.clear && args.player) {
    throw new InputError("Use either --player or --clear, not both.");
  }

  if (!args.clear) {
    const player = normalizePlayerName(args.player);
    if (!player) {
      throw new InputError("Missing required --player (or use --clear).");
    }
    return { player, clear: false, dryRun: Boolean(args.dryRun) };
  }

  return { player: null, clear: true, dryRun: Boolean(args.dryRun) };
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

async function upsertGoldenBootWinner(playerName, config) {
  const existing = await fetchTournamentSettings(config);
  const currentValue = existing?.value && typeof existing.value === "object" ? existing.value : {};
  const nextValue = {
    ...currentValue,
    golden_boot_winner: playerName
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

async function clearGoldenBootWinner(config) {
  const existing = await fetchTournamentSettings(config);
  if (!existing) {
    return null;
  }

  const currentValue = existing.value && typeof existing.value === "object" ? { ...existing.value } : {};
  delete currentValue.golden_boot_winner;

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
  console.log(`[set-golden-boot-winner] Mode: ${input.dryRun ? "dry-run" : "write"}`);

  if (input.clear) {
    console.log("[set-golden-boot-winner] Planned action: clear tournament.golden_boot_winner");
  } else {
    console.log("[set-golden-boot-winner] Planned official winner:");
    console.log(JSON.stringify({ golden_boot_winner: input.player }, null, 2));
  }

  if (input.dryRun) {
    console.log("[set-golden-boot-winner] Dry-run active. Supabase write skipped.");
    return { ok: true, dryRun: true, ...input };
  }

  const config = readSupabaseConfig();
  validateSupabaseConfig(config);

  const before = await fetchTournamentSettings(config);
  console.log("[set-golden-boot-winner] Current tournament settings:");
  console.log(JSON.stringify(before || { key: "tournament", value: {} }, null, 2));

  const result = input.clear
    ? await clearGoldenBootWinner(config)
    : await upsertGoldenBootWinner(input.player, config);

  console.log("[set-golden-boot-winner] Tournament settings updated.");
  console.log(JSON.stringify(result, null, 2));
  console.log("[set-golden-boot-winner] Leaderboard bonus points will apply on next read of public.leaderboard.");
  return { ok: true, ...input, result };
}

function handleCliError(error) {
  const isInput = error instanceof InputError;
  const label = isInput ? "Input error" : "Golden Boot winner update failed";
  console.error(`[set-golden-boot-winner] ${label}: ${redactSecrets(error.message)}`);
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
  normalizePlayerName,
  validateArgs
};
