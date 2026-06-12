import { createClient } from "npm:@supabase/supabase-js@2";
import fixtureMap from "./fixture-map.json" with { type: "json" };

const PROVIDER = "football-data";
const PROVIDER_URL =
  "https://api.football-data.org/v4/competitions/WC/matches?season=2026";
const CRON_HEADER = "x-wc2026-cron-secret";
const PROVIDER_TIMEOUT_MS = 15_000;

type FixtureMapEntry = {
  internalMatchId: number;
  footballDataMatchId: number;
};

type ScoreRow = {
  match_id: number;
  home_score: number;
  away_score: number;
  status: "finished";
  minute: 90;
};

type ExistingScore = {
  match_id: number;
  home_score: number;
  away_score: number;
  status: string;
  minute: number;
};

type SyncReport = {
  provider: typeof PROVIDER;
  dry_run: boolean;
  write_enabled: boolean;
  provider_request_count: number;
  provider_fixture_count: number;
  mapped_fixture_count: number;
  valid_finished_count: number;
  inserted_count: number;
  unchanged_count: number;
  corrected_count: number;
  skipped_count: number;
  live_write_enabled: false;
  messages: string[];
};

const providerToInternal = new Map<number, number>(
  (fixtureMap as FixtureMapEntry[]).map((entry) => [
    entry.footballDataMatchId,
    entry.internalMatchId,
  ]),
);

function report(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    provider: PROVIDER,
    dry_run: true,
    write_enabled: false,
    provider_request_count: 0,
    provider_fixture_count: 0,
    mapped_fixture_count: 0,
    valid_finished_count: 0,
    inserted_count: 0,
    unchanged_count: 0,
    corrected_count: 0,
    skipped_count: 0,
    live_write_enabled: false,
    messages: [],
    ...overrides,
  };
}

