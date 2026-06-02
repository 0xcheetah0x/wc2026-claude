-- World Cup 2026 Prediction Game
-- Patch: minimum service-role grants for trusted server-side score writers.
--
-- Safe to run after:
-- 1. supabase/migrations/001_initial_schema.sql
-- 2. supabase/migrations/002_fix_leaderboard_view.sql
--
-- Purpose:
-- Server-side scripts such as server/set-score.js and the future score updater
-- need to read public.matches and upsert public.scores using the Supabase
-- service_role key. This migration captures the manual grants tested in
-- Supabase SQL Editor.
--
-- This migration intentionally does not:
-- - grant delete on public.scores
-- - grant writes to public.matches
-- - grant access to predictions, profiles, champion_picks, leaderboard, or audit_logs
-- - change or weaken RLS policies
-- - include any credentials

begin;

grant usage on schema public to service_role;
grant select on public.matches to service_role;
grant select, insert, update on public.scores to service_role;

commit;
