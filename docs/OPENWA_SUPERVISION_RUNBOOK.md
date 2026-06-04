# OpenWA Supervision Runbook

## Scope

This runbook covers M5 transport supervision for the smoke OpenWA runtime only.

## Supervisor State Model

- `starting`: the smoke runtime is creating the OpenWA client or waiting for a bounded startup retry.
- `ready`: the OpenWA client exists, the transport listener is registered once for that client, and the post-ready liveness loop is active.
- `degraded`: startup failed or repeated post-ready liveness checks failed.
- `shutting_down`: shutdown was requested and retry, recovery, or client cleanup is in progress.
- `stopped`: shutdown completed and no further startup retry, liveness heartbeat, or recovery work will run.

## Runtime Controls

- `OPENWA_STARTUP_MAX_ATTEMPTS`
  Default: `1`
  Bounded count for OpenWA startup attempts.
- `OPENWA_STARTUP_RETRY_DELAY_SECONDS`
  Default: `5`
  Delay between bounded startup retries after a failed OpenWA client creation attempt.
- `OPENWA_LIVENESS_INTERVAL_SECONDS`
  Default: `30`
  Interval between post-ready liveness checks.
- `OPENWA_LIVENESS_FAILURE_THRESHOLD`
  Default: `3`
  Consecutive failed liveness checks required before the supervisor transitions `ready -> degraded`.
- `OPENWA_RECOVERY_MODE`
  Default: `manual`
  Recovery policy used only when liveness degradation persists after readiness.
- `OPENWA_RECOVERY_MAX_ATTEMPTS`
  Default: `0` in `manual`, `1` in `restart_client`
  Bounded count for recovery retries. This is separate from startup retry and does not affect initial OpenWA boot attempts.
- `OPENWA_RECOVERY_RETRY_DELAY_SECONDS`
  Default: `10`
  Delay before a scheduled recovery attempt runs after the transport enters persistent liveness degradation.

## Recovery Policy

- `manual`
  The supervisor never restarts the client automatically. It logs `openwa_recovery_required` and waits for operator action.
- `restart_client`
  When liveness degradation persists, the supervisor waits for the configured recovery delay, gracefully kills the current client when available, creates a fresh OpenWA client through the existing startup path, re-registers the listener once for the new client, and restarts liveness once for the new client.
- Automatic recovery never deletes `openwa-session/`, never clears session files, never forces a QR reset, and never sends a WhatsApp message as a probe.
- Listener idempotency remains process-local across a client restart, so duplicate message listeners are not intentionally added during recovery.

## Health and Readiness

- `startOpenWaSmokeApp()` exposes `getHealth()`.
- `getHealth().ready === true` only when the supervisor state is `ready`.
- `getHealth()` returns:
  - `state`
  - `ready`
  - `startupAttempt`
  - `startupAttempts`
  - `startupMaxAttempts`
  - `startupRetryDelaySeconds`
  - `remainingStartupAttempts`
  - `shutdownRequested`
  - `clientActive`
  - `listenerRegistered`
  - `livenessEnabled`
  - `livenessIntervalSeconds`
  - `livenessFailureThreshold`
  - `livenessFailureCount`
  - `recoveryMode`
  - `recoveryAttempt`
  - `recoveryMaxAttempts`
  - `recoveryInProgress`
  - `recoveryRetryDelaySeconds`
  - `lastLivenessOkAt`
  - `lastLivenessFailureAt`
  - `lastRecoveryStartedAt`
  - `lastRecoverySucceededAt`
  - `lastRecoveryFailedAt`
  - `lastError`

## Structured Logs

- `openwa_supervisor_state_changed`
  Emitted on each supervisor transition.
- `openwa_supervisor_ready`
  Emitted after the OpenWA client is created and listener registration succeeds.
- `openwa_supervisor_degraded`
  Emitted after a failed startup attempt with retry metadata and the startup error.
- `openwa_supervisor_stopped`
  Emitted after shutdown completes and retry, liveness, and recovery timers are cancelled.
- `openwa_liveness_check_ok`
  Emitted after a successful post-ready heartbeat. The heartbeat uses read-only OpenWA client calls when available and never sends a WhatsApp message.
- `openwa_liveness_check_failed`
  Emitted for each failed post-ready heartbeat with the current consecutive failure count.
- `openwa_liveness_degraded`
  Emitted when consecutive heartbeat failures reach the configured threshold.
- `openwa_liveness_recovered`
  Emitted when a later heartbeat succeeds and the supervisor transitions `degraded -> ready`.
- `openwa_recovery_required`
  Emitted in `manual` mode when liveness degradation persists and operator action is required.
- `openwa_recovery_starting`
  Emitted when a scheduled `restart_client` recovery attempt begins.
- `openwa_recovery_attempt_failed`
  Emitted when a recovery restart attempt fails.
- `openwa_recovery_succeeded`
  Emitted when a recovery restart attempt returns the supervisor to `ready`.
- `openwa_recovery_exhausted`
  Emitted when the bounded recovery retry budget is exhausted and the supervisor remains `degraded`.

## Operator Guidance

1. Start the smoke runtime with `npm run smoke:openwa`.
2. If startup fails, use `openwa_supervisor_degraded` to diagnose initial client boot separately from post-ready recovery. Startup retry and recovery retry are different controls.
3. After `openwa_supervisor_ready`, watch `openwa_liveness_check_ok` for steady-state transport health. No WhatsApp message is sent as part of the heartbeat.
4. If the runtime reaches `degraded` after readiness in `manual` mode, inspect the last liveness failure, browser state, and OpenWA connection state, then restart the smoke runtime manually when appropriate.
5. If `OPENWA_RECOVERY_MODE=restart_client`, watch `openwa_recovery_starting`, `openwa_recovery_attempt_failed`, `openwa_recovery_succeeded`, and `openwa_recovery_exhausted` to confirm whether automatic recovery succeeded or stalled.
6. Manually delete `_IGNORE_<sessionId>` only when OpenWA session metadata is stuck across repeated restarts, a fresh QR re-link is intentionally planned, and the operator has decided to discard the existing session state. Do not delete it as a first response to ordinary liveness degradation.
7. If shutdown is requested during startup retry, liveness supervision, or recovery delay, rely on the supervisor to cancel pending timers and prevent new recovery work instead of repeatedly restarting the process.
8. Keep `openwa-session/`, browser profiles, and other runtime artifacts untracked.
