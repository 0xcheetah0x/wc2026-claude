import { extractPredictionScoreFromFootballData } from "./score-policy.ts";

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