function jsonResponse(payload: SyncReport, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function secretsMatch(received: string, expected: string): boolean {
  if (!received || !expected || received.length !== expected.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function isValidScore(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 20;
}

async function readRequestBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};

  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify(report({ messages: ["Method not allowed."] })),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          Allow: "POST",
        },
      },
    );
  }

  const cronSecret = Deno.env.get("WC2026_CRON_SECRET") ?? "";
  if (!cronSecret) {
    return jsonResponse(
      report({ messages: ["Function authentication is not configured."] }),
      500,
    );
  }

  const receivedSecret = request.headers.get(CRON_HEADER) ?? "";
  if (!secretsMatch(receivedSecret, cronSecret)) {
    return jsonResponse(report({ messages: ["Unauthorized."] }), 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await readRequestBody(request);
  } catch {
    return jsonResponse(
      report({ messages: ["Request body must be valid JSON."] }),
      400,
    );
  }

  const requestedWrite = body.dryRun === false;
  const environmentWriteEnabled =
    Deno.env.get("FINISHED_SCORE_SYNC_ENABLED") === "true";
  const writeEnabled = requestedWrite && environmentWriteEnabled;
  const dryRun = !writeEnabled;
  const messages: string[] = [];

  if (!requestedWrite) {
    messages.push("Dry-run requested; zero score writes will be performed.");
  } else if (!environmentWriteEnabled) {
    messages.push(
      "Write requested but FINISHED_SCORE_SYNC_ENABLED is not true; dry-run performed.",
    );
  }

  const footballDataToken = Deno.env.get("FOOTBALL_DATA_TOKEN") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!footballDataToken || !supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      report({
        dry_run: dryRun,
        write_enabled: writeEnabled,
        messages: [...messages, "Required server-side configuration is missing."],
      }),
      500,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let providerPayload: unknown;

  try {
    const providerResponse = await fetch(PROVIDER_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Auth-Token": footballDataToken,
      },
      signal: controller.signal,
    });

    if (!providerResponse.ok) {
      return jsonResponse(
        report({
          dry_run: dryRun,
          write_enabled: writeEnabled,
          provider_request_count: 1,
          messages: [
            ...messages,
            `Provider request failed with HTTP ${providerResponse.status}.`,
          ],
        }),
        502,
      );
    }

    providerPayload = await providerResponse.json();
  } catch {
    return jsonResponse(
      report({
        dry_run: dryRun,
        write_enabled: writeEnabled,
        provider_request_count: 1,
        messages: [...messages, "Provider request failed."],
      }),
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawProviderMatches =
    providerPayload && typeof providerPayload === "object"
      ? (providerPayload as { matches?: unknown }).matches
      : undefined;
  if (!Array.isArray(rawProviderMatches)) {
    return jsonResponse(
      report({
        dry_run: dryRun,
        write_enabled: writeEnabled,
        provider_request_count: 1,
        messages: [...messages, "Provider returned an unexpected payload."],
      }),
      502,
    );
  }
  const providerMatches = rawProviderMatches;

  const validRowsByMatchId = new Map<number, ScoreRow>();
  let mappedFixtureCount = 0;
  let skippedCount = 0;
  let liveCount = 0;
  let upcomingCount = 0;

  for (const value of providerMatches) {
    if (!value || typeof value !== "object") continue;

    const fixture = value as {
      id?: unknown;
      status?: unknown;
      score?: {
        fullTime?: {
          home?: unknown;
          away?: unknown;
        };
      };
    };
    const providerMatchId = Number(fixture.id);
    const internalMatchId = providerToInternal.get(providerMatchId);
    if (!internalMatchId) continue;

    mappedFixtureCount += 1;
    const status = String(fixture.status ?? "").toUpperCase();

    if (status === "IN_PLAY" || status === "PAUSED") {
      liveCount += 1;
      skippedCount += 1;
      continue;
    }

    if (status === "TIMED" || status === "SCHEDULED") {
      upcomingCount += 1;
      skippedCount += 1;
      continue;
    }

    if (status !== "FINISHED") {
      skippedCount += 1;
      continue;
    }

    const homeScore = fixture.score?.fullTime?.home;
    const awayScore = fixture.score?.fullTime?.away;
    if (!isValidScore(homeScore) || !isValidScore(awayScore)) {
      skippedCount += 1;
      messages.push(
        `Match ${internalMatchId}: Finished fixture is missing full-time score; retry on next scheduled invocation.`,
      );
      continue;
    }

    if (validRowsByMatchId.has(internalMatchId)) {
      skippedCount += 1;
      messages.push(
        `Match ${internalMatchId}: duplicate provider fixture skipped.`,
      );
      continue;
    }

    validRowsByMatchId.set(internalMatchId, {
      match_id: internalMatchId,
      home_score: homeScore,
      away_score: awayScore,
      status: "finished",
      minute: 90,
    });
  }

  if (liveCount > 0) {
    messages.push(
      `${liveCount} live fixture(s) skipped. Live football-data writes remain disabled.`,
    );
  }
  if (upcomingCount > 0) {
    messages.push(`${upcomingCount} upcoming fixture(s) skipped.`);
  }

  const validRows = Array.from(validRowsByMatchId.values()).sort(
    (left, right) => left.match_id - right.match_id,
  );
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let existingRows: ExistingScore[] = [];
  if (validRows.length > 0) {
    const { data, error } = await supabase
      .from("scores")
      .select("match_id,home_score,away_score,status,minute")
      .in(
        "match_id",
        validRows.map((row) => row.match_id),
      );

    if (error || !Array.isArray(data)) {
      return jsonResponse(
        report({
          dry_run: dryRun,
          write_enabled: writeEnabled,
          provider_request_count: 1,
          provider_fixture_count: providerMatches.length,
          mapped_fixture_count: mappedFixtureCount,
          valid_finished_count: validRows.length,
          skipped_count: skippedCount,
          messages: [...messages, "Existing score reconciliation failed."],
        }),
        502,
      );
    }
    existingRows = data as ExistingScore[];
  }

  const existingByMatchId = new Map<number, ExistingScore>(
    existingRows.map((row) => [Number(row.match_id), row]),
  );
  const rowsToWrite: ScoreRow[] = [];
  let insertedCount = 0;
  let unchangedCount = 0;
  let correctedCount = 0;

  for (const row of validRows) {
    const existing = existingByMatchId.get(row.match_id);
    if (!existing) {
      insertedCount += 1;
      rowsToWrite.push(row);
      continue;
    }

    if (
      String(existing.status).toLowerCase() === "finished" &&
      Number(existing.home_score) === row.home_score &&
      Number(existing.away_score) === row.away_score
    ) {
      unchangedCount += 1;
      continue;
    }

    correctedCount += 1;
    rowsToWrite.push(row);
  }

  messages.push(`${insertedCount} finished score row(s) classified as inserted.`);
  messages.push(`${unchangedCount} finished score row(s) classified as unchanged.`);
  messages.push(`${correctedCount} finished score row(s) classified as corrected.`);

  if (writeEnabled && rowsToWrite.length > 0) {
    const { error } = await supabase
      .from("scores")
      .upsert(rowsToWrite, { onConflict: "match_id" });

    if (error) {
      return jsonResponse(
        report({
          dry_run: false,
          write_enabled: true,
          provider_request_count: 1,
          provider_fixture_count: providerMatches.length,
          mapped_fixture_count: mappedFixtureCount,
          valid_finished_count: validRows.length,
          inserted_count: insertedCount,
          unchanged_count: unchangedCount,
          corrected_count: correctedCount,
          skipped_count: skippedCount,
          messages: [...messages, "Finished-score upsert failed."],
        }),
        502,
      );
    }
  }

  messages.push(
    writeEnabled
      ? `Write completed for ${rowsToWrite.length} finished score row(s).`
      : `Dry-run completed; ${rowsToWrite.length} finished score row(s) would be written.`,
  );

  return jsonResponse(
    report({
      dry_run: dryRun,
      write_enabled: writeEnabled,
      provider_request_count: 1,
      provider_fixture_count: providerMatches.length,
      mapped_fixture_count: mappedFixtureCount,
      valid_finished_count: validRows.length,
      inserted_count: insertedCount,
      unchanged_count: unchangedCount,
      corrected_count: correctedCount,
      skipped_count: skippedCount,
      messages,
    }),
  );
});
