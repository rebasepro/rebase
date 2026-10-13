import { describe, it, expect } from "@jest/globals";
import * as path from "path";
import { defineCron } from "./define-cron";
import { loadCrons } from "./cron-loader";
import { requireImporter } from "../../test/helpers/require-importer";
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
        defineCron({
            name: "Bad",
            // @ts-expect-error — 'shedule' is not a valid field on CronJobDefinition.
            // The directive sits on the property, not on the `defineCron(` line:
            // tsc reports an excess property where it is written, so a directive
            // one line above the call suppresses nothing and asserts nothing.
            shedule: "* * * * *",
            handler: async () => undefined,
        });
    });
});

// ─── Integration: loader with defineCron fixture ────────────────────

describe("loadCrons (defineCron fixture)", () => {
    // Load from a committed fixtures directory (test/fixtures/crons) rather
    // than writing a temp file at runtime. The fixture is a CJS module (a
    // nested package.json pins `"type": "commonjs"` inside server's ESM
    // package) exporting the same shape defineCron() returns. Using a stable
    // on-disk fixture avoids the mkdtemp→write→native-import→rmSync lifecycle,
    // which raced under jest's parallel workers and intermittently yielded an
    // empty result.
    const cronsDir = path.resolve(__dirname, "../../test/fixtures/crons");

    it("loads a defineCron-authored file as the value it exports, keyed by file name", async () => {
        const crons = await loadCrons(cronsDir, { importModule: requireImporter });

        expect(Object.keys(crons)).toEqual(["fixture-job"]);
        const job = crons["fixture-job"];
        expect(job.name).toBe("Fixture job");
        expect(job.schedule).toBe("*/10 * * * *");
        expect(job.description).toBe("Test fixture");
        expect(typeof job.handler).toBe("function");
    });
});
