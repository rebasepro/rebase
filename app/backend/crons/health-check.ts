import type { CronJobDefinition } from "@rebasepro/types";

/**
 * Example cron job: logs a heartbeat every minute.
 *
 * This file is auto-discovered by Rebase and registered as cron job
 * "health-check". The schedule uses standard 5-field cron syntax.
 *
 * Visible in the Studio under Automation → Cron Jobs.
 */
const job: CronJobDefinition = {
    schedule: "*/5 * * * *",
    name: "System Health Check",
    description: "Runs every 5 minutes to verify system health and log uptime metrics",

    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const memUsage = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        ctx.log(`RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            rssMB: Math.round(memUsage.rss / 1024 / 1024),
            timestamp: new Date().toISOString(),
        };
    },
};

export default job;
