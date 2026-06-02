# Real API-Football Dry-Run Guide

This guide is for the first safe real-provider dry-run of the server-side score updater. Do not use it to deploy, write scores, or expose secrets.

## Purpose

The first real API dry-run is used to validate mapping before enabling real score writes.

It will:

- fetch real API-Football fixture/score data,
- map provider fixtures to internal match IDs from `server/matches.json` and `server/fixture-map.json`,
- print planned Supabase `public.scores` upserts,
- skip Supabase writes when `DRY_RUN=1`,
- show unmapped or ambiguous fixtures so the mapping can be corrected safely.

## Required Server-Only Env Vars

Use placeholders here. Real values belong only in a local/server `.env` or scheduler secret store.

| Variable | Purpose |
| --- | --- |
| `API_FOOTBALL_KEY` | API-Football/API-Sports key for provider reads. |
| `API_FOOTBALL_LEAGUE_ID` | Optional provider league/tournament ID once confirmed. |
| `API_FOOTBALL_SEASON` | Optional provider season, usually `2026` for this tournament. Required when `API_FOOTBALL_LEAGUE_ID` is set. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for future trusted score writes. Not used for writes when `DRY_RUN=1`. |
| `DRY_RUN=1` | Required for safe dry-run. Prevents Supabase writes. |
| `MOCK_FIXTURES=0` | Uses real API-Football instead of mock fixtures. |
| `DISCOVER_FIXTURES=1` | Optional discovery mode. Never writes to Supabase, regardless of `DRY_RUN`. |
| `DISCOVER_LEAGUES=1` | Optional league discovery mode. Never writes to Supabase. |
| `LEAGUE_SEARCH` | Optional league search text, for example `World Cup`. |
| `LEAGUE_COUNTRY` | Optional provider country filter, for example `World`. |
| `MATCH_DATE=YYYY-MM-DD` | Restricts provider fetch to one date. |
| `SCORE_UPDATE_BUDGET_DAILY` | Optional daily request budget, default around `100`. |
| `SCORE_UPDATE_RESERVE` | Optional reserve buffer, default around `20`. |

`API_FOOTBALL_KEY` stays server-side only.

`SUPABASE_SERVICE_ROLE_KEY` stays server-side only.

Neither key goes into frontend code, `index.html`, `config.local.js`, GitHub Pages config, public config files, screenshots, chat messages, or committed files.

## Where To Find Keys

API-Football key:

- API-Football/API-Sports dashboard.
- Use it only in the server/scheduler environment.

Supabase URL:

- Supabase Dashboard -> Project Settings -> API / Data API.

Supabase service role key:

- Supabase Dashboard -> Project Settings -> API Keys.
- Use only in server-side scripts, scheduled jobs, serverless functions, or secure CI secrets.

Frontend reminder:

- Frontend may use only the Supabase anon/publishable key.
- Frontend must never use the service role key.
- API-Football key must never be used in browser code.

## Local `.env` Example

Create `.env` locally with real values only on your machine/server. The example below is placeholders only:

```env
API_FOOTBALL_KEY=your_api_football_key_here
API_FOOTBALL_LEAGUE_ID=
API_FOOTBALL_SEASON=2026
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
DRY_RUN=1
MOCK_FIXTURES=0
DISCOVER_FIXTURES=0
DISCOVER_LEAGUES=0
LEAGUE_SEARCH=World Cup
LEAGUE_COUNTRY=
MATCH_DATE=2026-06-11
SCORE_UPDATE_BUDGET_DAILY=100
SCORE_UPDATE_RESERVE=20
```

Safety rules:

- `.env` is gitignored.
- Never commit `.env`.
- Never send `.env` to anyone.
- Never paste real keys into docs, issues, commits, screenshots, or frontend config.

## Commands

Mock dry-run, no API-Football calls and no Supabase writes:

```powershell
npm --prefix server run update:scores:mock
```

Future real provider dry-run for one date:

```powershell
$env:DRY_RUN='1'; $env:MOCK_FIXTURES='0'; $env:MATCH_DATE='2026-06-11'; node server\update-scores.js
```

This consumes API-Football quota because it calls the provider. It writes nothing to Supabase because `DRY_RUN=1`.

Future league + season dry-run:

```powershell
$env:DRY_RUN='1'; $env:MOCK_FIXTURES='0'; $env:API_FOOTBALL_LEAGUE_ID='YOUR_LEAGUE_ID'; $env:API_FOOTBALL_SEASON='2026'; node server\update-scores.js
```

Future league + season + date dry-run:

```powershell
$env:DRY_RUN='1'; $env:MOCK_FIXTURES='0'; $env:API_FOOTBALL_LEAGUE_ID='YOUR_LEAGUE_ID'; $env:API_FOOTBALL_SEASON='2026'; $env:MATCH_DATE='2026-06-11'; node server\update-scores.js
```

