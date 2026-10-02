import { Server } from "http";
import { RealtimeProvider } from "@rebasepro/types";
import { logger } from "../utils/logger";
import { drainBackgroundWork } from "../functions/wait-until";

interface ShutdownConfig {
    server: Server;
    /** Structural, for the same no-circular-imports reason as the backend below. */
    cronScheduler?: { stop(timeoutMs?: number): Promise<void> | void };
    /** Structural, for the same no-circular-imports reason as the backend below. */
    jobQueue?: { stop(timeoutMs?: number): Promise<void> };
    /** Structural, same reason. */
    rlsAudit?: { stop(): void };
    /** The expired-token sweep's timer. */
    authTokenSweep?: { stop(): void };
    /** The stop `MetricsHistory.start()` returned: its interval writes to the pool. */
    stopMetricsSampler?: () => void;
    realtimeServices: Record<string, RealtimeProvider>;
    /**
     * End the responses that stay open until their client leaves — the Logs
     * Explorer's SSE tail. `server.close()` waits for every open connection, so
     * one of these left open held the shutdown to its force timeout.
     */
    closeLongLivedResponses?: () => void;
}

/**
 * Minimal structural view of the backend instance needed by
 * {@link installShutdownHandlers}. Structural (rather than importing
 * `RebaseBackendInstance`) to avoid a circular import with `../init`.
 */
interface ShutdownCapableBackend {
    shutdown(timeoutMs?: number): Promise<void>;
}

export interface ShutdownHandlerOptions {
    /**
     * Cleanup to run after the backend has drained — e.g. closing your
     * database pool: `onCleanup: () => pool.end()`.
     */
    onCleanup?: () => Promise<void> | void;

    /**
     * Hard force-exit timeout in milliseconds. If the shutdown sequence
     * (drain + cleanup) has not completed by then, the process exits with
     * code 1. `backend.shutdown()` is given this budget less a reserve for
     * `onCleanup` (the smaller of 2s and a fifth of it), so a drain the
     * backend has to force still ends in the pool close.
     *
     * @default 15000
     */
    timeoutMs?: number;

    /**
     * Process signals to handle.
     * @default ["SIGTERM", "SIGINT"]
     */
    signals?: NodeJS.Signals[];

    /** @internal Injectable exit function for tests. */
    exit?: (code: number) => void;
}

/**
 * Install graceful-shutdown signal handlers for a Rebase backend.
 *
 * On the first signal received, this drains the backend via
 * `backend.shutdown()` — which stops the cron scheduler, tears down
 * realtime services, and closes the HTTP server. Do **not** call
 * `server.close()` yourself in addition: closing an already-closing
 * server deadlocks, because the second close's callback never fires.
 *
 * After the drain, `onCleanup` runs (close your database pool here),
 * and the process exits 0. A force-exit timer guards the whole
 * sequence: if it has not completed within `timeoutMs`, the process
 * exits 1. Repeated signals while a shutdown is in flight are ignored.
 *
 * @returns An uninstall function that removes the signal listeners
 * (useful in tests).
 *
 * @example
 * ```ts
 * const backend = await initializeRebaseBackend({ ... });
 * installShutdownHandlers(backend, { onCleanup: () => pool.end() });
 * ```
 */
export function installShutdownHandlers(
    backend: ShutdownCapableBackend,
    options: ShutdownHandlerOptions = {}
): () => void {
    const {
        onCleanup,
        timeoutMs = 15_000,
        signals = ["SIGTERM", "SIGINT"],
        exit = process.exit
    } = options;

    let shuttingDown = false;

    const shutdownSequence = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;

        logger.info(`Received ${signal}, shutting down gracefully...`);

        // Hard backstop — must be armed before any awaits.
        const forceTimer = setTimeout(() => {
            logger.error(`Shutdown timed out after ${Math.round(timeoutMs / 1000)}s. Forcefully exiting.`);
            exit(1);
        }, timeoutMs);
        forceTimer.unref();

        try {
            // Less than this timer's own budget: the backend's force-resolve
            // at the same deadline would lose the race to it, and exit 1
            // without the cleanup ever running.
            await backend.shutdown(timeoutMs - cleanupReserveMs(timeoutMs));
            if (onCleanup) {
                await onCleanup();
            }
            clearTimeout(forceTimer);
            // Not "graceful": when the drain had to be forced, the line before
            // this one says so, and "graceful" right after it contradicted it.
            logger.info("Shutdown complete.");
            exit(0);
        } catch (err) {
            logger.error("Error during shutdown cleanup:", { error: err instanceof Error ? err : new Error(String(err)) });
            exit(1);
        }
    };

    const listeners = signals.map((signal) => {
        const listener = () => { void shutdownSequence(signal); };
        process.on(signal, listener);
        return { signal, listener } as const;
    });

    return () => {
        for (const { signal, listener } of listeners) {
            process.removeListener(signal, listener);
        }
    };
}

/** The part of a shutdown budget kept back from the drain for `onCleanup`. */
function cleanupReserveMs(timeoutMs: number): number {
    return Math.min(2_000, Math.floor(timeoutMs / 5));
}

/**
 * The share of the shutdown budget spent waiting for work in flight — cron
 * runs, jobs and `waitUntil()` tasks. The rest is kept for the teardown after
 * it, so a handler that never settles costs the work it was doing, not the
 * realtime teardown and the HTTP server's close.
 */
const WORK_DRAIN_SHARE = 2 / 3;

