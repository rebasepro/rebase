import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";

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

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" }
        }
    } as unknown as CollectionConfig;
}

/** A driver that does nothing; init only needs it to exist and be routable. */
function stubDriver() {
    return {
        fetchCollection: jest.fn(async () => ({ data: [], meta: { total: 0, hasMore: false } })),
        fetchEntity: jest.fn(async () => undefined),
        saveEntity: jest.fn(async () => ({})),
        deleteEntity: jest.fn(async () => undefined),
        countCollection: jest.fn(async () => 0),
        checkUniqueField: jest.fn(async () => true),
        healthCheck: jest.fn(async () => ({ healthy: true, latencyMs: 1 }))
    } as never;
}

/**
 * @param reports what initializeDriver reports back on `collections`:
 *   an array = "I introspected and found these"; undefined = "I cannot introspect".
 */
function fakeBootstrapper(reports: CollectionConfig[] | undefined): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return {
                driver: stubDriver(),
                collections: reports,
                internals: {}
            } as unknown as InitializedDriver;
        }
    } as unknown as BackendBootstrapper;
}

async function bootWith(config: Record<string, unknown>) {
    const app = new Hono();
    const server = {} as never;
    const backend = await initializeRebaseBackend({
        app: app as never,
        server,
        ...config
    } as never);
    return { app, backend };
}

const boot = bootWith;

/**
 * Whether a route is mounted. Without an auth config the data API still mounts
 * but guards every request, so a mounted route answers 401 and an unmounted one
 * 404s. These tests are about which routes exist, not what they return.
 */
async function mounted(app: Hono, path: string, method = "GET"): Promise<boolean> {
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
            collections: [collection("from_config")],
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
        ).rejects.toThrow(/cannot derive collections from the database schema/);
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
            collections: [collection("posts")],
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        // A driver without introspection is fine here — cms declares collections.
        expect(await mounted(app, "/api/data/posts")).toBe(true);
    });
});
