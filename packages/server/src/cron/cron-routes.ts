import { Hono } from "hono";
import type { Context } from "hono";
import type { HonoEnv } from "../api/types";
import { isAlreadyExecutingSkip, type CronScheduler } from "./cron-scheduler";
import { ApiError, errorHandler } from "../api/errors";
import { resolveListLimitParam } from "../api/rest/query-parser";
import { logger } from "../utils/logger.js";

/** Who made a change, as `cron_job_state.updated_by` records it. */
function actorOf(c: Context<HonoEnv>): string | undefined {
    const user = c.get("user");
    if (typeof user === "object" && user !== null && typeof user.uid === "string") return user.uid;
    const apiKey = c.get("apiKey");
    return apiKey ? `api-key:${apiKey.id}` : undefined;
}

/**
 * Create admin REST routes for managing cron jobs.
 *
 * Routes:
 *   GET    /          → list all cron jobs
 *   GET    /:id       → get a single job's status
 *   POST   /:id/trigger → manually trigger a job
 *   GET    /:id/logs  → get execution logs for a job
 *   PUT    /:id       → update job (enable/disable, or `null` to follow the code)
 *
 * Every answer about a job's state is read from the store, not from this
 * process's memory: the process serving these routes is often not the one
 * running the jobs (the `api` role never starts its scheduler), and is only
 * ever one replica of several.
 */
export function createCronRoutes(scheduler: CronScheduler, skipped = 0): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    // Hono's onError does NOT propagate from parent to child routers, so this
    // child router registers its own handler to format thrown ApiErrors.
    router.onError(errorHandler);

    // List all jobs
    router.get("/", async (c) => {
        const jobs = await scheduler.fetchJobs();
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
    router.get("/:id", async (c) => {
        const id = c.req.param("id");
        const job = await scheduler.fetchJob(id);
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
        // Nothing ran, so this is not a success: the job is executing already —
        // on this process, or on whichever one holds its run lease (the worker,
        // seen from the api role). The skip is in the run history either way;
        // `details.log` carries it, and its line names the process.
        if (log && isAlreadyExecutingSkip(log)) {
            throw ApiError.conflict(
                `Cron job "${id}" is already executing — try again when that run has finished`,
                "CRON_JOB_ALREADY_EXECUTING",
                { log }
            );
        }
        return c.json({ log,
job: await scheduler.fetchJob(id) });
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

    // Enable/disable a job — for every process, and across redeploys
    router.put("/:id", async (c) => {
        const id = c.req.param("id");
        const body: unknown = await c.req.json().catch(() => ({}));
        const enabled = typeof body === "object" && body !== null && "enabled" in body ? body.enabled : undefined;

        if (typeof enabled !== "boolean" && enabled !== null) {
            throw ApiError.badRequest(
                "Missing 'enabled' in body: true or false to override the job's code, or null to follow it again"
            );
        }

        if (!scheduler.getJob(id)) {
            throw ApiError.notFound(`Cron job "${id}" not found`);
        }

        try {
            await scheduler.persistJobEnabled(id, enabled, actorOf(c));
        } catch (err) {
            logger.error(`[cron] Could not save the enabled state of "${id}"`, { error: err });
            throw ApiError.serviceUnavailable(
                `The change to cron job "${id}" could not be saved, so no process was changed. ` +
                "The server log has the reason."
            );
        }

        return c.json({ job: await scheduler.fetchJob(id) });
    });

    return router;
}
