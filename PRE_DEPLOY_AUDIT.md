# Pre-Deploy Security & Readiness Audit

Audit date: 2026-06-02

Scope: security, configuration, Supabase readiness, server scripts, deployment options, and cleanup steps before GitHub Pages or Netlify deployment. No deployment was performed.

## Current Status

Status: not ready for public deployment yet.

Private/local production testing is close, but public deployment should wait until the items below are resolved or explicitly accepted.

Highest-priority blockers:

1. Confirm ignored local secret files are not tracked by git.
2. Apply `supabase/migrations/002_fix_leaderboard_view.sql` if it has not already been applied.
3. Convert the manually tested `service_role` grants into a migration patch or document them as a required manual Supabase step.
4. Clean test users, predictions, champion picks, placeholder profiles, and test scores before real play.
5. Decide deployment config injection for Production Mode.

## Secret Exposure

Local secret-bearing files exist:

- `.env`
- `config.local.js`

These are expected for local testing, and `.gitignore` contains:

```text
.env
.env.*
!.env.example
config.local.js
```

Sanitized findings:

- `.env` contains server-only key names including `API_FOOTBALL_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
- `config.local.js` contains frontend production config names: `APP_MODE`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`.
- `config.local.js` does not mention `SUPABASE_SERVICE_ROLE_KEY` or `API_FOOTBALL_KEY`.
- `config.example.js` contains placeholders only.
- `.env.example` contains placeholders only.
- No service role key or API-Football key reference was found in `index.html` or `config.example.js`.

Important limitation: `git` is not available in this shell, so I could not run `git status` or `git ls-files`. Before deployment, run:

```powershell
git status --ignored
git ls-files .env config.local.js
```

Expected result: `.env` and `config.local.js` must not be tracked.

## Frontend Production Config

Frontend defaults:

- `APP_MODE` defaults to `demo` in `index.html`.
- `config.local.js` is optional and loaded before the app starts.
- If `config.local.js` is missing, the app falls back to Demo Mode.
- Production Mode requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Missing/placeholder Supabase config fails safely with a clear message.

Frontend-safe values:

- Supabase Project URL
- Supabase anon/public key
- `APP_MODE`

Forbidden frontend values:

- `SUPABASE_SERVICE_ROLE_KEY`
- `API_FOOTBALL_KEY`
- database passwords
- user passwords

Risk note: the frontend cannot technically prevent someone from pasting a service role key into the anon key slot. This must be controlled operationally: only use the Supabase anon/public key in frontend config.

## Supabase Readiness

Migration files:

- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_fix_leaderboard_view.sql`

Seed file:

- `supabase/seed/001_matches_seed.sql`

RLS status:

- RLS is enabled for `profiles`, `matches`, `scores`, `predictions`, `champion_picks`, `app_settings`, and `audit_logs`.
- Authenticated users can read matches/scores/leaderboard.
- Normal frontend users do not have insert/update/delete policies for `matches` or `scores`.
- Prediction and champion-pick writes are owner-only and lock-aware.
- `public.leaderboard` uses `security_invoker = true`.

Leaderboard patch:

- `002_fix_leaderboard_view.sql` fixes `scored_matches` / `correct_outcomes` parity for finished scores.
- Apply it before relying on production leaderboard totals.

Service role score-writer grants:

During testing, these grants were manually added:

```sql
grant usage on schema public to service_role;
grant select on public.matches to service_role;
grant select, insert, update on public.scores to service_role;
```

They are now represented in:

```text
supabase/migrations/003_service_role_score_grants.sql
```

Apply it after `002_fix_leaderboard_view.sql` in any fresh Supabase project. The migration grants only schema usage, match select, and score select/insert/update to `service_role`.

## Production Data Cleanup

Do not delete automatically. Review and clean in Supabase before real play:

- disposable/test auth users
- test rows in `profiles`
- placeholder usernames/display names such as `user_%` or `Oyuncu`
- test predictions
- test champion picks
- test score rows in `scores`

Useful review queries:

```sql
select id, username, display_name, created_at, updated_at
from public.profiles
order by created_at;
```

```sql
select user_id, match_id, home_score, away_score, created_at, updated_at
from public.predictions
order by updated_at desc;
```

```sql
select user_id, team, created_at, updated_at
from public.champion_picks
order by updated_at desc;
```

```sql
select *
from public.scores
order by updated_at desc;
```

```sql
select *
from public.profiles
where username like 'user_%'
   or display_name = 'Oyuncu';
