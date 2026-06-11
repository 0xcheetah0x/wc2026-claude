-- World Cup 2026 Prediction Game
-- Golden Boot (Gol Kralı) picks, RLS, scoring helpers, and leaderboard bonus.
--
-- Safe to run after 001_initial_schema.sql and 002_fix_leaderboard_view.sql.
-- Reuses champion lock timing (is_champion_pick_open / champion_lock_at).
-- Does not modify match scoring, champion picks, or prediction lock rules.

begin;

-- ---------------------------------------------------------------------------
-- Golden Boot picks table
-- ---------------------------------------------------------------------------

create table if not exists public.golden_boot_picks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  player_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golden_boot_picks_player_name_not_blank check (length(btrim(player_name)) > 0)
);

drop trigger if exists golden_boot_picks_set_updated_at on public.golden_boot_picks;
create trigger golden_boot_picks_set_updated_at
before update on public.golden_boot_picks
for each row execute function public.set_updated_at();

alter table public.golden_boot_picks enable row level security;

-- ---------------------------------------------------------------------------
-- Official winner + scoring helpers
-- ---------------------------------------------------------------------------
-- Official winner is stored manually in app_settings.tournament.golden_boot_winner
-- (service-role admin script). No automatic provider dependency.

create or replace function public.normalize_golden_boot_name(p_name text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

create or replace function public.tournament_golden_boot_winner()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(value->>'golden_boot_winner'), '')
  from public.app_settings
  where key = 'tournament';
$$;

create or replace function public.golden_boot_bonus_points(p_pick text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.tournament_golden_boot_winner() is null then 0
    when public.normalize_golden_boot_name(p_pick)
      = public.normalize_golden_boot_name(public.tournament_golden_boot_winner()) then 3
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- Leaderboard view: match points + Golden Boot bonus (+3 when correct)
-- ---------------------------------------------------------------------------

create or replace view public.leaderboard
with (security_invoker = true)
as
with evaluated_predictions as (
  select
    pr.user_id,
    pr.match_id,
    pr.home_score as predicted_home_score,
    pr.away_score as predicted_away_score,
    s.home_score as actual_home_score,
    s.away_score as actual_away_score,
    public.prediction_points(
      pr.home_score,
      pr.away_score,
      s.home_score,
      s.away_score,
      m.home_seeded,
      m.away_seeded
    ) as points,
    (
      pr.home_score = s.home_score
      and pr.away_score = s.away_score
    ) as is_exact_score,
    (
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
    ) as is_correct_outcome
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  join public.scores s
    on s.match_id = pr.match_id
   and s.status = 'finished'
),
match_totals as (
  select
    p.id as user_id,
    p.username,
    p.display_name,
    coalesce(sum(ep.points), 0)::integer as match_points,
    count(*) filter (where ep.is_exact_score)::integer as exact_scores,
    count(*) filter (where ep.is_correct_outcome)::integer as correct_outcomes,
    count(ep.match_id)::integer as scored_matches
  from public.profiles p
  left join evaluated_predictions ep on ep.user_id = p.id
  group by p.id, p.username, p.display_name
)
select
  mt.user_id,
  mt.username,
  mt.display_name,
  (
    mt.match_points
    + coalesce(public.golden_boot_bonus_points(gb.player_name), 0)
  )::integer as total_points,
  mt.exact_scores,
  mt.correct_outcomes,
  mt.scored_matches
from match_totals mt
left join public.golden_boot_picks gb on gb.user_id = mt.user_id;

grant select on table public.leaderboard to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: same lock/visibility model as champion_picks
-- ---------------------------------------------------------------------------

drop policy if exists golden_boot_picks_read_own_or_locked on public.golden_boot_picks;
create policy golden_boot_picks_read_own_or_locked
on public.golden_boot_picks
for select
to authenticated
using (
  user_id = auth.uid()
  or not public.is_champion_pick_open()
);

drop policy if exists golden_boot_picks_insert_own_before_lock on public.golden_boot_picks;
create policy golden_boot_picks_insert_own_before_lock
on public.golden_boot_picks
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_champion_pick_open()
);

drop policy if exists golden_boot_picks_update_own_before_lock on public.golden_boot_picks;
create policy golden_boot_picks_update_own_before_lock
on public.golden_boot_picks
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

drop policy if exists golden_boot_picks_delete_own_before_lock on public.golden_boot_picks;
create policy golden_boot_picks_delete_own_before_lock
on public.golden_boot_picks
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.is_champion_pick_open()
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on table public.golden_boot_picks from anon, authenticated;

grant select on table public.golden_boot_picks to authenticated;
grant insert on table public.golden_boot_picks to authenticated;
grant update (player_name) on table public.golden_boot_picks to authenticated;
grant delete on table public.golden_boot_picks to authenticated;

grant execute on function public.normalize_golden_boot_name(text) to authenticated;
grant execute on function public.tournament_golden_boot_winner() to authenticated;
grant execute on function public.golden_boot_bonus_points(text) to authenticated;

-- Service role admin script can update tournament settings (official winner).
grant select, update on table public.app_settings to service_role;

commit;
