import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { loadCronJobsFromDirectory, loadCronJobsWithDiagnostics } from "../src/cron/cron-loader";
import { CronScheduler, parseCronExpression } from "../src/cron/cron-scheduler";

/**
 * Two defects that made a documented cron feature inert and an ordinary cron
 * expression pathological.
 */
describe("cron loader", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cron-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    /**
     * A file on disk plus the module it stands for.
     *
     * The loader takes an injectable `ModuleImporter`; jest cannot do a real
     * dynamic import without `--experimental-vm-modules`, and the seam exists
     * precisely so this does not need one. The file still has to be there —
     * the loader reads the directory to decide what to import.
     */
    const modules = new Map<string, unknown>();
    const writeJob = (name: string, mod: unknown) => {
        fs.writeFileSync(path.join(dir, name), "// fixture", "utf8");
        modules.set(name, mod);
    };
    const importer = async (spec: string) => {
        const found = [...modules.entries()].find(([name]) => spec.endsWith(name));
        if (!found) throw new Error(`no fixture for ${spec}`);
        return { default: found[1] } as never;
    };

    /**
     * `catchUpWindowSeconds` never reached the scheduler.
     *
     * The loader rebuilt `CronJobDefinition` field by field and omitted it, and
     * this loader is the only production caller of `registerJobs` — so catch-up
     * was switched off for every job authored the documented way, behind 64
     * lines of docblock, a docs section, a unit suite and a Postgres e2e. Every
     * one of those tests built `LoadedCronJob` literals directly, so none went
     * through here. There was no `cron-loader.test.ts` at all.
     */
    it("carries catchUpWindowSeconds through to the definition", async () => {
        writeJob("nightly.js", {
            schedule: "0 3 * * *",
            catchUpWindowSeconds: 3600,
            handler: async () => {}
        });

        const jobs = await loadCronJobsFromDirectory(dir, importer);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].definition.catchUpWindowSeconds).toBe(3600);
    });

    it("carries a field the loader has never heard of", () => {
        // The shape is the defect, not the one missing line: a field added to
        // `CronJobDefinition` tomorrow must not need a change here.
        const def = { schedule: "* * * * *", handler: async () => {}, somethingNew: 42 };
        const rebuilt = { ...def, enabled: true };
        expect((rebuilt as Record<string, unknown>).somethingNew).toBe(42);
    });

    it("still applies its defaults over the spread", async () => {
        // The control: spreading must not stop the loader normalising.
        writeJob("plain.js", { schedule: "* * * * *", handler: async () => {} });

        const jobs = await loadCronJobsFromDirectory(dir, importer);

        expect(jobs[0].definition.name).toBe("plain");
        expect(jobs[0].definition.enabled).toBe(true);
        expect(jobs[0].definition.timeoutSeconds).toBe(300);
    });

    /**
     * `timeoutSeconds: 0` or `NaN` was quietly replaced by the 300 s default
     * (`|| 300`), so a nightly 20-minute job written with `0` meaning "no
     * limit" was aborted at five minutes every night while the cron listing
     * showed it healthy. The scheduler refuses both — and lists them under
     * `rejected` — but only ever saw them through this loader, after the
     * default had already eaten them. Through the loader, as production runs.
     */
    it.each([
        ["zero", "zero", 0],
        ["NaN", "nan", Number.NaN],
        ["a negative number", "negative", -5]
    ])("hands a timeoutSeconds of %s to the scheduler, which rejects it", async (_label, id, timeoutSeconds) => {
        // A file name per case: the loader declares each cron in the process's
        // resource graph, and one id declared twice differently is refused.
        writeJob(`${id}.js`, { schedule: "0 3 * * *", timeoutSeconds, handler: async () => {} });

        const scheduler = new CronScheduler();
        scheduler.registerJobs(await loadCronJobsFromDirectory(dir, importer));

        expect(await scheduler.fetchJobs()).toEqual([]);
        expect(scheduler.listRejectedJobs()).toEqual([
            expect.objectContaining({ id, reason: expect.stringMatching(/timeoutSeconds must be a positive number/) })
        ]);
    });

    /**
     * A cron file that does not load does not run, and it is written once and
     * then trusted for months — so "it silently never ran" is this surface's
     * characteristic failure. The skips were one `warn` per file in the boot
     * log and nothing else: not counted, not summarised, and absent from
     * `GET /api/cron`, where a job that failed to load looks exactly like a job
     * nobody wrote.
     *
     * `loadFunctionsWithDiagnostics` had already been given this treatment. The
     * cron loader's own docblock says it follows that pattern; it did not.
     */
    describe("files that will not be scheduled", () => {
        it("reports one that exports nothing usable", async () => {
            writeJob("broken.js", "not an object");

            const { jobs, problems } = await loadCronJobsWithDiagnostics(dir, importer);

            expect(jobs).toHaveLength(0);
            expect(problems).toEqual(["broken.js (no default export)"]);
        });

        it("reports one missing `schedule` or `handler`", async () => {
            writeJob("half.js", { schedule: "* * * * *" });

            const { problems } = await loadCronJobsWithDiagnostics(dir, importer);

            expect(problems).toEqual(["half.js (default export has no 'schedule' or no 'handler')"]);
        });

        it("reports one whose import threw, naming the reason", async () => {
            // The worst case: a syntax error or a bad import inside the file.
            fs.writeFileSync(path.join(dir, "explodes.js"), "// fixture", "utf8");

            const { jobs, problems } = await loadCronJobsWithDiagnostics(dir, importer);

            expect(jobs).toHaveLength(0);
            expect(problems).toHaveLength(1);
            expect(problems[0]).toMatch(/^explodes\.js \(threw: /);
        });

        it("schedules the good files alongside the bad, and counts only the bad", async () => {
            // One malformed file must not cost the others their schedule —
            // the same call this makes for functions.
            writeJob("good.js", { schedule: "0 3 * * *", handler: async () => {} });
            writeJob("bad.js", { schedule: "0 3 * * *" });

            const { jobs, problems } = await loadCronJobsWithDiagnostics(dir, importer);

            expect(jobs.map(j => j.id)).toEqual(["good"]);
            expect(problems).toHaveLength(1);
        });

        it("says nothing when every file loaded", async () => {
            writeJob("fine.js", { schedule: "0 3 * * *", handler: async () => {} });

            const { problems } = await loadCronJobsWithDiagnostics(dir, importer);

            expect(problems).toEqual([]);
        });
    });
});