```

Delete test auth users through Supabase Auth/admin tools, then remove related public rows if needed.

## Server Scripts

`server/update-scores.js`:

- Defaults to `DRY_RUN=1`.
- Defaults to mock fixtures in dry-run.
- Supports fixture discovery and league discovery.
- Real API calls require `MOCK_FIXTURES=0` and `API_FOOTBALL_KEY`.
- Supabase writes require `DRY_RUN=0`, non-mock mode, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Writes only to `public.scores`.
- Redacts service/API secrets in error messages.
- Uses `server/.api-budget.json`, which is gitignored.

`server/set-score.js`:

- Manual server-side score admin script.
- Dry-run prints local match and planned `public.scores` payload.
- Real write checks `public.matches` first.
- Upserts only `match_id`, `home_score`, `away_score`, `status`, and `minute`.
- Does not require API-Football key.
- Uses `SUPABASE_SERVICE_ROLE_KEY` only server-side.

`server/live-server.js`:

- Reads `API_FOOTBALL_KEY` from env.
- Has cache/budget controls.
- Should not be exposed publicly without rate limiting and CORS/access review.
- Static deployment does not need this server running in public.

Runtime files ignored by git:

- `server/.api-budget.json`
- `server/.score-cache.json`

## Deployment Options

### GitHub Pages + Supabase

Can do:

- host the static frontend
- use Supabase URL + anon/public key
- run Production Mode reads/writes allowed by RLS

Cannot do:

- safely store API-Football key
- safely store Supabase service role key
- run scheduled server-side score updates by itself

If using GitHub Pages, score updates need a separate trusted backend, local scheduled task, GitHub Actions with secrets, Cloudflare Worker, or another server-side process.

### Netlify + Supabase

Can do:

- host the static frontend
- inject frontend-safe config at build time
- later add Netlify Functions or Scheduled Functions for score updates

Still must not expose:

- `SUPABASE_SERVICE_ROLE_KEY`
- `API_FOOTBALL_KEY`

Recommendation: Netlify + Supabase is the smoother path if you want one hosting platform that can later support scheduled score ingestion. GitHub Pages is fine for static hosting only, but it still needs a separate backend path for scores.

Daily redeploys are not needed. Match scores should be written to Supabase by a server-side process; the frontend should read from Supabase.

## Required Fixes Before Deployment

Public deployment blockers:

- Verify `.env` and `config.local.js` are not tracked by git.
- Apply `002_fix_leaderboard_view.sql`.
- Apply `003_service_role_score_grants.sql` after `002_fix_leaderboard_view.sql`.
- Clean test data in Supabase.
- Decide how Production Mode config is injected for the deployed site.
- Confirm RLS checklist against the real Supabase project after all migrations.

Warnings:

- Do not expose `server/live-server.js` publicly without access/rate-limit review.
- Do not run API-Football polling from the browser.
- Do not place service role/API-Football keys in Netlify public env, GitHub Pages, `index.html`, or `config.local.js`.
- Confirm `matches.home_seeded` / `away_seeded` match frontend seeded-team logic before relying on underdog scoring.

## Safe Deployment Checklist

Before static deployment:

- [ ] `git ls-files .env config.local.js` returns no files.
- [ ] `config.example.js` contains placeholders only.
- [ ] `APP_MODE` default remains `demo`.
- [ ] Production config uses only Supabase URL + anon key.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- [ ] `API_FOOTBALL_KEY` is server-only.
- [ ] Migrations `001` and `002` are applied.
- [ ] Service role grants are reproducible.
- [ ] Seed has 72 matches.
- [ ] RLS tests pass.
- [ ] Test users/predictions/champion picks/scores are cleaned.
- [ ] Manual score dry-run is tested.
- [ ] One controlled real score write is tested in Supabase before match day.

Recommended next step: apply migrations `001`, `002`, and `003` in order, then run the cleanup/revalidation SQL in Supabase.
