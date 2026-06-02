# Supabase Production Plan

This document is a planning draft only. It does not change the current Demo Mode app, scoring rules, UI, API polling/cache logic, or localStorage keys.

## Goals

- Keep Demo Mode localStorage behavior until production mode is implemented.
- Use Supabase Auth for real production identity.
- Use Postgres tables plus Row Level Security (RLS) for shared game data.
- Enforce the current lock rule in the database: predictions lock 60 minutes before kickoff.
- Let users manage only their own predictions and champion pick before lock.
- Let authenticated users read shared match, score, and leaderboard data.
- Let only a trusted server/service role update official scores.

## Recommended Auth Model

Use Supabase Auth email/password for the first production version.

Supabase Auth natively supports email/password well. The app can still require a public username by storing it in `profiles.username`. Users register themselves; no Mert/Saygin/Erkan users should be pre-created.

If username/password login is required later, use a secure server-side flow such as an Edge Function that maps a username to the auth email and then performs a normal sign-in flow. Do not implement username-only auth by trusting client-side localStorage or by exposing private auth data.

Recommended signup metadata:

- `username`: public unique handle, stored in `profiles`
- `display_name`: public display name, stored in `profiles`
- Email remains in `auth.users`, not in `profiles`

## Table Design

### `profiles`

Public user profile data linked to Supabase Auth users.

Columns:

- `id uuid primary key references auth.users(id) on delete cascade`
- `username citext not null unique`
- `display_name text not null`
- `avatar_id text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Notes:

- Keep private email/password data in Supabase Auth, not in this table.
- Do not store production passwords here.
- If admin roles are needed later, prefer auth app metadata or a separate service-managed admin table, not user-editable profile fields.

### `matches`

Canonical World Cup schedule.

Columns:

- `id integer primary key`
- `group_code text`
- `stage text not null default 'group'`
- `home_team text not null`
- `away_team text not null`
- `home_seeded boolean not null default false`
- `away_seeded boolean not null default false`
- `kickoff_at timestamptz not null`
- `city text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:

- `kickoff_at`
- `stage`

### `scores`

Official score/status per match.

Columns:

- `match_id integer primary key references matches(id) on delete cascade`
- `home_score smallint not null default 0`
- `away_score smallint not null default 0`
- `status text not null default 'upcoming' check (status in ('upcoming','live','finished'))`
- `minute smallint not null default 0`
- `source text`
- `provider_updated_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Write access:

- Service role/server process only.
- The browser must never receive the service role key.

### `predictions`

One score prediction per user per match.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references profiles(id) on delete cascade`
- `match_id integer not null references matches(id) on delete cascade`
- `home_score smallint not null check (home_score between 0 and 20)`
- `away_score smallint not null check (away_score between 0 and 20)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:

- `unique (user_id, match_id)`

Indexes:

- `(user_id)`
- `(match_id)`
- `(user_id, match_id)`

### `champion_picks`

One tournament winner pick per user.

Columns:

- `user_id uuid primary key references profiles(id) on delete cascade`
- `team text not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Lock:

- Same idea as current demo: closes 60 minutes before the first match kickoff unless overridden by `app_settings`.

### `app_settings`

Optional service-managed settings.

Columns:

- `key text primary key`
- `value jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Useful keys later:

- `tournament`: `{ "champion_lock_at": "2026-06-11T18:00:00Z" }`
- `scoring`: `{ "engine_version": 3 }`

### `audit_logs` Optional

Useful for score updates and admin/server actions.

Columns:

- `id bigserial primary key`
- `actor_id uuid`
- `action text not null`
- `table_name text`
- `row_pk jsonb`
- `old_data jsonb`
- `new_data jsonb`
- `created_at timestamptz not null default now()`

RLS:

- Enabled with no authenticated read/write policies by default.
- Service role only.

## Match Lock Rule

Current demo rule:

```text
lock_at = kickoff_at - 60 minutes
```

Production should enforce this in Postgres with RLS:

```sql
now() < matches.kickoff_at - interval '60 minutes'
```

This means even if a user modifies frontend code, inserts/updates/deletes after lock will fail at the database layer.

## Leaderboard Strategy

For a small 3-10 person game, the simplest safe production approach is:

1. Store official matches, predictions, and scores in Supabase.
2. Use RLS so users can only write their own unlocked predictions.
3. Use a SQL view or RPC to calculate leaderboard points from final scores.

Recommendation:

- Start with a SQL function plus a `leaderboard` view.
- Keep the scoring formula equivalent to the current app.
- Let authenticated users read the view.
- Do not store user-editable leaderboard totals as authoritative data.

Client-side leaderboard calculation can still be used during early production testing, but a database view/RPC is safer because the scoring source of truth is centralized.

## SQL Draft

This is a practical first draft for Supabase SQL Editor. Review names and seed data before applying.

```sql
-- Extensions
create extension if not exists pgcrypto;
create extension if not exists citext;

