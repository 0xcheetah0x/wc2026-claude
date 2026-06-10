# football-data.org Adapter Feasibility Report

Validation date: 2026-06-06

## Result

football-data.org is now supported as a second, server-side score provider in
**dry-run mode only**.

The authenticated World Cup 2026 request succeeded:

- competition code: `WC`
- competition ID: `2000`
- season: `2026`
- endpoint: `/v4/competitions/WC/matches?season=2026`
- provider matches fetched: `104`
- internal group matches mapped: `72`
- provider matches not mapped: `32` expected knockout placeholders
- ambiguous mappings: `0`
- planned score upserts: `0`, because all group matches are still scheduled
- Supabase writes: `0`

Required opener checks passed:

| Provider match | football-data ID | Internal match | Mapping |
|---|---:|---:|---|
| Mexico vs South Africa | `537327` | `1` | `footballDataMatchId` |
| South Korea vs Czechia | `537328` | `2` | `footballDataMatchId` |

football-data.org is the recommended free/low-cost candidate for the next
server-side validation phase. API-Football remains available in code, but its
free plan still cannot access the 2026 season.

## Safety

- The token was available only through the gitignored root `.env`.
- The token was sent only in the `X-Auth-Token` header.
- The token was never printed, added to a URL, or committed.
- Provider requests used HTTP `GET` only.
- No frontend file or `index.html` was changed.
- No scoring rule or Supabase schema was changed.
- No Supabase request or write occurred.
- `server/set-score.js` remains unchanged and available as the manual fallback.
- football-data write mode is explicitly refused even if `DRY_RUN=0` is set.

Multiple authenticated read-only checks were made while implementing the
adapter and auditing kickoff consistency. Each requested the same World Cup
season resource. A normal production-style dry-run uses one request.

## Files

Created earlier and retained:

- `server/check-football-data.js`

Updated for this adapter:

- `server/update-scores.js`
- `server/fixture-map.json`
- `server/package.json`
- `.env.example`
- `server/football-data-feasibility-report.md`

Updated by the kickoff consistency follow-up:

- `index.html`
- `server/matches.json`
- `server/fixture-map.json`
- `supabase/seed/001_matches_seed.sql`
- `supabase/migrations/004_fix_kickoff_times.sql`
- `supabase/migrations/005_fix_match_32_kickoff.sql`

## Provider selection

The default remains API-Football:

```env
SCORE_PROVIDER=api-football
```

Select football-data.org with:

```env
SCORE_PROVIDER=football-data
FOOTBALL_DATA_TOKEN=your_server_only_token
FOOTBALL_DATA_COMPETITION=WC
FOOTBALL_DATA_SEASON=2026
```

Only placeholder values are present in `.env.example`.

## Dry-run commands

From the project root:

```powershell
$env:SCORE_PROVIDER='football-data'
$env:DRY_RUN='1'
node server\update-scores.js
```

From the `server` folder:

```powershell
$env:SCORE_PROVIDER='football-data'
$env:DRY_RUN='1'
node update-scores.js
```

Convenience command for a full-season mapping run:

```powershell
npm --prefix server run update:scores:football-data:dry-run
```

`MATCH_DATE=YYYY-MM-DD` applies a local date filter after the one season
request. The convenience command deliberately clears `MATCH_DATE` after
dotenv loads so it always audits all 104 matches.

## Mapping

`server/fixture-map.json` now keeps provider IDs separately:

```json
{
  "apiFixtureId": null,
  "footballDataMatchId": 537327
}
```

All 72 group-stage entries have a unique `footballDataMatchId`.
`apiFixtureId` was preserved for every entry and was not repurposed.

The initial mapping required all of:

- exact provider match ID when already stored, otherwise aliases;
- home and away team orientation;
- a unique internal candidate;
- kickoff time within the existing 36-hour safety window.

The only missing alias was `Cape Verde Islands`; it was added to the three
relevant Cape Verde fixtures. After that correction, all 72 group matches
mapped with zero ambiguity. The final run mapped by stable provider ID plus
the same kickoff safety check.

The 32 unmapped provider records are knockout fixtures. Their teams are not
known yet and this project currently maps only the 72 group matches.

## Kickoff discrepancies resolved

Four internal kickoff values were corrected to match football-data.org:

| Internal match | Pair | Previous UTC | Corrected UTC |
|---:|---|---|---|
| 5 | Australia vs Turkey | `2026-06-13T04:00:00Z` | `2026-06-14T04:00:00Z` |
| 20 | Austria vs Jordan | `2026-06-16T07:00:00Z` | `2026-06-17T04:00:00Z` |
| 29 | Turkey vs Paraguay | `2026-06-19T04:00:00Z` | `2026-06-20T03:00:00Z` |
| 33 | Tunisia vs Japan | `2026-06-20T04:00:00Z` | `2026-06-21T04:00:00Z` |

