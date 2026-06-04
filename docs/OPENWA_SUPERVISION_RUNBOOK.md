# OpenWA Supervision Runbook

## Scope

This runbook covers M4 transport supervision for the smoke OpenWA runtime only.

## Supervisor State Model

- `starting`: the smoke runtime is creating the OpenWA client or waiting for a bounded startup retry.
- `ready`: the OpenWA client exists and the transport listener is registered once.
- `ready` also means the post-ready liveness loop is active.
- `degraded`: the latest startup attempt failed and the runtime is not ready.
- `degraded` can also mean the process is still alive but repeated post-ready liveness checks failed.
- `shutting_down`: shutdown was requested and the retry loop or client cleanup is in progress.
- `stopped`: shutdown completed and no further startup retry will run.

## Runtime Controls

- `OPENWA_STARTUP_MAX_ATTEMPTS`
  Default: `1`
  Bounded count for OpenWA startup attempts. `1` keeps the previous single-attempt behavior.
- `OPENWA_STARTUP_RETRY_DELAY_SECONDS`
  Default: `5`
  Delay between bounded startup retries after a failed OpenWA client creation attempt.
- `OPENWA_LIVENESS_INTERVAL_SECONDS`
  Default: `30`
  Interval between post-ready liveness checks.
- `OPENWA_LIVENESS_FAILURE_THRESHOLD`
  Default: `3`
  Consecutive failed liveness checks required before the supervisor transitions `ready -> degraded`.

## Health and Readiness

- `startOpenWaSmokeApp()` exposes `getHealth()`.
- `getHealth().ready === true` only when the supervisor state is `ready`.
- `getHealth()` also reports startup counters, retry delay, shutdown intent, active client presence, listener registration, liveness enablement, liveness failure counters, the latest liveness timestamps, and the latest error when degraded.

## Structured Logs

- `openwa_supervisor_state_changed`
  Emitted on each supervisor transition.
- `openwa_supervisor_ready`
  Emitted after the OpenWA client is created and listener registration succeeds.
- `openwa_supervisor_degraded`
  Emitted after a failed startup attempt with retry metadata and the startup error.
- `openwa_supervisor_stopped`
  Emitted after shutdown completes and the retry loop is no longer active.
- `openwa_liveness_check_ok`
  Emitted after a successful post-ready heartbeat. The heartbeat uses read-only OpenWA client calls when available and never sends a WhatsApp message.
- `openwa_liveness_check_failed`
  Emitted for each failed post-ready heartbeat with the current consecutive failure count.
- `openwa_liveness_degraded`
  Emitted when consecutive heartbeat failures reach the configured threshold.
- `openwa_liveness_recovered`
  Emitted when a later heartbeat succeeds and the supervisor transitions `degraded -> ready`.

## Operational Use

1. Start the smoke runtime with `npm run smoke:openwa`.
2. If startup fails once and `OPENWA_STARTUP_MAX_ATTEMPTS=1`, inspect the `openwa_supervisor_degraded` log and fix the underlying OpenWA or browser issue before retrying manually.
3. After `openwa_supervisor_ready`, watch `openwa_liveness_check_ok` for the steady-state transport signal. No WhatsApp message is sent as part of the heartbeat.
4. If the runtime reaches `degraded` after readiness, treat that as transport degradation, not proof that the Node.js process is dead. Inspect the last liveness failure log and the browser session state before deciding to restart.
5. Restart manually when the supervisor stays `degraded`, liveness recovery does not occur, or OpenWA/browser state remains unhealthy after operator inspection.
6. If shutdown is requested during startup retry or liveness supervision, rely on the supervisor to stop timers and prevent further checks instead of restarting the process repeatedly.
7. Keep `openwa-session/`, browser profiles, and other runtime artifacts untracked.