-- Updated-at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  display_name text not null,
  avatar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username::text ~ '^[a-z0-9_]{3,20}$')
);

create table if not exists public.matches (
  id integer primary key,
  group_code text,
  stage text not null default 'group',
  home_team text not null,
  away_team text not null,
  home_seeded boolean not null default false,
  away_seeded boolean not null default false,
  kickoff_at timestamptz not null,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scores (
  match_id integer primary key references public.matches(id) on delete cascade,
  home_score smallint not null default 0 check (home_score between 0 and 20),
  away_score smallint not null default 0 check (away_score between 0 and 20),
  status text not null default 'upcoming' check (status in ('upcoming','live','finished')),
  minute smallint not null default 0 check (minute between 0 and 130),
  source text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id integer not null references public.matches(id) on delete cascade,
  home_score smallint not null check (home_score between 0 and 20),
  away_score smallint not null check (away_score between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint predictions_one_per_user_match unique (user_id, match_id)
);

create table if not exists public.champion_picks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  team text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  table_name text,
  row_pk jsonb,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists matches_kickoff_at_idx on public.matches(kickoff_at);
create index if not exists matches_stage_idx on public.matches(stage);
create index if not exists predictions_user_id_idx on public.predictions(user_id);
create index if not exists predictions_match_id_idx on public.predictions(match_id);
create index if not exists predictions_user_match_idx on public.predictions(user_id, match_id);
create index if not exists scores_status_idx on public.scores(status);

-- Updated-at triggers
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

drop trigger if exists scores_set_updated_at on public.scores;
create trigger scores_set_updated_at
before update on public.scores
for each row execute function public.set_updated_at();

drop trigger if exists predictions_set_updated_at on public.predictions;
create trigger predictions_set_updated_at
before update on public.predictions
for each row execute function public.set_updated_at();

drop trigger if exists champion_picks_set_updated_at on public.champion_picks;
create trigger champion_picks_set_updated_at
before update on public.champion_picks
for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

-- Profile creation from Supabase Auth metadata
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_display_name text;
begin
  v_username := lower(coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'user_' || substring(new.id::text, 1, 8)));
  v_username := regexp_replace(v_username, '[^a-z0-9_]', '', 'g');

  if length(v_username) < 3 then
    v_username := 'user_' || substring(new.id::text, 1, 8);
  end if;

  if exists (select 1 from public.profiles where username = v_username::citext) then
    v_username := substring(v_username, 1, 13) || '_' || substring(new.id::text, 1, 6);
  end if;

  v_display_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'username', ''),
    'Oyuncu'
  );

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Lock helper functions
create or replace function public.is_match_prediction_open(p_match_id integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and now() < m.kickoff_at - interval '60 minutes'
  );
$$;

create or replace function public.is_match_prediction_locked(p_match_id integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and now() >= m.kickoff_at - interval '60 minutes'
  );
$$;

create or replace function public.is_champion_pick_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select now() < coalesce(
    (
      select nullif(value->>'champion_lock_at', '')::timestamptz
      from public.app_settings
      where key = 'tournament'
    ),
    (
      select min(kickoff_at) - interval '60 minutes'
      from public.matches
    )
  );
$$;

-- Scoring helper equivalent to current normal score prediction rules
create or replace function public.prediction_points(
  p_pred_home integer,
  p_pred_away integer,
  p_actual_home integer,
  p_actual_away integer,
  p_home_seeded boolean,
  p_away_seeded boolean
)
returns integer
language plpgsql
immutable
as $$
declare
  v_exact integer := 0;
  v_outcome integer := 0;
  v_pred_outcome text;
  v_actual_outcome text;
  v_winner_seeded boolean;
  v_loser_seeded boolean;