FIFA's public match pages corroborate the corrected times:

- Australia vs Turkey: 21:00 Vancouver on June 13, which is
  `2026-06-14T04:00:00Z`;
- Austria vs Jordan: 21:00 San Francisco on June 16, which is
  `2026-06-17T04:00:00Z`;
- Turkey vs Paraguay: 20:00 San Francisco on June 19, which is
  `2026-06-20T03:00:00Z`;
- Tunisia vs Japan: 22:00 Monterrey on June 20, which is
  `2026-06-21T04:00:00Z`.

References:

- [FIFA Australia vs Turkey preview](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/australia-turkiye-preview-live-stream-team-news-tickets)
- [FIFA Austria vs Jordan preview](https://www.fifa.com/en/articles/austria-jordan-live-stream-team-news-tickets-live-stream)
- [FIFA Turkey vs Paraguay preview](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/turkiye-paraguay-preview-live-stream-team-news-tickets)
- [FIFA Tunisia vs Japan preview](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/tunisia-japan-preview-live-stream-team-news-tickets)

A cross-file audit confirmed the corrected UTC value for each ID in:

- `index.html`;
- `server/matches.json`;
- `server/fixture-map.json`;
- `supabase/seed/001_matches_seed.sql`;
- `supabase/migrations/004_fix_kickoff_times.sql`.

The data-only migration updates the already-seeded Supabase project by match
ID. No schema, score, prediction, or scoring-rule change is included.

An exact all-72 provider audit found one additional, smaller discrepancy after
the four-row patch:

| Internal match | Pair | Previous UTC | Corrected UTC | Difference |
|---:|---|---|---|---:|
| 32 | Brazil vs Haiti | `2026-06-20T01:00:00Z` | `2026-06-20T00:30:00Z` | 30 minutes |

FIFA lists this match at 20:30 in Philadelphia on June 19, which converts to
`2026-06-20T00:30:00Z`. The discrepancy is resolved consistently in the
frontend fixture list, server match data, provider fixture map, and Supabase
seed. The existing Supabase project can be corrected by applying
`supabase/migrations/005_fix_match_32_kickoff.sql`, which updates only match
ID `32`.

- [FIFA Brazil vs Haiti preview](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/brazil-haiti-live-stream-team-news-tickets)

## Status and score normalization

| football-data status | Project status | Score behavior |
|---|---|---|
| `SCHEDULED`, `TIMED` | `upcoming` | No score row is planned |
| `IN_PLAY`, `PAUSED` | `live` | Requires `score.fullTime` |
| `FINISHED`, `AWARDED` | `finished` | Requires `score.fullTime` |
| postponed, cancelled, suspended, unknown | unsupported | Skip and report |

Rules validated with local fixtures:

- scheduled match with no score produces no upsert;
- live match with a score and no minute keeps `minute: null`;
- finished match with a score and no minute uses `minute: 90`;
- live or finished match without a score is skipped;
- no scheduled match is silently written as `0-0`.

The existing Supabase schema makes `scores.minute` non-null. Because the
provider can omit the live minute, football-data Supabase writes remain
disabled until a real live response is reviewed and a schema-compatible
server-side policy is chosen without changing scoring rules.

## Write guard

This currently fails before any provider or Supabase write:

```powershell
$env:SCORE_PROVIDER='football-data'
$env:DRY_RUN='0'
node server\update-scores.js
```

The error is:

```text
football-data Supabase writes are not enabled yet. Use DRY_RUN=1.
```

API-Football's existing guarded write path remains intact.

## Validation

Passed:

```powershell
node --check server\update-scores.js
node --check server\check-football-data.js
npm --prefix server run update:scores:mock
node server\set-score.js --help
npm --prefix server run update:scores:football-data:dry-run
```

The final football-data dry-run reported:

```text
Provider season matches fetched count: 104
Mapped fixtures count: 72
Unmapped fixtures count: 32
Ambiguous fixtures count: 0
Kickoff differences over 0 minutes: 0
Kickoff discrepancies over 60 minutes: 0
Planned Supabase upserts: 0
Supabase writes: skipped because DRY_RUN=1
```

## Recommended next step

Keep football-data in dry-run mode. Shortly before the opener:

1. apply `supabase/migrations/005_fix_match_32_kickoff.sql` to the existing
   Supabase project;
2. verify match ID `32` in `public.matches`;
3. run a date-filtered dry run for June 11;
4. inspect the first actual `IN_PLAY` response for score and minute behavior;
5. decide a schema-compatible minute fallback before enabling writes;
6. retain `server/set-score.js` for corrections and provider outages.

Do not enable football-data Supabase writes until those checks pass.
