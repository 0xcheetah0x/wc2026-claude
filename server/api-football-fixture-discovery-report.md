# API-Football World Cup 2026 Fixture Discovery Report

Audit timestamp: 2026-06-06 16:31 TRT (UTC+03:00)

## Safety Scope

This was a read-only provider audit.

- Root `.env` loading succeeded.
- `API_FOOTBALL_KEY` was available but was never printed.
- All operations were discovery-only.
- `DRY_RUN=0` was not used.
- No Supabase endpoint was called.
- No Supabase score write occurred.
- No frontend file or Supabase schema file was changed.

## Request Summary

Three API-Football requests were used:

1. `/leagues?id=1&season=2026`
2. `/fixtures?league=1&season=2026`
3. `/fixtures?league=1&season=2026&date=2026-06-11`

The Istanbul-day budget file now records:

- day: `2026-06-06`
- requests used: `3`
- configured spend limit before reserve: `80`

The rounds endpoint was not called because the all-season fixture request
returned no fixtures and a definitive plan-coverage error. Avoiding that
fourth call preserved quota.

## League Coverage Check

Endpoint:

```text
/leagues?id=1&season=2026
```

Result:

- response rows: `0`
- league metadata returned: none
- coverage object returned: none
- fixtures/events/standings availability: not reported

Provider error:

```text
Free plans do not have access to this season, try from 2022 to 2024.
```

The previous league-discovery result remains useful context:

- league ID: `1`
- league name: `World Cup`
- season `2026` was listed as available

However, the current account plan cannot retrieve the 2026 season details or
coverage object through the exact league endpoint.

## All-Season Fixture Discovery

Endpoint:

```text
/fixtures?league=1&season=2026
```

Result:

- fixtures fetched: `0`
- first 10 fixtures: none
- 72 group-stage fixtures present: no
- knockout fixtures present: no

Provider error:

```text
Free plans do not have access to this season, try from 2022 to 2024.
```

This result does not prove that API-Football has failed to publish the
fixtures. It proves that the current free plan cannot access season 2026, so
fixture publication cannot be evaluated with this account tier.

## First-Match-Date Discovery

Endpoint:

```text
/fixtures?league=1&season=2026&date=2026-06-11
```

Result:

- fixtures fetched: `0`
- Mexico vs South Africa found: no
- provider fixture ID: unavailable
- mapping to internal match ID `1`: unavailable

Provider error:

```text
Free plans do not have access to this season, try from 2022 to 2024.
```

## Rounds Discovery

The following endpoint was not called:

```text
/fixtures/rounds?league=1&season=2026
```

Reason:

- all-season fixtures were unavailable,
- the provider returned a plan restriction rather than an empty successful
  season,
- another call would almost certainly consume quota and return the same plan
  restriction.

Therefore, group-stage and knockout round names could not be audited.

## Mapping Status

No provider fixtures were returned, so no mapping attempt was possible.

- mapped fixtures: `0`
- unmapped fixtures: `0`
- ambiguous fixtures: `0`
- suggested `apiFixtureId` values: none

Current `server/fixture-map.json` status:

- entries: `72`
- populated `apiFixtureId` values: `0`

The fixture map was not modified.

## Current Automatic-Score Status

Automatic score ingestion remains blocked.

The current blocker is more specific than the previous “fixtures may not be
published” theory:

> The current API-Football free plan does not grant access to season 2026.

Until the account can access league `1`, season `2026`, the updater cannot:

- discover provider fixture IDs,
- verify provider team/date data,
- lock fixture mappings,
- fetch live or final World Cup 2026 scores.

The working server-side manual fallback remains:

```powershell
node server\set-score.js --match=1 --home=2 --away=1 --status=finished --minute=90 --dry-run
```

Review the dry-run, then use the documented real-write command only from the
trusted local/server environment when needed.

## Code-Inspection Finding

`server/update-scores.js` checks HTTP status codes but currently does not reject
or prominently report API-Football payload-level errors such as:

```json
{
  "errors": {
    "plan": "..."
  }
}
```

As a result, the built-in discovery report can describe this response as
“0 fixtures” and show generic guidance while hiding the decisive plan error.

No code change was made during this audit. A later small server-only task
should make `fetchApiFootballJson()` surface non-empty provider `errors`
safely, without printing credentials.

## Recommended Next Action

1. Check the API-Football/API-Sports dashboard for a plan that includes the
   2026 World Cup season.
2. Do not repeat these queries on the current free plan; the restriction is
   plan-based, not a transient empty response.
3. If access is upgraded or API-Football changes free-plan coverage, rerun only:

   ```powershell
   $env:DRY_RUN='1'
   $env:DISCOVER_FIXTURES='1'
   $env:MOCK_FIXTURES='0'
   $env:API_FOOTBALL_LEAGUE_ID='1'
   $env:API_FOOTBALL_SEASON='2026'
   Remove-Item Env:\MATCH_DATE -ErrorAction SilentlyContinue
   node server\update-scores.js
   ```

4. If fixtures appear, review teams/dates, populate confirmed
   `apiFixtureId` values, and run a one-date real-provider dry-run before any
   write mode is considered.
5. Until then, continue using `server/set-score.js`; the frontend, Supabase
   reads, and leaderboard remain functional.

## Final Result

- Real API-Football calls made: yes, read-only discovery only
- Requests used: `3`
- World Cup 2026 fixtures available to this account: no
- Mexico vs South Africa found: no
- Fixture IDs ready to populate: no
- Supabase writes: none
- Credentials printed or added: none
- Frontend changes: none
