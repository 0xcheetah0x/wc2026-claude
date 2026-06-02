# Supabase SQL Validation Checklist

Use this guide to validate the migration and seed in a disposable Supabase project before applying anything to the real World Cup 2026 prediction game.

This is a testing guide only. Do not add real users, real passwords, API keys, service role keys, or production data while following it.

## 1. Disposable Project Setup

1. Create a new disposable Supabase project.
2. Open the Supabase SQL Editor.
3. Run `supabase/migrations/001_initial_schema.sql`.
4. Run `supabase/seed/001_matches_seed.sql`.
5. Confirm 72 group-stage matches were inserted.
6. Confirm no users, predictions, champion picks, or scores were seeded.

```sql
select count(*) as group_match_count
from public.matches
where stage = 'group';

select 'profiles' as table_name, count(*) from public.profiles
union all
select 'predictions', count(*) from public.predictions
union all
select 'champion_picks', count(*) from public.champion_picks
union all
select 'scores', count(*) from public.scores;
```

Expected:

- `group_match_count = 72`
- `profiles = 0`
- `predictions = 0`
- `champion_picks = 0`
- `scores = 0`

After auth tests, `profiles` will no longer be zero because test users should create profile rows.

## 2. Basic Schema Checks

Verify required tables exist:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles',
    'matches',
    'scores',
    'predictions',
    'champion_picks',
    'app_settings',
    'audit_logs'
  )
order by table_name;
```

Verify RLS is enabled:

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'matches',
    'scores',
    'predictions',
    'champion_picks',
    'app_settings',
    'audit_logs'
  )
order by c.relname;
```

Every row should have `rls_enabled = true`.

Verify policies exist:

```sql
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Expected policy names include:

- `profiles_read_authenticated`
- `profiles_insert_own`
- `profiles_update_own`
- `matches_read_authenticated`
- `scores_read_authenticated`
- `predictions_read_own_or_locked`
- `predictions_insert_own_before_lock`
- `predictions_update_own_before_lock`
- `predictions_delete_own_before_lock`
- `champion_picks_read_own_or_locked`
- `champion_picks_insert_own_before_lock`
- `champion_picks_update_own_before_lock`
- `champion_picks_delete_own_before_lock`
- `app_settings_read_authenticated`

Verify helper functions exist:

```sql
select proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'set_updated_at',
    'handle_new_user',
    'is_match_prediction_open',
    'is_match_prediction_locked',
    'champion_lock_at',
    'is_champion_pick_open',
    'prediction_points'
  )
order by proname;
```

Verify the leaderboard view exists and inspect its options:

```sql
select table_schema, table_name
from information_schema.views
where table_schema = 'public'
  and table_name = 'leaderboard';

select c.relname, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'leaderboard';
```

`reloptions` should show `security_invoker=true` on Supabase/Postgres versions that support it.

Verify the champion lock app setting exists:

```sql
select
  key,
  value->>'champion_lock_at' as champion_lock_at,
  (value->>'champion_lock_at')::timestamptz as champion_lock_at_utc
from public.app_settings
where key = 'tournament';
```

Verify all match IDs 1-72 exist:

```sql
select count(*) as match_count, min(id) as min_id, max(id) as max_id
from public.matches;

select id as missing_id
from generate_series(1, 72) as id
except
select id
from public.matches
order by missing_id;
```

Expected:

- `match_count = 72`
- `min_id = 1`
- `max_id = 72`
- no missing IDs

## 3. Auth And Profile Checks

Manual setup:

1. In Supabase Dashboard, go to Authentication.
2. Create two disposable test users, such as `test-a@example.invalid` and `test-b@example.invalid`.
3. Include user metadata if the UI allows it:
   - `username`: `test_a` / `test_b`
   - `display_name`: `Test A` / `Test B`
4. If metadata cannot be set in the UI, create users normally and inspect the auto-generated profile usernames.

Check profile rows were created by the auth trigger:

```sql
select id, username, display_name, avatar_id, created_at
from public.profiles
order by created_at;
```

Check the trigger source data if needed:

```sql
select id, email, raw_user_meta_data, created_at
from auth.users
order by created_at;
```

To test RLS in SQL Editor, use temporary role simulation. Replace the UUIDs below with the two profile IDs from the disposable users.

Important: SQL Editor can run as an elevated database role. For the strongest RLS proof, also test with a real authenticated client later. These SQL blocks are useful approximations.

```sql
-- Replace these manually before running examples:
-- User A: 00000000-0000-0000-0000-000000000001
-- User B: 00000000-0000-0000-0000-000000000002
```

User can read profiles:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select id, username, display_name
from public.profiles
order by username;

rollback;
```

