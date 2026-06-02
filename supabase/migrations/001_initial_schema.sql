-- World Cup 2026 Prediction Game
-- Initial Supabase production schema draft.
--
-- Review before running in Supabase. This migration intentionally contains:
-- - no API keys
-- - no service role keys
-- - no predefined users
-- - no user emails or passwords

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  display_name text not null,
  avatar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username::text ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_not_blank check (length(btrim(display_name)) > 0)
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
  updated_at timestamptz not null default now(),
  constraint matches_teams_different check (home_team <> away_team),
  constraint matches_stage_not_blank check (length(btrim(stage)) > 0)
);

create table if not exists public.scores (
  match_id integer primary key references public.matches(id) on delete cascade,
  home_score smallint not null default 0 check (home_score between 0 and 20),
  away_score smallint not null default 0 check (away_score between 0 and 20),
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'finished')),
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
  updated_at timestamptz not null default now(),
  constraint champion_picks_team_not_blank check (length(btrim(team)) > 0)
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_settings_key_not_blank check (length(btrim(key)) > 0)
);

-- Optional service/admin audit table. No authenticated policies are added below.
create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  table_name text,
  row_pk jsonb,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (length(btrim(action)) > 0)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists matches_kickoff_at_idx on public.matches(kickoff_at);
create index if not exists matches_stage_idx on public.matches(stage);
create index if not exists scores_status_idx on public.scores(status);
create index if not exists predictions_user_id_idx on public.predictions(user_id);
create index if not exists predictions_match_id_idx on public.predictions(match_id);
create index if not exists predictions_user_match_idx on public.predictions(user_id, match_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Supabase Auth profile bootstrap
-- ---------------------------------------------------------------------------
-- Users self-register through Supabase Auth. This trigger creates a public
-- profile from signup metadata without predefining any users.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_display_name text;
  v_user_suffix text;
begin
  v_user_suffix := substring(replace(new.id::text, '-', ''), 1, 8);
  v_username := lower(coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'user_' || v_user_suffix));
  v_username := regexp_replace(v_username, '[^a-z0-9_]', '', 'g');
  v_username := substring(v_username, 1, 20);

  if length(v_username) < 3 then
    v_username := 'user_' || v_user_suffix;
  end if;

  if exists (select 1 from public.profiles where username = v_username::citext) then
    v_username := substring(v_username, 1, 13) || '_' || substring(replace(new.id::text, '-', ''), 1, 6);
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

-- ---------------------------------------------------------------------------
-- Lock helpers
-- ---------------------------------------------------------------------------

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

create or replace function public.champion_lock_at()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
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

create or replace function public.is_champion_pick_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(now() < public.champion_lock_at(), false);
$$;

-- ---------------------------------------------------------------------------
-- Scoring helper and simple leaderboard
-- ---------------------------------------------------------------------------
-- This mirrors the current normal score prediction rules. Event-based rules
-- are intentionally not included.

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
strict
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
  count(*) filter (
    where pr.home_score = s.home_score
      and pr.away_score = s.away_score
  )::integer as exact_scores,
  count(*) filter (
    where
      case
        when pr.home_score = pr.away_score then 'D'
        when pr.home_score > pr.away_score then 'H'
        else 'A'
      end =
      case
        when s.home_score = s.away_score then 'D'
        when s.home_score > s.away_score then 'H'
        else 'A'
      end
  )::integer as correct_outcomes,
  count(*) filter (where s.status = 'finished')::integer as scored_matches
from public.profiles p
left join public.predictions pr on pr.user_id = p.id
left join public.matches m on m.id = pr.match_id
left join public.scores s on s.match_id = pr.match_id and s.status = 'finished'
group by p.id, p.username, p.display_name;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.scores enable row level security;
alter table public.predictions enable row level security;
alter table public.champion_picks enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: authenticated users can read public profile data. Users can
-- create/update only their own profile row.

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

-- Matches: authenticated users can read. Normal frontend users cannot write
-- because there are no insert/update/delete policies.

drop policy if exists matches_read_authenticated on public.matches;
create policy matches_read_authenticated
on public.matches
for select
to authenticated
using (true);

-- Scores: authenticated users can read. Server/service role updates scores
-- through a trusted backend and bypasses RLS; normal frontend users cannot write.

drop policy if exists scores_read_authenticated on public.scores;
create policy scores_read_authenticated
on public.scores
for select
to authenticated
using (true);

-- Predictions: users can manage only their own prediction before match lock.
-- Other users' predictions become readable after the match locks.

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

-- Champion picks: users can manage only their own pick before tournament lock.
-- All champion picks become readable after the champion lock.

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

-- Settings: authenticated users can read. Server/service role manages writes.

drop policy if exists app_settings_read_authenticated on public.app_settings;
create policy app_settings_read_authenticated
on public.app_settings
for select
to authenticated
using (true);

-- audit_logs intentionally has no authenticated policies.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- RLS is the primary protection, but these grants keep the normal frontend role
-- focused on the operations it should perform. Service role bypasses RLS and is
-- used only from trusted server-side code.

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.matches from anon, authenticated;
revoke all on table public.scores from anon, authenticated;
revoke all on table public.predictions from anon, authenticated;
revoke all on table public.champion_picks from anon, authenticated;
revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;
revoke all on table public.leaderboard from anon, authenticated;

grant select on table public.profiles to authenticated;
grant insert on table public.profiles to authenticated;
grant update (username, display_name, avatar_id) on table public.profiles to authenticated;

grant select on table public.matches to authenticated;
grant select on table public.scores to authenticated;
grant select on table public.predictions to authenticated;
grant insert on table public.predictions to authenticated;
grant update (home_score, away_score) on table public.predictions to authenticated;
grant delete on table public.predictions to authenticated;

grant select on table public.champion_picks to authenticated;
grant insert on table public.champion_picks to authenticated;
grant update (team) on table public.champion_picks to authenticated;
grant delete on table public.champion_picks to authenticated;

grant select on table public.app_settings to authenticated;
grant select on table public.leaderboard to authenticated;

grant execute on function public.is_match_prediction_open(integer) to authenticated;
grant execute on function public.is_match_prediction_locked(integer) to authenticated;
grant execute on function public.champion_lock_at() to authenticated;
grant execute on function public.is_champion_pick_open() to authenticated;
grant execute on function public.prediction_points(integer, integer, integer, integer, boolean, boolean) to authenticated;

-- Optional: keep anon completely read-only/no-access for the game until the
-- production frontend explicitly supports public pages.
