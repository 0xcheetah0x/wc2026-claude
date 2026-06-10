-- Correct four World Cup 2026 kickoff timestamps.
-- Data-only migration: no schema, score, prediction, or scoring-rule changes.

begin;

update public.matches as m
set kickoff_at = corrected.kickoff_at
from (
  values
    (5,  '2026-06-14T04:00:00Z'::timestamptz),
    (20, '2026-06-17T04:00:00Z'::timestamptz),
    (29, '2026-06-20T03:00:00Z'::timestamptz),
    (33, '2026-06-21T04:00:00Z'::timestamptz)
) as corrected(id, kickoff_at)
where m.id = corrected.id;

commit;

select id, home_team, away_team, kickoff_at
from public.matches
where id in (5, 20, 29, 33)
order by id;
