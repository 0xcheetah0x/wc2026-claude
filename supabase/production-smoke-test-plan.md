# Production Smoke Test Plan

Use this plan to test Supabase-powered Production Mode locally before deploying anything.

This guide is documentation only. Do not commit real credentials, do not create production users in repo files, and do not use the service role key in the frontend.

## 1. Prerequisites

Before starting:

- `supabase/migrations/001_initial_schema.sql` has been run in Supabase.
- `supabase/seed/001_matches_seed.sql` has been run after the migration.
- `public.matches` contains exactly 72 rows.
- The Supabase Auth `profiles` trigger has already been tested.
- You have the Project URL from Supabase Dashboard.
- You have the anon public key from Supabase Dashboard.
- You are not using the service role key in frontend code.

Quick Supabase SQL checks:

```sql
select count(*) as match_count from public.matches;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'matches', 'scores', 'predictions', 'champion_picks');
```

Expected:

- `match_count = 72`
- all listed tables exist

## 2. Create Local Config

### Find Supabase Values

In Supabase:

1. Open your project.
2. Go to `Project Settings -> API`.
3. Copy `Project URL`.
4. Copy the `anon public` key.
5. Do not copy or use the `service_role` key in frontend config.

Copy the safe example config:

```text
config.example.js -> config.local.js
```

Edit `config.local.js` locally:

```js
window.WC2026_CONFIG = {
  APP_MODE: "production",
  SUPABASE_URL: "YOUR_PROJECT_URL",
  SUPABASE_ANON_KEY: "YOUR_ANON_PUBLIC_KEY"
};
```

Important:

- Do not commit `config.local.js`.
- Do not paste the service role key.
- Do not paste the API-Football key.
- The Supabase anon key is allowed in frontend code, but RLS must remain enabled.
- `config.local.js` is already listed in `.gitignore`.

After testing, you can remove `config.local.js` or set `APP_MODE` back to `"demo"`.

To return to Demo Mode:

- Delete `config.local.js`, or
- Rename `config.local.js`, or
- Set `APP_MODE: "demo"` in `config.local.js`.

## 3. Local Preview Steps

Use a local static server. Do not deploy for this smoke test.

From the project root:

```text
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/index.html
```

If Python is not available, any simple static server is fine, for example an editor preview server or a Node static server. Avoid opening `index.html` directly from `file://` for production testing because browser behavior around modules, fetches, and local scripts can differ.

Expected first signal:

- With `APP_MODE: "production"` and valid Supabase config, the auth screen should use Production Mode behavior.
- With missing config, the app should fail safely with a clear config message.
- With no `config.local.js`, the app should remain in Demo Mode.

## 4. Production Smoke Tests

Quick checklist:

- Open the app locally.
- Confirm Production Mode starts.
- Register a disposable test user.
- Confirm a profile row appears in Supabase.
- Confirm matches load.
- Save one prediction.
- Confirm the prediction row appears in Supabase.
- Select a champion.
- Confirm the champion row appears in Supabase.
- Check leaderboard does not crash.

### Auth

- Production login screen uses email/password.
- Register a new disposable test user.
- Confirm a row appears in Supabase `profiles`.
- Logout.
- Login again with the same email/password.
- Password reset uses Supabase email recovery or shows a safe email-reset message.
- Production mode does not show or use local security-question reset.

Supabase checks:

```sql
select id, username, display_name, avatar_id, created_at
from public.profiles
order by created_at desc
limit 5;
```

### Matches And Scores

- Matches load from Supabase.
- 72 matches are available in the app.
- Scores read does not crash if `scores` is empty.
- Empty scores are normal before score ingestion is implemented.

Supabase checks:

```sql
select count(*) from public.matches;
select count(*) from public.scores;
```

### Predictions

- Save a prediction before lock.
- Confirm a row appears in `predictions`.
- Edit the prediction before lock.
- Confirm `home_score` / `away_score` update in Supabase.
- Delete prediction before lock only if the UI supports delete.
- If you can safely test a locked match, confirm the write fails with a friendly lock/RLS message.

Supabase checks:

```sql
select user_id, match_id, home_score, away_score, created_at, updated_at
from public.predictions
order by updated_at desc
limit 10;
```

Notes:

- Frontend writes must use the logged-in user's Supabase UUID.
- RLS should reject writes for other users or locked matches.

### Champion Pick