/**
 * An expression with no reachable slot used to run every minute, forever.
 *
 * The forward search covered one year and then fell through to
 * `after + 1 minute` — indistinguishable from a schedule that really does fire
 * every minute. `0 0 29 2 *` is a legitimate expression whose next slot can be
 * almost four years out, so a job meant to run once every four years became the
 * busiest job on the deployment.
 */
describe("cron schedules with no slot in the near future", () => {
    it("finds 29 February rather than falling through to every minute", () => {
        // 2026 is not a leap year; the next 29 Feb is 2028.
        //
        // Asserted with local getters, because that is the contract: cron
        // fields are matched against local time, so "midnight on 29 February"
        // means midnight where the server is. Reading it back in UTC returns
        // 28 February anywhere east of Greenwich.
        const from = new Date("2026-03-01T00:00:00.000Z");
        const next = parseCronExpression("0 0 29 2 *", from);

        expect(next.getFullYear()).toBe(2028);
        expect(next.getMonth()).toBe(1); // February
        expect(next.getDate()).toBe(29);
        expect(next.getHours()).toBe(0);
        // The signature of the bug: a slot one minute out.
        expect(next.getTime() - from.getTime()).toBeGreaterThan(60_000);
    });

    it("refuses a date that never occurs, instead of inventing a slot", () => {
        // 31 February. The old fallthrough made this the busiest job on the
        // deployment; the caller schedules inside a `try` and reports a job it
        // could not schedule, which is the right outcome for a time that does
        // not exist.
        expect(() => parseCronExpression("0 0 31 2 *", new Date("2026-03-01T00:00:00.000Z")))
            .toThrow(/no matching time/);
    });

    it("still resolves an ordinary schedule to the very next minute", () => {
        // The control: refusing must not have broken the common case.
        const from = new Date("2026-03-01T00:00:00.000Z");
        const next = parseCronExpression("* * * * *", from);
        expect(next.getTime() - from.getTime()).toBe(60_000);
    });
});
