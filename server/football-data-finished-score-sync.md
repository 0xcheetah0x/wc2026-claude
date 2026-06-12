# football-data.org Finished-Score Sync

## Scope

The football-data.org integration can automatically write finished match
scores to `public.scores`. Live-score writes remain disabled.

The provider can report `FINISHED` before `score.fullTime.home` and
`score.fullTime.away` become available. The updater handles this as eventual
consistency: it skips the incomplete fixture and lets the normal scheduler try
again on its next bounded run.

There is no tight internal retry loop.

## Finished-only behavior

For `SCORE_PROVIDER=football-data`, the updater writes a row only when:

- the provider status maps to `finished`;
- both `score.fullTime.home` and `score.fullTime.away` are numeric;
- the fixture maps safely to one internal match; and
- real-write credentials are present.

The Supabase payload contains only:

```json
{
  "match_id": 1,
  "home_score": 2,
  "away_score": 0,
  "status": "finished",
  "minute": 90
}
```

When football-data omits the minute for a finished match, the updater uses
`90`. Provider IDs and other response fields are never written to Supabase.

## Delayed scores

A `FINISHED` fixture without both usable full-time score values is skipped
with:

```text
Finished fixture is missing full-time score; retry on next run.
```

The updater continues processing other fixtures. It does not write `0-0`,
does not remove an existing score, and does not fail the complete job because
one final score is delayed.

## Existing and manual rows

Before a real football-data write, the updater reads only:

```text
match_id
home_score
away_score
status
minute
```

from the relevant existing `public.scores` rows.

Each valid provider row is classified as:

- `inserted`: no score row exists, so the finished result is inserted;
- `unchanged/idempotent`: the existing finished score already matches, so no
  unnecessary write is made;
- `corrected`: a valid provider result differs from the existing row, so the
  finished provider result is written and the old/new values are logged;
- `skipped`: the row does not satisfy the finished-only safety contract.

Missing provider score data never reaches reconciliation and therefore cannot
overwrite an existing manual finished score. The football-data path never
downgrades a row from `finished` to `live` or `upcoming`.

The manual fallback remains available:

```powershell
node server\set-score.js --match=1 --home=2 --away=0 --status=finished --minute=90
```

Use its documented `--dry-run` flow before a manual production correction.

## Live fixtures

`IN_PLAY` and `PAUSED` fixtures are mapped and reported, but they do not
produce writable rows. The log states:

```text
Live football-data writes remain disabled until live payload validation passes.
```

API-Football behavior is unchanged.

## Required environment

A real football-data finished-score run requires:

```text
SCORE_PROVIDER=football-data
DRY_RUN=0
FOOTBALL_DATA_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Secrets must remain in the gitignored root `.env` or the server environment.
They must never be added to command arguments, frontend files, or logs.

## Dry-run command

From the project root:

```powershell
$env:SCORE_PROVIDER='football-data'
$env:DRY_RUN='1'
$env:MATCH_DATE='2026-06-11'
node server\update-scores.js
```

This makes the provider GET request, maps and normalizes fixtures, and prints
the planned finished-score payload. It makes no Supabase request or write.

## Controlled write command

Run only after reviewing a successful dry-run and explicitly approving the
production write:

```powershell
$env:SCORE_PROVIDER='football-data'
$env:DRY_RUN='0'
$env:MATCH_DATE='2026-06-11'
node server\update-scores.js
```

The token, Supabase URL, and service-role key are loaded from the server
environment. The run reads matching existing score rows, writes only valid
finished rows that are new or corrected, and logs inserted, unchanged,
corrected, and skipped results.

## Scheduler guidance

Use bounded scheduled runs rather than an aggressive retry loop. If a
finished score is delayed, the next normal run should retry it. Retain the
manual score command for provider delays, outages, and corrections.
