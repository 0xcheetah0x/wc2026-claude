# GitHub Actions Schedule Diagnostic

Diagnostic date: `2026-06-12`

## Root-cause assessment

No repository-code defect was found in
`.github/workflows/sync-finished-scores.yml`.

The local repository, remote tracking data, and read-only GitHub API checks
confirmed:

- the workflow path is exactly
  `.github/workflows/sync-finished-scores.yml`;
- the workflow file is tracked and deployed in commit
  `615aaa0995e43491988433d6b2e36f08331c44e1`;
- local `main`, `origin/main`, and `origin/HEAD` point to that commit;
- GitHub reports the repository default branch as `main`;
- GitHub reports `sync-finished-scores` as an active workflow;
- the repository is not archived or disabled;
- GitHub recorded two successful `workflow_dispatch` runs;
- GitHub recorded no `schedule` runs for the workflow at audit time;
- no duplicate workflow file or workflow-name conflict exists.

The YAML structure, indentation, quoting, and cron nesting are valid.
`schedule` is correctly nested under `on`, beside `workflow_dispatch`.

The file contains UTF-8-compatible ASCII text with:

- no byte-order mark;
- no tabs;
- no null bytes;
- LF line endings; and
- no invisible prefix before `name:`.

The cron expression:

```text
7,37 * * * *
```

is valid POSIX cron syntax accepted by GitHub Actions. It requests runs at
minute 7 and minute 37 of every UTC hour.

The repository variable cannot prevent GitHub from creating a scheduled
workflow run. `FINISHED_SCORE_SYNC_ENABLED` is evaluated only inside the first
job step, after a `schedule` event has already created a run. Therefore, the
absence of scheduled runs occurred before the workflow's variable gate.

The root cause cannot be assigned to a specific repository line. The evidence
is consistent with GitHub not enqueueing or registering the schedule event,
or with GitHub-side schedule delay/drop behavior. GitHub documents that
scheduled workflows:

- run from the latest commit on the default branch;
- can run as often as every five minutes;
- can be delayed during high Actions load; and
- may be dropped when load is sufficiently high.

GitHub does not document a required workflow-file edit after the initial
default-branch commit. Editing a cron or disabling and re-enabling a workflow
can be used as a later troubleshooting action, but it is not a normal
registration requirement.

References:

- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows

## Why the schedule probe exists

`.github/workflows/schedule-probe.yml` isolates GitHub schedule-event creation
from all application logic.

It has:

- a manual trigger;
- a five-minute cron;
- read-only repository permission;
- one two-minute job;
- no checkout;
- no secrets;
- no provider request;
- no Supabase access;
- no npm installation;
- no Node execution; and
- no external network command.

Its only step prints:

```text
schedule-probe
event=<github event name>
<UTC timestamp>
```

## Expected test behavior

After the probe is committed and pushed to default branch `main`:

1. A manual probe run should print `event=workflow_dispatch`.
2. Scheduled probe runs should be eligible every five minutes.
3. A scheduled run should print `event=schedule`.
4. GitHub schedules are not guaranteed to start at the exact cron minute, so
   allow several windows before drawing a conclusion.

Keep:

```text
FINISHED_SCORE_SYNC_ENABLED=false
```

while testing. If the main workflow receives a schedule event, it should log:

```text
Scheduled finished-score sync is disabled.
```

It then exits before checkout, dependency installation, provider access,
Supabase access, or writes.

## Interpreting the result

If the probe receives scheduled runs:

- GitHub schedule events are working for the repository;
- inspect whether the main workflow begins receiving its minute 7 and 37
  events;
- if only the main workflow remains absent, disable and re-enable that
  workflow in the Actions UI or make a reviewed cron-only edit to force a
  fresh workflow update.

If the probe manual run works but no scheduled probe appears after several
five-minute windows:

- the failure is repository/GitHub scheduling state rather than updater code;
- verify Actions are enabled in repository settings;
- disable and re-enable the probe from the Actions UI;
- check GitHub Actions service status;
- contact GitHub Support if schedule events remain absent.

## Removing the probe

After at least one `event=schedule` probe run is confirmed:

1. delete `.github/workflows/schedule-probe.yml`;
2. commit and push the deletion to `main`;
3. confirm the probe disappears or becomes inactive in the Actions UI.

The diagnostic document can remain as an operational record.

## Re-enabling finished-score sync

Only after scheduled behavior is verified:

1. remove the temporary probe;
2. confirm the main workflow creates a scheduled run while the safety variable
   is still `false`;
3. verify that run logs `Scheduled finished-score sync is disabled.`;
4. set:

   ```text
   FINISHED_SCORE_SYNC_ENABLED=true
   ```

5. monitor the first enabled scheduled run and verify its finished-only sync
   summary.

Live-score writes remain disabled, and `server/set-score.js` remains the
manual fallback.
