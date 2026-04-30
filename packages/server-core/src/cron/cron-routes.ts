import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import type { CronScheduler } from "./cron-scheduler";

/**
 * Create admin REST routes for managing cron jobs.
 *
 * Routes:
 *   GET    /          → list all cron jobs
 *   GET    /:id       → get a single job's status
 *   POST   /:id/trigger → manually trigger a job
 *   GET    /:id/logs  → get execution logs for a job
 *   PUT    /:id       → update job (enable/disable)
 */
export function createCronRoutes(scheduler: CronScheduler): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    // List all jobs
    router.get("/", (c) => {
        const jobs = scheduler.listJobs();
        return c.json({ jobs });
    });

    // Get single job
    router.get("/:id", (c) => {
        const id = c.req.param("id");
        const job = scheduler.getJob(id);
        if (!job) {
            return c.json({ error: { message: `Cron job "${id}" not found`, code: "NOT_FOUND" } }, 404);
        }
        return c.json({ job });
    });

    // Trigger a job manually
    router.post("/:id/trigger", async (c) => {
        const id = c.req.param("id");
        const job = scheduler.getJob(id);
        if (!job) {
            return c.json({ error: { message: `Cron job "${id}" not found`, code: "NOT_FOUND" } }, 404);
        }

        const log = await scheduler.triggerJob(id);
        return c.json({ log, job: scheduler.getJob(id) });
    });

    // Get job logs
    router.get("/:id/logs", async (c) => {
        const id = c.req.param("id");
        const limitStr = c.req.query("limit");
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;

        const job = scheduler.getJob(id);
        if (!job) {
            return c.json({ error: { message: `Cron job "${id}" not found`, code: "NOT_FOUND" } }, 404);
        }

        const logs = await scheduler.getJobLogsFromDb(id, limit);
        return c.json({ logs });
    });

    // Enable/disable a job
    router.put("/:id", async (c) => {
        const id = c.req.param("id");
        const body = await c.req.json().catch(() => ({})) as { enabled: boolean };

        if (typeof body.enabled !== "boolean") {
            return c.json({ error: { message: "Missing 'enabled' boolean in body", code: "BAD_REQUEST" } }, 400);
        }

        const job = scheduler.setJobEnabled(id, body.enabled);
        if (!job) {
            return c.json({ error: { message: `Cron job "${id}" not found`, code: "NOT_FOUND" } }, 404);
        }

        return c.json({ job });
    });

    return router;
}
