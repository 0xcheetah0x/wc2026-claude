#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  artifactChangeCounts,
  generateFixtureSyncPlan,
  localArtifactWriteStatus,
  noKnownFixtureImportMessage,
  normalizeProviderStage,
  writeArtifacts
} = require("./sync-knockout-fixtures");

function team(name, shortName = name, tla = name.slice(0, 3).toUpperCase()) {
  return { id: Math.floor(Math.random() * 100000) + 1, name, shortName, tla };
}

function match(id, utcDate, home, away, stage = "LAST_32") {
  return {
    id,
    utcDate,
    stage,
    venue: `Venue ${id}`,
    homeTeam: typeof home === "string" ? team(home) : home,
    awayTeam: typeof away === "string" ? team(away) : away,
    score: { fullTime: { home: null, away: null } },
    status: "TIMED"
  };
}

const localState = {
  matches: Array.from({ length: 72 }, (_, index) => ({
    id: index + 1,
    h: `Home ${index + 1}`,
    a: `Away ${index + 1}`,
    utc: `2026-06-${String(11 + Math.floor(index / 4)).padStart(2, "0")}T19:00:00Z`
  })),
  fixtureMap: [
    {
      id: 1,
      utc: "2026-06-11T19:00:00Z",
      home: "Meksika",
      away: "Güney Afrika",
      homeAliases: ["Meksika", "Mexico"],
      awayAliases: ["Güney Afrika", "South Africa"],
      footballDataMatchId: 537327
    },
    {
      id: 3,
      utc: "2026-06-12T19:00:00Z",
      home: "Kanada",
      away: "Bosna Hersek",
      homeAliases: ["Kanada", "Canada"],
      awayAliases: ["Bosna Hersek", "Bosnia and Herzegovina"],
      footballDataMatchId: 537333
    },
    {
      id: 7,
      utc: "2026-06-13T22:00:00Z",
      home: "Brezilya",
      away: "Fas",
      homeAliases: ["Brezilya", "Brazil"],
      awayAliases: ["Fas", "Morocco"],
      footballDataMatchId: 537339
    },
    {
      id: 9,
      utc: "2026-06-14T17:00:00Z",
      home: "Almanya",
      away: "Curaçao",
      homeAliases: ["Almanya", "Germany"],
      awayAliases: ["Curaçao", "Curacao"],
      footballDataMatchId: 537351
    },
    {
      id: 10,
      utc: "2026-06-14T20:00:00Z",
      home: "Hollanda",
      away: "Japonya",
      homeAliases: ["Hollanda", "Netherlands"],
      awayAliases: ["Japonya", "Japan"],
      footballDataMatchId: 537357
    },
    {
      id: 4,
      utc: "2026-06-13T01:00:00Z",
      home: "ABD",
      away: "Paraguay",
      homeAliases: ["ABD", "USA"],
      awayAliases: ["Paraguay"],
      footballDataMatchId: 537345
    }
  ],
  edgeFixtureMap: [{ internalMatchId: 1, footballDataMatchId: 537327 }]
};

const tbd = { id: null, name: "TBD", shortName: "TBD", tla: "TBD" };
const round32 = [
  match(600001, "2026-06-28T19:00:00Z", "South Africa", "Canada"),
  match(600002, "2026-06-28T23:00:00Z", "Brazil", "Japan"),
  match(600003, "2026-06-29T19:00:00Z", "Germany", "Paraguay"),
  match(600004, "2026-06-29T23:00:00Z", "Netherlands", "Morocco"),
  match(600005, "2026-06-30T19:00:00Z", "Mexico", tbd),
  match(600006, "2026-06-30T23:00:00Z", "USA", "Brazil"),
  match(600007, "2026-07-01T19:00:00Z", "Canada", "Japan"),
  match(600008, "2026-07-01T23:00:00Z", "Germany", "Mexico"),
  match(600009, "2026-07-02T19:00:00Z", "Paraguay", "Netherlands"),
  match(600010, "2026-07-02T23:00:00Z", "Morocco", "South Africa"),
  match(600011, "2026-07-03T19:00:00Z", "Japan", "Germany"),
  match(600012, "2026-07-03T23:00:00Z", "Brazil", "Canada"),
  match(600013, "2026-07-04T19:00:00Z", "Mexico", "Paraguay"),
  match(600014, "2026-07-04T23:00:00Z", "Netherlands", "USA"),
  match(600015, "2026-07-05T19:00:00Z", "Morocco", "Germany"),
  match(600016, "2026-07-05T23:00:00Z", "Canada", "Mexico")
];

function byProviderId(plan, providerId) {
  return plan.serverFixtureMapEntries.find((entry) => entry.footballDataMatchId === providerId);
}

assert.strictEqual(normalizeProviderStage("LAST_32"), "round_32");
assert.strictEqual(normalizeProviderStage("QUARTER_FINALS"), "quarter_final");

