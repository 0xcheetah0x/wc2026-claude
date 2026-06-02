# Server-Side Score Updater Plan

Task 17 scope: prepare the secure architecture and implementation outline for writing API-Football match scores into Supabase. This document does not deploy anything, does not change frontend behavior, and does not include real credentials.

## Recommendation

Create a separate scheduled CLI script later:

```text
server/update-scores.js
```

Do not extend `server/live-server.js` into a Supabase writer endpoint. The current live server is a read proxy/cache endpoint for `/api/scores`; the production writer will need `SUPABASE_SERVICE_ROLE_KEY`, so keeping it as a non-frontend scheduled job is safer and easier to audit.

The future updater should be dependency-light and compatible with the existing `server/package.json` Node requirement (`>=18`), using built-in `fetch`, `fs`, and `path` where possible.

## Existing Server Review

- `server/live-server.js`
  - Reads `API_FOOTBALL_KEY` from environment only.
  - Caches `/api/scores` in `server/.score-cache.json`.
  - Tracks API usage in `server/.api-budget.json`.
  - Resets the budget by Europe/Istanbul date.
  - Uses match-aware refresh timing instead of constant frontend polling.
  - Should remain read-only from the frontend perspective.

- `server/matches.json`
  - Contains stable internal match IDs, Turkish team names, and UTC kickoff times.
  - Does not contain API-Football fixture IDs.
  - Future API mapping should preserve these internal IDs.

- `.env.example`
  - Contains placeholder-only server env names.
  - Has been extended with Supabase service-role and score-update budget placeholders.

- `.gitignore`
  - Ignores `.env`, `.env.*`, `server/.api-budget.json`, `server/.score-cache.json`, and `config.local.js`.
  - This protects real local secrets and runtime cache/budget files from commits.

- `server/package.json`
  - Defines `node live-server.js` as the current server start script.
  - No root `package.json` is required for the current app flow.

## Server-Only Environment Variables

These belong only in server/scheduled-job environments, never in frontend config:

| Variable | Required | Purpose |
| --- | --- | --- |
| `API_FOOTBALL_KEY` | Yes | API-Football request key. |
| `API_FOOTBALL_LEAGUE_ID` | Optional | Provider league/tournament ID once confirmed. |
| `API_FOOTBALL_SEASON` | Optional | Provider season, for example `2026`. Required when `API_FOOTBALL_LEAGUE_ID` is set. |
| `SUPABASE_URL` | Yes | Supabase project URL for server-side REST calls. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key for trusted score writes only. Never expose to browser code. |
| `SCORE_UPDATE_BUDGET_DAILY` | Optional | Daily API request ceiling for the updater, default around `100`. |
| `SCORE_UPDATE_RESERVE` | Optional | Reserved request buffer so the updater stops before the daily limit, default around `20`. |
| `DRY_RUN` | Optional | When `1`, map/fetch but do not write to Supabase. |
| `DISCOVER_FIXTURES` | Optional | When `1`, fetch and print provider fixture metadata only. Supabase writes are disabled regardless of `DRY_RUN`. |
| `DISCOVER_LEAGUES` | Optional | When `1`, fetch and print provider league/tournament metadata only. Supabase writes are disabled. |
| `LEAGUE_SEARCH` | Optional | Search text for league discovery, such as `World Cup`. |
| `LEAGUE_COUNTRY` | Optional | Country filter for league discovery, such as `World`. |

The frontend should continue using only:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

The service role key and API-Football key must never be placed in `config.local.js`, `config.example.js`, or `index.html`.

## Future Updater Data Flow

The future `server/update-scores.js` should:

1. Load environment variables.
2. Refuse real writes unless `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present.
3. Load internal matches from `server/matches.json`.
4. Determine which matches need checking:
   - Today in Europe/Istanbul.
   - Currently live.
   - Recently finished and needing final confirmation.
   - Skip matches already final in Supabase unless a final-confirmation window is active.
5. Check the daily API budget before every external call.
6. Fetch API-Football fixture data.
7. Map API fixtures to internal match IDs.
8. Normalize score/status/minute.
9. Upsert into `public.scores`.
10. Log only sanitized summaries.

## API-Football Mapping

The current internal match source has no provider fixture IDs, so the updater uses:

```text
server/fixture-map.json
```

That file has one entry per internal match:

```json
{
  "id": 1,
  "utc": "2026-06-11T19:00:00Z",
  "home": "Meksika",
  "away": "Güney Afrika",
  "homeAliases": ["Meksika", "Mexico"],
  "awayAliases": ["Güney Afrika", "South Africa"],
  "apiFixtureId": null
}
```

Mapping order:

1. If `apiFixtureId` is filled later, match provider fixture ID first.
2. Otherwise match provider home/away names against `homeAliases` and `awayAliases`.
3. Fall back to normalized exact internal home/away team names.
4. Apply kickoff date proximity as a safety check.
5. Skip ambiguous or unmapped fixtures.

Aliases are needed because internal app names are Turkish or shortened while API-Football may use English/international names, such as `ABD` vs `USA`, `Çekya` vs `Czechia`, and `Fildişi Sah.` vs `Ivory Coast`.

When real API-Football fixture IDs are known, fill only the matching entry:

```json
{
  "id": 1,
  "apiFixtureId": 1234567
}
```

Keep `id`, `utc`, `home`, and `away` aligned with `server/matches.json`.

If a fixture cannot be mapped confidently, skip it and log:

```text
Skipped unmapped fixture: <home> vs <away> at <kickoff>
```

Do not guess ambiguous mappings. A skipped row is safer than writing the wrong score to a stable internal match ID.

Mock dry-run validates alias mapping with API-style names including `USA`, `South Korea`, `Ivory Coast`, `Cape Verde`, and `DR Congo`.

## Score Normalization

Map API-Football fixture status into the existing Supabase/frontend status shape:

| API-Football status examples | Supabase status |
| --- | --- |
| `NS`, `TBD` | `upcoming` |
| `1H`, `HT`, `2H`, `ET`, `BT`, `P`, `LIVE` | `live` |
| `FT`, `AET`, `PEN` | `finished` |

Minute should use API-Football elapsed time when present, clamped to the database constraint range `0..130`.

## Supabase Upsert Outline

The updater should write only score rows, using the service role key server-side:

```js
const row = {
  match_id: internalMatch.id,
  home_score: Number(apiFixture.goals.home ?? 0),
  away_score: Number(apiFixture.goals.away ?? 0),
  status: normalizedStatus,
  minute: normalizedMinute
};
```

Upsert target:

```text
public.scores on conflict (match_id)
```

The SQL migration includes `source` and `provider_updated_at`, but the first production updater should keep writes minimal and limited to the task-approved score fields above. `updated_at` is handled by the database trigger on updates.

The updater must never write:

- `profiles`
- `predictions`
- `champion_picks`
- `app_settings`
- `leaderboard`

## REST Upsert Sketch

A dependency-free implementation can call Supabase REST directly:

```js
await fetch(`${SUPABASE_URL}/rest/v1/scores?on_conflict=match_id`, {
  method: "POST",
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates"
  },
  body: JSON.stringify(rows)
});
```

The script should redact secrets in any thrown error or diagnostic output.

## Daily API Budget

Reuse the spirit of the existing `server/live-server.js` budget guard:

- Daily limit defaults to `100`.
- Reserve defaults to `20`, so normal spending stops around `80`.
- Reset by Europe/Istanbul date.
- Persist counter in `server/.api-budget.json` so the live read server and updater do not accidentally exceed the same API-Football quota.
- If budget is exhausted:
  - do not call API-Football,
  - do not crash,
  - log a safe message,
  - leave existing Supabase scores unchanged.

The updater can read score-specific env names first:

```text
SCORE_UPDATE_BUDGET_DAILY
SCORE_UPDATE_RESERVE
```

and fall back to existing live-server names if needed:

```text
API_FOOTBALL_DAILY_BUDGET
API_FOOTBALL_BUDGET_RESERVE
```

## Match-Aware Scheduling

The updater should avoid constant polling. For a normal match, aim for the same rough checkpoint pattern already used by the live server:

```text
0, 5, 15, 30, 45, 50, 55, 65, 75, 85, 90, 100, 115, 130 minutes
```

For four matches in a day, this keeps the updater below roughly 80 API calls if one fixture/date request can cover multiple matches. Keep the reserve buffer for retries, API status checks, or manual verification.

Final matches should receive one or two final confirmation checks, then stop polling.

## Dry Run Mode

The draft script now supports:

```text
DRY_RUN=1
```

Expected behavior:

- Validate required non-secret setup.
- Load and map internal matches.
- Fetch API data only if explicitly allowed for the dry run, or load a local mock fixture payload.
- Print sanitized `would upsert` rows.
- Do not write to Supabase.
- Do not print API keys, service role keys, anon keys, or full Authorization headers.

The script defaults to mock dry-run, so this is the safest validation command:

```text
cd server
npm run update:scores:mock
```

or from the repository root:

```text
node server/update-scores.js
```

With the default `DRY_RUN=1` and `MOCK_FIXTURES=1`, this does not call API-Football, does not spend quota, and does not write to Supabase.

Later, a real provider dry-run can be done only when quota use is acceptable:

```text
DRY_RUN=1
MOCK_FIXTURES=0
MATCH_DATE=2026-06-11
node server/update-scores.js
```

That provider dry-run can fetch API-Football data, but still prints planned upserts instead of writing.

Supported provider query modes:

```text
# Date only
DRY_RUN=1 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

