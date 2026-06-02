# Supabase Test Data Cleanup Guide

Use this guide before real play if the Supabase project contains test users, test predictions, test champion picks, test scores, or placeholder profile names.

This guide is documentation only. Do not run cleanup SQL until you have inspected the rows and decided what should be removed.

## Safety Warning

- Run `select` queries first.
- Do not delete real users accidentally.
- Backup/export data first if unsure.
- Only run `delete` or `update` statements after confirming the target rows.
- This is for test/private setup cleanup before real play.
- Prefer the Supabase Dashboard for auth-user cleanup.

## Inspect Current Data

Inspect profiles:

```sql
select id, username, display_name, created_at
from public.profiles
order by created_at desc;
```

Auth users:

- `auth.users` is visible in Supabase SQL Editor for project owners.
- Handle it carefully.
- Prefer Supabase Dashboard -> Authentication -> Users for deleting test auth users.

Inspect predictions:

```sql
select *
from public.predictions
order by created_at desc;
```

Inspect champion picks:

```sql
select *
from public.champion_picks
order by created_at desc;
```

Inspect scores:

```sql
select *
from public.scores
order by updated_at desc;
```

Inspect leaderboard:

```sql
select *
from public.leaderboard
order by total_points desc;
```

Find placeholder-looking profiles:

```sql
select id, username, display_name, created_at
from public.profiles
where username like 'user_%'
   or display_name = 'Oyuncu'
order by created_at desc;
```

## Clean Only Game Data

This option keeps auth users and profile rows. Use it if the same users will play for real.

Inspect first, then run only if you are sure:

```sql
delete from public.predictions;
delete from public.champion_picks;
delete from public.scores;
```

This removes:

- all match predictions,
- all champion picks,
- all manual/test scores.

This does not remove:

- Supabase Auth users,
- `public.profiles`,
- match seed data,
- app settings,
- migrations.

## Reset Profile Names

If test registration created placeholder names such as `user_xxxx` or `Oyuncu`, update each profile manually after inspecting IDs.

Example:

```sql
update public.profiles
set username = 'mert',
    display_name = 'Mert'
where id = 'USER_UUID_HERE';
```

Rules:

- Use the profile UUID from the `select` query.
- Do not guess UUIDs.
- Usernames must be unique.
- Use lowercase usernames that match the existing username format rule.
- Update one profile at a time if unsure.

## Full Test User Cleanup

Deleting auth users should usually be done from:

```text
Supabase Dashboard -> Authentication -> Users
```

Why:

- Auth users live in the `auth` schema.
- Deleting auth users can cascade/delete `public.profiles` because profiles reference `auth.users(id)` with `on delete cascade`.
- Related predictions and champion picks may also cascade through profile/user relationships.
- If you are not sure, do not delete auth users from SQL.

Recommended approach:

1. Use the Dashboard to delete disposable test auth users.
2. Re-run the inspection queries.
3. Clean leftover game rows only if needed.

## Verify Clean State

Check row counts:

```sql
select count(*) as prediction_count
from public.predictions;
```

```sql
select count(*) as champion_pick_count
from public.champion_picks;
```

```sql
select count(*) as score_count
from public.scores;
```

Check leaderboard:

```sql
select *
from public.leaderboard
order by total_points desc;
```

Expected after game-data cleanup:

- `predictions = 0`
- `champion_picks = 0`
- `scores = 0`
- leaderboard users may remain if profiles remain,
- leaderboard points should be `0` or the view may be empty depending on profile state.

## Recommended Pre-Game Cleanup Path

Recommended sequence:

1. Keep real intended users if they already exist.
2. Delete only game data:
   - `public.predictions`
   - `public.champion_picks`
   - `public.scores`
3. Update profile usernames/display names for real players.
4. Verify leaderboard is clean.
5. Start real predictions.

This is safer than deleting all users if the real players have already registered.

## Secrets Reminder

Cleanup has nothing to do with `.env`.

Never:

- paste the service role key into frontend code,
- paste API-Football keys into frontend code,
- commit `.env`,
- commit `config.local.js`,
- share secrets in screenshots or chat.