User can update only their own allowed profile fields:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

update public.profiles
set display_name = 'Test A Updated'
where id = '<USER_A_UUID>';

rollback;
```

Expected failure when updating another user's profile:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

update public.profiles
set display_name = 'Should Not Work'
where id = '<USER_B_UUID>';

rollback;
```

Expected: zero rows updated or an RLS permission error.

## 4. Prediction RLS Tests

For repeatable tests, create disposable test matches that do not conflict with the real seeded match IDs. This is safe only in the disposable project.

```sql
insert into public.matches (
  id,
  group_code,
  stage,
  home_team,
  away_team,
  kickoff_at,
  city
) values
  (900001, 'T', 'test', 'Test Home Open', 'Test Away Open', now() + interval '2 days', 'Test City'),
  (900002, 'T', 'test', 'Test Home Locked', 'Test Away Locked', now() + interval '30 minutes', 'Test City')
on conflict (id) do update set
  kickoff_at = excluded.kickoff_at,
  updated_at = now();
```

Check lock helpers:

```sql
select
  id,
  kickoff_at,
  public.is_match_prediction_open(id) as prediction_open,
  public.is_match_prediction_locked(id) as prediction_locked
from public.matches
where id in (900001, 900002)
order by id;
```

Expected:

- `900001`: open = true, locked = false
- `900002`: open = false, locked = true

Authenticated user can insert own prediction before lock:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.predictions (user_id, match_id, home_score, away_score)
values ('<USER_A_UUID>', 900001, 2, 1);

rollback;
```

Authenticated user can update/delete own prediction before lock:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.predictions (user_id, match_id, home_score, away_score)
values ('<USER_A_UUID>', 900001, 2, 1)
on conflict (user_id, match_id) do update
set home_score = excluded.home_score,
    away_score = excluded.away_score;

update public.predictions
set home_score = 3, away_score = 1
where user_id = '<USER_A_UUID>'
  and match_id = 900001;

delete from public.predictions
where user_id = '<USER_A_UUID>'
  and match_id = 900001;

rollback;
```

Expected failure when inserting another user's prediction:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.predictions (user_id, match_id, home_score, away_score)
values ('<USER_B_UUID>', 900001, 1, 1);

rollback;
```

Expected: RLS `with check` violation.

Expected failure when editing own prediction after lock:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.predictions (user_id, match_id, home_score, away_score)
values ('<USER_A_UUID>', 900002, 1, 0);

rollback;
```

Expected: RLS `with check` violation because match `900002` is inside the 60-minute lock window.

Other users cannot read prediction before lock:

```sql
-- Seed the row with elevated SQL Editor privileges for this disposable test.
insert into public.predictions (user_id, match_id, home_score, away_score)
values ('<USER_A_UUID>', 900001, 2, 1)
on conflict (user_id, match_id) do update
set home_score = excluded.home_score,
    away_score = excluded.away_score;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_B_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select *
from public.predictions
where user_id = '<USER_A_UUID>'
  and match_id = 900001;

rollback;
```

Expected: no rows.

Other users can read prediction after lock:

```sql
-- Seed the row with elevated SQL Editor privileges for this disposable test.
insert into public.predictions (user_id, match_id, home_score, away_score)
values ('<USER_A_UUID>', 900002, 1, 0)
on conflict (user_id, match_id) do update
set home_score = excluded.home_score,
    away_score = excluded.away_score;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_B_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select *
from public.predictions
where user_id = '<USER_A_UUID>'
  and match_id = 900002;

rollback;
```

Expected: one row.

Cleanup disposable prediction test data:

```sql
delete from public.predictions where match_id in (900001, 900002);
delete from public.matches where id in (900001, 900002);
```

## 5. Champion Pick RLS Tests

Check the current champion lock:

```sql
select
  public.champion_lock_at() as champion_lock_at,
  public.is_champion_pick_open() as champion_pick_open;
```

Before the champion lock, user can insert/update own champion pick:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.champion_picks (user_id, team)
values ('<USER_A_UUID>', 'Arjantin')
on conflict (user_id) do update
set team = excluded.team;

rollback;
```

Expected failure when editing another user's champion pick:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.champion_picks (user_id, team)
values ('<USER_B_UUID>', 'Fransa')
on conflict (user_id) do update
set team = excluded.team;

rollback;
```

Expected: RLS `with check` violation.

To test the locked state in a disposable project, temporarily move champion lock into the past:

```sql
update public.app_settings
set value = jsonb_set(value, '{champion_lock_at}', to_jsonb((now() - interval '1 minute')::text))
where key = 'tournament';

select public.is_champion_pick_open() as champion_pick_open;
```

Expected failure when inserting/updating after champion lock:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.champion_picks (user_id, team)
values ('<USER_A_UUID>', 'Brezilya')
on conflict (user_id) do update
set team = excluded.team;

rollback;
```

Expected: RLS `with check` violation.

Restore the seeded champion lock:

```sql
update public.app_settings
set value = jsonb_set(value, '{champion_lock_at}', to_jsonb('2026-06-11T18:00:00Z'::text))
where key = 'tournament';
```

## 6. Scores And Matches Security Tests

Authenticated users can read matches and scores:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select id, home_team, away_team, kickoff_at
from public.matches
order by id
limit 5;

select *
from public.scores
order by match_id
limit 5;

rollback;
```

Authenticated users cannot insert/update/delete matches:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.matches (id, home_team, away_team, kickoff_at)
values (910001, 'Nope Home', 'Nope Away', now() + interval '1 day');

rollback;
```

Expected: permission denied or RLS failure.

Authenticated users cannot insert/update/delete scores:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<USER_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.scores (match_id, home_score, away_score, status, minute)
values (1, 1, 0, 'finished', 90);

rollback;
```

Expected: permission denied or RLS failure.

Service role/server process can write scores. In SQL Editor this is represented by elevated project-owner privileges, not by the browser anon key:

```sql
insert into public.scores (match_id, home_score, away_score, status, minute, source)
values (1, 2, 1, 'finished', 90, 'validation')
on conflict (match_id) do update
set home_score = excluded.home_score,
    away_score = excluded.away_score,
    status = excluded.status,
    minute = excluded.minute,
    source = excluded.source,
    updated_at = now();

select *
from public.scores
where match_id = 1;
```

Cleanup if desired:

```sql
delete from public.scores
where source = 'validation';
```

Service role key rule: the service role key must never be placed in browser code, frontend environment variables, `index.html`, or public deployment settings. Use it only in trusted server-side scripts/processes.

## 7. Leaderboard Parity Checks

Use disposable scores and predictions to compare SQL points with the current frontend scoring logic.

Create a finished score:

```sql
insert into public.scores (match_id, home_score, away_score, status, minute, source)
values (1, 2, 1, 'finished', 90, 'validation')
on conflict (match_id) do update
set home_score = excluded.home_score,
    away_score = excluded.away_score,
    status = excluded.status,
    minute = excluded.minute,
    source = excluded.source,
    updated_at = now();
```

Add test predictions with elevated SQL Editor privileges:

```sql
insert into public.predictions (user_id, match_id, home_score, away_score)
values
  ('<USER_A_UUID>', 1, 2, 1),
  ('<USER_B_UUID>', 1, 1, 0)
on conflict (user_id, match_id) do update
set home_score = excluded.home_score,
    away_score = excluded.away_score;
```

Check direct scoring helper:

```sql
select
  public.prediction_points(2, 1, 2, 1, true, false) as exact_score_points,
  public.prediction_points(1, 0, 2, 1, true, false) as correct_winner_points;
```

Expected with the current normal score rules:

- exact `2-1` on an actual `2-1`: `4` total points (`3` exact score + `1` correct winner)
- predicted home win `1-0` on actual home win `2-1`: `1` point

Check leaderboard rows:

```sql
select username, display_name, total_points, exact_scores, correct_outcomes, scored_matches
from public.leaderboard
order by total_points desc, username;
```

