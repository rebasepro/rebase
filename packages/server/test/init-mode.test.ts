import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { createServer } from "node:http";
import path from "node:path";
import type { BackendBootstrapper, DataDriver, InitializedDriver, TableDescriptor } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { initializeRebaseBackend, type RebaseBackendConfig } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";
import { tablesFrom } from "./helpers/tables";

/**
 * Covers the `mode` contract:
 *  - baas derives collections from the driver; cms takes them from config
 *  - a driver that cannot introspect fails baas mode loudly at boot
 *
 * The schema editor follows the same mode — it writes collection files, which
 * baas mode does not have — but it is no longer *unmounted* when it cannot
 * write, so "is the route there?" stopped being the question worth asking about
 * it. What it answers, and to whom, lives in `schema-editor-availability.test.ts`.
 */

function collection(slug: string): LegacyCollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" }
        }
    };
}

/** The descriptor an introspecting driver reports beside {@link collection}. */
function descriptor(slug: string): TableDescriptor {
    return {
        name: slug, slug, table: slug, schema: "public", kind: "table",
        columns: [{ key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true, default: { kind: "random-uuid" } }],
        primaryKey: ["id"],
        relations: [],
        rls: { posture: "rules", rules: [], defaultPolicies: false }
    };
}

/** A driver that does nothing; init only needs it to exist and be routable. */
function stubDriver(): DataDriver {
    return fakeDataDriver({
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        count: async () => 0,
        checkUniqueField: async () => true
    });
}

/**
 * @param reports what initializeDriver reports back on `collections`:
 *   an array = "I introspected and found these"; undefined = "I cannot introspect".
 */
function fakeBootstrapper(reports: LegacyCollectionConfig[] | undefined): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return {
                driver: stubDriver(),
                collections: reports,
                ...(reports ? { tables: reports.map(c => descriptor(c.slug)) } : {}),
                internals: {}
            };
        }
    };
}

async function bootWith(config: Omit<RebaseBackendConfig, "app" | "server">) {
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const backend = await initializeRebaseBackend({
        app,
        server,
        ...config
    });
    return { app, backend };
}

const boot = bootWith;

/**
 * Whether a route is mounted. Without an auth config the data API still mounts
 * but guards every request, so a mounted route answers 401 and an unmounted one
 * 404s. These tests are about which routes exist, not what they return.
 */
async function mounted(app: Hono<HonoEnv>, path: string, method = "GET"): Promise<boolean> {
    return (await app.request(path, { method })).status !== 404;
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    process.env.NODE_ENV = "development";
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
});

describe("no declared collections — derived from the database", () => {
    it("serves the collections the driver derived from the database", async () => {
        const { app, backend } = await boot({
            bootstrappers: [fakeBootstrapper([collection("posts")])]
        });

        // The registry is the precise check: the auth middleware answers every
        // /api/data/* path alike, so route probing alone can't tell which
        // collections are actually registered.
        expect(backend.collectionRegistry.getCollections().map(c => c.slug)).toEqual(["posts"]);
        expect(await mounted(app, "/api/data/posts")).toBe(true);
    });

    it("serves declared collections when there ARE any, rather than discarding them", async () => {
        // This used to be the reverse: `mode: "baas"` alongside declared
        // collections warned and threw them away. That state cannot be
        // expressed now — declaring collections IS what makes them served, so
        // the flag and the data can no longer disagree.
        const { backend } = await boot({
            ...tablesFrom([collection("from_config")]),
            bootstrappers: [fakeBootstrapper([collection("from_database")])]
        });

        expect(backend.collectionRegistry.getCollections().map(c => c.slug)).toEqual(["from_config"]);
    });

    it("fails at boot when the driver cannot introspect, instead of serving nothing", async () => {
        // A driver reporting `undefined` never looked at the schema, so this
        // server could only ever 404 — it must not boot "successfully".
        await expect(
            boot({
                bootstrappers: [fakeBootstrapper(undefined)]
            })
        ).rejects.toThrow(/cannot derive tables from the database schema/);
    });

    it("warns, but still boots, when the database has no tables yet", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        const { app } = await boot({
            bootstrappers: [fakeBootstrapper([])]
        });

        expect(warn.mock.calls.flat().join(" ")).toMatch(/found no tables/);
        // Nothing to serve, so no data API.
        expect(await mounted(app, "/api/data/anything")).toBe(false);
    });
});

describe("declared collections", () => {
    it("serves collections from config", async () => {
        const { app } = await boot({
            ...tablesFrom([collection("posts")]),
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        // A driver without introspection is fine here — cms declares collections.
        expect(await mounted(app, "/api/data/posts")).toBe(true);
    });
});

describe("cron", () => {
    it("mounts the cron surface for the directory, not for the jobs in it", async () => {
        // A directory with no loadable job files — which is also what a
        // directory of jobs looks like when every one of them fails to import.
        // Mounting only on `loadedJobs.length > 0` meant one syntax error took
        // `/api/cron` and the Studio cron panel with it, leaving a 404 that
        // reads as a broken deploy and one line in the boot log.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        const { app } = await boot({
            ...tablesFrom([collection("posts")]),
            cronsDir: path.join(__dirname, "fixtures"),
            cronPersistence: false,
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        expect(await mounted(app, "/api/cron")).toBe(true);
        expect(warn.mock.calls.flat().join(" ")).toMatch(/no jobs loaded/);
    });
});
