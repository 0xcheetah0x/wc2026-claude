# GitHub Pages Deployment Guide

This guide prepares the static frontend for GitHub Pages. It does not deploy anything and does not change how scores are updated.

## Hosting Model

GitHub Pages will host only the static frontend:

- `index.html`
- frontend assets such as `avatar/`, `intro/`, and images
- public-safe frontend config

GitHub Pages cannot safely run server-side jobs or keep server secrets. The API-Football updater and manual score fallback must run somewhere trusted outside the browser.

## Config Files

Demo Mode remains the default when no config file is loaded.

The app now loads config in this effective priority:

1. built-in Demo Mode defaults
2. `config.production.js` if present
3. `config.local.js` if present

`config.local.js` loads last so your private local testing config can override the production config on your machine.

Use these files:

- `config.example.js`: local/demo example.
- `config.production.example.js`: public-safe production example.
- `config.production.js`: recommended actual GitHub Pages production config filename.
- `config.local.js`: private local testing config, already ignored by git.

## Production Config

Create `config.production.js` from `config.production.example.js` when you are ready:

```js
window.WC2026_CONFIG = {
  APP_MODE: "production",
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "your_supabase_anon_or_publishable_key"
};
```

`config.production.js` will be public if committed and deployed. That is acceptable only when it contains frontend-safe values:

- Supabase Project URL
- Supabase anon/publishable key
- `APP_MODE: "production"`

Never put these in `config.production.js`, `config.local.js`, `index.html`, or any frontend file:

- Supabase service role key
- API-Football key
- `.env` values used by server scripts
- passwords

The anon/publishable key is allowed in frontend code because Supabase RLS controls what users can read and write.

## GitHub Pages Setup

In GitHub:

1. Open the repository.
2. Go to `Settings -> Pages`.
3. Under `Build and deployment`, choose the source you want to use.
4. For a simple static deploy, choose `Deploy from a branch`.
5. Select the deployment branch, usually `main`.
6. Select the folder that contains `index.html`, usually `/ (root)`.
7. Save and wait for GitHub Pages to publish the site URL.

Commit the static app files and docs you need for the site. Include `config.production.js` only after you have verified it contains no server secrets.

## Files To Commit

Usually safe to commit:

- `index.html`
- `config.example.js`
- `config.production.example.js`
- `config.production.js` only with Supabase URL plus anon/publishable key
- `avatar/`
- `intro/`
- public image assets
- Supabase docs and migration files

Do not commit:

- `.env`
- `.env.*` files except `.env.example`
- `config.local.js`
- Supabase service role key
- API-Football key
- passwords or private tokens

## How Players Use The Site

After Production Mode is configured and deployed:

1. Friends open the GitHub Pages link.
2. They register with email/password.
3. They set username/display name through the app profile flow.
4. They log in.
5. They submit predictions and champion picks before locks.
6. Leaderboard reads from Supabase.

## Score Updates

GitHub Pages only serves static files.

It cannot run:

- `server/update-scores.js`
- `server/set-score.js`
- API-Football polling
- Supabase service-role writes

Automatic score updates must run somewhere server-side, for example:

- your local machine with a scheduled task
- GitHub Actions with repository secrets later
- a trusted server or cron process
- another secure backend or worker

Manual `server/set-score.js` is a fallback only and must run locally or on a trusted server with `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

Daily redeploys are not needed for score updates. Deploy only when code or public static config changes. Scores should update through server/API/database logic, not by rebuilding the site.

## Supabase Before Deploy

Apply migrations in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_fix_leaderboard_view.sql`
3. `supabase/migrations/003_service_role_score_grants.sql`
4. `supabase/seed/001_matches_seed.sql`

Then confirm:

- 72 matches exist.
- RLS is enabled.
- Auth/profile trigger works.
- `leaderboard` view works.
- Test data has been cleaned or intentionally kept.

## Security Checklist

- [ ] `.env` is not committed.
- [ ] `config.local.js` is not committed.
- [ ] `config.production.js` contains only Supabase URL and anon/publishable key.
- [ ] Supabase service role key is not in frontend files.
- [ ] API-Football key is not in frontend files.
- [ ] Supabase RLS is enabled.
- [ ] Required migrations and seed were applied.
- [ ] Test predictions, champion picks, and scores are cleaned before real play.
- [ ] Users/profiles are ready for the real game.
- [ ] Score updater runs only in a trusted server-side environment.

## Recommended Next Manual Steps

1. Review `config.production.example.js`.
2. Create `config.production.js` with the real Supabase Project URL and anon/publishable key only.
3. Confirm `.env` and `config.local.js` are not tracked.
4. Run the production smoke test locally one more time.
5. Clean test data in Supabase.
6. Commit only public-safe files.
7. Enable GitHub Pages from the repository settings.
