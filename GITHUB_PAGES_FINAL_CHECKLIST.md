# GitHub Pages Final Publish Checklist

Use this immediately before publishing the World Cup 2026 prediction game to GitHub Pages. Do not deploy until every item that applies to your setup is checked.

## Pre-Push Safety

- [ ] `.env` is not committed.
- [ ] `.env.*` files are not committed, except `.env.example`.
- [ ] `config.local.js` is not committed.
- [ ] `server/.api-budget.json` is not committed.
- [ ] `server/.score-cache.json` is not committed.
- [ ] No Supabase service role key appears in frontend files.
- [ ] No API-Football key appears in frontend files.
- [ ] No passwords, private tokens, or server secrets are committed.
- [ ] `config.production.js`, if present, contains only frontend-safe values.

If `git` is available, run:

```bash
git status --ignored
git ls-files .env config.local.js server/.api-budget.json server/.score-cache.json
```

Expected: `.env`, `config.local.js`, and runtime cache/budget files should not be tracked.

## Supabase Setup

Apply SQL in this order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_fix_leaderboard_view.sql`
3. `supabase/migrations/003_service_role_score_grants.sql`
4. `supabase/seed/001_matches_seed.sql`

Then confirm:

- [ ] 72 matches exist.
- [ ] RLS is enabled.
- [ ] Auth/profile trigger works.
- [ ] Users can register with email/password.
- [ ] Profiles have correct username/display name values.
- [ ] Predictions lock correctly.
- [ ] Champion picks lock correctly.
- [ ] Leaderboard view works.
- [ ] Test `predictions`, `champion_picks`, and `scores` are cleaned before real play.

## Production Config

Create `config.production.js` from `config.production.example.js` only when ready to publish:

```js
window.WC2026_CONFIG = {
  APP_MODE: "production",
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "your_supabase_anon_or_publishable_key"
};
```

Safe in `config.production.js`:

- Supabase Project URL
- Supabase anon/publishable key
- `APP_MODE: "production"`

Never put these in `config.production.js`:

- Supabase service role key
- API-Football key
- `.env` values for server scripts
- passwords

`config.local.js` loads after `config.production.js`, so local testing can override deployed config without changing the public file.

## GitHub Pages Settings

In GitHub:

1. Open repository settings.
2. Go to `Pages`.
3. Choose `Deploy from a branch`.
4. Select the publish branch, usually `main`.
5. Select `/ (root)` if `index.html` is in the repo root.
6. Save and wait for the Pages URL.

GitHub Pages hosts only static frontend files. It cannot run the score updater or store server secrets.

## Score Updates

- [ ] API-Football key remains server-side only.
- [ ] Supabase service role key remains server-side only.
- [ ] `server/update-scores.js` runs only from a trusted server/local scheduled task/GitHub Actions secrets later.
- [ ] `server/set-score.js` is fallback only and runs server-side/local only.
- [ ] Score updates do not require daily redeploys.

## Post-Publish Smoke Test

Open the GitHub Pages URL and verify:

- [ ] Production Mode starts.
- [ ] Auth screen uses email/password.
- [ ] Register a test user.
- [ ] Confirm profile row appears in Supabase.
- [ ] Login/logout works.
- [ ] Matches load from Supabase.
- [ ] Scores read without crashing, even if empty.
- [ ] Save one prediction before lock.
- [ ] Confirm prediction row appears in Supabase.
- [ ] Select champion.
- [ ] Confirm champion row appears in Supabase.
- [ ] Leaderboard loads safely.
- [ ] Demo Mode still works locally after removing/renaming `config.local.js`.

Clean any post-publish smoke-test data before real play.

## Rollback

If the deployed site has a problem:

1. Disable GitHub Pages temporarily, or switch Pages back to a known-good branch.
2. Remove or fix `config.production.js` if config is the issue.
3. Revert the last public-safe commit if code is the issue.
4. Keep Supabase data intact unless the problem is bad test data.
5. Do not rotate keys unless a real secret was exposed.

If a service role key or API-Football key was exposed publicly, rotate that key immediately in the provider dashboard.

## Final Privacy Reminder

- Keep `.env` private.
- Keep `config.local.js` private.
- Keep service role and API-Football keys out of frontend files.
- Use only the Supabase anon/publishable key in browser config.
- Keep RLS enabled.
