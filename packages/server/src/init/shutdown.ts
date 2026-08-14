import { Server } from "http";
import { RealtimeProvider } from "@rebasepro/types";
import { logger } from "../utils/logger";

interface ShutdownConfig {
    server: Server;
    cronScheduler?: { stop(): void };
    /** Structural, for the same no-circular-imports reason as the backend below. */
    jobQueue?: { stop(): Promise<void> };
    realtimeServices: Record<string, RealtimeProvider>;
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
     * code 1. Also passed to `backend.shutdown()` as its drain timeout.
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
            await backend.shutdown(timeoutMs);
            if (onCleanup) {
                await onCleanup();
            }
            clearTimeout(forceTimer);
            logger.info("Graceful shutdown complete.");
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

export function createShutdown(config: ShutdownConfig): (timeoutMs?: number) => Promise<void> {
    return (timeoutMs = 15_000): Promise<void> => {
        return new Promise<void>((resolve) => {
            (async () => {
                logger.info("Shutting down Rebase Backend...");

                // 1. Stop cron scheduler
                if (config.cronScheduler) {
                    config.cronScheduler.stop();
                    logger.info("Cron scheduler stopped");
                }

                // 1b. Stop claiming jobs, and wait for the ones in flight.
                //
                // Before the realtime teardown and the pool close, both of
                // which a still-running handler would be caught by. Jobs
                // executing at this point keep their claim, so anything this
                // misses is recovered by the visibility timeout rather than
                // lost — but waiting here is what stops a deploy from running
                // the tail of a batch twice.
                if (config.jobQueue) {
                    await config.jobQueue.stop();
                    logger.info("Job queue stopped");
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

                // 3. Close the HTTP server (stop accepting, drain in-flight)
                config.server.close(() => {
                    logger.info("HTTP server closed");
                    resolve();
                });

                // 4. Force-resolve after timeout (unless disabled with 0)
                if (timeoutMs > 0) {
                    setTimeout(() => {
                        logger.warn(`Forced shutdown after ${timeoutMs / 1000}s timeout`);
                        resolve();
                    }, timeoutMs).unref();
                }
            })();
        });
    };
}
