import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import path from "node:path";
import { declaredResources, resetDeclaredResources, type BackendBootstrapper, type CollectionConfig, type InitializedDriver } from "@rebasepro/types";

import { declareCrons, defineCron, defineFunction, initializeRebaseBackend, loadCrons, loadFunctions } from "../src/index";
import { _resetRebaseMock } from "../src/singleton";
import { requireImporter } from "./helpers/require-importer";

// A boot reads `functionsDir` / `cronsDir` through the runtime's own `import()`,
// which jest's vm cannot do deterministically — see the same mock in
// `runtime-surfaces.test.ts`. The loader logic itself is the real one.
jest.mock("../src/utils/dynamic-import", () => ({
    ...(jest.requireActual("../src/utils/dynamic-import") as Record<string, unknown>),
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deterministic CJS load, as in the helper's own docblock
    nativeDynamicImport: (url: string) => require("./helpers/require-importer").requireImporter(url)
}));

/**
 * Functions and crons are values, as collections already were.
 *
 * `functions` / `crons` take `{ [name]: value }`, and `loadFunctions` /
 * `loadCrons` read a directory into exactly that shape — so the directory
 * options are one way of producing the values, not a separate feature. What is
 * pinned here is that equivalence, the refusal to take both sources at once,
 * and that loading a directory no longer writes the process-wide resource graph
 * as a side effect.
 */

const FUNCTIONS_DIR = path.join(__dirname, "fixtures", "functions");
const CRONS_DIR = path.join(__dirname, "fixtures", "crons");
const SERVICE_KEY = "values-test-service-key-0123456789abcdef!";
const asService = { headers: { authorization: `Bearer ${SERVICE_KEY}` } };

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

function bootstrapper(): BackendBootstrapper {
    const driver = {
        fetchCollection: async () => [],
        withAuth: async () => driver,
        admin: { executeSql: async () => [] }
    };
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    } as unknown as BackendBootstrapper;
}

const stops: Array<() => Promise<void>> = [];

async function boot(extra: Record<string, unknown>) {
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: { close: (cb: () => void) => cb() } as never,
        collections: [collection("widgets")],
        bootstrappers: [bootstrapper()],
        auth: { jwtSecret: "values-test-jwt-secret-0123456789abcdef", serviceKey: SERVICE_KEY },
        cronPersistence: false,
        ...extra
    } as never);
    stops.push(() => backend.shutdown(0));
    return { app, backend };
}

afterEach(async () => {
    while (stops.length) await stops.pop()!();
    _resetRebaseMock();
    jest.restoreAllMocks();
});

describe("functions as values", () => {
    it("serves each value at its record key", async () => {
        const hello = defineFunction((app) => {
            app.get("/hi", (c) => c.text("hi from a value"));
        });

        const { app } = await boot({ functions: { hello } });

        const res = await app.request("/api/functions/hello/hi");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hi from a value");

        const listed = await (await app.request("/api/functions", asService)).json() as { functions: { name: string; endpoint: string }[] };
        expect(listed.functions).toEqual([{ name: "hello", endpoint: "/api/functions/hello" }]);
    });

    it("`functions: await loadFunctions(dir)` serves what `functionsDir: dir` serves", async () => {
        const fromDir = (await boot({ functionsDir: FUNCTIONS_DIR })).app;
        const fromValues = (await boot({
            functions: await loadFunctions(FUNCTIONS_DIR, { importModule: requireImporter })
        })).app;

        const answers = async (app: Hono) => ({
            listed: ((await (await app.request("/api/functions", asService)).json()) as { functions: unknown[] }).functions,
            hello: await (await app.request("/api/functions/valid-app/hello")).text(),
            factory: await (await app.request("/api/functions/valid-factory/hello", { method: "POST" })).text()
        });
        expect(await answers(fromValues)).toEqual(await answers(fromDir));
        expect((await answers(fromValues)).listed).toEqual([
            { name: "valid-app", endpoint: "/api/functions/valid-app" },
            { name: "valid-factory", endpoint: "/api/functions/valid-factory" }
        ]);
    });

    it("refuses `functions` and `functionsDir` together, naming both", async () => {
        await expect(boot({ functions: {}, functionsDir: FUNCTIONS_DIR }))
            .rejects.toThrow(/Both `functions` and `functionsDir` are set/);
    });
});

describe("crons as values", () => {
    it("schedules each value under its record key, with the scheduler's defaults", async () => {
        const nightly = defineCron({ schedule: "0 3 * * *", handler: async () => undefined });

        const { backend, app } = await boot({ crons: { "nightly-report": nightly } });

        const jobs = await backend.cronScheduler!.fetchJobs();
        expect(jobs.map(job => job.id)).toEqual(["nightly-report"]);
        // Filled in at registration — the value itself is left as written.
        expect(jobs[0].name).toBe("nightly-report");
        expect(nightly).not.toHaveProperty("name");

        const listed = await (await app.request("/api/admin/cron", asService)).json() as { jobs: { id: string }[] };
        expect(listed.jobs.map(job => job.id)).toEqual(["nightly-report"]);
    });

    it("`crons: await loadCrons(dir)` schedules what `cronsDir: dir` schedules", async () => {
        const fromDir = await boot({ cronsDir: CRONS_DIR });
        const fromValues = await boot({ crons: await loadCrons(CRONS_DIR, { importModule: requireImporter }) });

        const ids = async (b: typeof fromDir) => (await b.backend.cronScheduler!.fetchJobs()).map(job => [job.id, job.name, job.schedule]);
        expect(await ids(fromValues)).toEqual(await ids(fromDir));
        expect(await ids(fromValues)).toEqual([["fixture-job", "Fixture job", "*/10 * * * *"]]);
    });

    it("refuses `crons` and `cronsDir` together, naming both", async () => {
        await expect(boot({ crons: {}, cronsDir: CRONS_DIR }))
            .rejects.toThrow(/Both `crons` and `cronsDir` are set/);
    });

    it("refuses a value that is not a cron job, by its key", async () => {
        await expect(boot({ crons: { broken: { schedule: "0 3 * * *" } } }))
            .rejects.toThrow(/crons\["broken"\] is not a cron job/);
    });
});

describe("loading declares nothing", () => {
    afterEach(() => resetDeclaredResources());

    it("loadCrons leaves the resource graph alone; declareCrons is the explicit step", async () => {
        resetDeclaredResources();

        const crons = await loadCrons(CRONS_DIR, { importModule: requireImporter });
        expect(declaredResources("cron")).toEqual([]);

        declareCrons(crons);
        expect(declaredResources("cron").map(r => [r.key, r.options])).toEqual([
            // As written: no `enabled` or `timeoutSeconds` the author did not write.
            ["fixture-job", { schedule: "*/10 * * * *", description: "Test fixture" }]
        ]);
    });

    it("booting with crons does not declare them either", async () => {
        resetDeclaredResources();

        await boot({ cronsDir: CRONS_DIR });

        expect(declaredResources("cron")).toEqual([]);
    });
});
