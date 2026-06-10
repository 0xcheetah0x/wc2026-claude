# football-data.org Write Enablement Plan

Prepared: 2026-06-06

## Scope

This document plans a future football-data.org score-write path. It does not
enable writes, change the Supabase schema, modify scoring rules, configure a
scheduler, add credentials, or make a Supabase request.

The existing manual fallback remains:

```powershell
node server\set-score.js --match=1 --home=2 --away=1 --status=finished --minute=90 --dry-run
```

Review the dry-run before using the separately documented real manual command.

## Current readiness

| Area | Status |
|---|---|
| World Cup coverage | Ready: `WC`, season `2026`, 104 provider matches |
| Group-stage mapping | Ready: 72/72 mapped |
| Stable provider IDs | Ready: 72 unique `footballDataMatchId` values |
| Ambiguous mappings | Ready: 0 |
| Kickoff consistency | Ready: 0 provider/internal differences |
| Upcoming handling | Ready: scheduled matches produce no score row |
| Score handling | Ready in dry-run: `score.fullTime` is required for live/final rows |
| Status handling | Implemented, but must be observed during a real match |
| Finished minute fallback | Implemented in dry-run: missing minute becomes `90` |
| Live minute handling | Blocked: missing minute currently remains `null` |
| Supabase write guard | Active: football-data rejects `DRY_RUN=0` |
| Scheduler | Not implemented |
| Manual fallback | Ready: `server/set-score.js` |

football-data.org is the preferred free/low-cost candidate. API-Football code
remains intact, but its free plan cannot access the 2026 season.

## Existing safety boundaries

`server/update-scores.js` currently provides these protections:

- defaults to `SCORE_PROVIDER=api-football`;
- defaults to `DRY_RUN=1`;
- requires `FOOTBALL_DATA_TOKEN` for football-data requests;
- sends the token only through `X-Auth-Token`;
- maps football-data records by `footballDataMatchId` with a kickoff safety
  check;
- skips unmapped and ambiguous fixtures;
- skips `SCHEDULED` and `TIMED` matches;
- skips live or finished matches without both score values;
- skips unsupported statuses;
- prints planned rows before the Supabase function is reached;
- skips Supabase writes whenever `DRY_RUN=1`;
- currently rejects every football-data run with `DRY_RUN=0`.

The existing Supabase upsert function writes to:

```text
public.scores?on_conflict=match_id
```

The normalized row contains only:

```text
match_id
home_score
away_score
status
minute
```

It does not write to `matches`, `predictions`, `profiles`, `champion_picks`,
`leaderboard`, or any scoring configuration.

## Write blockers

### 1. Live minute is unobserved

The football-data adapter reads the provider's top-level `match.minute`.
Scheduled responses do not contain a usable minute. It is not yet known
whether the selected plan supplies `minute` reliably while the World Cup is
`IN_PLAY` or `PAUSED`.

The current dry-run normalizer preserves a missing live minute as `null`.

### 2. Supabase requires a minute

`public.scores.minute` is:

```sql
minute smallint not null default 0 check (minute between 0 and 130)
```

A planned live row with `minute: null` would fail a real upsert. This is the
direct technical blocker.

### 3. Real live score shape is unverified

The adapter uses:

```text
score.fullTime.home
score.fullTime.away
```

Provider documentation indicates that `fullTime` can represent the running
score, but the exact World Cup 2026 response must be inspected during an
actual match. The project must not assume that scheduled response shape proves
live behavior.

### 4. Status transitions are unverified

The expected mappings are:

| football-data | Project |
|---|---|
| `SCHEDULED`, `TIMED` | `upcoming`, no row |
| `IN_PLAY`, `PAUSED` | `live` |
| `FINISHED`, `AWARDED` | `finished` |
| postponed, cancelled, suspended, unknown | skip |

At least one real `IN_PLAY` response and its later `FINISHED` response must be
observed before the guard is removed.

### 5. Final-score semantics need one live-cycle check

For normal group matches, `score.fullTime` is expected to be sufficient. Before
knockout writes are enabled, extra-time and penalty responses must also be
reviewed so that the adapter preserves the project's current score meaning.

## Minute policy options

### Option A: Use `0` when a live minute is missing

Policy:

- upcoming: no row;
- live with provider minute: use provider minute;
- live without provider minute: use `0`;
- finished with provider minute: use provider minute;
- finished without provider minute: use `90`.

Advantages:

- works with the current non-null schema;
- requires no migration;
- matches the existing column default and valid range;
- allows live score updates even if only the score is available;
- the frontend already treats non-numeric/missing minute values as `0`.

