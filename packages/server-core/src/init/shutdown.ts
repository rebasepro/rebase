import { Server } from "http";
import { RealtimeProvider } from "@rebasepro/types";
import { logger } from "../utils/logger";

interface ShutdownConfig {
    server: Server;
    cronScheduler?: { stop(): void };
    realtimeServices: Record<string, RealtimeProvider>;
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
