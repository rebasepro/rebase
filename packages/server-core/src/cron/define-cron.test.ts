import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { defineCron } from "./define-cron";
import { loadCronJobsFromDirectory } from "./cron-loader";
import type { CronJobDefinition } from "@rebasepro/types";

// ─── Unit: defineCron ───────────────────────────────────────────────

describe("defineCron", () => {
    it("returns the same object reference (identity)", () => {
        const def: CronJobDefinition = {
            name: "Test job",
            schedule: "* * * * *",
            handler: async () => ({ ok: true }),
        };
        const result = defineCron(def);
        expect(result).toBe(def);
    });

    it("preserves all optional fields", () => {
        const def = defineCron({
            name: "Full options",
            schedule: "0 3 * * *",
            description: "Nightly cleanup",
            enabled: false,
            timeoutSeconds: 60,
            handler: async () => undefined,
        });
        expect(def.description).toBe("Nightly cleanup");
        expect(def.enabled).toBe(false);
        expect(def.timeoutSeconds).toBe(60);
    });

    it("rejects misspelled fields at compile time", () => {
        // @ts-expect-error — 'shedule' is not a valid field on CronJobDefinition
        defineCron({
            name: "Bad",
            shedule: "* * * * *",
            handler: async () => undefined,
        });
    });
});

// ─── Integration: loader with defineCron fixture ────────────────────

describe("loadCronJobsFromDirectory (defineCron fixture)", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-loader-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("loads a defineCron-authored file correctly", async () => {
        // The fixture exports the same shape defineCron() returns (identity
        // is proven by the unit tests above). Using a plain object here
        // because the temp .js file can't require() our .ts source.
        const fixture = `
            module.exports = {
                name: "Fixture job",
                schedule: "*/10 * * * *",
                description: "Test fixture",
                handler: async function(ctx) {
                    ctx.log("hello");
                    return { ok: true };
                },
            };
        `;
        fs.writeFileSync(path.join(tmpDir, "fixture-job.js"), fixture);

        const jobs = await loadCronJobsFromDirectory(tmpDir);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].id).toBe("fixture-job");
        expect(jobs[0].definition.name).toBe("Fixture job");
        expect(jobs[0].definition.schedule).toBe("*/10 * * * *");
        expect(jobs[0].definition.description).toBe("Test fixture");
        expect(typeof jobs[0].definition.handler).toBe("function");
    });
});
