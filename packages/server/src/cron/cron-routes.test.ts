import { describe, it, expect, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import { CronScheduler } from "./cron-scheduler";
import { createCronRoutes } from "./cron-routes";
import type { LoadedCronJob } from "./cron-loader";
import type { CronJobDefinition } from "@rebasepro/types";

// ─── Helpers ────────────────────────────────────────────────────────

function makeJob(
    id: string,
    overrides: Partial<CronJobDefinition> = {}
): LoadedCronJob {
    return {
        id,
        definition: {
            schedule: "0 * * * *",
            name: `Job ${id}`,
            enabled: true,
            timeoutSeconds: 5,
            handler: async (ctx) => {
                ctx.log("executed");
                return { ran: true };
            },
            ...overrides
        }
    };
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
    return res.json() as Promise<Record<string, unknown>>;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("cron-routes", () => {
    let scheduler: CronScheduler;
    let app: Hono;

    beforeEach(() => {
        scheduler = new CronScheduler();
        scheduler.registerJobs([
            makeJob("job-a", { name: "Job A",
description: "First job" }),
            makeJob("job-b", { name: "Job B" })
        ]);

        app = new Hono();
        app.route("/cron", createCronRoutes(scheduler));
    });

    // ── GET / (list) ────────────────────────────────────────────────

    describe("GET /cron", () => {
        it("returns all registered jobs", async () => {
            const res = await app.request("/cron");
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            const jobs = body.jobs as Array<Record<string, unknown>>;
            expect(jobs).toHaveLength(2);
            expect(jobs.map((j) => j.id).sort()).toEqual(["job-a", "job-b"]);
        });

        it("says nothing about skipped files when there are none", async () => {
            const body = await jsonBody(await app.request("/cron"));
            expect(body.skipped).toBeUndefined();
            expect(body.note).toBeUndefined();
        });

        it("reports files that failed to load, which are in no other answer", async () => {
            // A cron file that does not load is not a job, so it appears
            // nowhere in `jobs` — and "my job is missing" reads exactly like
            // "nobody wrote one". The count is the only thing that separates
            // them without boot-log access.
            const withProblems = new Hono();
            withProblems.route("/cron", createCronRoutes(scheduler, 2));

            const body = await jsonBody(await withProblems.request("/cron"));

            expect(body.skipped).toBe(2);
            expect(body.note).toMatch(/NOT scheduled/);
            expect((body.jobs as unknown[])).toHaveLength(2);
        });

        it("names a job whose schedule the scheduler refused, and the reason", async () => {
            // The other way to be absent, and the one with a name attached: the
            // file loaded, the schedule did not validate. Six fields, from an
            // expression copied out of a tool that supports seconds, is the
            // common case and a one-character fix — if you can see it.
            scheduler.registerJobs([makeJob("nightly", { schedule: "0 0 3 * * *" })]);

            const body = await jsonBody(await app.request("/cron"));

            expect(body.skipped).toBe(1);
            expect(body.rejected).toEqual([{
                id: "nightly",
                name: "Job nightly",
                schedule: "0 0 3 * * *",
                reason: "Expected 5 fields, got 6"
            }]);
            expect(body.note).toMatch(/invalid schedule/);
            expect((body.jobs as unknown[])).toHaveLength(2);
        });

        it("counts unloadable files and refused schedules together", async () => {
            scheduler.registerJobs([makeJob("nightly", { schedule: "0 0 3 * * *" })]);
            const withBoth = new Hono();
            withBoth.route("/cron", createCronRoutes(scheduler, 2));

            const body = await jsonBody(await withBoth.request("/cron"));

            expect(body.skipped).toBe(3);
            expect((body.rejected as unknown[])).toHaveLength(1);
        });

        it("each job has the expected shape", async () => {
            const res = await app.request("/cron");
            const body = await jsonBody(res);
            const jobs = body.jobs as Array<Record<string, unknown>>;
            const jobA = jobs.find((j) => j.id === "job-a")!;

            expect(jobA.name).toBe("Job A");
            expect(jobA.description).toBe("First job");
            expect(jobA.schedule).toBe("0 * * * *");
            expect(jobA.enabled).toBe(true);
            expect(jobA.state).toBe("idle");
            expect(jobA.totalRuns).toBe(0);
            expect(jobA.totalFailures).toBe(0);
        });
    });

    // ── GET /:id (single) ───────────────────────────────────────────

    describe("GET /cron/:id", () => {
        it("returns a single job", async () => {
            const res = await app.request("/cron/job-a");
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            const job = body.job as Record<string, unknown>;
            expect(job.id).toBe("job-a");
            expect(job.name).toBe("Job A");
        });

        it("returns 404 for nonexistent job", async () => {
            const res = await app.request("/cron/nonexistent");
            expect(res.status).toBe(404);

            const body = await jsonBody(res);
            expect((body.error as Record<string, unknown>).code).toBe("NOT_FOUND");
        });
    });

    // ── POST /:id/trigger ───────────────────────────────────────────

    describe("POST /cron/:id/trigger", () => {
        it("triggers a job and returns log + updated status", async () => {
            const res = await app.request("/cron/job-a/trigger", {
                method: "POST"
            });
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            const log = body.log as Record<string, unknown>;
            const job = body.job as Record<string, unknown>;

            expect(log.jobId).toBe("job-a");
            expect(log.success).toBe(true);
            expect(log.manual).toBe(true);
            expect((log.logs as string[])).toContain("executed");
            expect(log.result).toEqual({ ran: true });

            expect(job.totalRuns).toBe(1);
        });

        it("returns 404 for nonexistent job", async () => {
            const res = await app.request("/cron/ghost/trigger", {
                method: "POST"
            });
            expect(res.status).toBe(404);
        });
    });

    // ── GET /:id/logs ───────────────────────────────────────────────

    describe("GET /cron/:id/logs", () => {
        it("returns empty logs before any execution", async () => {
            const res = await app.request("/cron/job-a/logs");
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            expect(body.logs).toEqual([]);
        });

        it("returns logs after trigger", async () => {
            // Trigger first
            await app.request("/cron/job-a/trigger", { method: "POST" });

            const res = await app.request("/cron/job-a/logs");
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            const logs = body.logs as Array<Record<string, unknown>>;
            expect(logs).toHaveLength(1);
            expect(logs[0].success).toBe(true);
        });

        it("respects limit query parameter", async () => {
            await app.request("/cron/job-a/trigger", { method: "POST" });
            await app.request("/cron/job-a/trigger", { method: "POST" });
            await app.request("/cron/job-a/trigger", { method: "POST" });

            const res = await app.request("/cron/job-a/logs?limit=2");
            const body = await jsonBody(res);
            expect((body.logs as unknown[]).length).toBe(2);
        });

        it("returns 404 for nonexistent job", async () => {
            const res = await app.request("/cron/ghost/logs");
            expect(res.status).toBe(404);
        });
    });

    // ── PUT /:id (enable/disable) ───────────────────────────────────

    describe("PUT /cron/:id", () => {
        it("disables a job", async () => {
            const res = await app.request("/cron/job-a", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: false })
            });
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            const job = body.job as Record<string, unknown>;
            expect(job.enabled).toBe(false);
            expect(job.state).toBe("disabled");
        });

        it("re-enables a disabled job", async () => {
            // Disable first
            await app.request("/cron/job-a", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: false })
            });

            // Re-enable
            const res = await app.request("/cron/job-a", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: true })
            });
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            expect((body.job as Record<string, unknown>).enabled).toBe(true);
        });

        it("returns 400 if enabled is missing from body", async () => {
            const res = await app.request("/cron/job-a", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ something: "else" })
            });
            expect(res.status).toBe(400);

            const body = await jsonBody(res);
            expect((body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
        });

        it("returns 404 for nonexistent job", async () => {
            const res = await app.request("/cron/ghost", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: false })
            });
            expect(res.status).toBe(404);
        });
    });

    // ── Edge cases ──────────────────────────────────────────────────

    describe("edge cases", () => {
        it("handles a failing job trigger gracefully", async () => {
            scheduler.registerJobs([
                makeJob("fail-job", {
                    handler: async () => {
                        throw new Error("kaboom");
                    }
                })
            ]);

            const res = await app.request("/cron/fail-job/trigger", {
                method: "POST"
            });
            expect(res.status).toBe(200); // trigger still returns 200

            const body = await jsonBody(res);
            const log = body.log as Record<string, unknown>;
            expect(log.success).toBe(false);
            expect(log.error).toBe("kaboom");
        });

        it("handles URL-encoded job IDs", async () => {
            scheduler.registerJobs([makeJob("has-dash", { name: "Dashed" })]);

            const res = await app.request("/cron/has-dash");
            expect(res.status).toBe(200);

            const body = await jsonBody(res);
            expect((body.job as Record<string, unknown>).id).toBe("has-dash");
        });
    });
});
