import { createClient } from "npm:@supabase/supabase-js@2";
import fixtureMap from "./fixture-map.json" with { type: "json" };
import {
  extractPredictionScoreFromFootballData,
  normalizeFootballDataStage,
  reconcileFinishedScore,
  type FinishedScoreConflict,
  type FootballDataMatchForScore,
  type ScoreDurationFields,
} from "./score-policy.ts";

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
  source: typeof PROVIDER;
  provider_updated_at: string;
};

type ExistingScore = {
  match_id: number;
  home_score: number;
  away_score: number;
  status: string;
  minute: number;
  source: string | null;
  provider_updated_at: string | null;
};

type FinishedScoreCandidate = {
  provider_match_id: number;
  home: string | null;
  away: string | null;
  stage: string | null;
  provider_stage: string | null;
  duration: string | null;
  duration_fields: ScoreDurationFields;
  row: ScoreRow;
};

type ScoreWarning = {
  match_id: number;
  provider_match_id: number;
  stage: string | null;
  home: string | null;
  away: string | null;
  duration: string | null;
  available_score_fields: Record<string, unknown>;
  reason: string;
  action: "skipped";
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
  conflict_count: number;
  conflicts: FinishedScoreConflict[];
  warnings: ScoreWarning[];
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
    conflict_count: 0,
    conflicts: [],
    warnings: [],
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

function providerTeamName(team: {
  name?: unknown;
  shortName?: unknown;
  tla?: unknown;
} | undefined): string | null {
  const candidate = team?.name ?? team?.shortName ?? team?.tla;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function scoreWarningForFixture(
  fixture: FootballDataMatchForScore & {
    homeTeam?: Parameters<typeof providerTeamName>[0];
    awayTeam?: Parameters<typeof providerTeamName>[0];
  },
  internalMatchId: number,
  providerMatchId: number,
  reason: string,
  duration: string | null,
  availableScoreFields: Record<string, unknown>,
): ScoreWarning {
  return {
    match_id: internalMatchId,
    provider_match_id: providerMatchId,
    stage: normalizeFootballDataStage(fixture.stage),
    home: providerTeamName(fixture.homeTeam),
    away: providerTeamName(fixture.awayTeam),
    duration,
    available_score_fields: availableScoreFields,
    reason,
    action: "skipped",
  };
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

  const providerObservedAt = new Date().toISOString();
  const validRowsByMatchId = new Map<number, FinishedScoreCandidate>();
  let mappedFixtureCount = 0;
  let skippedCount = 0;
  let liveCount = 0;
  let upcomingCount = 0;
  const warnings: ScoreWarning[] = [];

  for (const value of providerMatches) {
    if (!value || typeof value !== "object") continue;

    const fixture = value as FootballDataMatchForScore & {
      id?: unknown;
      status?: unknown;
      stage?: unknown;
      homeTeam?: {
        name?: unknown;
        shortName?: unknown;
        tla?: unknown;
      };
      awayTeam?: {
        name?: unknown;
        shortName?: unknown;
        tla?: unknown;
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

    const predictionScore = extractPredictionScoreFromFootballData(fixture);
    if (!predictionScore.ok) {
      skippedCount += 1;
      warnings.push(
        scoreWarningForFixture(
          fixture,
          internalMatchId,
          providerMatchId,
          predictionScore.reason,
          predictionScore.duration,
          predictionScore.available_score_fields as Record<string, unknown>,
        ),
      );
      messages.push(
        `Match ${internalMatchId}: ${predictionScore.message}`,
      );
      continue;
    }

    const homeScore = predictionScore.home_score;
    const awayScore = predictionScore.away_score;
    if (!isValidScore(homeScore) || !isValidScore(awayScore)) {
      skippedCount += 1;
      warnings.push(
        scoreWarningForFixture(
          fixture,
          internalMatchId,
          providerMatchId,
          "invalid_extracted_prediction_score",
          predictionScore.duration,
          {
            fullTime: fixture.score?.fullTime ?? null,
            regularTime: fixture.score?.regularTime ?? null,
            extraTime: fixture.score?.extraTime ?? null,
            penalties: fixture.score?.penalties ?? null,
            winner: fixture.score?.winner ?? null,
          },
        ),
      );
      messages.push(
        `Match ${internalMatchId}: extracted prediction score is outside the allowed range.`,
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

    const durationFields: ScoreDurationFields = {
      top_level: fixture.duration ?? null,
      score: fixture.score?.duration ?? null,
      selected: predictionScore.duration,
    };

    validRowsByMatchId.set(internalMatchId, {
      provider_match_id: providerMatchId,
      home: providerTeamName(fixture.homeTeam),
      away: providerTeamName(fixture.awayTeam),
      stage: normalizeFootballDataStage(fixture.stage),
      provider_stage:
        typeof fixture.stage === "string" && fixture.stage.trim()
          ? fixture.stage.trim()
          : null,
      duration: predictionScore.duration,
      duration_fields: durationFields,
      row: {
        match_id: internalMatchId,
        home_score: homeScore,
        away_score: awayScore,
        status: "finished",
        minute: 90,
        source: PROVIDER,
        provider_updated_at: providerObservedAt,
      },
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
    (left, right) => left.row.match_id - right.row.match_id,
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
      .select(
        "match_id,home_score,away_score,status,minute,source,provider_updated_at",
      )
      .in(
        "match_id",
        validRows.map((candidate) => candidate.row.match_id),
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
          warnings,
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
  const conflicts: FinishedScoreConflict[] = [];
  let insertedCount = 0;
  let unchangedCount = 0;
  let correctedCount = 0;
  let conflictCount = 0;

  for (const candidate of validRows) {
    const row = candidate.row;
    const existing = existingByMatchId.get(row.match_id);
    const reconciliation = reconcileFinishedScore(row, existing ?? null, {
      provider_match_id: candidate.provider_match_id,
      provider_fixture_id: candidate.provider_match_id,
      home: candidate.home,
      away: candidate.away,
      stage: candidate.stage,
      provider_stage: candidate.provider_stage,
      duration: candidate.duration,
      duration_fields: candidate.duration_fields,
    });

    if (reconciliation.action === "inserted") {
      insertedCount += 1;
      rowsToWrite.push(row);
      continue;
    }

    if (reconciliation.action === "unchanged") {
      unchangedCount += 1;
      continue;
    }

    if (reconciliation.action === "conflict") {
      conflictCount += 1;
      skippedCount += 1;
      conflicts.push(reconciliation.conflict);
      continue;
    }

    correctedCount += 1;
    rowsToWrite.push(row);
  }

  messages.push(`${insertedCount} finished score row(s) classified as inserted.`);
  messages.push(`${unchangedCount} finished score row(s) classified as unchanged.`);
  messages.push(
    `${correctedCount} non-final score row(s) classified as finalized.`,
  );
  messages.push(
    `${conflictCount} finished score conflict(s) skipped without overwrite.`,
  );

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
          conflict_count: conflictCount,
          conflicts,
          warnings,
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
      conflict_count: conflictCount,
      conflicts,
      warnings,
      skipped_count: skippedCount,
      messages,
    }),
  );
});
