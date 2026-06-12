# GitHub Actions Finished-Score Sync Guide

## What the workflow does

`.github/workflows/sync-finished-scores.yml` runs the existing
football-data.org updater from a trusted GitHub-hosted runner.

The updater scans the complete World Cup 2026 season and writes only valid
finished scores. It continues to skip:

- upcoming matches;
- live matches;
- unchanged finished scores; and
- finished fixtures whose `score.fullTime` values are still missing.

A delayed final score is retried by the next scheduled run. There is no rapid
retry loop. Live-score writes remain disabled, and the manual
`server/set-score.js` fallback remains available.

## 1. Add repository secrets

In the GitHub repository, open:

```text
Settings -> Secrets and variables -> Actions -> Secrets
```

Add these repository secrets:

```text
FOOTBALL_DATA_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Use the existing server-side values. Do not add them to workflow files,
repository files, command arguments, or logs.

## 2. Add the scheduled-write variable

In:

```text
Settings -> Secrets and variables -> Actions -> Variables
```

Create:

```text
FINISHED_SCORE_SYNC_ENABLED
```

Set its value to:

```text
true
```

Scheduled writes are enabled only when the value is exactly lowercase
`true`. If the variable is missing, removed, or has any other value, the
scheduled job logs:

```text
Scheduled finished-score sync is disabled.
```

It then exits before checkout, dependency installation, provider access, or
Supabase access.

## 3. Run the workflow manually

Open:

```text
GitHub repository -> Actions -> sync-finished-scores -> Run workflow
```

Choose one mode:

- `dry-run`: the default; fetches and reports planned finished rows but makes
  no Supabase request or write;
- `write`: explicitly selected; reconciles and writes valid finished rows.

Manual dispatch does not depend on `FINISHED_SCORE_SYNC_ENABLED`.

## 4. Recommended activation order

1. Deploy the workflow file.
2. Add the three repository secrets.
3. Run a manual `dry-run`.
4. Review mapping, skipped fixtures, and planned rows in the logs.
5. Run one manual `write`.
6. Review `public.scores`, the website result, and leaderboard behavior.
7. Only then set `FINISHED_SCORE_SYNC_ENABLED=true`.

This keeps scheduled writes disabled until both manual modes have been
reviewed successfully.

## 5. Disable scheduled writes immediately

Change:

```text
FINISHED_SCORE_SYNC_ENABLED=false
```

or remove the variable. Future scheduled runs will exit before making a
provider or Supabase request.

Manual workflow runs remain available for an operator-selected dry-run or
write.

## Schedule and API usage

The workflow uses:

```text
7,37 * * * *
```

It runs at minute 7 and minute 37 of every hour, avoiding the exact start of
the hour. A 30-minute cadence is approximately 48 scheduled provider requests
per day when scheduled sync is enabled.

The updater makes one normal football-data.org request per run:

```text
GET /v4/competitions/WC/matches?season=2026
```

It does not set `MATCH_DATE`; filtering and finished-only decisions happen
after the complete season response is loaded.

## Stateless runner and budget note

GitHub-hosted runners are ephemeral. `server/.api-budget.json` is a gitignored
local runtime guard that records requests made within one filesystem. It is
not committed and will not persist reliably between separate Actions runs.

Do not rely on that file as a cross-run GitHub Actions quota. The conservative
fixed 30-minute cron schedule, concurrency group, five-minute timeout, and
absence of an internal retry loop are the durable scheduler safeguards.

## Operational boundaries

- Finished-score synchronization is automatic only after the repository
  variable is enabled.
- Missing full-time scores are skipped and retried on the next scheduled run.
- Existing matching scores are treated idempotently.
- Valid provider corrections are logged before being written.
- Live football-data writes remain disabled.
- API-Football behavior is unchanged.
- Manual corrections remain available through `server/set-score.js`.
- No `.env` or runtime budget file is uploaded by the workflow.