export function createShutdown(config: ShutdownConfig): (timeoutMs?: number) => Promise<void> {
    return (timeoutMs = 15_000): Promise<void> => {
        return new Promise<void>((resolve) => {
            // Force-resolve after the timeout (unless disabled with 0). Armed
            // before anything is awaited: it bounds the whole sequence, and a
            // step that hangs must not be what decides when it starts counting.
            const forceTimer = timeoutMs > 0
                ? setTimeout(() => {
                    logger.warn(
                        `Forced shutdown after ${timeoutMs / 1000}s timeout: a teardown step hung, or the HTTP ` +
                        "server still had requests open. Closing the remaining connections."
                    );
                    // So the process can actually end: an open socket holds the
                    // event loop, and the cleanup after this closes the pool.
                    config.server.closeAllConnections?.();
                    resolve();
                }, timeoutMs)
                : undefined;
            forceTimer?.unref();

            // Until when waiting for work in flight is worth it. Unbounded only
            // when the caller disabled the timeout.
            const workDeadline = timeoutMs > 0 ? Date.now() + Math.floor(timeoutMs * WORK_DRAIN_SHARE) : undefined;
            const workBudget = (): number | undefined =>
                workDeadline === undefined ? undefined : Math.max(0, workDeadline - Date.now());

            (async () => {
                logger.info("Shutting down Rebase Backend...");

                // 1. Stop the cron scheduler, and wait for a run in flight —
                // alongside the job drain below, within the same budget, since
                // the pool closing under a handler is the same failure either
                // way. A run still going when the budget runs out has its
                // `ctx.signal` aborted and is recorded as stopped.
                const cronStopped = config.cronScheduler
                    ? Promise.resolve(config.cronScheduler.stop(workBudget())).then(
                        () => logger.info("Cron scheduler stopped"),
                        (err: unknown) => logger.warn("Error stopping the cron scheduler:", { error: err })
                    )
                    : undefined;

                // 1a. Stop the audit timer. Nothing waits on it: a scan in
                // flight is a read-only query that ends with the connection.
                if (config.rlsAudit) {
                    config.rlsAudit.stop();
                }
                // And the token sweep's: one DELETE, nothing to wait for.
                config.authTokenSweep?.stop();
                // And the metrics sampler, whose next tick would write to a
                // pool the embedder closes once this resolves.
                config.stopMetricsSampler?.();

                // 1b. Stop claiming jobs, and wait for the ones in flight.
                //
                // Before the realtime teardown and the pool close, both of
                // which a still-running handler would be caught by. Jobs
                // executing at this point keep their claim, so anything this
                // misses is recovered by the visibility timeout rather than
                // lost — but waiting here is what stops a deploy from running
                // the tail of a batch twice. Bounded: a job still running when
                // the budget runs out is left to the visibility timeout.
                if (config.jobQueue) {
                    await config.jobQueue.stop(workBudget());
                    logger.info("Job queue stopped");
                }
                await cronStopped;

                // 1c. Wait for post-response work handed to `waitUntil()`.
                //
                // Before the pool closes and before realtime teardown, because
                // that is the work most likely to be touching both: the whole
                // point of `waitUntil` is the write nobody is waiting for, and
                // a webhook delivery or an audit row is exactly what a deploy
                // silently drops today. `waitUntil` exists chiefly so the same
                // function file survives a move to an isolate host — this is
                // what it buys on Node, where a floating promise at SIGTERM is
                // otherwise lost with no trace at all.
                //
                // Bounded well inside the overall budget: outstanding work is
                // worth waiting for, but not worth turning a rolling deploy
                // into a stall.
                const drainBudget = Math.min(5_000, workBudget() ?? 5_000);
                const stillPending = await drainBackgroundWork(drainBudget);
                if (stillPending > 0) {
                    logger.warn(
                        `${stillPending} background task(s) handed to waitUntil() did not finish within ` +
                        `${drainBudget}ms and are being dropped. Give them an AbortSignal, or move work ` +
                        "this long into a cron job or the job queue, where it is restartable."
                    );
                }

                // 2. Tear down realtime services (LISTEN clients, debounce timers,
                //    subscriptions). Must happen BEFORE pool.end() so that pending
                //    timer callbacks don't fire against a closed pool.
                for (const [key, rt] of Object.entries(config.realtimeServices)) {
                    try {
                        if (typeof rt.destroy === "function") {
                            await rt.destroy();
                            logger.info(`Realtime service "${key}" destroyed`);
                        } else if (typeof rt.stopListening === "function") {
                            await rt.stopListening();
                            logger.info(`Realtime service "${key}" LISTEN client stopped`);
                        }
                    } catch (err) {
                        logger.warn(`Error destroying realtime service "${key}":`, { error: err });
                    }
                }

                // 3. Close the HTTP server (stop accepting, drain in-flight).
                //
                // Streams first: an open SSE tail is a request that is never
                // "in flight" towards an end, and `close()` would wait on it
                // until the force timer — the WebSockets get the same treatment
                // in the realtime teardown above.
                config.closeLongLivedResponses?.();
                // `close()` closes the connections that are idle when it is
                // called, and only those. A keep-alive connection whose response
                // finishes a moment later — a stream just ended above, a request
                // that was in flight — then holds the server open for the whole
                // keep-alive timeout. Sweep the idle ones until it has closed;
                // a connection still serving a request is never touched.
                const sweepIdle = setInterval(() => config.server.closeIdleConnections?.(), 100);
                sweepIdle.unref();
                config.server.close(() => {
                    clearInterval(sweepIdle);
                    logger.info("HTTP server closed");
                    clearTimeout(forceTimer);
                    resolve();
                });
            })();
        });
    };
}
