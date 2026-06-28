#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  adaptFootballDataMatch,
  buildScorePlan,
  extractPredictionScoreFromFootballData,
  reconcileFootballDataFinishedRows
} = require("./update-scores");

const config = { footballDataSeason: "2026" };

const internalMatches = [
  {
    id: 1,
    h: "Mexico",
    a: "South Africa",
    utc: "2026-06-11T19:00:00Z",
    stage: "group"
  },
  {
    id: 73,
    h: "South Africa",
    a: "Canada",
    utc: "2026-06-28T19:00:00Z",
    stage: "round_32"
  }
];

const fixtureMap = [
  {
    id: 1,
    utc: "2026-06-11T19:00:00Z",
    home: "Mexico",
    away: "South Africa",
    footballDataMatchId: 1001
  },
  {
    id: 73,
    utc: "2026-06-28T19:00:00Z",
    home: "South Africa",
    away: "Canada",
    footballDataMatchId: 537417
  }
];

function team(name) {
  return { name, shortName: name, tla: name.slice(0, 3).toUpperCase() };
}

function providerMatch(overrides) {
  return {
    id: 1001,
    utcDate: "2026-06-11T19:00:00Z",
    status: "FINISHED",
    stage: "GROUP_STAGE",
    homeTeam: team("Mexico"),
    awayTeam: team("South Africa"),
    competition: { id: 2000, name: "FIFA World Cup" },
    score: {
      duration: "REGULAR",
      fullTime: { home: 1, away: 1 }
    },
    ...overrides
  };
}

function rowFromSingleMatch(match) {
  const fixture = adaptFootballDataMatch(match, config);
  const plan = buildScorePlan([fixture], internalMatches, fixtureMap);
  return { fixture, plan, row: plan.rows[0] || null };
}

{
  const match = providerMatch({});
  const extracted = extractPredictionScoreFromFootballData(match);
  assert.deepStrictEqual(extracted.ok && [extracted.home_score, extracted.away_score], [1, 1]);

  const { row } = rowFromSingleMatch(match);
  assert.strictEqual(row.home_score, 1);
  assert.strictEqual(row.away_score, 1);
  assert.strictEqual(row.status, "finished");
}

{
  const match = providerMatch({
    id: 537417,
    utcDate: "2026-06-28T19:00:00Z",
    stage: "LAST_32",
    homeTeam: team("South Africa"),
    awayTeam: team("Canada"),
    score: {
      duration: "EXTRA_TIME",
      regularTime: { home: 1, away: 1 },
      fullTime: { home: 2, away: 1 },
      extraTime: { home: 1, away: 0 }
    }
  });
  const { row } = rowFromSingleMatch(match);
  assert.strictEqual(row.match_id, 73);
  assert.strictEqual(row.home_score, 1);
  assert.strictEqual(row.away_score, 1);
}

{
  const match = providerMatch({
    id: 537417,
    utcDate: "2026-06-28T19:00:00Z",
    stage: "LAST_32",
    homeTeam: team("South Africa"),
    awayTeam: team("Canada"),
    score: {
      duration: "PENALTY_SHOOTOUT",
      regularTime: { home: 0, away: 0 },
      fullTime: { home: 0, away: 0 },
      penalties: { home: 4, away: 3 }
    }
  });
  const { row } = rowFromSingleMatch(match);
  assert.strictEqual(row.home_score, 0);
  assert.strictEqual(row.away_score, 0);
}

{
  const match = providerMatch({
    id: 537417,
    utcDate: "2026-06-28T19:00:00Z",
    stage: "LAST_32",
    homeTeam: team("South Africa"),
    awayTeam: team("Canada"),
    score: {
      duration: "EXTRA_TIME",
      regularTime: null,
      fullTime: { home: 2, away: 1 }
    }
  });
  const { plan } = rowFromSingleMatch(match);
  assert.strictEqual(plan.rows.length, 0);
  assert.strictEqual(plan.report.skipped.length, 1);
  assert.strictEqual(
    plan.report.skipped[0].reason,
    "missing_regular_time_score_for_knockout"
  );
  assert.strictEqual(plan.report.skipped[0].action, "skipped");
}

{
  const reconciliation = reconcileFootballDataFinishedRows(
    [{ match_id: 73, home_score: 2, away_score: 1, status: "finished", minute: 90 }],
    [{ match_id: 73, home_score: 1, away_score: 1, status: "finished", minute: 90 }]
  );
  assert.strictEqual(reconciliation.rowsToWrite.length, 0);
  assert.strictEqual(reconciliation.actions.length, 1);
  assert.strictEqual(reconciliation.actions[0].action, "conflict");
  assert.strictEqual(reconciliation.actions[0].stored_score, "1-1");
  assert.strictEqual(reconciliation.actions[0].provider_score, "2-1");
}

console.log("[update-scores:test] All mocked football-data score policy checks passed.");
