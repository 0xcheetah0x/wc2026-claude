export type FootballDataScoreValue = {
  home?: unknown;
  away?: unknown;
  homeTeam?: unknown;
  awayTeam?: unknown;
} | null | undefined;

export type FootballDataMatchForScore = {
  status?: unknown;
  stage?: unknown;
  duration?: unknown;
  score?: {
    duration?: unknown;
    fullTime?: FootballDataScoreValue;
    regularTime?: FootballDataScoreValue;
    extraTime?: FootballDataScoreValue;
    penalties?: FootballDataScoreValue;
    winner?: unknown;
  };
};

export type PredictionScoreExtraction =
  | {
      ok: true;
      source: "fullTime" | "regularTime";
      duration: string;
      home_score: number;
      away_score: number;
    }
  | {
      ok: false;
      reason:
        | "match_not_finished"
        | "unknown_duration_for_knockout"
        | "missing_full_time_score"
        | "missing_regular_time_score_for_knockout"
        | "unsupported_duration";
      message: string;
      duration: string | null;
      available_score_fields: {
        fullTime: FootballDataScoreValue;
        regularTime: FootballDataScoreValue;
        extraTime: FootballDataScoreValue;
        penalties: FootballDataScoreValue;
        winner: unknown;
      };
    };

export type ScoreDurationFields = {
  top_level?: unknown;
  score?: unknown;
  selected?: unknown;
};

export type FinishedScoreRowForPolicy = {
  match_id: number;
  home_score: number;
  away_score: number;
  status: string;
  minute?: number;
  source?: string | null;
  provider_updated_at?: string | null;
};

export type ExistingScoreRowForPolicy = {
  match_id: number;
  home_score: number;
  away_score: number;
  status: string;
  minute?: number;
  source?: string | null;
  provider_updated_at?: string | null;
};

export type FinishedScoreConflictMetadata = {
  provider_match_id?: number | null;
  provider_fixture_id?: number | null;
  home?: string | null;
  away?: string | null;
  internal_home?: string | null;
  internal_away?: string | null;
  stage?: string | null;
  provider_stage?: string | null;
  duration?: string | null;
  duration_fields?: ScoreDurationFields | null;
};

export type FinishedScoreConflict = {
  action: "conflict";
  manual_review_required: true;
  match_id: number;
  provider_match_id: number | null;
  provider_fixture_id: number | null;
  home: string | null;
  away: string | null;
  internal_home: string | null;
  internal_away: string | null;
  stage: string | null;
  provider_stage: string | null;
  duration: string | null;
  duration_fields: {
    top_level: unknown;
    score: unknown;
    selected: unknown;
  };
  source: string | null;
  existing_source: string | null;
  stored_score: string;
  provider_score: string;
  reason: string;
};

export type FinishedScoreReconciliation =
  | {
      action: "inserted" | "unchanged" | "corrected";
      row: FinishedScoreRowForPolicy;
      existing?: ExistingScoreRowForPolicy;
    }
  | {
      action: "conflict";
      conflict: FinishedScoreConflict;
    };

function optionalScoreInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const score = Math.trunc(n);
  return score >= 0 && score <= 20 ? score : null;
}

function scoreValue(score: FootballDataScoreValue, side: "home" | "away"): unknown {
  if (!score || typeof score !== "object") return undefined;
  const fallbackKey = side === "home" ? "homeTeam" : "awayTeam";
  return score[side] ?? score[fallbackKey];
}

function scorePair(score: FootballDataScoreValue): { home: number; away: number } | null {
  const home = optionalScoreInt(scoreValue(score, "home"));
  const away = optionalScoreInt(scoreValue(score, "away"));
  if (home === null || away === null) return null;
  return { home, away };
}

export function normalizeFootballDataStage(stage: unknown): string | null {
  const value = String(stage ?? "").trim().toUpperCase();
  if (!value) return null;

  const stages: Record<string, string> = {
    GROUP_STAGE: "group",
    LAST_32: "round_32",
    ROUND_OF_32: "round_32",
    LAST_16: "round_16",
    ROUND_OF_16: "round_16",
    QUARTER_FINALS: "quarter_final",
    QUARTER_FINAL: "quarter_final",
    SEMI_FINALS: "semi_final",
    SEMI_FINAL: "semi_final",
    THIRD_PLACE: "third_place",
    THIRD_PLACE_GAME: "third_place",
    FINAL: "final",
  };

  return stages[value] ?? value.toLowerCase();
}

