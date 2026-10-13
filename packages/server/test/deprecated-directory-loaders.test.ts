import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import path from "node:path";
import { resetDeprecationWarningsForTests } from "@rebasepro/common";
import { declaredResources, resetDeclaredResources } from "@rebasepro/types";

import {
    loadCronJobsFromDirectory,
    loadCronJobsWithDiagnostics,
    loadFunctionsFromDirectory,
    loadFunctionsWithDiagnostics
} from "../src/index";
import { requireImporter } from "./helpers/require-importer";

/**
 * The four directory loaders that returned arrays are deprecated in favour of
 * `loadFunctions` / `loadCrons`, which return `{ [name]: value }`. Each keeps
 * its old shape — and the cron pair keeps declaring what it loads in the
 * resource graph, which the build's derive step reads — and says once per
 * process which name replaces it.
 */

const FUNCTIONS_DIR = path.join(__dirname, "fixtures", "functions");
const CRONS_DIR = path.join(__dirname, "fixtures", "crons");

let warn: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
    resetDeprecationWarningsForTests();
    resetDeclaredResources();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    resetDeclaredResources();
    jest.restoreAllMocks();
});

/** The deprecation lines printed so far, naming `name`. */
const deprecations = (name: string) =>
    warn.mock.calls.map(call => String(call[0])).filter(line => line.includes("Deprecated") && line.includes(name));

describe("loadFunctionsFromDirectory", () => {
    it("still returns the array of { name, app }, and warns once naming loadFunctions", async () => {
        const first = await loadFunctionsFromDirectory(FUNCTIONS_DIR, requireImporter);
        await loadFunctionsFromDirectory(FUNCTIONS_DIR, requireImporter);

        expect(first.map(fn => fn.name).sort()).toEqual(["valid-app", "valid-factory"]);
        expect(typeof first[0].app.fetch).toBe("function");
        expect(deprecations("loadFunctionsFromDirectory")).toHaveLength(1);
        expect(deprecations("loadFunctionsFromDirectory")[0]).toContain("loadFunctions(dir)");
    });
});

describe("loadFunctionsWithDiagnostics", () => {
    it("still returns { functions: [...], problems }, and warns once naming loadFunctions", async () => {
        const first = await loadFunctionsWithDiagnostics(FUNCTIONS_DIR, requireImporter);
        await loadFunctionsWithDiagnostics(FUNCTIONS_DIR, requireImporter);

        expect(first.functions.map(fn => fn.name).sort()).toEqual(["valid-app", "valid-factory"]);
        expect(first.problems).toEqual(expect.arrayContaining([expect.stringContaining("no-default.js")]));
        expect(deprecations("loadFunctionsWithDiagnostics")).toHaveLength(1);
        expect(deprecations("loadFunctionsWithDiagnostics")[0]).toContain("loadFunctions(dir, { onSkip })");
    });
});

describe("loadCronJobsFromDirectory", () => {
    it("still returns normalised { id, definition } jobs, declares them, and warns once", async () => {
        const first = await loadCronJobsFromDirectory(CRONS_DIR, requireImporter);
        resetDeclaredResources();
        await loadCronJobsFromDirectory(CRONS_DIR, requireImporter);

        expect(first).toEqual([expect.objectContaining({ id: "fixture-job" })]);
        expect(first[0].definition).toEqual(expect.objectContaining({ name: "Fixture job", enabled: true, timeoutSeconds: 300 }));
        expect(declaredResources("cron").map(r => r.key)).toEqual(["fixture-job"]);
        expect(deprecations("loadCronJobsFromDirectory")).toHaveLength(1);
        expect(deprecations("loadCronJobsFromDirectory")[0]).toContain("loadCrons(dir)");
    });
});

describe("loadCronJobsWithDiagnostics", () => {
    it("still returns { jobs, problems }, declares the jobs, and warns once naming loadCrons and declareCrons", async () => {
        const first = await loadCronJobsWithDiagnostics(CRONS_DIR, requireImporter);
        resetDeclaredResources();
        await loadCronJobsWithDiagnostics(CRONS_DIR, requireImporter);

        expect(first.jobs.map(job => job.id)).toEqual(["fixture-job"]);
        expect(first.problems).toEqual([]);
        expect(declaredResources("cron").map(r => r.key)).toEqual(["fixture-job"]);
        expect(deprecations("loadCronJobsWithDiagnostics")).toHaveLength(1);
        expect(deprecations("loadCronJobsWithDiagnostics")[0]).toMatch(/loadCrons\(dir, \{ onSkip \}\).*declareCrons/);
    });
});
