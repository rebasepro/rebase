import { DataDriver, HealthCheckResult, isSQLAdmin } from "@rebasepro/types";
import { logger } from "../utils/logger";

export function createHealthCheck(defaultDriver: DataDriver): () => Promise<HealthCheckResult> {
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
            const latencyMs = Math.round(performance.now() - start);
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
