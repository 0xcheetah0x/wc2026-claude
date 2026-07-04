import {
  extractPredictionScoreFromFootballData,
  reconcileFinishedScore,
} from "./score-policy.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ??
        `Assertion failed. Expected ${expectedJson}, received ${actualJson}.`,
    );
  }
}

Deno.test("regular finished match uses fullTime", () => {
  const extracted = extractPredictionScoreFromFootballData({
    status: "FINISHED",
    stage: "GROUP_STAGE",
    score: {
      duration: "REGULAR",
      fullTime: { home: 1, away: 1 },
    },
  });

  assertEquals(extracted, {
    ok: true,
    source: "fullTime",
    duration: "REGULAR",
    home_score: 1,
    away_score: 1,
  });
});

Deno.test("Colombia-Ghana regular payload extracts the official 90-minute score", () => {
  const extracted = extractPredictionScoreFromFootballData({
    status: "FINISHED",
    stage: "LAST_32",
    score: {
      duration: "REGULAR",
      fullTime: { home: 1, away: 0 },
      regularTime: { home: 1, away: 0 },
      extraTime: null,
      penalties: null,
      winner: "HOME_TEAM",
    },
  });

  assertEquals(extracted, {
    ok: true,
    source: "fullTime",
    duration: "REGULAR",
    home_score: 1,
    away_score: 0,
  });
});

Deno.test("manual Colombia-Ghana final row is preserved when provider differs", () => {
  const result = reconcileFinishedScore(
    {
      match_id: 88,
      home_score: 2,
      away_score: 0,
      status: "finished",
      minute: 90,
      source: "football-data",
    },
    {
      match_id: 88,
      home_score: 1,
      away_score: 0,
      status: "finished",
      minute: 90,
      source: "manual",
    },
    {
      provider_match_id: 537430,
      provider_fixture_id: 537430,
      home: "Colombia",
      away: "Ghana",
      stage: "round_32",
      provider_stage: "LAST_32",
      duration: "REGULAR",
      duration_fields: {
        top_level: null,
        score: "REGULAR",
        selected: "REGULAR",
      },
    },
  );

  assertEquals(result.action, "conflict");
  if (result.action !== "conflict") throw new Error("Expected conflict.");
  assertEquals(result.conflict, {
    action: "conflict",
    manual_review_required: true,
    match_id: 88,
    provider_match_id: 537430,
    provider_fixture_id: 537430,
    home: "Colombia",
    away: "Ghana",
    internal_home: null,
    internal_away: null,
    stage: "round_32",
    provider_stage: "LAST_32",
    duration: "REGULAR",
    duration_fields: {
      top_level: null,
      score: "REGULAR",
      selected: "REGULAR",
    },
    source: "manual",
    existing_source: "manual",
    stored_score: "1-0",
    provider_score: "2-0",
    reason: "Existing manual score row is protected from automatic overwrite.",
  });
});

Deno.test("automated Colombia-Ghana final mismatch requires manual review", () => {
  const result = reconcileFinishedScore(
    {
      match_id: 88,
      home_score: 1,
      away_score: 0,
      status: "finished",
      minute: 90,
      source: "football-data",
    },
    {
      match_id: 88,
      home_score: 2,
      away_score: 0,
      status: "finished",
      minute: 90,
      source: "football-data",
    },
    {
      provider_match_id: 537430,
      home: "Colombia",
      away: "Ghana",
      stage: "round_32",
      duration: "REGULAR",
      duration_fields: {
        top_level: null,
        score: "REGULAR",
        selected: "REGULAR",
      },
    },
  );

  assertEquals(result.action, "conflict");
  if (result.action !== "conflict") throw new Error("Expected conflict.");
  assertEquals(result.conflict.manual_review_required, true);
  assertEquals(result.conflict.stored_score, "2-0");
  assertEquals(result.conflict.provider_score, "1-0");
  assertEquals(
    result.conflict.reason,
    "Stored final score differs from provider final score; automatic overwrite skipped.",
  );
});

Deno.test("extra-time knockout uses regularTime, not fullTime", () => {
  const extracted = extractPredictionScoreFromFootballData({
    status: "FINISHED",
    stage: "LAST_32",
    score: {
      duration: "EXTRA_TIME",
      regularTime: { home: 1, away: 1 },
      fullTime: { home: 2, away: 1 },
      extraTime: { home: 1, away: 0 },
    },
  });

  assertEquals(extracted.ok && [extracted.home_score, extracted.away_score], [1, 1]);
});

Deno.test("Belgium-Senegal extra-time payload uses top-level duration and regularTime", () => {
  const extracted = extractPredictionScoreFromFootballData({
    status: "FINISHED",
    stage: "LAST_32",
    duration: "EXTRA_TIME",
    score: {
      fullTime: { home: 3, away: 2 },
      regularTime: { home: 2, away: 2 },
      extraTime: { home: 1, away: 0 },
      penalties: null,
      winner: "HOME_TEAM",
    },
  });

  assertEquals(extracted.ok && [extracted.home_score, extracted.away_score], [2, 2]);
});

Deno.test("penalty-shootout knockout uses regularTime, not penalties", () => {
  const extracted = extractPredictionScoreFromFootballData({
    status: "FINISHED",
    stage: "LAST_32",
    score: {
      duration: "PENALTY_SHOOTOUT",
      regularTime: { home: 0, away: 0 },
      fullTime: { home: 0, away: 0 },
      penalties: { home: 4, away: 3 },
    },
  });

  assertEquals(extracted.ok && [extracted.home_score, extracted.away_score], [0, 0]);
});

Deno.test("missing regular-time score for extended knockout is skipped", () => {
  const extracted = extractPredictionScoreFromFootballData({
    status: "FINISHED",
    stage: "LAST_32",
    score: {
      duration: "EXTRA_TIME",
      regularTime: null,
      fullTime: { home: 2, away: 1 },
    },
  });

  assertEquals(extracted, {
    ok: false,
    reason: "missing_regular_time_score_for_knockout",
    message:
      "Finished knockout fixture lacks a reliable 90-minute regular-time score; score write skipped.",
    duration: "EXTRA_TIME",
    available_score_fields: {
      fullTime: { home: 2, away: 1 },
      regularTime: null,
      extraTime: null,
      penalties: null,
      winner: null,
    },
  });
});

Deno.test("Belgium-Senegal missing regularTime is skipped with available score fields", () => {
  const extracted = extractPredictionScoreFromFootballData({
    status: "FINISHED",
    stage: "LAST_32",
    duration: "EXTRA_TIME",
    score: {
      fullTime: { home: 3, away: 2 },
      regularTime: null,
      extraTime: { home: 1, away: 0 },
    },
  });

  assertEquals(extracted, {
    ok: false,
    reason: "missing_regular_time_score_for_knockout",
    message:
      "Finished knockout fixture lacks a reliable 90-minute regular-time score; score write skipped.",
    duration: "EXTRA_TIME",
    available_score_fields: {
      fullTime: { home: 3, away: 2 },
      regularTime: null,
      extraTime: { home: 1, away: 0 },
      penalties: null,
      winner: null,
    },
  });
});
