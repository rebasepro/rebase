import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import type { CronScheduler } from "./cron-scheduler";
import { ApiError, errorHandler } from "../api/errors";

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
export function createCronRoutes(scheduler: CronScheduler, skipped = 0): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    // Hono's onError does NOT propagate from parent to child routers, so this
    // child router registers its own handler to format thrown ApiErrors.
    router.onError(errorHandler);

    // List all jobs
    router.get("/", (c) => {
        const jobs = scheduler.listJobs();
        // A file that failed to load is not a job, so it appears nowhere in
        // this list — and "my job is missing" and "my job is not scheduled"
        // look identical from here. Say how many were dropped, as the
        // functions listing does, so the Studio panel and anyone with curl can
        // see it without boot-log access.
        return c.json({
            jobs,
            ...(skipped > 0 && {
                skipped,
                note: `${skipped} cron file(s) failed to load and are NOT scheduled — see the server log for the reason.`
            })
        });
    });

    // Get single job
    router.get("/:id", (c) => {
        const id = c.req.param("id");
        const job = scheduler.getJob(id);
        if (!job) {
            throw ApiError.notFound(`Cron job "${id}" not found`);
        }
        return c.json({ job });
    });

    // Trigger a job manually
    router.post("/:id/trigger", async (c) => {
        const id = c.req.param("id");
        const job = scheduler.getJob(id);
        if (!job) {
            throw ApiError.notFound(`Cron job "${id}" not found`);
        }

        const log = await scheduler.triggerJob(id);
        return c.json({ log,
job: scheduler.getJob(id) });
    });

    // Get job logs
    router.get("/:id/logs", async (c) => {
        const id = c.req.param("id");
        const limitStr = c.req.query("limit");
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;

        const job = scheduler.getJob(id);
        if (!job) {
            throw ApiError.notFound(`Cron job "${id}" not found`);
        }

        const logs = await scheduler.getJobLogsFromDb(id, limit);
        return c.json({ logs });
    });

    // Enable/disable a job
    router.put("/:id", async (c) => {
        const id = c.req.param("id");
        const body = await c.req.json().catch(() => ({})) as { enabled: boolean };

        if (typeof body.enabled !== "boolean") {
            throw ApiError.badRequest("Missing 'enabled' boolean in body");
        }

        const job = scheduler.setJobEnabled(id, body.enabled);
        if (!job) {
            throw ApiError.notFound(`Cron job "${id}" not found`);
        }

        return c.json({ job });
    });

    return router;
}
