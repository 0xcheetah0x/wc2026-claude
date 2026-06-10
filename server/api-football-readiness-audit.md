# API-Football Automatic Score Readiness Audit

Audit date: 2026-06-06 (Europe/Istanbul)

This is an offline code and documentation audit. No API-Football request was
made and no Supabase write was performed.

## Readiness Summary

Status: **implementation-ready for controlled dry-runs, but not operationally
ready for automatic production updates**.

The updater already has the fetch, mapping, reporting, budget, dry-run, and
Supabase score-upsert paths. Real automatic scoring is currently blocked by:

1. API-Football previously returned zero World Cup 2026 fixtures for the known
   league/season/date queries.
2. All 72 `apiFixtureId` fields in `server/fixture-map.json` are still `null`.
3. No trusted scheduler/runner has been configured to execute the updater
   automatically outside GitHub Pages.

Do not enable `DRY_RUN=0` until provider fixtures exist, mappings have been
reviewed, and the server-only runtime configuration is verified.

## Files Reviewed

- `server/update-scores.js`
- `server/fixture-map.json`
- `server/score-updater-plan.md`
- `server/real-api-dry-run-guide.md`
- `.env.example`
- `server/package.json`
- `.gitignore` for runtime and secret-file protection

No frontend files or Supabase schema files were changed during this audit.

## Current Capabilities

| Capability | Status | Evidence/behavior |
| --- | --- | --- |
| Mock dry-run | Ready | Defaults to `DRY_RUN=1`; `update:scores:mock` forces mock fixtures and performs no external request or Supabase write. |
| Real provider dry-run | Ready, quota-consuming | `DRY_RUN=1 MOCK_FIXTURES=0` fetches API-Football and prints planned rows without writing. |
| Fixture discovery | Ready | `DISCOVER_FIXTURES=1` prints fixture IDs, teams, dates, league fields, status, and tentative mappings. It returns before the upsert path. |
| League discovery | Ready | `DISCOVER_LEAGUES=1` queries `/leagues`, reports candidates/seasons, and returns before match loading or Supabase writes. |
| Date-only fixture query | Ready | Builds `/fixtures?date=YYYY-MM-DD`. |
| League + season query | Ready | Builds `/fixtures?league=...&season=...`. |
| League + season + date query | Ready | Adds `date=YYYY-MM-DD` to the league/season query. |
| API budget guard | Ready | Persistent file-based guard reserves a request before every provider call. Default budget is 100 with a reserve of 20. |
| Istanbul-day reset | Ready | Budget day keys use `Europe/Istanbul`; a different Istanbul date starts a fresh counter. |
| `DRY_RUN=1` | Ready | Prevents Supabase upserts and reports that writes were skipped. |
| `MOCK_FIXTURES` | Ready | Mock mode avoids API-Football and does not touch the budget file. |
| `DISCOVER_FIXTURES` | Ready | Discovery output only; no Supabase service-role key is required. |
| `DISCOVER_LEAGUES` | Ready | League metadata output only; no match mapping or Supabase key is required. |
| Controlled Supabase write | Ready in code, not enabled | Only runs outside discovery when `DRY_RUN=0`, requires server-side Supabase URL/service-role key, and upserts `public.scores`. |
| Secret redaction | Ready | Error handling redacts configured API-Football and service-role values. Keys are read from server environment only. |
| Automatic scheduling | Not configured | Documentation lists options, but the repository has no active scheduler/workflow for this updater. |

## Mapping Readiness

`server/fixture-map.json` currently contains:

- 72 entries
- unique internal IDs 1 through 72
- home and away aliases for every entry
- zero populated `apiFixtureId` values

Mapping priority is conservative:

1. confirmed `apiFixtureId`
2. home/away aliases
3. normalized exact home/away names
4. kickoff-date proximity safety check

Ambiguous or unmapped fixtures are reported and skipped. Provider fixture IDs
remain the strongest mapping and should be filled once API-Football publishes
the tournament fixtures.

## Intended Automatic Score Path

1. A trusted server or scheduled job runs `server/update-scores.js`.
2. The script checks and reserves API request budget for the Istanbul day.
3. API-Football returns fixture, score, status, and elapsed-minute data.
4. The mapping layer associates each provider fixture with a stable internal
   match ID.
5. The script creates rows containing only:
   - `match_id`
   - `home_score`
   - `away_score`
   - `status`
   - `minute`
6. A dry-run prints the planned rows and performs no write.
7. A reviewed real run uses the Supabase service-role key server-side to upsert
   `public.scores` by `match_id`.
8. The Supabase `leaderboard` view reflects updated finished scores without a
   frontend redeploy.

GitHub Pages is not part of the write path. It only serves the frontend, which
reads Supabase data under RLS.

## Current Blocker

The primary provider blocker is still fixture availability.

Previous safe discovery attempts returned zero fixtures for:

- `/fixtures?date=2026-06-11`
- `/fixtures?league=1&season=2026&date=2026-06-11`

League discovery identified:

- league ID: `1`
- league name: `World Cup`
- season: `2026` reported as available

Zero fixture results may mean:

- fixtures have not yet been published by API-Football,
- World Cup 2026 fixture endpoint coverage is not ready,
- the provider requires a different query/competition representation,
- the current API plan does not expose the expected fixture data.

Until fixtures appear, provider IDs cannot be confirmed and the mapping cannot
be locked with `apiFixtureId`.

There is also an operational blocker: an automatic runner has not been selected
or configured. Later choices include Windows Task Scheduler, GitHub Actions
with repository secrets, or another trusted server/cron environment.

