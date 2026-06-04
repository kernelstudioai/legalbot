import type { Logger } from "../../logging/logger.ts";
import { createOpenWaDispatcher, type OpenWaDispatcher } from "./dispatcher.ts";
import { createOpenWaLivenessCheck } from "./liveness.ts";
import { registerOpenWaListener } from "./listener.ts";
import type { OpenWaConfig } from "./client.ts";
import type { OpenWaLivenessCheck, OpenWaRuntimeClient } from "./types.ts";

export type OpenWaSupervisorState =
  | "starting"
  | "ready"
  | "degraded"
  | "shutting_down"
  | "stopped";

export type OpenWaRecoveryMode = "manual" | "restart_client";

export interface OpenWaSupervisorHealth {
  state: OpenWaSupervisorState;
  ready: boolean;
  startupAttempt: number;
  startupAttempts: number;
  startupMaxAttempts: number;
  startupRetryDelaySeconds: number;
  remainingStartupAttempts: number;
  shutdownRequested: boolean;
  clientActive: boolean;
  listenerRegistered: boolean;
  livenessEnabled: boolean;
  livenessIntervalSeconds: number;
  livenessFailureThreshold: number;
  livenessFailureCount: number;
  recoveryMode: OpenWaRecoveryMode;
  recoveryAttempt: number;
  recoveryMaxAttempts: number;
  recoveryInProgress: boolean;
  recoveryRetryDelaySeconds: number;
  lastLivenessOkAt?: string;
  lastLivenessFailureAt?: string;
  lastRecoveryStartedAt?: string;
  lastRecoverySucceededAt?: string;
  lastRecoveryFailedAt?: string;
  lastError?: string;
}

export interface OpenWaSupervisor {
  getHealth(): OpenWaSupervisorHealth;
  start(): Promise<OpenWaRuntimeClient>;
  stop(reason?: string): Promise<void>;
}

export interface OpenWaSupervisorDependencies {
  config: OpenWaConfig;
  logger: Logger;
  createClient: (config: OpenWaConfig) => Promise<OpenWaRuntimeClient>;
  startupMaxAttempts: number;
  startupRetryDelaySeconds: number;
  livenessIntervalSeconds: number;
  livenessFailureThreshold: number;
  recoveryMode?: OpenWaRecoveryMode;
  recoveryMaxAttempts?: number;
  recoveryRetryDelaySeconds?: number;
  createDispatcher?: (client: Pick<OpenWaRuntimeClient, "sendText">) => OpenWaDispatcher;
  createLivenessCheck?: (client: OpenWaRuntimeClient) => OpenWaLivenessCheck;
  registerListener?: (
    client: Pick<OpenWaRuntimeClient, "onMessage">,
    dependencies: {
      dispatcher: OpenWaDispatcher;
      logger: Logger;
      processedMessageIds?: Set<string>;
    }
  ) => Promise<unknown>;
}

const STOPPED_DURING_STARTUP_ERROR = "openwa_startup_stopped";
const DEFAULT_RECOVERY_MODE: OpenWaRecoveryMode = "manual";
const DEFAULT_RECOVERY_RETRY_DELAY_SECONDS = 10;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown_error";

