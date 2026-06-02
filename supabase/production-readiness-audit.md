# Supabase Production Readiness Audit

Task scope: audit/report only. This document maps the current Demo Mode/localStorage data flows to the planned Supabase production schema so the later integration can be done in small, reversible steps.

No app code, SQL migration, seed data, UI, scoring rules, API cache/polling, deployment, or auth implementation should be changed as part of this audit.

## Current Demo Data Flows

| Flow | Current implementation | Demo storage/source | Production target |
| ---- | ---------------------- | ------------------- | ----------------- |
| App mode | `APP_MODE = 'demo'` selects demo adapters. Production placeholder intentionally stops insecure local auth. | Constant in `index.html` | Keep as mode switch; add Supabase adapters later. |
| User registration | `RegisterF` calls `authAdapter.register`, implemented by `demoAuth.register`. | `wc2026_users`, `wc2026_session` | Supabase Auth sign-up plus `profiles` row. |
| Login | `LoginF` calls `authAdapter.login`, implemented by `demoAuth.login`. | `wc2026_users`, `wc2026_session` | Supabase Auth sign-in/session. |
| Logout | `MainApp` logout buttons call `authAdapter.logout`. | Deletes `wc2026_session` | Supabase Auth sign-out. |
| Password reset | `ResetF` calls `authAdapter.getResetQuestion`, `verifyResetAnswer`, and `updatePassword`. | Security question/answer hash inside `wc2026_users` | Supabase password reset flow, likely email-based. |
| Session persistence | Root `App` initializes from `authAdapter.getCurrentUser`. | `wc2026_session` with username lookup in `wc2026_users` | Supabase session listener and current user. |
| Profile/display name | `usersAdapter` reads/writes user records; `displayName` is shown in UI and leaderboard. | `wc2026_users` | `profiles.display_name`, `profiles.username`. |
| Avatar selection | `MyScreen.saveAvatar` updates `avatarId` on the current user. | `avatarId` field inside `wc2026_users` | `profiles.avatar_id`. |
| Predictions | `MyScreen.savePred` uses `predictionsAdapter.saveForUser`; `PredictionCard` edits per-match scores before lock. | `wc2026_preds_<username>` | `predictions` table with `user_id`, `match_id`, `home_score`, `away_score`. |
| Champion pick | `ChampionCard` and `MyScreen.saveChampion` use `championAdapter`. | `wc2026_champ_<username>` | `champion_picks` table. |
| Scores | `MainApp` loads/saves via `scoresAdapter`; live overlay comes from `/api/scores`. | `wc2026_scores` | `scores` table, written by server/service role. |
| Leaderboard | `HomeScreen` calls `computeLeaderboard(users, scores)`. | `wc2026_users`, all `wc2026_preds_<username>`, `wc2026_scores`, embedded `MATCHES` | `leaderboard` view/RPC or client calculation from Supabase rows. |
| Profile/user score | `processUserProfileScores`, `calculateUserScore`, and ledger/fingerprint helpers update user records. | `userScore`, `userScoreLedger`, `userScoreEngineVersion` inside `wc2026_users` | Needs a production decision: recompute client-side, add a table, or add an RPC/view. |
| Match list | `MATCHES` constant drives fixtures, locks, leaderboard, and UI. | Embedded array in `index.html` | `matches` table seeded by `supabase/seed/001_matches_seed.sql`. |
| Match lock logic | `getLockState` and `getLockPct`; predictions lock 60 minutes before kickoff. | Embedded `MATCHES.utc` values | DB policies use `matches.kickoff_at` and `now()`. Keep client UX in parity. |
| Prediction reveal logic | `HomeScreen.revealedPredFeed` reveals other users' predictions after lock timing. | Reads all demo users and prediction keys | Supabase `predictions` select policy and frontend feed logic. |

## LocalStorage To Supabase Map

| Current demo/localStorage source | Purpose | Future Supabase table/view/function | Notes |
| -------------------------------- | ------- | ----------------------------------- | ----- |
| `APP_MODE` | Selects Demo Mode now and blocks unsafe Production Mode. | App config that selects Supabase adapters. | Keep the explicit production guard until real Supabase adapters are wired. |
| `wc2026_users` | Demo user registry, display names, local password hash, security reset data, role, avatar, profile score fields. | Supabase Auth plus `profiles`; optional profile score table/function. | Username-keyed object must be migrated to UUID-based records. Do not migrate local password hashes. |
| `wc2026_session` | Demo session persistence by username. | Supabase Auth session. | Should be fully replaced in production; do not use localStorage as production auth authority. |
| `wc2026_preds_<username>` | Per-user match predictions keyed by internal match id. | `predictions`. | Convert username to `auth.users.id`/`profiles.id`; preserve internal match ids. |
| `wc2026_champ_<username>` | Per-user champion pick. | `champion_picks`. | Tournament lock must match the seeded `app_settings.champion_lock_at`. |
| `wc2026_scores` | Browser-side cached score object keyed by match id. | `scores`. | Production writes should come from server/service role, not frontend. |
| `userScore` inside `wc2026_users` | Profile score/rating display. | Open decision: computed field, table, or RPC/view. | Current migration does not include a dedicated profile score table. |
| `userScoreLedger` inside `wc2026_users` | Profile score audit/fingerprint data for recalculation. | Open decision: table such as `profile_score_ledgers`, or recompute without persistence. | Needed only if the profile score feature must retain historical ledger behavior. |
| `userScoreEngineVersion` inside `wc2026_users` | Forces profile score recalculation when scoring engine changes. | Open decision: app setting or persisted profile-score metadata. | Current frontend version is `USER_SCORE_ENGINE_VERSION`. |
| `MATCHES` constant | Local fixture source for all 72 group matches. | `matches`. | Supabase seed should remain the source of truth in production. |
| `SEEDED` constant | Identifies seeded teams for prediction point rules. | `matches.home_seeded`, `matches.away_seeded` or app scoring metadata. | SQL scoring must match frontend seeded flags exactly. |
| `wc2026_matchEvents` | Legacy/previous event data key if present in old browsers. | None planned. | Not part of current active scoring/UI after event-rule removal; do not migrate unless a future feature needs it. |