## Environment Loading Status

The previous local environment-loading gap has been addressed:

- `dotenv` is declared in `server/package.json`.
- `server/update-scores.js` and `server/set-score.js` explicitly load the
  project-root `.env` using `path.resolve(__dirname, "..", ".env")`.
- Existing PowerShell, CI, and scheduler environment variables remain usable
  and are not overwritten by the root file.
- If dependencies are not installed, run:

  ```powershell
  npm --prefix server install
  ```

- If `dotenv` is unavailable, both scripts fail gracefully back to variables
  already provided by the host environment.
- The frontend and GitHub Pages do not load `.env`.

## Next Safe Manual Checks

These commands make real API-Football requests and consume quota. Do not run
them until the server-only `API_FOOTBALL_KEY` is available in the current
PowerShell environment.

### A. League Discovery

```powershell
$env:DISCOVER_LEAGUES='1'
$env:MOCK_FIXTURES='0'
$env:LEAGUE_SEARCH='World Cup'
node server\update-scores.js
```

Depending on other configured league filters/season values, league discovery
can build more than one `/leagues` path. Review the printed `API paths` because
each real path consumes one request.

### B. Fixture Discovery for the Full Season

```powershell
$env:DISCOVER_LEAGUES='0'
$env:DISCOVER_FIXTURES='1'
$env:MOCK_FIXTURES='0'
$env:API_FOOTBALL_LEAGUE_ID='1'
$env:API_FOOTBALL_SEASON='2026'
Remove-Item Env:\MATCH_DATE -ErrorAction SilentlyContinue
node server\update-scores.js
```

Expected query:

```text
/fixtures?league=1&season=2026
```

### C. Fixture Discovery for the First Match Date

```powershell
$env:DISCOVER_FIXTURES='1'
$env:MOCK_FIXTURES='0'
$env:API_FOOTBALL_LEAGUE_ID='1'
$env:API_FOOTBALL_SEASON='2026'
$env:MATCH_DATE='2026-06-11'
node server\update-scores.js
```

Expected query:

```text
/fixtures?league=1&season=2026&date=2026-06-11
```

Discovery modes disable Supabase writes regardless of `DRY_RUN`. Setting
`DRY_RUN=1` explicitly before these checks is still a useful operator habit:

```powershell
$env:DRY_RUN='1'
```

## API Quota Caution

- Every real API path consumes provider quota because the budget is reserved
  before the request.
- Do not run discovery repeatedly in the same session.
- When a tournament is months away, weekly or monthly checks are enough.
- As of 2026-06-06, the first internal match is scheduled for 2026-06-11, so
  the tournament is close. One controlled check now, followed by at most one
  carefully reviewed check per day if necessary, is more appropriate than
  repeated retries.
- Preserve the configured reserve for match-time score updates.

## If Fixtures Appear

1. Save and review the discovery report.
2. Compare provider home/away names and kickoff UTC values with internal
   matches.
3. Confirm there are no unexpected unmapped or ambiguous fixtures.
4. Fill the confirmed `apiFixtureId` values in `server/fixture-map.json`.
5. Run a real-provider score dry-run with:

   ```powershell
   $env:DISCOVER_FIXTURES='0'
   $env:DISCOVER_LEAGUES='0'
   $env:DRY_RUN='1'
   $env:MOCK_FIXTURES='0'
   $env:API_FOOTBALL_LEAGUE_ID='1'
   $env:API_FOOTBALL_SEASON='2026'
   $env:MATCH_DATE='2026-06-11'
   node server\update-scores.js
   ```

6. Review mapped, unmapped, ambiguous, skipped, and planned-upsert rows.
7. Verify budget before/after and the `Supabase writes: skipped` message.
8. Only after clean mapping and one-date review should a separate task
   consider `DRY_RUN=0` and a trusted scheduler.

## If Fixtures Still Return Zero

- Keep using `server/set-score.js` as the server-side manual fallback.
- Leave the automatic updater in dry-run/discovery mode.
- Try again later without repeated quota-consuming calls.
- No user-facing application change is required: manually written scores still
  update Supabase and the leaderboard view.

## Safety Findings

- `.env`, `.env.*`, `server/.api-budget.json`, and
  `server/.score-cache.json` are gitignored.
- `.env.example` contains placeholders only.
- No service-role or API-Football value is embedded in frontend code.
- Real Supabase writes require `DRY_RUN=0`, non-mock operation, Supabase URL,
  and the server-only service-role key.
- The write implementation targets only `public.scores`.
- No credentials were added during this audit.

## Offline Validation Performed

- `node --check server/update-scores.js` passed.
- `npm --prefix server run update:scores:mock` passed.
- The mock run made no API-Football request.
- Six sample fixtures mapped successfully.
- Unmapped fixtures: 0.
- Ambiguous fixtures: 0.
- The report stated `Supabase writes: skipped because DRY_RUN=1`.
- `server/.api-budget.json` had the same timestamp and SHA-256 hash before and
  after the mock run.
- `server/.score-cache.json` had the same timestamp and SHA-256 hash before and
  after the mock run.
- No JWT-looking token, real Supabase project URL, or assigned server secret
  was found in this report.

## Recommendation

Keep the current manual score fallback active. Run one controlled fixture
discovery check when quota is acceptable. If fixtures appear, populate provider
fixture IDs and perform a one-date real-provider dry-run. Choose a trusted
scheduler before calling the system fully automatic.