Disadvantages:

- `0` means "minute unavailable", not necessarily "kickoff minute";
- a live `0` could be misleading if displayed as actual elapsed time;
- provider minute recovery must overwrite the fallback on a later poll.

### Option B: Allow `minute` to be null

Advantages:

- accurately represents unknown elapsed time;
- avoids overloading `0`;
- separates "not supplied" from "start of match".

Disadvantages:

- requires a schema migration;
- requires checking all frontend and server assumptions;
- expands the task beyond provider enablement;
- is unnecessary if the provider supplies live minute reliably;
- creates more migration and rollback work immediately before a tournament.

### Option C: Keep writes disabled until live minute is confirmed

Advantages:

- safest evidence-based approach;
- avoids an unnecessary schema decision;
- prevents the first real write from failing or publishing misleading minute
  data;
- allows the existing manual fallback to remain authoritative.

Disadvantages:

- automatic writes cannot be enabled before the first observed live response;
- an operator must run and inspect the first-match dry-runs.

## Recommended minute policy

Use **Option C now**: keep football-data writes disabled until the first real
`IN_PLAY` and `FINISHED` responses have been captured through dry-run.

After that observation:

1. If live `minute` is reliably numeric, use it and retain `90` only as the
   missing finished-minute fallback.
2. If live score is reliable but minute is absent, use **Option A**:
   `minute=0` for missing live minute and `minute=90` for missing finished
   minute.
3. Do not make `minute` nullable unless live behavior or product requirements
   demonstrate that distinguishing unknown minute from zero is necessary.

This is the safest schema-compatible policy. The meaning of live `minute=0`
must be documented as "provider minute unavailable", and every later valid
provider minute must replace it.

## Future write-path design

### Configuration gate

The future football-data write path must require all of:

```text
SCORE_PROVIDER=football-data
DRY_RUN=0
FOOTBALL_DATA_TOKEN
FOOTBALL_DATA_COMPETITION=WC
FOOTBALL_DATA_SEASON=2026
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The current unconditional football-data `DRY_RUN=0` rejection must remain
until every validation gate below passes.

When implementation is approved later, replace that unconditional rejection
with explicit football-data write validation. Do not weaken the existing
API-Football guard.

### Processing sequence

1. Load the root `.env` or host-provided secrets.
2. Validate provider, token, competition, season, Supabase URL, service-role
   key, and `DRY_RUN=0`.
3. Fetch:

   ```text
   GET /v4/competitions/WC/matches?season=2026
   ```

4. If `MATCH_DATE` is set, filter the returned season locally.
5. Adapt each provider match into the common internal fixture shape.
6. Map by `footballDataMatchId`.
7. Require the provider kickoff to remain inside the configured safety window.
8. Normalize provider status.
9. Skip upcoming, postponed, cancelled, suspended, and unknown statuses.
10. Require numeric home and away `score.fullTime` values for live and
    finished rows.
11. Apply the approved minute policy.
12. Reject duplicate provider records for one internal match.
13. Print the complete planned upsert report.
14. Upsert only the normalized `public.scores` rows by `match_id`.
15. Report written-row count without printing credentials.

### Row contract

The future write payload must contain no fields beyond:

```json
{
  "match_id": 1,
  "home_score": 1,
  "away_score": 0,
  "status": "live",
  "minute": 0
}
```

Do not write scheduled `0-0` rows. Do not add provider IDs to Supabase. Do not
update match kickoff data from the score job. Do not write provider payloads
or secrets to logs.

### Failure behavior

The job must perform no Supabase write when:

- the provider request fails;
- football-data returns invalid JSON or a payload error;
- the token is missing;
- the fixture is unmapped or ambiguous;
- provider ID and kickoff safety checks disagree;
- status is unsupported;
- a live or finished score is incomplete;
- minute violates the approved policy or database range;
- duplicate fixtures target one internal match;
- Supabase configuration is missing.

One bad fixture should be skipped and reported without inventing a score.
Provider-wide/configuration failures should fail the run before any write.

## Validation gates

### Gate 1: Baseline full-season dry-run

Run:

```powershell
npm --prefix server run update:scores:football-data:dry-run
```

Require:

```text
104 provider matches
72 mapped group matches
32 expected knockout placeholders
0 ambiguous mappings
0 kickoff differences
0 planned upserts while all matches are scheduled
0 Supabase writes
```

### Gate 2: Opening-date dry-run

From the project root:

```powershell
$env:SCORE_PROVIDER='football-data'
$env:DRY_RUN='1'
$env:MATCH_DATE='2026-06-11'
node server\update-scores.js
```

Before kickoff, require:

- match ID `1` maps by `footballDataMatchId=537327`;
- status is scheduled/upcoming;
- no score row is planned;
- no Supabase write occurs.

### Gate 3: First live-match dry-run

Run the same command while Mexico vs South Africa is live:

```powershell
$env:SCORE_PROVIDER='football-data'
$env:DRY_RUN='1'
$env:MATCH_DATE='2026-06-11'
node server\update-scores.js
```

Inspect and record:

- raw provider status, expected `IN_PLAY` or `PAUSED`;
- normalized status, expected `live`;
- `score.fullTime.home`;
- `score.fullTime.away`;
- whether `minute` exists;
- whether minute is numeric and plausible;
- planned `match_id`, score, status, and minute;
- mapping method is `footballDataMatchId`;
- planned upserts count is exactly the expected live match count;
- Supabase writes remain zero.

If minute is absent, do not enable writes during that run. Confirm and
implement the documented `minute=0` fallback in a separate reviewed task.

### Gate 4: First final-whistle dry-run

After the provider reports the opener finished, run the same command again.

Require:

- provider status is `FINISHED` or a reviewed equivalent;
- normalized status is `finished`;
- final `score.fullTime` values are correct;
- minute is provider minute or the documented `90` fallback;
- exactly one correct planned upsert exists for match `1`;
- no Supabase write occurs.

### Gate 5: Controlled implementation review

Only after Gates 1-4 pass:

- add focused tests for live minute present, live minute missing, finished
  minute missing, missing score, unsupported status, duplicate fixture, and
  provider-ID/kickoff mismatch;
- replace only the football-data write rejection;
- run mock and real-provider dry-runs again;
- review the exact five-column payload;
- perform a separate, explicitly approved one-match controlled write;
- verify `public.scores` and the leaderboard;
- keep `server/set-score.js` ready for immediate correction.

## Scheduler recommendation

No scheduler is implemented by this plan.

### Preferred runtime

For reliable two-to-five-minute live updates, prefer:

1. **Windows Task Scheduler or a small always-on server/worker** when a trusted
   machine will be online; or
2. **GitHub Actions** when occasional schedule delay is acceptable and secrets
   are stored in repository Actions secrets.

GitHub Pages must never call the provider or Supabase service-role endpoint
directly.

### Polling schedule

| Tournament state | Recommendation |
|---|---|
| Before tournament | No recurring polling |
| Match day, more than 60 minutes before kickoff | No polling or one check every 30 minutes |
| 60 minutes before kickoff until provider says live | Every 10-15 minutes; increase only near kickoff |
| Match live | Every 2-5 minutes |
| Half-time/paused | Continue every 2-5 minutes |
| Provider says finished | One immediate sync, then one confirmation 5-10 minutes later |
| No matches active | Stop polling |

The endpoint returns the season schedule in one request, so local date/status
filtering should be used instead of making one request per fixture.

The free plan limit is higher than this schedule requires, but the updater's
local daily budget and reserve should remain enabled. Avoid overlapping jobs:
one run must finish before another starts.

### Scheduler safeguards

A future scheduler must:

- set `SCORE_PROVIDER=football-data` explicitly;
- start in `DRY_RUN=1`;
- store tokens and Supabase credentials only in the scheduler secret store;
- use one concurrency group or equivalent lock;
- set a timeout;
- retain sanitized logs;
- fail closed on provider errors;
- never retry rapidly in a loop;
- stop or alert after repeated failures;
- provide a simple way to disable the job immediately.

## Rollback and fallback

If automatic writes are later enabled and a problem occurs:

1. disable the scheduler;
2. restore `DRY_RUN=1`;
3. do not delete score rows automatically;
4. inspect the provider response and the affected `public.scores` row;
5. correct a known score with `server/set-score.js`, starting with `--dry-run`;
6. verify the leaderboard after the manual correction;
7. keep automatic writes disabled until the cause is understood.

The manual tool is the operational fallback for:

- provider outages;
- delayed free-tier updates;
- missing minute or score fields;
- postponed or abandoned matches;
- extra-time or penalty ambiguity;
- incorrect provider data;
- scheduler failures.

## Enablement decision

football-data writes are **not ready to enable today**.

The remaining evidence gate is a real World Cup 2026 live-to-finished response
cycle. Mapping, kickoff consistency, scheduled-row skipping, credential
handling, and dry-run reporting are ready. The first live-match dry-run must
settle the minute policy before any code change removes the write guard.