- Select a champion team.
- Confirm a row appears in `champion_picks`.
- Edit the champion pick before champion lock if allowed.
- If champion lock is already closed, the write should fail safely.

Supabase checks:

```sql
select user_id, team, created_at, updated_at
from public.champion_picks
order by updated_at desc
limit 10;
```

### Leaderboard

- Leaderboard loads from Supabase `leaderboard` view.
- Empty or zero leaderboard state is handled safely before finished scores exist.
- After test scores/predictions are added later, scoring parity should be checked against frontend rules.

Supabase checks:

```sql
select *
from public.leaderboard
order by total_points desc, username
limit 10;
```

Parity reminder:

- SQL leaderboard scoring must stay aligned with frontend `ruleScorePoints`, `ruleOutcomePoints`, and `ruleMatchPoints`.

### Demo Fallback

- Remove `config.local.js`, or change `APP_MODE` to `"demo"`.
- Refresh the local app.
- Confirm Demo Mode still works.
- Confirm demo login/register/password reset still use browser-local data.
- Confirm demo predictions and champion picks still use localStorage.

## 5. Supabase Dashboard Checks

Inspect these tables/views during the smoke test:

- `profiles`
- `matches`
- `scores`
- `predictions`
- `champion_picks`
- `leaderboard` view

Recommended checks:

- `profiles`: new test user profile exists.
- `matches`: 72 rows exist.
- `scores`: may be empty by design.
- `predictions`: current user's prediction rows appear.
- `champion_picks`: current user's champion pick appears.
- `leaderboard`: readable by authenticated users.

## 6. Troubleshooting

### Missing Config

Symptoms:

- Production Mode shows a missing Supabase config message.
- App stays in Demo Mode when you expected Production Mode.

Check:

- `config.local.js` exists in the project root.
- It defines `window.WC2026_CONFIG`.
- `APP_MODE` is exactly `"production"`.
- The local server is serving the latest file.

### Wrong Anon Key

Symptoms:

- Login/register fails.
- Supabase reads return 401/403.

Check:

- You used the `anon public` key, not service role.
- The Project URL matches the same Supabase project as the anon key.

### RLS Blocking Writes

Symptoms:

- Prediction or champion save fails.
- Error mentions permission, RLS, or lock.

Check:

- You are logged in.
- The row `user_id` is your authenticated user UUID.
- The match is before prediction lock.
- Champion lock is still open.
- RLS policies are enabled and unchanged.

### Email Confirmation Blocking Login

Symptoms:

- Register succeeds but login fails.
- Supabase says email is not confirmed.

Check:

- Supabase Auth email confirmation setting.
- For private testing, email confirmation can be disabled temporarily.
- If enabled, confirm the test email before logging in.

### CORS Or Origin Issues

Symptoms:

- Browser console shows blocked requests.
- Supabase requests fail before reaching Auth/RLS.

Check:

- You are using `http://127.0.0.1:8000` or another local static server.
- Supabase project settings allow the local site URL if required.
- Avoid `file://` for this smoke test.

### `config.local.js` Not Loaded

Symptoms:

- App behaves as Demo Mode.
- Production config values are ignored.

Check:

- `config.local.js` is in the project root next to `index.html`.
- The file has no syntax errors.
- Browser cache is cleared or hard-refreshed.
- DevTools Network tab shows `config.local.js` loaded successfully.

### Leaderboard Empty

Symptoms:

- Leaderboard shows empty/zero data.

Common causes:

- There are no finished scores yet.
- There are no predictions for finished matches.
- The `scores` table is empty by design.
- RLS/authenticated read failed.

### Scores Table Empty

This is expected before the production score updater exists.

Do not redeploy the site just to update scores. Scores should later be updated by server/API/database logic, not by rebuilding the frontend.

## 7. Security Reminders

- Never share the Supabase service role key.
- Never commit `config.local.js`.
- Never put `API_FOOTBALL_KEY` in frontend code.
- Keep RLS enabled.
- Use disposable test users first.
- Use the anon public key only for frontend Supabase access.
- Keep service-role score updates for a future trusted server-side process.

## 8. After The Smoke Test

Before returning to normal local work:

- Remove `config.local.js`, or set `APP_MODE` back to `"demo"`.
- Confirm Demo Mode opens without Supabase.
- Keep any test users/rows in Supabase only if they are useful for later testing.
- Do not commit screenshots or logs containing keys.