## Integration Points To Change Later

Adapters and config:

- `APP_MODE`
- `demoStorage`, `storageAdapter`, and compatibility alias `S`
- `usersAdapter`
- `authAdapter` / `demoAuth`
- `predictionsAdapter`
- `championAdapter`
- `scoresAdapter`

Auth and account UI:

- `App` session initialization
- `LoginF`
- `RegisterF`
- `ResetF`
- `MainApp` logout handlers
- `MyScreen.saveAvatar`

Prediction and champion flows:

- `MyScreen.savePred`
- `MyScreen.saveChampion`
- `PredictionCard`
- `ChampionCard`
- `getLockState`
- `getLockPct`

Leaderboard, profile score, and reveal logic:

- `computeLeaderboard`
- `ruleScorePoints`
- `ruleOutcomePoints`
- `ruleMatchPoints`
- `processUserProfileScores`
- `calculateUserScore`
- `buildUserScoreFingerprint`
- `buildMatchEventsSnapshot`
- `HomeScreen` leaderboard, daily ranking, communication feed, and `revealedPredFeed`

Scores and match data:

- `MATCHES`
- `SEEDED`
- `MainApp` score loading/saving effect
- `fetchLiveScoresOverlay`
- `getLiveScoreRefreshDelay`

The live-score server cache and request-budget logic should remain separate from this adapter work. Production Supabase score writes should be added later through a server-side process using the service role key.

## Recommended Phased Implementation

1. Phase 0: Validate Supabase foundation.
   Run the migration and seed in a disposable Supabase project, confirm 72 matches, inspect RLS policies, and run the setup guide checklist before touching the app.

2. Phase 1: Read-only production data.
   Add Supabase-backed reads for `matches`, `scores`, and `app_settings` behind existing adapters while keeping demo auth/predictions local. This proves schema, fixture ids, status values, and score shape without risking user writes.

3. Phase 2: Supabase Auth and profiles.
   Replace `demoAuth` and `usersAdapter` with Supabase Auth plus `profiles`. Keep username/display name as profile fields and migrate session handling away from `wc2026_session`.

4. Phase 3: Predictions and champion picks.
   Wire `predictionsAdapter` and `championAdapter` to Supabase tables. Enforce lock rules with RLS and keep client-side lock UI as a user-friendly preview only.

5. Phase 4: Leaderboard and profile score.
   Decide whether leaderboard stays client-calculated from Supabase rows or moves to the SQL view/RPC. Separately decide how to persist or recompute profile/user score.

6. Phase 5: Production cleanup.
   Remove insecure production fallbacks, leave Demo Mode intentionally local, add production environment checks, and document operational score-update scripts.

## Risks And Cautions

- Username-keyed demo data does not map directly to Supabase UUIDs. Every production user-owned row should use `auth.uid()`, with username stored only as profile metadata.
- Demo password reset uses local security questions. Production should use Supabase email reset or another secure server-backed flow; local answer hashes should not be migrated.
- RLS will reject writes if `user_id`, lock timing, or authenticated session state is wrong. The frontend should handle these as normal validation errors, not crashes.
- Time handling must stay consistent. Demo lock logic uses JavaScript `Date` with UTC fixture strings; Supabase uses `timestamptz` and `now()`. Turkey display time should remain presentation only.
- Prediction reveal parity needs a choice. Current demo feed reveals shortly after the 60-minute lock timing, while the SQL select policy reveals locked predictions based on the database lock function.
- Profile score persistence is not fully represented in the current migration. Decide whether production profile score is recomputed, stored on `profiles`, or stored in a separate ledger table.
- Leaderboard scoring parity is critical. The SQL `prediction_points` function and frontend `ruleMatchPoints` path must be tested against the same match/seed cases.
- The live score server currently returns frontend-compatible score data. Later Supabase writes must use server-side credentials only and must not expose service role keys.
- Avatar support currently stores only `avatarId`. If production later supports uploaded images, that is a separate storage/RLS design.
- Existing localStorage demo data should remain compatible in Demo Mode; production integration should not delete or reinterpret demo browser data.

## Blockers Before Supabase Integration

- Decide whether production login is email/password only, or whether username-first login will be supported with an email lookup flow.
- Decide the production model for profile/user score and ledger data.
- Decide exact prediction reveal timing parity between frontend feed behavior and Supabase RLS.
- Validate the migration and seed in Supabase, including `security_invoker` view behavior and RLS policies.
- Prepare a small parity test set for frontend scoring vs SQL leaderboard scoring.
- Confirm how the server process will authenticate score updates with the service role key outside frontend code.

## Recommended Next Phase

Start with Phase 0, then Phase 1. In practice: apply the migration and seed to a disposable Supabase project, run the RLS checklist from `supabase/setup-guide.md`, then wire read-only `matches` and `scores` through adapters. That gives useful production signal without changing auth, predictions, or scoring behavior first.
