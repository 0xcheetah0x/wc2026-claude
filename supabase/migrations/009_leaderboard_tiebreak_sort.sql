-- World Cup 2026 Prediction Game
-- Add the hidden high-scoring exact-hit leaderboard tie-break metric.
--
-- Safe to run after 008_exact_draw_score_matrix.sql.
-- This replaces only public.leaderboard. It does not write production data,
-- change scoring rules, or alter the existing RLS model.

begin;

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
    count(ep.match_id)::integer as scored_matches,
    coalesce(
      sum(ep.actual_home_score + ep.actual_away_score)
        filter (where ep.is_exact_score),
      0
    )::integer as exact_score_goal_total_tiebreak
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
  mt.scored_matches,
  mt.exact_score_goal_total_tiebreak
from match_totals mt
left join public.champion_picks cp on cp.user_id = mt.user_id
left join public.golden_boot_picks gb on gb.user_id = mt.user_id;

grant select on table public.leaderboard to authenticated;

commit;