const beforeGroup = JSON.stringify(localState.matches.filter((item) => item.id <= 72));
const defaultPlan = generateFixtureSyncPlan(round32, {
  localState,
  stage: "round_32",
  includePlaceholders: false
});
const afterGroup = JSON.stringify(localState.matches.filter((item) => item.id <= 72));
assert.strictEqual(afterGroup, beforeGroup, "group fixtures 1-72 must not be changed by planning");

assert.strictEqual(defaultPlan.providerMatchesFetched, 16);
assert.strictEqual(defaultPlan.knockoutMatchesFound, 16);
assert.strictEqual(defaultPlan.knownTeamFixtures, 15);
assert.strictEqual(defaultPlan.placeholderFixturesSkipped, 1);
assert.deepStrictEqual(defaultPlan.plannedInserts.map((row) => row.id), [
  73, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88
]);

const southAfricaCanada = defaultPlan.rows.find((row) => row.id === 73);
assert.strictEqual(southAfricaCanada.home_team, "Güney Afrika");
assert.strictEqual(southAfricaCanada.away_team, "Kanada");
assert.strictEqual(southAfricaCanada.kickoff_at, "2026-06-28T19:00:00Z");
assert.strictEqual(southAfricaCanada.stage, "round_32");

assert.strictEqual(byProviderId(defaultPlan, 600001).id, 73);
assert.strictEqual(byProviderId(defaultPlan, 600002).id, 74);
assert.strictEqual(byProviderId(defaultPlan, 600003).id, 75);
assert.strictEqual(byProviderId(defaultPlan, 600004).id, 76);
assert.strictEqual(defaultPlan.edgeFixtureMapEntries.find((entry) => entry.footballDataMatchId === 600001).internalMatchId, 73);

const placeholderDefault = defaultPlan.rows.find((row) => row.id === 77);
assert.strictEqual(placeholderDefault, undefined, "Mexico vs TBD should be skipped by default");

const includePlan = generateFixtureSyncPlan(round32, {
  localState,
  stage: "round_32",
  includePlaceholders: true
});
const placeholderIncluded = includePlan.rows.find((row) => row.id === 77);
assert(placeholderIncluded, "Mexico vs TBD should be included with --include-placeholders");
assert.strictEqual(placeholderIncluded.home_team, "Meksika");
assert.strictEqual(placeholderIncluded.away_team, "TBD");

const allPlaceholderRound32 = Array.from({ length: 16 }, (_, index) =>
  match(700001 + index, `2026-06-${String(28 + Math.floor(index / 4)).padStart(2, "0")}T19:00:00Z`, tbd, tbd)
);
const placeholderPlan = generateFixtureSyncPlan(allPlaceholderRound32, {
  localState,
  stage: "round_32",
  includePlaceholders: false
});
assert.strictEqual(placeholderPlan.knownTeamFixtures, 0);
assert.strictEqual(placeholderPlan.placeholderFixturesSkipped, 16);
assert.strictEqual(placeholderPlan.plannedInserts.length, 0);
assert.strictEqual(placeholderPlan.plannedUpdates.length, 0);
assert.deepStrictEqual(artifactChangeCounts(placeholderPlan), {
  matches: 0,
  serverFixtureMap: 0,
  edgeFixtureMap: 0,
  total: 0
});
assert.strictEqual(
  localArtifactWriteStatus(placeholderPlan, { writeArtifacts: true, dryRun: false }),
  "skipped because there are no planned artifact changes"
);
assert.strictEqual(
  noKnownFixtureImportMessage(placeholderPlan),
  "No known-team fixtures available from provider; nothing was imported."
);

let placeholderWriteCalls = 0;
const placeholderArtifactResult = writeArtifacts(placeholderPlan, {
  writeJson: () => {
    placeholderWriteCalls += 1;
  }
});
assert.strictEqual(placeholderWriteCalls, 0, "placeholder-only plan must not call artifact writers");
assert.strictEqual(placeholderArtifactResult.skipped, true);
assert.strictEqual(placeholderArtifactResult.reason, "no_changes");

const knownArtifactWrites = [];
const knownArtifactResult = writeArtifacts(defaultPlan, {
  writeJson: (file, data) => {
    knownArtifactWrites.push({ file, count: data.length });
  }
});
assert.strictEqual(knownArtifactResult.skipped, false);
assert.deepStrictEqual(
  knownArtifactWrites.map((item) => item.file.replace(/\\/g, "/").split("/").slice(-2).join("/")),
  ["server/matches.json", "server/fixture-map.json", "sync-finished-scores/fixture-map.json"]
);
assert.deepStrictEqual(artifactChangeCounts(defaultPlan), {
  matches: 15,
  serverFixtureMap: 15,
  edgeFixtureMap: 15,
  total: 45
});

console.log("[sync-knockout-fixtures:test] All mocked fixture sync checks passed.");
