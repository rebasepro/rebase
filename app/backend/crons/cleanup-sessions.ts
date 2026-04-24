import type { CronJobDefinition } from "@rebasepro/types";

/**
 * Example cron job: cleans up expired sessions from the database.
 *
 * This demonstrates a cron job that would interact with the database.
 * Schedule: every day at 3:00 AM.
 */
const job: CronJobDefinition = {
    schedule: "0 3 * * *",
    name: "Cleanup Expired Sessions",
    description: "Removes user sessions older than 30 days to free up storage",

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // In a real implementation, you would use the driver:
        // const result = await ctx.driver.executeSql(
        //     "DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '30 days'"
        // );

        const simulatedCount = Math.floor(Math.random() * 50);
        ctx.log(`Cleaned up ${simulatedCount} expired sessions`);

        return { deletedSessions: simulatedCount };
    },
};

export default job;