export function extractPredictionScoreFromFootballData(
  match: FootballDataMatchForScore,
): PredictionScoreExtraction {
  const score = match?.score;
  const duration = String(match?.duration ?? score?.duration ?? "").trim().toUpperCase();
  const available_score_fields = {
    fullTime: score?.fullTime ?? null,
    regularTime: score?.regularTime ?? null,
    extraTime: score?.extraTime ?? null,
    penalties: score?.penalties ?? null,
    winner: score?.winner ?? null,
  };

  function skipped(
    reason: Extract<PredictionScoreExtraction, { ok: false }>["reason"],
    message: string,
  ): PredictionScoreExtraction {
    return {
      ok: false,
      reason,
      message,
      duration: duration || null,
      available_score_fields,
    };
  }

  const status = String(match?.status ?? "").toUpperCase();
  if (status !== "FINISHED") {
    return skipped("match_not_finished", "Match is not finished.");
  }

  const normalizedStage = normalizeFootballDataStage(match?.stage);
  const groupStage = normalizedStage === "group";
  const regularDurations = new Set(["REGULAR", "NORMAL"]);
  const extendedDurations = new Set(["EXTRA_TIME", "PENALTY_SHOOTOUT"]);

  if (!duration && !groupStage) {
    return skipped(
      "unknown_duration_for_knockout",
      "Finished non-group fixture is missing duration; score write skipped.",
    );
  }

  if (!duration || regularDurations.has(duration)) {
    const fullTime = scorePair(score?.fullTime);
    if (fullTime) {
      return {
        ok: true,
        source: "fullTime",
        duration: duration || "REGULAR",
        home_score: fullTime.home,
        away_score: fullTime.away,
      };
    }

    return skipped(
      "missing_full_time_score",
      "Finished fixture is missing full-time score; retry on next scheduled invocation.",
    );
  }

  if (extendedDurations.has(duration)) {
    const regularTime = scorePair(score?.regularTime);
    if (regularTime) {
      return {
        ok: true,
        source: "regularTime",
        duration,
        home_score: regularTime.home,
        away_score: regularTime.away,
      };
    }

    return skipped(
      "missing_regular_time_score_for_knockout",
      "Finished knockout fixture lacks a reliable 90-minute regular-time score; score write skipped.",
    );
  }

  return skipped(
    "unsupported_duration",
    `Finished fixture has unsupported duration "${duration}".`,
  );
}

function scoreText(row: {
  home_score: unknown;
  away_score: unknown;
}): string {
  return `${Number(row.home_score)}-${Number(row.away_score)}`;
}

function normalizeDurationFields(
  metadata: FinishedScoreConflictMetadata,
): FinishedScoreConflict["duration_fields"] {
  const fields = metadata.duration_fields ?? {};
  return {
    top_level: fields.top_level ?? null,
    score: fields.score ?? null,
    selected: fields.selected ?? metadata.duration ?? null,
  };
}

function scoreConflict(
  row: FinishedScoreRowForPolicy,
  existing: ExistingScoreRowForPolicy,
  metadata: FinishedScoreConflictMetadata,
  reason: string,
): FinishedScoreConflict {
  const durationFields = normalizeDurationFields(metadata);
  const duration =
    metadata.duration ??
      (durationFields.selected === null || durationFields.selected === undefined
        ? null
        : String(durationFields.selected));
  return {
    action: "conflict",
    manual_review_required: true,
    match_id: Number(row.match_id),
    provider_match_id: metadata.provider_match_id ?? null,
    provider_fixture_id:
      metadata.provider_fixture_id ?? metadata.provider_match_id ?? null,
    home: metadata.home ?? null,
    away: metadata.away ?? null,
    internal_home: metadata.internal_home ?? null,
    internal_away: metadata.internal_away ?? null,
    stage: metadata.stage ?? null,
    provider_stage: metadata.provider_stage ?? null,
    duration,
    duration_fields: durationFields,
    source: existing.source ?? null,
    existing_source: existing.source ?? null,
    stored_score: scoreText(existing),
    provider_score: scoreText(row),
    reason,
  };
}

export function reconcileFinishedScore(
  row: FinishedScoreRowForPolicy,
  existing: ExistingScoreRowForPolicy | null | undefined,
  metadata: FinishedScoreConflictMetadata = {},
): FinishedScoreReconciliation {
  if (!existing) {
    return { action: "inserted", row };
  }

  const existingStatus = String(existing.status ?? "").toLowerCase();
  const existingScore = scoreText(existing);
  const providerScore = scoreText(row);

  if (existingStatus === "finished" && existingScore === providerScore) {
    return { action: "unchanged", row, existing };
  }

  if (String(existing.source ?? "").toLowerCase() === "manual") {
    return {
      action: "conflict",
      conflict: scoreConflict(
        row,
        existing,
        metadata,
        "Existing manual score row is protected from automatic overwrite.",
      ),
    };
  }

  if (existingStatus === "finished") {
    return {
      action: "conflict",
      conflict: scoreConflict(
        row,
        existing,
        metadata,
        "Stored final score differs from provider final score; automatic overwrite skipped.",
      ),
    };
  }

  return { action: "corrected", row, existing };
}