# League + season
DRY_RUN=1 MOCK_FIXTURES=0 API_FOOTBALL_LEAGUE_ID=YOUR_LEAGUE_ID API_FOOTBALL_SEASON=2026 node server/update-scores.js

# League + season + date
DRY_RUN=1 MOCK_FIXTURES=0 API_FOOTBALL_LEAGUE_ID=YOUR_LEAGUE_ID API_FOOTBALL_SEASON=2026 MATCH_DATE=2026-06-11 node server/update-scores.js

# Discovery mode, never writes
DISCOVER_FIXTURES=1 MOCK_FIXTURES=0 MATCH_DATE=2026-06-11 node server/update-scores.js

# League discovery mode, never writes
DISCOVER_LEAGUES=1 MOCK_FIXTURES=0 LEAGUE_SEARCH="World Cup" node server/update-scores.js
```

Discovery mode prints API paths, provider fixture IDs, teams, kickoff dates, league name/id, season, status, and tentative internal mapping. It is used to find the correct API-Football source before score writes are enabled.

League discovery mode prints API paths, league IDs, league names, countries, league types, available seasons, whether season `2026` appears, and possible World Cup candidates. Use it to choose a candidate `API_FOOTBALL_LEAGUE_ID`, then confirm that ID with fixture discovery before enabling any real score writes.

The dry-run report should be reviewed before any write is enabled. It includes:

- selected match date
- API-Football paths requested
- provider fixtures fetched count
- mapped, unmapped, ambiguous, and skipped fixture counts
- safe unmapped fixture details
- safe ambiguous fixture details with candidate internal match IDs
- planned Supabase upsert preview with `match_id`, score, status, minute, provider fixture ID, and mapping method
- API budget before/after
- explicit confirmation that Supabase writes were skipped when `DRY_RUN=1`

Interpretation:

- `mapped_by: apiFixtureId` is the strongest mapping and should be preferred once provider fixture IDs are confirmed.
- `mapped_by: alias` is acceptable for dry-run review when the team aliases and kickoff date clearly match.
- `mapped_by: normalized` is a fallback and should be reviewed carefully before real writes.
- Any `unmapped` fixture should either get a better alias or an `apiFixtureId`.
- Any `ambiguous` fixture should not be written until `server/fixture-map.json` is updated with the correct `apiFixtureId`.

If API-Football returns 0 fixtures, do not treat it as fatal. Likely causes include unpublished fixtures, wrong date, missing league/season parameters, wrong provider league ID, plan/coverage limitations, or the tournament not being available yet. Try discovery mode and league/season queries later, but avoid repeated real calls because each one can spend quota.

If league discovery returns 0 leagues, broaden `LEAGUE_SEARCH`, remove restrictive country filters, try a season-only query, or wait for provider tournament coverage. Do not hardcode a league ID until fixture discovery confirms it returns the expected World Cup 2026 fixtures.

Real writes require:

```text
DRY_RUN=0
MOCK_FIXTURES=0
```

and server-only `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`. Never place those values in frontend config.

Do not run `DRY_RUN=0` until the provider dry-run report has zero unexpected unmapped/ambiguous fixtures and all planned rows have been reviewed.

Help output is available with:

```text
HELP=1 node server/update-scores.js
```

## Implementation Outline

Implemented draft file:

```text
server/update-scores.js
```

Recommended internal functions:

```text
loadEnv()
loadInternalMatches()
istanbulDayKey(date)
normalizeBudget(now)
canSpendApiCalls(count)
reserveApiCall(path)
selectMatchesToCheck(matches, now)
fetchApiFootballFixtures(paths)
normalizeTeamName(name)
mapFixtureToInternalMatch(fixture, matches, optionalFixtureMap)
normalizeFixtureScore(fixture)
buildScoreRows(fixtures, matches)
upsertScoresToSupabase(rows)
main()
```

The script should exit with a non-zero code only for configuration/programming problems. Provider failures, unmapped fixtures, exhausted budget, or empty responses should be safe logged outcomes.

## Scheduling Options Later

Manual terminal:

```text
node server/update-scores.js
```

Windows Task Scheduler:

```text
node C:\path\to\project\server\update-scores.js
```

GitHub Actions schedule:

- Store secrets in GitHub Actions secrets.
- Use `SUPABASE_SERVICE_ROLE_KEY` only in the workflow environment.
- Avoid logging env values.

Netlify scheduled functions:

- Works only if the updater is implemented as a serverless function.
- Secrets belong in Netlify environment variables.
- Score updates should not require daily redeploys.

Cloudflare Worker/Cron:

- Good fit for scheduled polling.
- Store keys as Worker secrets.
- Keep the same budget and Supabase upsert rules.

Daily Netlify redeploys are not needed for score updates. Scores should be updated by a server/scheduled process writing to Supabase, while the deployed frontend only reads.

## Safety Checklist Before Real Use

- `.env` remains gitignored.
- `config.local.js` remains gitignored.
- No service role key in `index.html`, `config.example.js`, or any frontend bundle.
- No API-Football key in frontend code.
- Logs redact secrets.
- `DRY_RUN=1` tested before real writes.
- API fixture mapping reviewed for every internal match ID.
- Supabase `scores` RLS stays read-only for normal authenticated users.
- Service role key is used only in the server/scheduled updater environment.

## Manual Steps Before Implementation

1. Decide hosting target for the updater: local scheduled task, GitHub Actions, Netlify scheduled function, or Cloudflare Worker.
2. Create server-side environment values outside git.
3. Add or confirm API-Football fixture ID mapping for the 72 group matches.
4. Implement `server/update-scores.js` using the outline above.
5. Run mock dry-run validation with no API calls.
6. Run one real dry-run when quota usage is acceptable.
7. Enable real Supabase writes only after mapped rows are reviewed.
