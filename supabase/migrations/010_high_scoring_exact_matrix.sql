-- World Cup 2026 Prediction Game
-- Fix high-scoring non-draw exact-score matrix entries.
--
-- Safe to run after 009_leaderboard_tiebreak_sort.sql.
-- Replaces only the shared match-points function. It does not write stored
-- points, change tables, change RLS, or alter Champion/Golden Boot bonuses.

begin;

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
      when p_actual_home = 1 and p_actual_away = 1 then 3
      when p_actual_home = 2 and p_actual_away = 2 then 4
      when p_actual_home = 3 and p_actual_away = 3 then 5
      when p_actual_home = p_actual_away and p_actual_home >= 4 then 6
      when (p_actual_home = 1 and p_actual_away = 0) or (p_actual_home = 0 and p_actual_away = 1) then 2
      when (p_actual_home = 2 and p_actual_away = 0) or (p_actual_home = 0 and p_actual_away = 2) then 3
      when (p_actual_home = 2 and p_actual_away = 1) or (p_actual_home = 1 and p_actual_away = 2) then 3
      when (p_actual_home = 3 and p_actual_away = 0) or (p_actual_home = 0 and p_actual_away = 3) then 3
      when p_actual_home <> p_actual_away and (p_actual_home + p_actual_away) >= 4 then 5
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

grant execute on function public.prediction_points(
  integer,
  integer,
  integer,
  integer,
  boolean,
  boolean
) to authenticated;

commit;
