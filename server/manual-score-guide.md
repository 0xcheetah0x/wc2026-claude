# Manual Score Admin Guide

This guide explains how to update one match score in Supabase while API-Football fixtures are unavailable.

Use this only from a trusted server/local terminal. Never run score writes from the frontend.

## Purpose

`server/set-score.js` manually upserts one row into `public.scores`.

It writes only:

- `match_id`
- `home_score`
- `away_score`
- `status`
- `minute`

It never writes:

- predictions
- profiles
- champion picks
- matches
- leaderboard

## Required Env Vars

Real writes require server-only env vars:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Rules:

- `SUPABASE_SERVICE_ROLE_KEY` stays server-side only.
- Never put the service role key in `index.html`, `config.local.js`, frontend config, GitHub Pages, or public docs.
- Never commit `.env`.
- `.env` is gitignored.

`API_FOOTBALL_KEY` is not required for manual score updates.

## Dry Run First

Run dry-run before every real write:

```powershell
node server\set-score.js --match=1 --home=2 --away=1 --status=finished --minute=90 --dry-run
```

Dry-run:

- validates the input,
- loads local match info from `server/matches.json`,
- prints the planned `public.scores` payload,
- does not check Supabase,
- does not write to Supabase.

## Real Write

After reviewing dry-run output:

```powershell
node server\set-score.js --match=1 --home=2 --away=1 --status=finished --minute=90
```

The real write path:

- requires `SUPABASE_URL`,
- requires `SUPABASE_SERVICE_ROLE_KEY`,
- checks that the match exists in Supabase `public.matches`,
- upserts into `public.scores` by `match_id`,
- prints safe output without exposing the service role key.

You can also run through npm from the `server` package:

```powershell
npm --prefix server run set-score -- --match=1 --home=2 --away=1 --status=finished --minute=90 --dry-run
```

## Status And Minute

Allowed status values:

- `upcoming`
- `live`
- `finished`

If `status=finished` and `--minute` is omitted, minute defaults to `90`.

If `status=upcoming` or `status=live` and `--minute` is omitted, minute defaults to `0`.

## Verify In Supabase

After a real write, verify recent score rows:

```sql
select *
from public.scores
order by updated_at desc
limit 5;
```

Then check the leaderboard view:

```sql
select *
from public.leaderboard
order by total_points desc;
```

The leaderboard should update automatically because it reads from predictions and `public.scores`.

## Safety Checklist

- Use `--dry-run` first.
- Confirm the match ID and local team names.
- Confirm score, status, and minute.
- Keep the service role key server-side only.
- Never commit `.env`.
- Never paste real keys into docs, chats, screenshots, or frontend files.
- Write one match first, then verify `scores` and `leaderboard`.
