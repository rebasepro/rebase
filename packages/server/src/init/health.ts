import { AuthSchemaHealth, DataDriver, HealthCheckResult, isSQLAdmin } from "@rebasepro/types";
import { logger } from "../utils/logger";

/**
 * @param defaultDriver     — probed for basic database reachability.
 * @param authSchemaCheck   — optional; asserts the auth schema is one this
 *   runtime can serve. Reachability alone is not health: a database can answer
 *   `SELECT 1` in a millisecond while the auth tables have been migrated out
 *   from under the running code, so every login returns 500 behind a green
 *   check. Reporting that as healthy is what lets an orchestrator keep routing
 *   traffic to a server that cannot authenticate anyone.
 */
export function createHealthCheck(
    defaultDriver: DataDriver,
    authSchemaCheck?: () => Promise<AuthSchemaHealth>
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
            return {
                healthy: false,
                latencyMs,
                details: {
                    error: error instanceof Error ? error.message : String(error)
                }
            };
        }
    };
}
