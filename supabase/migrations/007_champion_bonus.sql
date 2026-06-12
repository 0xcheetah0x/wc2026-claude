-- World Cup 2026 Prediction Game
-- Champion prediction scoring helpers and leaderboard bonus.
--
-- Safe to run after 006_golden_boot_picks.sql.
-- Does not modify match scoring, Golden Boot scoring, pick locks, or RLS.

begin;

-- ---------------------------------------------------------------------------
-- Official Champion winner + scoring helpers
-- ---------------------------------------------------------------------------
-- Official winner is stored manually in app_settings.tournament.champion_winner
-- (service-role admin script). No automatic provider dependency.

create or replace function public.normalize_champion_team(p_team text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(coalesce(p_team, ''), '\s+', ' ', 'g')));
$$;

create or replace function public.tournament_champion_winner()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(value->>'champion_winner'), '')
  from public.app_settings
  where key = 'tournament';
$$;

create or replace function public.champion_bonus_points(p_pick text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.tournament_champion_winner() is null then 0
    when public.is_champion_pick_open() then 0
    when public.normalize_champion_team(p_pick)
      = public.normalize_champion_team(public.tournament_champion_winner()) then 5
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- Leaderboard view: match points + Champion (+5) + Golden Boot (+3)
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
    + coalesce(public.champion_bonus_points(cp.team), 0)
    + coalesce(public.golden_boot_bonus_points(gb.player_name), 0)
  )::integer as total_points,
  mt.exact_scores,
  mt.correct_outcomes,
  mt.scored_matches
from match_totals mt
left join public.champion_picks cp on cp.user_id = mt.user_id
left join public.golden_boot_picks gb on gb.user_id = mt.user_id;

grant select on table public.leaderboard to authenticated;

grant execute on function public.normalize_champion_team(text) to authenticated;
grant execute on function public.tournament_champion_winner() to authenticated;
grant execute on function public.champion_bonus_points(text) to authenticated;

-- Service-role admin script can preserve/update tournament settings.
grant select, insert, update on table public.app_settings to service_role;

commit;
