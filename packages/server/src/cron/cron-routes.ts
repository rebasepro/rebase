import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import type { CronScheduler } from "./cron-scheduler";
import { ApiError, errorHandler } from "../api/errors";
import { resolveListLimitParam } from "../api/rest/query-parser";

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
        //
        // Two ways to be dropped, counted together and reported apart. A file
        // the loader could not read has only a count: the failure happened
        // before there was a job to name. A schedule the scheduler refused has a
        // name and a reason — most often "Expected 5 fields, got 6", from an
        // expression copied out of a tool that supports seconds — and quoting it
        // here turns a job that silently never fires into a one-line fix.
        const rejected = scheduler.listRejectedJobs();
        const total = skipped + rejected.length;
        return c.json({
            jobs,
            ...(total > 0 && {
                skipped: total,
                ...(rejected.length > 0 && { rejected }),
                note: [
                    skipped > 0 ? `${skipped} cron file(s) failed to load` : undefined,
                    rejected.length > 0 ? `${rejected.length} job(s) have an invalid schedule` : undefined
                ].filter(Boolean).join(" and ") +
                    " — NOT scheduled. " +
                    (rejected.length > 0
                        ? "See `rejected` for the reason; "
                        : "") +
                    "the server log has the rest."
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
        // Validated, not `parseInt`-ed. `?limit=abc` used to reach the store as
        // `NaN`, where Postgres refused `LIMIT NaN`, the store swallowed the
        // error and returned `[]` — a 200 with an empty list, which reads as
        // "this job has never run". The data plane answers 400 for the same
        // input; so does this now.
        const limit = resolveListLimitParam(c.req.query("limit") ?? null, { defaultLimit: 50 });

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
