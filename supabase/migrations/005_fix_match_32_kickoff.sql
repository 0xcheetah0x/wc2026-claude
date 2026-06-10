-- Correct the Brazil vs Haiti kickoff timestamp.
-- Data-only migration: no schema, score, prediction, or scoring-rule changes.

begin;

update public.matches
set kickoff_at = '2026-06-20T00:30:00Z'::timestamptz
where id = 32;

commit;

select id, home_team, away_team, kickoff_at
from public.matches
where id = 32;
