# Supabase Setup Guide

This guide prepares the production database for the World Cup 2026 prediction game. The current app integration is intentionally limited: Production Mode can use Supabase Auth/profiles, read matches/scores, store the logged-in user's predictions/champion pick, and read the leaderboard view, while Demo Mode remains the default and profile-score persistence is not wired to Supabase yet.

## 1. Create A Supabase Project

1. Go to the Supabase dashboard.
2. Create a new project.
3. Choose a project name, region, and database password.
4. Wait for the project to finish provisioning.

After the project is created, open:

`Project Settings -> API`

You will find:

- `Project URL`: this will later become `SUPABASE_URL`.
- `anon public` key: this will later become `SUPABASE_ANON_KEY`.
- `service_role` key: this is only for trusted server-side scripts.

Important:

- The `anon public` key may be used in frontend code with Row Level Security enabled.
- The `service_role` key bypasses RLS.
- Never place the `service_role` key in `index.html`, browser code, public repos, or client-side environment variables.

## 2. Run SQL Files

Run the SQL files in this order.

1. Run:

```text
supabase/migrations/001_initial_schema.sql
```

This creates:

- Tables
- Constraints
- Indexes
- `updated_at` triggers
- Lock helper functions
- Leaderboard view
- Row Level Security policies

2. Run:

```text
supabase/seed/001_matches_seed.sql
```

This inserts:

- 72 group-stage matches
- Match IDs compatible with the current app
- Group letters
- Team names
- UTC kickoff times
- Cities
- Seeded-team flags used by leaderboard scoring
- Tournament champion lock setting

The seed is idempotent and safe to rerun. It uses `on conflict ... do update`.

## 3. Auth Settings

Recommended first production auth setup:

- Use Supabase email/password auth.
- Store username in `profiles.username`.
- Store display name in `profiles.display_name`.
- Do not use username as the primary login credential at first.

Why email/password first:

- Supabase supports it directly.
- Password handling stays inside Supabase Auth.
- The app can still display usernames publicly through `profiles`.

Email confirmation for a private 3-10 person game:

- For easier private testing, email confirmation can be disabled.
- For stricter security later, email confirmation can be enabled.

Tradeoff:

- Disabled confirmation is faster and less friction for a small trusted test group.
- Enabled confirmation reduces fake or mistyped accounts and is better for a wider rollout.

Suggested early private test setting:

- Disable email confirmation while testing with known participants.
- Enable it before a broader production launch.

## 4. User Registration Flow

Users should register themselves later through the production app after Supabase is wired into Production Mode.

Do not pre-create users in SQL.

Do not store real emails or passwords in repo files.

Expected future signup flow:

1. User enters email, password, username, and display name.
2. Supabase Auth creates the auth user.
3. The `handle_new_user()` trigger creates a row in `profiles`.
4. The production app immediately updates that profile with the selected username and display name when a signup session is returned.
5. The user can create predictions and champion picks subject to RLS lock rules.

Fallback profile values such as `user_<uuid-prefix>` or `Oyuncu` should only remain if the profile update fails or if a user is created manually from the Supabase Dashboard. In that case, fix the profile row before real play using `supabase/test-data-cleanup-guide.md`.

## 5. RLS Test Checklist

After running the migration and seed, test with at least two normal users and one trusted server/service-role script.

Auth/profile:

- New user can sign up.
- A `profiles` row is created for the new user.
- User can read public profile data.
- User can update only their own allowed profile fields.
- User cannot update another user's profile.

Matches/scores:

- Authenticated user can read `matches`.
- Authenticated user can read `scores`.
- Normal frontend user cannot insert/update/delete `matches`.
- Normal frontend user cannot insert/update/delete `scores`.
- Trusted server process can update `scores` using the service role key.

Predictions:

- User can create their own prediction before match lock.
- User can update their own prediction before match lock.
- User can delete their own prediction before match lock.
- User cannot insert/update/delete a prediction after match lock.
- User cannot insert/update/delete another user's prediction.
- Other users can read predictions only after that match is locked.