begin
  if p_pred_home = p_actual_home and p_pred_away = p_actual_away then
    v_exact := case
      when p_actual_home = 0 and p_actual_away = 0 then 4
      when (p_actual_home = 1 and p_actual_away = 0) or (p_actual_home = 0 and p_actual_away = 1) then 2
      when (p_actual_home = 2 and p_actual_away = 0) or (p_actual_home = 0 and p_actual_away = 2) then 3
      when (p_actual_home = 2 and p_actual_away = 1) or (p_actual_home = 1 and p_actual_away = 2) then 3
      when p_actual_home = 2 and p_actual_away = 2 then 4
      when (p_actual_home = 3 and p_actual_away = 0) or (p_actual_home = 0 and p_actual_away = 3) then 3
      when abs(p_actual_home - p_actual_away) >= 3 and (p_actual_home + p_actual_away) >= 4 then 5
      else 0
    end;
  end if;

  v_pred_outcome := case
    when p_pred_home = p_pred_away then 'D'
    when p_pred_home > p_pred_away then 'H'
    else 'A'
  end;

  v_actual_outcome := case
    when p_actual_home = p_actual_away then 'D'
    when p_actual_home > p_actual_away then 'H'
    else 'A'
  end;

  if v_pred_outcome = v_actual_outcome then
    if v_actual_outcome = 'D' then
      v_outcome := 2;
    else
      v_winner_seeded := case when v_actual_outcome = 'H' then p_home_seeded else p_away_seeded end;
      v_loser_seeded := case when v_actual_outcome = 'H' then p_away_seeded else p_home_seeded end;

      if not v_winner_seeded and v_loser_seeded then
        v_outcome := 3;
      else
        v_outcome := 1;
      end if;
    end if;
  end if;

  return v_exact + v_outcome;
end;
$$;

-- Leaderboard view. Keep security_invoker so RLS still applies.
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  p.id as user_id,
  p.username,
  p.display_name,
  coalesce(sum(public.prediction_points(
    pr.home_score,
    pr.away_score,
    s.home_score,
    s.away_score,
    m.home_seeded,
    m.away_seeded
  )), 0)::integer as total_points,
  count(*) filter (where pr.home_score = s.home_score and pr.away_score = s.away_score)::integer as exact_scores,
  count(*) filter (
    where
      case when pr.home_score = pr.away_score then 'D' when pr.home_score > pr.away_score then 'H' else 'A' end =
      case when s.home_score = s.away_score then 'D' when s.home_score > s.away_score then 'H' else 'A' end
  )::integer as correct_outcomes,
  count(*) filter (where s.status = 'finished')::integer as scored_matches
from public.profiles p
left join public.predictions pr on pr.user_id = p.id
left join public.matches m on m.id = pr.match_id
left join public.scores s on s.match_id = pr.match_id and s.status = 'finished'
group by p.id, p.username, p.display_name;

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.scores enable row level security;
alter table public.predictions enable row level security;
alter table public.champion_picks enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles policies
drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated
on public.profiles
for select
to authenticated
using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Matches are readable by authenticated users. Writes are service role only.
drop policy if exists matches_read_authenticated on public.matches;
create policy matches_read_authenticated
on public.matches
for select
to authenticated
using (true);

-- Scores are readable by authenticated users. Writes are service role/server only.
drop policy if exists scores_read_authenticated on public.scores;
create policy scores_read_authenticated
on public.scores
for select
to authenticated
using (true);

-- Predictions
drop policy if exists predictions_read_own_or_locked on public.predictions;
create policy predictions_read_own_or_locked
on public.predictions
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_match_prediction_locked(match_id)
);

drop policy if exists predictions_insert_own_before_lock on public.predictions;
create policy predictions_insert_own_before_lock
on public.predictions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_match_prediction_open(match_id)
);

drop policy if exists predictions_update_own_before_lock on public.predictions;
create policy predictions_update_own_before_lock
on public.predictions
for update
to authenticated
using (
  user_id = auth.uid()
  and public.is_match_prediction_open(match_id)
)
with check (
  user_id = auth.uid()
  and public.is_match_prediction_open(match_id)
);