export const createOpenWaSupervisor = ({
  config,
  logger,
  createClient,
  startupMaxAttempts,
  startupRetryDelaySeconds,
  livenessIntervalSeconds,
  livenessFailureThreshold,
  recoveryMode = DEFAULT_RECOVERY_MODE,
  recoveryMaxAttempts = recoveryMode === "restart_client" ? 1 : 0,
  recoveryRetryDelaySeconds = DEFAULT_RECOVERY_RETRY_DELAY_SECONDS,
  createDispatcher = createOpenWaDispatcher,
  createLivenessCheck = (client) => client.checkLiveness ?? createOpenWaLivenessCheck({}),
  registerListener = registerOpenWaListener
}: OpenWaSupervisorDependencies): OpenWaSupervisor => {
  const livenessEnabled = livenessIntervalSeconds > 0 && livenessFailureThreshold > 0;
  const processedMessageIds = new Set<string>();
  let state: OpenWaSupervisorState = "starting";
  let startupAttempts = 0;
  let shutdownRequested = false;
  let lastError: string | undefined;
  let activeClient: OpenWaRuntimeClient | undefined;
  let listenerRegisteredForActiveClient = false;
  let startPromise: Promise<OpenWaRuntimeClient> | undefined;
  let stopPromise: Promise<void> | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let resolveRetryDelay: (() => void) | undefined;
  let livenessTimer: NodeJS.Timeout | undefined;
  let livenessCheck: OpenWaLivenessCheck | undefined;
  let livenessFailureCount = 0;
  let lastLivenessOkAt: string | undefined;
  let lastLivenessFailureAt: string | undefined;
  let recoveryTimer: NodeJS.Timeout | undefined;
  let resolveRecoveryDelay: (() => void) | undefined;
  let recoveryAttempt = 0;
  let recoveryInProgress = false;
  let recoveryScheduled = false;
  let recoveryExhausted = false;
  let lastRecoveryStartedAt: string | undefined;
  let lastRecoverySucceededAt: string | undefined;
  let lastRecoveryFailedAt: string | undefined;

  const logStateChange = (
    previousState: OpenWaSupervisorState,
    nextState: OpenWaSupervisorState,
    meta?: Record<string, unknown>
  ) => {
    logger.info("openwa_supervisor_state_changed", {
      previous_state: previousState,
      state: nextState,
      ...meta
    });
  };

  const setState = (nextState: OpenWaSupervisorState, meta?: Record<string, unknown>) => {
    if (state === nextState) {
      return;
    }

    const previousState = state;
    state = nextState;
    logStateChange(previousState, nextState, meta);
  };

  const clearRetryDelay = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    if (resolveRetryDelay) {
      const resolve = resolveRetryDelay;
      resolveRetryDelay = undefined;
      resolve();
    }
  };

  const clearLivenessTimer = () => {
    if (!livenessTimer) {
      return;
    }

    clearTimeout(livenessTimer);
    livenessTimer = undefined;
  };

  const clearRecoveryDelay = () => {
    recoveryScheduled = false;

    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    }

    if (resolveRecoveryDelay) {
      const resolve = resolveRecoveryDelay;
      resolveRecoveryDelay = undefined;
      resolve();
    }
  };

  const waitForRetryDelay = async (): Promise<void> =>
    new Promise((resolve) => {
      resolveRetryDelay = () => {
        resolveRetryDelay = undefined;
        resolve();
      };

      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        resolveRetryDelay?.();
      }, startupRetryDelaySeconds * 1000);
    });

  const waitForRecoveryDelay = async (): Promise<void> =>
    new Promise((resolve) => {
      resolveRecoveryDelay = () => {
        resolveRecoveryDelay = undefined;
        resolve();
      };

      recoveryTimer = setTimeout(() => {
        recoveryTimer = undefined;
        resolveRecoveryDelay?.();
      }, recoveryRetryDelaySeconds * 1000);
    });

  const disposeClient = async (
    client: OpenWaRuntimeClient | undefined,
    reason: string
  ): Promise<void> => {
    if (!client || typeof client.kill !== "function") {
      return;
    }

    await client.kill(reason);
  };

  const resetRecoveryCycle = () => {
    clearRecoveryDelay();
    recoveryAttempt = 0;
    recoveryInProgress = false;
    recoveryExhausted = false;
  };

  const getHealth = (): OpenWaSupervisorHealth => ({
    state,
    ready: state === "ready",
    startupAttempt: startupAttempts,
    startupAttempts,
    startupMaxAttempts,
    startupRetryDelaySeconds,
    remainingStartupAttempts: Math.max(startupMaxAttempts - startupAttempts, 0),
    shutdownRequested,
    clientActive: activeClient !== undefined,
    listenerRegistered: listenerRegisteredForActiveClient,
    livenessEnabled,
    livenessIntervalSeconds,
    livenessFailureThreshold,
    livenessFailureCount,
    recoveryMode,
    recoveryAttempt,
    recoveryMaxAttempts,
    recoveryInProgress,
    recoveryRetryDelaySeconds,
    ...(lastLivenessOkAt ? { lastLivenessOkAt } : {}),
    ...(lastLivenessFailureAt ? { lastLivenessFailureAt } : {}),
    ...(lastRecoveryStartedAt ? { lastRecoveryStartedAt } : {}),
    ...(lastRecoverySucceededAt ? { lastRecoverySucceededAt } : {}),
    ...(lastRecoveryFailedAt ? { lastRecoveryFailedAt } : {}),
    ...(lastError ? { lastError } : {})
  });

  const assertNotShuttingDown = async (
    candidateClient?: OpenWaRuntimeClient
  ): Promise<void> => {
    if (!shutdownRequested) {
      return;
    }

    await disposeClient(candidateClient, STOPPED_DURING_STARTUP_ERROR);
    throw new Error(STOPPED_DURING_STARTUP_ERROR);
  };

  const scheduleNextLivenessCheck = (): void => {
    if (!livenessEnabled || shutdownRequested || activeClient === undefined || livenessCheck === undefined) {
      return;
    }

    clearLivenessTimer();
    livenessTimer = setTimeout(() => {
      livenessTimer = undefined;
      void runLivenessCheck();
    }, livenessIntervalSeconds * 1000);
  };

  const startLivenessMonitoring = (client: OpenWaRuntimeClient): void => {
    clearLivenessTimer();
    livenessCheck = createLivenessCheck(client);
    livenessFailureCount = 0;
    lastLivenessOkAt = undefined;
    lastLivenessFailureAt = undefined;
    scheduleNextLivenessCheck();
  };

  const activateClient = async (client: OpenWaRuntimeClient): Promise<void> => {
    const dispatcher = createDispatcher(client);
    await registerListener(client, {
      dispatcher,
      logger,
      processedMessageIds
    });
    await assertNotShuttingDown(client);

    activeClient = client;
    listenerRegisteredForActiveClient = true;
    lastError = undefined;
    startLivenessMonitoring(client);
  };

  const markRecoveryExhausted = () => {
    if (recoveryExhausted || recoveryMode !== "restart_client") {
      return;
    }

    recoveryExhausted = true;
    logger.warn("openwa_recovery_exhausted", {
      recovery_attempt: recoveryAttempt,
      recovery_max_attempts: recoveryMaxAttempts,
      recovery_retry_delay_seconds: recoveryRetryDelaySeconds,
      state
    });
  };

  const runRecovery = async (): Promise<void> => {
    if (
      shutdownRequested ||
      recoveryMode !== "restart_client" ||
      recoveryInProgress ||
      recoveryAttempt >= recoveryMaxAttempts ||
      state !== "degraded"
    ) {
      if (!shutdownRequested && recoveryMode === "restart_client" && recoveryAttempt >= recoveryMaxAttempts) {
        markRecoveryExhausted();
      }

      return;
    }

    recoveryScheduled = false;
    recoveryInProgress = true;
    recoveryAttempt += 1;
    lastRecoveryStartedAt = new Date().toISOString();

    logger.info("openwa_recovery_starting", {
      recovery_attempt: recoveryAttempt,
      recovery_max_attempts: recoveryMaxAttempts,
      recovery_retry_delay_seconds: recoveryRetryDelaySeconds,
      last_recovery_started_at: lastRecoveryStartedAt
    });

    const clientToReplace = activeClient;

    try {
      clearLivenessTimer();
      livenessCheck = undefined;
      await disposeClient(clientToReplace, "openwa_recovery_restart_client");
      activeClient = undefined;
      listenerRegisteredForActiveClient = false;

      const nextClient = await createClient(config);
      await assertNotShuttingDown(nextClient);
      await activateClient(nextClient);

      setState("ready", {
        reason: "recovery_succeeded",
        recovery_attempt: recoveryAttempt,
        recovery_max_attempts: recoveryMaxAttempts
      });

      lastRecoverySucceededAt = new Date().toISOString();
      lastError = undefined;
      recoveryExhausted = false;

      logger.info("openwa_recovery_succeeded", {
        recovery_attempt: recoveryAttempt,
        recovery_max_attempts: recoveryMaxAttempts,
        last_recovery_started_at: lastRecoveryStartedAt,
        last_recovery_succeeded_at: lastRecoverySucceededAt
      });
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      lastError = errorMessage;
      lastRecoveryFailedAt = new Date().toISOString();
      activeClient = undefined;
      listenerRegisteredForActiveClient = false;
      livenessCheck = undefined;

      logger.warn("openwa_recovery_attempt_failed", {
        recovery_attempt: recoveryAttempt,
        recovery_max_attempts: recoveryMaxAttempts,
        recovery_retry_delay_seconds: recoveryRetryDelaySeconds,
        last_recovery_started_at: lastRecoveryStartedAt,
        last_recovery_failed_at: lastRecoveryFailedAt,
        error: errorMessage
      });

      if (recoveryAttempt >= recoveryMaxAttempts) {
        markRecoveryExhausted();
      } else {
        void scheduleRecovery();
      }
    } finally {
      recoveryInProgress = false;
    }
  };

  const scheduleRecovery = async (): Promise<void> => {
    if (shutdownRequested || state !== "degraded") {
      return;
    }

    if (recoveryMode === "manual") {
      logger.warn("openwa_recovery_required", {
        recovery_mode: recoveryMode,
        recovery_attempt: recoveryAttempt,
        recovery_max_attempts: recoveryMaxAttempts,
        recovery_retry_delay_seconds: recoveryRetryDelaySeconds,
        last_liveness_failure_at: lastLivenessFailureAt,
        error: lastError
      });
      return;
    }

    if (recoveryInProgress || recoveryScheduled) {
      return;
    }

    if (recoveryAttempt >= recoveryMaxAttempts) {
      markRecoveryExhausted();
      return;
    }

    recoveryScheduled = true;
    await waitForRecoveryDelay();

    if (!recoveryScheduled || shutdownRequested || state !== "degraded") {
      return;
    }

    void runRecovery();
  };

  const runLivenessCheck = async (): Promise<void> => {
    if (!livenessEnabled || shutdownRequested || activeClient === undefined || livenessCheck === undefined) {
      return;
    }

    try {
      const meta = await livenessCheck();

      if (shutdownRequested) {
        return;
      }

      livenessFailureCount = 0;
      lastLivenessOkAt = new Date().toISOString();
      lastError = undefined;

      logger.info("openwa_liveness_check_ok", {
        liveness_failure_count: livenessFailureCount,
        liveness_failure_threshold: livenessFailureThreshold,
        last_liveness_ok_at: lastLivenessOkAt,
        ...meta
      });

      if (state === "degraded" && activeClient !== undefined) {
        clearRecoveryDelay();
        recoveryInProgress = false;
        setState("ready", {
          reason: "liveness_recovered"
        });
        logger.info("openwa_liveness_recovered", {
          last_liveness_ok_at: lastLivenessOkAt,
          ...meta
        });
      }
    } catch (error) {
      if (shutdownRequested) {
        return;
      }

      const errorMessage = toErrorMessage(error);
      livenessFailureCount += 1;
      lastLivenessFailureAt = new Date().toISOString();
      lastError = errorMessage;

      logger.warn("openwa_liveness_check_failed", {
        error: errorMessage,
        liveness_failure_count: livenessFailureCount,
        liveness_failure_threshold: livenessFailureThreshold,
        last_liveness_failure_at: lastLivenessFailureAt
      });

      if (livenessFailureCount >= livenessFailureThreshold && state === "ready") {
        resetRecoveryCycle();
        setState("degraded", {
          reason: "liveness_threshold_reached",
          liveness_failure_count: livenessFailureCount,
          liveness_failure_threshold: livenessFailureThreshold
        });
        logger.warn("openwa_liveness_degraded", {
          error: errorMessage,
          liveness_failure_count: livenessFailureCount,
          liveness_failure_threshold: livenessFailureThreshold,
          last_liveness_failure_at: lastLivenessFailureAt
        });
        void scheduleRecovery();
      }
    } finally {
      scheduleNextLivenessCheck();
    }
  };

  const start = async (): Promise<OpenWaRuntimeClient> => {
    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      while (startupAttempts < startupMaxAttempts) {
        await assertNotShuttingDown();

        startupAttempts += 1;

        let candidateClient: OpenWaRuntimeClient | undefined;

        try {
          candidateClient = await createClient(config);
          await assertNotShuttingDown(candidateClient);
          await activateClient(candidateClient);

          setState("ready", {
            startup_attempt: startupAttempts,
            startup_max_attempts: startupMaxAttempts
          });
          logger.info("openwa_supervisor_ready", {
            startup_attempt: startupAttempts,
            startup_max_attempts: startupMaxAttempts
          });

          return candidateClient;
        } catch (error) {
          const errorMessage = toErrorMessage(error);
          lastError = errorMessage;

          if (candidateClient !== activeClient) {
            await disposeClient(candidateClient, "openwa_startup_retry_cleanup");
          }

          setState("degraded", {
            startup_attempt: startupAttempts,
            startup_max_attempts: startupMaxAttempts,
            error: errorMessage
          });

          const willRetry =
            !shutdownRequested && startupAttempts < startupMaxAttempts;

          logger.warn("openwa_supervisor_degraded", {
            startup_attempt: startupAttempts,
            startup_max_attempts: startupMaxAttempts,
            startup_retry_delay_seconds: startupRetryDelaySeconds,
            will_retry: willRetry,
            error: errorMessage
          });

          if (shutdownRequested) {
            throw new Error(STOPPED_DURING_STARTUP_ERROR);
          }

          if (!willRetry) {
            throw error instanceof Error ? error : new Error(errorMessage);
          }

          setState("starting", {
            retry_attempt: startupAttempts + 1,
            startup_max_attempts: startupMaxAttempts
          });
          await waitForRetryDelay();
        }
      }

      throw new Error(lastError ?? "openwa_startup_failed");
    })();

    return startPromise;
  };

  const stop = async (reason = "shutdown"): Promise<void> => {
    if (stopPromise) {
      return stopPromise;
    }

    shutdownRequested = true;
    clearRetryDelay();
    clearLivenessTimer();
    clearRecoveryDelay();
    setState("shutting_down", { reason });

    stopPromise = (async () => {
      const clientCleanupAvailable = typeof activeClient?.kill === "function";

      try {
        await disposeClient(activeClient, reason);
        activeClient = undefined;
        listenerRegisteredForActiveClient = false;
        livenessCheck = undefined;
        recoveryInProgress = false;
        setState("stopped", { reason });
        logger.info("openwa_supervisor_stopped", {
          reason,
          client_cleanup_available: clientCleanupAvailable,
          startup_attempts: startupAttempts
        });
      } finally {
        clearRetryDelay();
        clearLivenessTimer();
        clearRecoveryDelay();
      }
    })();

    return stopPromise;
  };

  return {
    getHealth,
    start,
    stop
  };
};
