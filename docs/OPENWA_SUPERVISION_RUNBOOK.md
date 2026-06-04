# OpenWA Supervision Runbook

## Scope

This runbook covers M3 transport supervision for the smoke OpenWA runtime only.

## Supervisor State Model

- `starting`: the smoke runtime is creating the OpenWA client or waiting for a bounded startup retry.
- `ready`: the OpenWA client exists and the transport listener is registered once.
- `degraded`: the latest startup attempt failed and the runtime is not ready.
- `shutting_down`: shutdown was requested and the retry loop or client cleanup is in progress.
- `stopped`: shutdown completed and no further startup retry will run.

## Runtime Controls

- `OPENWA_STARTUP_MAX_ATTEMPTS`
  Default: `1`
  Bounded count for OpenWA startup attempts. `1` keeps the previous single-attempt behavior.
- `OPENWA_STARTUP_RETRY_DELAY_SECONDS`
  Default: `5`
  Delay between bounded startup retries after a failed OpenWA client creation attempt.

## Health and Readiness

- `startOpenWaSmokeApp()` exposes `getHealth()`.
- `getHealth().ready === true` only when the supervisor state is `ready`.
- `getHealth()` also reports attempt counters, retry delay, shutdown intent, active client presence, listener registration, and the latest startup error when degraded.

## Structured Logs

- `openwa_supervisor_state_changed`
  Emitted on each supervisor transition.
- `openwa_supervisor_ready`
  Emitted after the OpenWA client is created and listener registration succeeds.
- `openwa_supervisor_degraded`
  Emitted after a failed startup attempt with retry metadata and the startup error.
- `openwa_supervisor_stopped`
  Emitted after shutdown completes and the retry loop is no longer active.

## Operational Use

1. Start the smoke runtime with `npm run smoke:openwa`.
2. If startup fails once and `OPENWA_STARTUP_MAX_ATTEMPTS=1`, inspect the `openwa_supervisor_degraded` log and fix the underlying OpenWA or browser issue before retrying manually.
3. If bounded retry is enabled, wait for the configured delay and watch for `openwa_supervisor_ready` before interacting with WhatsApp.
4. If shutdown is requested during a retry window, rely on the supervisor to stop further retries instead of restarting the process repeatedly.
5. Keep `openwa-session/`, browser profiles, and other runtime artifacts untracked.
