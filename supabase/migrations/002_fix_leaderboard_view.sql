-- World Cup 2026 Prediction Game
-- Patch: leaderboard view scoring/counter parity.
--
-- Safe to run after 001_initial_schema.sql.
-- This migration changes only public.leaderboard. It does not modify tables,
-- data, RLS policies, predictions, scores, profiles, or scoring inputs.
--
-- Why:
-- The original view left-joined finished scores, but correct_outcomes compared
-- CASE expressions even when no finished score row existed. Because NULL score
-- comparisons fell through to the ELSE branch, some non-evaluated predictions
-- could be counted as away outcomes. This patch aggregates only predictions
-- joined to finished scores.

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
)
select
  p.id as user_id,
  p.username,
  p.display_name,
  coalesce(sum(ep.points), 0)::integer as total_points,
  count(*) filter (where ep.is_exact_score)::integer as exact_scores,
  count(*) filter (where ep.is_correct_outcome)::integer as correct_outcomes,
  count(ep.match_id)::integer as scored_matches
from public.profiles p
left join evaluated_predictions ep on ep.user_id = p.id
group by p.id, p.username, p.display_name;

grant select on table public.leaderboard to authenticated;

-- Manual validation queries to run after applying:
--
-- 1) Inspect predictions evaluated against finished scores for one match:
-- select
--   pr.user_id,
--   p.username,
--   pr.match_id,
--   pr.home_score as predicted_home,
--   pr.away_score as predicted_away,
--   s.home_score as actual_home,
--   s.away_score as actual_away,
--   s.status,
--   public.prediction_points(
--     pr.home_score,
--     pr.away_score,
--     s.home_score,
--     s.away_score,
--     m.home_seeded,
--     m.away_seeded
--   ) as points
-- from public.predictions pr
-- join public.profiles p on p.id = pr.user_id
-- join public.matches m on m.id = pr.match_id
-- join public.scores s on s.match_id = pr.match_id and s.status = 'finished'
-- where pr.match_id = 1
-- order by p.username;
--
-- 2) Check leaderboard after one finished score:
-- select username, total_points, exact_scores, correct_outcomes, scored_matches
-- from public.leaderboard
-- order by total_points desc, username asc;
--
-- Expected:
-- - exact score: scored_matches +1, exact_scores +1, correct_outcomes +1,
--   total_points adds exact-score points plus outcome points.
-- - correct outcome but wrong score: scored_matches +1, correct_outcomes +1,
--   exact_scores unchanged, total_points adds outcome points only.
-- - wrong prediction: scored_matches +1, total_points may remain 0.

commit;
