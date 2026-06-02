# Production Configuration And Deployment Guide

This guide explains how Production Mode should receive frontend-safe Supabase configuration without committing real credentials to the repo.

No deployment is performed by this guide.

## Current Defaults

`index.html` still defaults to Demo Mode:

```js
APP_MODE: 'demo'
```

If no external config is provided, the app keeps running as Demo Mode and does not require Supabase.

Production Mode requires:

- `APP_MODE: 'production'`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The service role key is never frontend config.

## Config Files

Use `config.example.js` as the safe template:

```js
window.WC2026_CONFIG = {
  APP_MODE: 'demo',
  SUPABASE_URL: 'your_supabase_project_url',
  SUPABASE_ANON_KEY: 'your_supabase_anon_public_key'
};
```

For local testing, copy it to:

```text
config.local.js
```

Then set local values there. `config.local.js` is ignored by git and must not be committed.

`index.html` attempts to load `config.local.js` before the app starts. If the file is missing, the app falls back to Demo Mode defaults.

## Local Production Test

1. Copy `config.example.js` to `config.local.js`.
2. Set:

```js
window.WC2026_CONFIG = {
  APP_MODE: 'production',
  SUPABASE_URL: 'your_supabase_project_url',
  SUPABASE_ANON_KEY: 'your_supabase_anon_public_key'
};
```

3. Use only the Supabase anon public key.
4. Do not add `SUPABASE_SERVICE_ROLE_KEY`.
5. Do not add `API_FOOTBALL_KEY`.

Production Mode should fail safely if URL/key are missing or placeholders.

## Netlify Notes

For a simple static deployment, the frontend can use the Supabase anon public key because Supabase RLS protects table access.

Recommended approaches:

- Keep `config.local.js` out of git.
- Generate or inject a production config file during the Netlify build using Netlify environment variables.
- Expose only frontend-safe values to the built site:
  - `APP_MODE`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

Never expose these in the published frontend:

- `SUPABASE_SERVICE_ROLE_KEY`
- `API_FOOTBALL_KEY`
- database passwords
- user passwords

### Netlify Credit Note

Score updates should not require daily redeploys.

Deploys should happen only when code changes. Match scores should be updated through server/API/database logic, such as a Netlify Function, scheduled function, worker, or trusted backend process that writes to Supabase with server-side credentials.

Rebuilding the site just to change match scores wastes deploy minutes/credits and is not the right production architecture.

## GitHub Pages Notes

GitHub Pages can host the static frontend, but it cannot securely run server-side secrets.

Allowed on GitHub Pages:

- Supabase Project URL
- Supabase anon public key
- Demo/production mode switch

Not allowed on GitHub Pages frontend:

- Supabase service role key
- API-Football key
- any backend-only token

GitHub Pages alone cannot safely update live scores from a secret API. A separate server, worker, scheduled function, or backend job is still needed for score ingestion.

## Score Update Architecture Later

The frontend should remain read-only for scores.

Future score updates should use a trusted server-side process:

1. Read live scores from the football API using `API_FOOTBALL_KEY`.
2. Respect API request budget/cache rules.
3. Write validated scores to Supabase `scores`.
4. Use `SUPABASE_SERVICE_ROLE_KEY` only on the server side.
5. Let the frontend read `scores` with the anon key and RLS.

## Security Checklist

- No service role key in frontend.
- No API-Football key in frontend.
- No real credentials committed.
- `config.local.js` is gitignored.
- Supabase anon key is public, but RLS must remain enabled.
- RLS policies must not be weakened for convenience.
- Production Mode must fail safely when config is missing.
- Score writes must happen only from trusted server-side code.

## Remaining Deployment TODOs

- Decide final hosting target: Netlify, GitHub Pages plus backend, or another host.
- Add a build/deploy-time config injection step if using Netlify.
- Add a server-side score updater later.
- Verify RLS in the real Supabase project after production config is wired.
- Keep Demo Mode available for local browser-only testing.
