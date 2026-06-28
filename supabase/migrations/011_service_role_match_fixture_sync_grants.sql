-- World Cup 2026 Prediction Game
-- Patch: minimum service-role grants for trusted fixture sync.
--
-- Safe to run after 003_service_role_score_grants.sql.
--
-- Purpose:
-- server/sync-knockout-fixtures.js needs to insert and update safe fixture
-- metadata in public.matches after football-data.org publishes knockout
-- fixtures with real teams.
--
-- This migration intentionally does not:
-- - modify any rows
-- - grant delete on public.matches
-- - grant writes to public.scores, predictions, profiles, champion_picks,
--   golden_boot_picks, leaderboard, app_settings, or audit_logs
-- - change RLS policies
-- - include any credentials

begin;

grant usage on schema public to service_role;
grant select on public.matches to service_role;
grant insert on public.matches to service_role;
grant update on public.matches to service_role;

commit;
