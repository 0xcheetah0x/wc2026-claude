# football-data.org Finished-Score Payload Audit

Audit timestamp: `2026-06-12T09:55:46.687Z`

## Scope and safety

This was a read-only audit. Two authenticated HTTP `GET` requests were made
with the server-only `FOOTBALL_DATA_TOKEN` loaded from the gitignored root
`.env`. The token was not printed. No Supabase request or write was made.

No updater behavior, frontend file, schema, fixture, score, scheduler,
API-Football path, or manual score tool was modified.

## Endpoints called

Provider request count: `2`

1. `GET /v4/matches/537327`
2. `GET /v4/competitions/WC/matches?season=2026`

Both requests returned HTTP `200`. The season response contained match
`537327`.

## Sanitized payload comparison

The two endpoints returned the same scoring data at the audit timestamp.

| Field | Single-match endpoint | Season endpoint |
|---|---|---|
| `id` | `537327` | `537327` |
| `utcDate` | `2026-06-11T19:00:00Z` | `2026-06-11T19:00:00Z` |
| `status` | `FINISHED` | `FINISHED` |
| `minute` | missing | missing |
| `homeTeam.name` | `Mexico` | `Mexico` |
| `awayTeam.name` | `South Africa` | `South Africa` |
| `score.winner` | `HOME_TEAM` | `HOME_TEAM` |
| `score.duration` | `REGULAR` | `REGULAR` |
| `score.fullTime.home` | `2` | `2` |
| `score.fullTime.away` | `0` | `0` |
| `score.regularTime.home` | missing | missing |
| `score.regularTime.away` | missing | missing |
| `score.extraTime.home` | missing | missing |
| `score.extraTime.away` | missing | missing |
| `score.penalties.home` | missing | missing |
| `score.penalties.away` | missing | missing |
| `score.halfTime.home` | `1` | `1` |
| `score.halfTime.away` | `0` | `0` |

## Exact adapter code path

The production football-data path in `server/update-scores.js` is:

1. `fetchFootballDataFixtures()` requests
   `/v4/competitions/WC/matches?season=2026`.
2. Each provider match is passed to `adaptFootballDataMatch()`.
3. The adapter reads the final score directly from:

   ```js
   goals: {
     home: match?.score?.fullTime?.home ?? null,
     away: match?.score?.fullTime?.away ?? null
   }
   ```

4. `normalizeFixtureScore()` maps `FINISHED` to project status `finished`.
5. It converts `fixture.goals.home` and `fixture.goals.away` with
   `optionalClampedInt()`.
6. If either value is absent, null, empty, or non-numeric, it returns:

   ```js
   reason: `${status === "live" ? "Live" : "Finished"} fixture is missing a full-time score.`
   ```

7. `buildScorePlan()` records that reason in `report.skipped`, so no planned
   Supabase row is produced.

Relevant locations:

- status mapping: `server/update-scores.js:363`
- score normalization and skip: `server/update-scores.js:640`
- football-data adaptation: `server/update-scores.js:881`
- exact `score.fullTime` reads: `server/update-scores.js:897`
- season request: `server/update-scores.js:924`

## Root cause

The adapter's field path is correct. At the audit timestamp, both endpoints
returned `score.fullTime.home = 2` and `score.fullTime.away = 0`, exactly where
the adapter expects them.

The earlier dry-run could emit the quoted reason only if at least one of those
two values was not usable in the season response at that earlier observation.
Because the same season endpoint now contains the final score, the evidence
indicates delayed provider population or delayed visibility of the final-score
fields rather than:

- a wrong adapter field path;
- a payload-normalization bug;
- a single-match versus season-endpoint difference;
- an incorrect `FINISHED` status mapping; or
- permanent omission of final scores for this account.

The available evidence does not prove whether the delay is an explicit
free-plan delay, provider processing latency, or response caching. The earlier
raw payload was not retained, so it is also not possible to distinguish
whether the fields were absent or present with null values at that moment.

The missing top-level `minute` is not the cause. For a finished match,
`normalizeFixtureScore()` already falls back to minute `90` after a valid
full-time score is present.

## Recommended next fix

Keep the current fail-closed rule: never invent a score when a finished
fixture lacks both numeric `score.fullTime` values.

In a separate implementation task:

1. add timestamped, sanitized diagnostics for a target match;
2. make the scheduled updater poll again after a `FINISHED` response with a
   missing full-time score, using bounded delay/backoff;
3. leave any existing manual `public.scores` row untouched while provider
   score fields are incomplete;
4. require a later dry-run to show the expected `2-0`, status `finished`, and
   minute fallback `90` before enabling writes;
5. measure at least one live-to-finished cycle to settle the existing live
   minute blocker.

Do not substitute `regularTime` for `fullTime` based on this payload: the
provider omitted `regularTime` here as well.

## Write enablement decision

Automatic football-data writes should not be enabled yet.

The final-score shape is now compatible with the adapter, but the observed
delay means a one-shot run can miss a finished result. The existing write
guard also remains active, and the previously documented live-minute
validation gate has not been completed.

## Validation summary

- Supabase writes: `0`
- score rows updated: `0`
- frontend modifications: none
- schema modifications: none
- credentials printed or committed: none
- automatic writes enabled: no
- `server/update-scores.js` behavior changed: no
- API-Football path changed: no
- `server/set-score.js` changed: no