Champion picks:

- User can create their own champion pick before tournament lock.
- User can update their own champion pick before tournament lock.
- User can delete their own champion pick before tournament lock.
- User cannot edit champion pick after tournament lock.
- Other users can read champion picks after tournament lock.

Leaderboard:

- Authenticated user can read `leaderboard`.
- Leaderboard uses finished scores only.
- Leaderboard does not require storing user-editable point totals.

## 6. Future Environment Variables

Use placeholders only until wiring Production Mode.

Frontend-safe:

```text
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_public_key
```

Server-side only:

```text
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to frontend code.

Future server-side score updater may also need:

```text
API_FOOTBALL_KEY=your_api_key_here
```

Keep API keys and service role keys only in server-side environments.

## 7. Current Frontend Production Config

`index.html` currently reads optional frontend config from `window.WC2026_CONFIG` and falls back to Demo Mode placeholders:

```js
window.WC2026_CONFIG = {
  APP_MODE: 'demo',
  SUPABASE_URL: 'your_supabase_project_url',
  SUPABASE_ANON_KEY: 'your_supabase_anon_public_key'
};
```

For a production test, provide only:

- `APP_MODE`: `production`
- `SUPABASE_URL`: the Supabase Project URL from `Project Settings -> API`
- `SUPABASE_ANON_KEY`: the `anon public` key from `Project Settings -> API`

Do not place `SUPABASE_SERVICE_ROLE_KEY` in frontend code, browser globals, `index.html`, public deployment settings, or client-side logs.

Current Production Mode behavior:

- Uses Supabase email/password auth for login/register.
- Stores the selected username and display name in `profiles`, not as the auth identity.
- Reads the logged-in user's `profiles` row and maps it into the app's current user shape.
- Updates `profiles.avatar_id` when avatar selection is used.
- Uses Supabase password recovery email flow for password reset.
- Reads `matches` from Supabase and maps rows into the app's existing match shape.
- Reads `scores` from Supabase and maps rows into the app's existing score shape.
- Stores the logged-in user's match predictions in `predictions`.
- Stores the logged-in user's champion pick in `champion_picks`.
- Lets RLS/database policies enforce match and champion-pick locks.
- Reads leaderboard rows from the Supabase `leaderboard` view.
- Requires the SQL leaderboard scoring to stay compatible with frontend `ruleScorePoints`, `ruleOutcomePoints`, and `ruleMatchPoints`.
- Does not replace profile-score persistence yet.

Because the current SQL policies allow `matches` and `scores` reads for authenticated users, sign in with Supabase Auth before expecting those reads to succeed. Do not use the service role key to solve frontend read failures.

## 8. Champion Lock Time Verification

The first match kickoff is:

```text
2026-06-11T19:00:00Z
```

In Turkey time:

```text
2026-06-11 22:00 TRT
```

Champion lock is first kickoff minus 60 minutes:

```text
2026-06-11T18:00:00Z
2026-06-11 21:00 TRT
```

The seed file sets:

```sql
jsonb_build_object('champion_lock_at', '2026-06-11T18:00:00Z')
```

This value is correct.

The migration also has a fallback: if `app_settings.tournament.value.champion_lock_at` is not present, `champion_lock_at()` calculates the lock as the earliest `matches.kickoff_at` minus 60 minutes.

## 9. Manual Setup Notes

Before applying to a real production project:

- Review the SQL in Supabase SQL Editor.
- Run the migration first.
- Run the seed second.
- Confirm `select count(*) from public.matches;` returns `72`.
- Confirm RLS is enabled on all production tables.
- Confirm normal authenticated users cannot write `matches` or `scores`.
- Keep service role key only on trusted server-side scripts.
- Do not add real users, emails, passwords, API keys, or service keys to repo files.

## 10. What This Does Not Do Yet

This guide does not:

- Replace Demo Mode
- Change scoring rules
- Change API polling/cache logic
- Add deployment configuration
- Create predefined users
- Replace profile-score persistence with Supabase
- Add production admin tooling or service-role score update scripts