Future discovery mode:

```powershell
$env:DISCOVER_FIXTURES='1'; $env:MOCK_FIXTURES='0'; $env:MATCH_DATE='2026-06-11'; node server\update-scores.js
```

Discovery mode fetches provider fixtures and prints provider fixture IDs, teams, kickoff dates, league fields, status, and tentative internal mapping. It never writes to Supabase, regardless of `DRY_RUN`.

Future league discovery mode:

```powershell
$env:DISCOVER_LEAGUES='1'; $env:MOCK_FIXTURES='0'; $env:LEAGUE_SEARCH='World Cup'; node server\update-scores.js
```

League discovery fetches possible API-Football tournaments/leagues and prints league ID, league name, country, type, available seasons, whether the target season appears, and possible World Cup candidates. It never writes to Supabase and does not require the Supabase service role key.

## Output Review Checklist

Before changing anything to real writes, inspect the dry-run output carefully:

- `Selected match date` is the intended date.
- `Provider fixtures fetched count` looks reasonable for that date.
- `Mapped fixtures count` matches the expected World Cup matches for that date.
- `Unmapped fixtures count` is zero or understood.
- `Ambiguous fixtures count` is zero.
- `Skipped fixtures count` is zero or understood.
- Planned upserts have the correct `match_id`.
- Planned scores, `status`, and `minute` look correct.
- `mapped_by` is trustworthy:
  - `apiFixtureId` is strongest.
  - `alias` is acceptable after review.
  - `normalized` should be checked carefully.
- `API budget before` and `API budget after` are within the safe range.
- Output says `Supabase writes: skipped because DRY_RUN=1`.

If discovery mode is used, inspect:

- API paths used,
- provider fixture IDs,
- provider league name/id and season,
- provider home/away names,
- kickoff dates,
- tentative internal match IDs,
- mapping notes.

If league discovery mode is used, inspect:

- API paths used,
- `Leagues returned count`,
- league IDs,
- league names,
- country names,
- league types,
- available seasons,
- whether season `2026` appears,
- possible World Cup candidates.

Before setting `API_FOOTBALL_LEAGUE_ID`, choose the candidate that most clearly represents the FIFA World Cup tournament, confirm it has season `2026`, then run fixture discovery with that league/season. Do not treat the first plausible result as final without fixture confirmation.

## If Provider Returns 0 Fixtures

Zero fixtures is not fatal. Possible reasons:

- fixtures are not published by the provider yet,
- wrong `MATCH_DATE`,
- league/season parameters are required,
- `API_FOOTBALL_LEAGUE_ID` or `API_FOOTBALL_SEASON` is wrong,
- API plan/provider coverage limitation,
- the tournament is not available in API-Football yet.

Next safe steps:

- try discovery mode for the same date,
- try league + season once the provider league ID is known,
- try league + season + date,
- do not enable writes from a zero-fixture result,
- do not keep retrying frequently because every real provider query can consume quota.

If league discovery returns 0 leagues:

- try a broader `LEAGUE_SEARCH`, such as `World`,
- remove `LEAGUE_COUNTRY` if it seems too restrictive,
- try only `API_FOOTBALL_SEASON=2026`,
- check whether API-Football has tournament coverage yet,
- stop and preserve quota if repeated searches stay empty.

## Unmapped Or Ambiguous Fixtures

Do not enable writes if there are unexpected unmapped or ambiguous fixtures.

For unmapped fixtures:

- compare provider home/away names with `server/fixture-map.json`,
- add missing aliases to `homeAliases` or `awayAliases`,
- rerun dry-run.

For ambiguous fixtures:

- do not guess,
- fill the correct `apiFixtureId` in `server/fixture-map.json` once known,
- rerun dry-run until the ambiguity is gone.

Provider fixture IDs are the safest long-term mapping once API-Football has the tournament fixtures available.

## When Not To Run

Do not run a real provider dry-run:

- too frequently,
- without `DRY_RUN=1`,
- without checking `MOCK_FIXTURES=0` is intentional,
- without a specific `MATCH_DATE` or reviewed league/season scope,
- if API quota is low,
- if the service role key may be exposed,
- from a machine or terminal session you do not trust,
- if you cannot review the output immediately.

## Future Real Write

Real writes are a later step only.

Only consider:

```powershell
$env:DRY_RUN='0'; $env:MOCK_FIXTURES='0'; $env:MATCH_DATE='2026-06-11'; node server\update-scores.js
```

after:

- mapping has been reviewed,
- unexpected unmapped/ambiguous fixtures are resolved,
- planned rows match the real fixtures,
- service role key is confirmed server-side only,
- one date has been tested first.

After a real write, monitor:

- Supabase `scores`,
- Supabase `leaderboard` view,
- frontend leaderboard read behavior,
- updater logs.

Never use the frontend for score writes.
