import { AuthSchemaHealth, DataDriver, HealthCheckResult, RealtimeListenerHealth, RealtimeProvider, isSQLAdmin } from "@rebasepro/types";
import { describeCauseChain, logger, redactSensitiveText } from "../utils/logger";

/**
 * @param defaultDriver     — probed for basic database reachability.
 * @param authSchemaCheck   — optional; asserts the auth schema is one this
 *   runtime can serve. Reachability alone is not health: a database can answer
 *   `SELECT 1` in a millisecond while the auth tables have been migrated out
 *   from under the running code, so every login returns 500 behind a green
 *   check. Reporting that as healthy is what lets an orchestrator keep routing
 *   traffic to a server that cannot authenticate anyone.
 */
/**
 * How long a realtime LISTEN connection may be down before `/health` says so.
 *
 * A dropped connection is replaced within seconds, and a pod that reports
 * itself degraded over that would shed traffic for nothing. One still down
 * after this is not reconnecting: every external and cross-instance change is
 * being lost while writes through this pod still look live, which is the
 * failure an orchestrator should route around.
 */
export const REALTIME_LISTENER_GRACE_MS = 60_000;

/**
 * @param realtimeProviders — optional; each reports the LISTEN connections it
 *   depends on. One down past {@link REALTIME_LISTENER_GRACE_MS} makes the
 *   check unhealthy; one down for less is reported but not failed on.
 */
export function createHealthCheck(
    defaultDriver: DataDriver,
    authSchemaCheck?: () => Promise<AuthSchemaHealth>,
    realtimeProviders: RealtimeProvider[] = []
): () => Promise<HealthCheckResult> {
    return async (): Promise<HealthCheckResult> => {
        const start = performance.now();
        try {
            const admin = defaultDriver.admin;
            if (isSQLAdmin(admin)) {
                await admin.executeSql("SELECT 1");
            } else {
                await defaultDriver.fetchCollection({
                    path: "__health_check_nonexistent__",
                    limit: 1
                });
            }

            const auth = await authSchemaCheck?.();
            const latencyMs = Math.round(performance.now() - start);
            if (auth && !auth.healthy) {
                logger.error("Health check failed: auth schema mismatch", {
                    problems: auth.problems,
                    databaseVersion: auth.databaseVersion,
                    runtimeVersion: auth.runtimeVersion
                });
                return {
                    healthy: false,
                    latencyMs,
                    details: { authSchema: auth }
                };
            }

            const listeners: RealtimeListenerHealth[] = realtimeProviders.flatMap((provider) => provider.health?.() ?? []);
            const down = listeners.filter((listener) => !listener.connected);
            if (down.length > 0) {
                const now = Date.now();
                const stuck = down.filter((listener) => now - (listener.downSince ?? now) >= REALTIME_LISTENER_GRACE_MS);
                if (stuck.length > 0) {
                    logger.error("Health check failed: realtime is not receiving changes", { listeners: stuck });
                }
                return {
                    healthy: stuck.length === 0,
                    latencyMs,
                    details: { realtime: { listeners } }
                };
            }

            return {
                healthy: true,
                latencyMs
            };
        } catch (error: unknown) {
            const latencyMs = Math.round(performance.now() - start);
            logger.error("Health check failed", {
                error: error instanceof Error ? error : new Error(String(error)),
                latencyMs
            });
            // The innermost cause, not the wrapper. Drizzle wraps every driver
            // failure in `Failed query: …`, which the logger redacts — so a
            // pool that was exhausted reported `Failed query: [redacted]` and
            // nothing about the pool. The cause chain is redacted too.
            const causes = describeCauseChain(error);
            const reason = causes.length > 0
                ? causes[causes.length - 1].replace(/^caused by: /, "")
                : redactSensitiveText(error instanceof Error ? error.message : String(error));
            return {
                healthy: false,
                latencyMs,
                details: {
                    error: reason
                }
            };
        }
    };
}