drop policy if exists predictions_delete_own_before_lock on public.predictions;
create policy predictions_delete_own_before_lock
on public.predictions
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.is_match_prediction_open(match_id)
);

-- Champion picks
drop policy if exists champion_picks_read_own_or_locked on public.champion_picks;
create policy champion_picks_read_own_or_locked
on public.champion_picks
for select
to authenticated
using (
  user_id = auth.uid()
  or not public.is_champion_pick_open()
);

drop policy if exists champion_picks_insert_own_before_lock on public.champion_picks;
create policy champion_picks_insert_own_before_lock
on public.champion_picks
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_champion_pick_open()
);

drop policy if exists champion_picks_update_own_before_lock on public.champion_picks;
create policy champion_picks_update_own_before_lock
on public.champion_picks
for update
to authenticated
using (
  user_id = auth.uid()
  and public.is_champion_pick_open()
)
with check (
  user_id = auth.uid()
  and public.is_champion_pick_open()
);

drop policy if exists champion_picks_delete_own_before_lock on public.champion_picks;
create policy champion_picks_delete_own_before_lock
on public.champion_picks
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.is_champion_pick_open()
);

-- Settings are readable by authenticated users. Writes are service role/server only.
drop policy if exists app_settings_read_authenticated on public.app_settings;
create policy app_settings_read_authenticated
on public.app_settings
for select
to authenticated
using (true);

-- Audit logs intentionally have no authenticated policies.

-- Optional grants to keep profile updates scoped to public profile fields.
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_id) on public.profiles to authenticated;
```

## RLS Behavior Summary

- Profiles:
  - Authenticated users can read public profile rows.
  - Users can insert/update only their own profile.
  - Email/password are not in `profiles`.
- Matches:
  - Authenticated users can read.
  - Writes should be service role only.
- Scores:
  - Authenticated users can read.
  - Writes should be service role/server only.
- Predictions:
  - Users can read their own predictions.
  - Users can read other predictions only after that match is locked.
  - Users can insert/update/delete only their own prediction before lock.
  - Lock is enforced by `now() < kickoff_at - interval '60 minutes'`.
- Champion picks:
  - Users can read their own pick.
  - Users can read all picks only after champion pick lock.
  - Users can insert/update/delete only their own pick before champion lock.
- Audit logs:
  - No authenticated access by default.

## Server/Admin Score Updates

The API-Football key and Supabase service role key must remain server-side only.

Recommended flow later:

1. Existing server-side score fetcher calls API-Football with `API_FOOTBALL_KEY`.
2. The same trusted server writes final/live scores to Supabase using the service role key.
3. The frontend reads `matches`, `scores`, predictions, champion picks, and leaderboard with the public Supabase anon key plus RLS.

Do not expose the service role key in `index.html`.

## Security Notes

LocalStorage auth is not safe for production because:

- Users can edit localStorage manually.
- Password hashes stored in the browser can be copied or manipulated.
- There is no server-side identity proof.
- Data is browser-specific and not a secure shared source of truth.

Supabase Auth + RLS is safer because:

- Auth identity is represented by signed server-issued JWTs.
- RLS policies enforce ownership and lock rules inside Postgres.
- A modified frontend still cannot bypass database policies.
- Shared data is stored centrally and consistently.

API keys:

- API-Football key remains on the backend only.
- Supabase anon key may be used in the frontend with RLS.
- Supabase service role key must never be exposed to the frontend because it bypasses RLS.

## Open Decisions Before Implementation

- Use email/password only for the first production release, or add a username-login Edge Function later?
- Should other users' predictions become visible at match lock or only at kickoff? The draft uses match lock, matching the current reveal behavior direction.
- Should champion picks become visible after tournament lock or only after the tournament starts? The draft uses tournament lock.
- Should match seed status be stored as `home_seeded`/`away_seeded`, or should a separate `teams` table be added?
- Should the leaderboard be a view as drafted, or an RPC that returns exactly the frontend's current leaderboard shape?
- How should score updates be audited: lightweight `audit_logs`, server logs only, or both?