Seeded flags affect underdog scoring. If a non-seeded team beats a seeded team and the user predicted the correct winning side, the outcome component should be worth more than a normal favorite win. Verify SQL `prediction_points` against the frontend `ruleOutcomePoints` before relying on leaderboard totals.

Cleanup validation rows:

```sql
delete from public.predictions where match_id = 1;
delete from public.scores where source = 'validation';
```

## 8. Timezone Checks

Kickoff values are stored as UTC `timestamptz`.

Confirm the first kickoff:

```sql
select
  id,
  kickoff_at as kickoff_utc,
  kickoff_at at time zone 'Europe/Istanbul' as kickoff_turkey_time
from public.matches
where id = 1;
```

Expected:

- UTC: `2026-06-11T19:00:00Z`
- Turkey time: `2026-06-11 22:00 TRT`

Confirm champion lock:

```sql
select
  public.champion_lock_at() as champion_lock_utc,
  public.champion_lock_at() at time zone 'Europe/Istanbul' as champion_lock_turkey_time;
```

Expected:

- UTC: `2026-06-11T18:00:00Z`
- Turkey time: `2026-06-11 21:00 TRT`

Confirm match prediction lock is kickoff minus 60 minutes:

```sql
select
  id,
  kickoff_at,
  kickoff_at - interval '60 minutes' as prediction_lock_at,
  public.is_match_prediction_open(id) as prediction_open,
  public.is_match_prediction_locked(id) as prediction_locked
from public.matches
where id = 1;
```

Expected lock time for match `1`:

- UTC: `2026-06-11T18:00:00Z`
- Turkey time: `2026-06-11 21:00 TRT`

## 9. Troubleshooting

### RLS blocks inserts

Check all of these:

- The SQL/API request is authenticated as the expected user.
- `auth.uid()` matches the row `user_id` or profile `id`.
- The match or champion pick is still before lock.
- The role is `authenticated`, not `anon`.
- The test is not accidentally running after the expected lock time.

Useful debug query inside a simulated authenticated block:

```sql
select
  auth.uid() as current_user_id,
  public.is_match_prediction_open(1) as match_1_open,
  public.is_champion_pick_open() as champion_open;
```

### Profile trigger does not create rows

Check that the `on_auth_user_created` trigger exists:

```sql
select tgname
from pg_trigger
where tgname = 'on_auth_user_created';
```

Check recent auth users and profiles:

```sql
select id, email, raw_user_meta_data, created_at
from auth.users
order by created_at desc
limit 5;

select id, username, display_name, created_at
from public.profiles
order by created_at desc
limit 5;
```

If auth users exist but profiles do not, review `public.handle_new_user()` and Supabase trigger permissions.

### `security_invoker` view not supported

If creating `public.leaderboard` fails because `security_invoker` is unsupported, the Supabase/Postgres version may be too old. Do not silently remove the option in production. First confirm the project Postgres version and decide whether to upgrade the project or replace the view with an RPC/function that preserves RLS expectations.

### Wrong timezone assumptions

Use UTC for storage and lock enforcement. Convert to Turkey time only for display/review:

```sql
select kickoff_at, kickoff_at at time zone 'Europe/Istanbul'
from public.matches
order by id
limit 5;
```

### Leaderboard view returns empty

Check:

- At least one profile exists.
- Predictions exist for that profile.
- Scores exist with `status = 'finished'`.
- The authenticated role has `select` grant on `public.leaderboard`.
- The view is not hidden by RLS on joined tables.

### Service role vs anon key confusion

- Browser/frontend uses only the anon public key.
- Server-side score update jobs may use the service role key.
- Service role bypasses RLS, so keep it out of client bundles, public logs, screenshots, and repository files.
- If a browser request can write `matches` or `scores`, the setup is wrong.

## 10. Final Validation Notes

Before moving to the real project:

- Re-run the migration and seed from a clean disposable project once.
- Confirm 72 matches and no seeded users/predictions/scores.
- Run at least one positive and one negative RLS test for profiles, predictions, champion picks, matches, and scores.
- Run leaderboard parity checks for exact score, normal correct winner, draw, and seeded-underdog scenarios.
- Document any manual SQL changes made during validation so the real migration stays reproducible.
