# Supabase Edge Function Finished-Score Sync Guide

## Architecture

```text
Supabase Cron
-> pg_net HTTP POST
-> Supabase Edge Function
-> football-data.org
-> public.scores
-> leaderboard and profiles update
```

`sync-finished-scores` makes one football-data.org season request per
invocation, maps only the 72 bundled group-stage fixtures, and reconciles valid
finished scores with `public.scores`.

It does not write upcoming or live fixtures. A `FINISHED` fixture whose
full-time score is delayed is skipped until the next scheduled invocation.
There is no internal retry loop.

## Security model

The function:

- accepts only `POST`;
- requires `x-wc2026-cron-secret`;
- compares that header with the server-side `WC2026_CRON_SECRET`;
- returns `401` for an invalid private header;
- never prints or returns secrets;
- returns only aggregate, sanitized score-sync counts and messages.

Deploy the function with JWT verification disabled because Supabase Cron uses
the dedicated private header instead:

```powershell
supabase functions deploy sync-finished-scores --no-verify-jwt
```

Disabling the gateway JWT check does not make the handler public: the function
rejects requests that do not supply the matching cron secret.

## Required Edge Function secrets

Configure:

```text
FOOTBALL_DATA_TOKEN
WC2026_CRON_SECRET
FINISHED_SCORE_SYNC_ENABLED
```

Hosted Supabase Edge Functions provide these server-side:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The function uses the service-role key only inside the Edge runtime to read and
upsert `public.scores`. Never place any of these values in frontend code,
committed files, browser configuration, logs, or the cron SQL body.

The cron header secret should be a strong random value used only for this
function. It must not be the football-data token or service-role key.

## Dry-run and write gates

The function defaults to dry-run.

A real write occurs only when both conditions are true:

```text
request body: {"dryRun":false}
FINISHED_SCORE_SYNC_ENABLED=true
```

Every other combination fetches and evaluates fixtures but performs zero
writes. This includes a write-shaped request while the environment flag is
missing, `false`, or any value other than exact lowercase `true`.

Dry-run reports classify valid finished rows as would-be inserted, unchanged,
or corrected. Upserts occur only for inserted and corrected rows in enabled
write mode.

## Finished-score behavior

Accepted provider rows require:

```text
status = FINISHED
score.fullTime.home = integer from 0 through 20
score.fullTime.away = integer from 0 through 20
```

The exact database payload is:

```json
{
  "match_id": 1,
  "home_score": 2,
  "away_score": 0,
  "status": "finished",
  "minute": 90
}
```

The function:

- inserts a valid finished row when no score exists;
- omits an unchanged matching finished row;
- writes and counts a valid provider correction;
- never downgrades a score to live or upcoming;
- never overwrites a manual row with missing provider data;
- never invents `0-0`;
- skips live and upcoming fixtures;
- keeps `live_write_enabled=false`.

## Safe activation order

1. Keep GitHub Actions scheduled writes disabled:

   ```text
   FINISHED_SCORE_SYNC_ENABLED=false
   ```

   This repository variable is separate from the Edge Function secret.

2. Review the function, bundled fixture map, validation script, and cron SQL
   example.

3. Link the local repository to the intended Supabase project using the
   Supabase CLI.

4. Deploy the function without gateway JWT verification:

   ```powershell
   supabase functions deploy sync-finished-scores --no-verify-jwt
   ```

5. Add Edge Function secrets through the Supabase Dashboard or CLI:

   ```text
   FOOTBALL_DATA_TOKEN=<server-only provider token>
   WC2026_CRON_SECRET=<strong independent random secret>
   FINISHED_SCORE_SYNC_ENABLED=false
   ```

6. Manually invoke the deployed function with the matching private header and:

   ```json
   { "dryRun": true }
   ```

7. Verify:

   - HTTP `200`;
   - `dry_run=true`;
   - `write_enabled=false`;
   - `provider_request_count=1`;
   - `live_write_enabled=false`;
   - zero database writes.

8. Set the Edge Function secret:

   ```text
   FINISHED_SCORE_SYNC_ENABLED=true
   ```

9. Manually invoke once with:

   ```json
   { "dryRun": false }
   ```

10. Verify inserted, unchanged, corrected, and skipped counts against
    `public.scores` and the website.

11. Only after manual verification, copy and review the commented statements
    in `supabase/sql/setup_finished_score_cron.sql.example`, substitute the two
    Vault placeholders, and execute the approved statements individually.

12. Confirm at least one successful Supabase Cron invocation before deleting:

    ```text
    .github/workflows/schedule-probe.yml
    ```

13. Keep the GitHub Actions repository variable disabled unless intentionally
    using that scheduler as the active write mechanism.

## Manual invocation shape

Use placeholders during review:

```powershell
$env:EDGE_FUNCTION_URL='https://REPLACE_PROJECT_REF.supabase.co/functions/v1/sync-finished-scores'
$env:WC2026_CRON_SECRET='REPLACE_WITH_LOCAL_MATCHING_SECRET'

curl.exe -X POST $env:EDGE_FUNCTION_URL `
  -H "Content-Type: application/json" `
  -H "x-wc2026-cron-secret: $env:WC2026_CRON_SECRET" `
  --data '{"dryRun":true}'
```

Change the body to `{"dryRun":false}` only during the controlled write step
after the Edge Function environment flag has been reviewed.

## Supabase Cron setup

The non-executable template:

```text
supabase/sql/setup_finished_score_cron.sql.example
```

documents how to:

- enable `pg_cron` and `pg_net`;
- store the function URL in Supabase Vault;
- store the private cron header in Supabase Vault;
- invoke every 30 minutes with `7,37 * * * *`;
- send `{"dryRun":false}`;
- inspect jobs and run history;
- unschedule immediately.

The template contains no real project URL, token, service-role key, or cron
secret. All SQL statements are commented out so the file cannot modify a
database by being opened or parsed.

## Immediate shutdown

Use both controls when stopping automation:

1. Set the Edge Function secret:

   ```text
   FINISHED_SCORE_SYNC_ENABLED=false
   ```

2. Unschedule the database job:

   ```sql
   select cron.unschedule('wc2026-finished-score-sync');
   ```

The environment flag makes write-shaped requests dry-run safely. Unscheduling
stops future invocations.

Keep these manual fallbacks:

- GitHub Actions `sync-finished-scores` manual dry-run/write;
- `server/update-scores.js`;
- `server/set-score.js`.

Live football-data writes remain disabled throughout this design.
