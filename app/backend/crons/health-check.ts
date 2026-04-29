import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server-core";

/**
 * Example cron job: logs a heartbeat every 5 minutes.
 *
 * This file is auto-discovered by Rebase and registered as cron job
 * "health-check". The schedule uses standard 5-field cron syntax.
 *
 * Visible in the Studio under Automation → Cron Jobs.
 */
const job: CronJobDefinition = {
    schedule: "*/5 * * * *",
    name: "System Health Check",
    description: "Periodically logs system health metrics.",
    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const memUsage = process.memoryUsage();
        const rssMB = Math.round(memUsage.rss / 1024 / 1024);

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        ctx.log(`RSS: ${rssMB}MB`);

        // Use the rebase singleton directly — same instance as ctx.client
        ctx.log("Pinging database via SDK...");
        let authorCount = 0;
        try {
            const res = await rebase.data.authors.find({ limit: 1 });
            authorCount = res.meta?.total || 0;
            ctx.log(`SDK query successful. Authors found: ${authorCount}`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            ctx.log(`SDK query failed: ${message}`);
        }

        // Example: send an alert email when memory is high
        // if (rebase.email?.isConfigured() && rssMB > 500) {
        //     await rebase.email.send({
        //         to: "ops@example.com",
        //         subject: "⚠️ High memory usage",
        //         html: `<p>RSS: ${rssMB}MB</p>`,
        //     });
        // }

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            rssMB,
            authorCount,
            timestamp: new Date().toISOString(),
        };
    },
};

export default job;
