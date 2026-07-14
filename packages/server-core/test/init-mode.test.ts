import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";

/**
 * Covers the `mode` contract:
 *  - baas derives collections from the driver; cms takes them from config
 *  - the schema editor follows the mode (it writes collection files, which
 *    baas mode does not have)
 *  - a driver that cannot introspect fails baas mode loudly at boot
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

describe("mode: baas", () => {
    it("serves the collections the driver derived from the database", async () => {
        const { app, backend } = await boot({
            mode: "baas",
            bootstrappers: [fakeBootstrapper([collection("posts")])]
        });

        // The registry is the precise check: the auth middleware answers every
        // /api/data/* path alike, so route probing alone can't tell which
        // collections are actually registered.
        expect(backend.collectionRegistry.getCollections().map(c => c.slug)).toEqual(["posts"]);
        expect(await mounted(app, "/api/data/posts")).toBe(true);
    });

    it("does not mount the schema editor — there are no collection files to edit", async () => {
        const { app } = await boot({
            mode: "baas",
            collectionsDir: "/tmp/does-not-matter",
            bootstrappers: [fakeBootstrapper([collection("posts")])]
        });

        expect(await mounted(app, "/api/schema-editor/collection/save", "POST")).toBe(false);
    });

    it("ignores configured collections rather than silently serving them", async () => {
        const { backend } = await boot({
            mode: "baas",
            collections: [collection("from_config")],
            bootstrappers: [fakeBootstrapper([collection("from_database")])]
        });

        expect(backend.collectionRegistry.getCollections().map(c => c.slug)).toEqual(["from_database"]);
    });

    it("fails at boot when the driver cannot introspect, instead of serving nothing", async () => {
        // A driver reporting `undefined` never looked at the schema — baas mode
        // could only ever 404, so it must not boot "successfully".
        await expect(
            boot({
                mode: "baas",
                bootstrappers: [fakeBootstrapper(undefined)]
            })
        ).rejects.toThrow(/does not support baas mode/);
    });

    it("warns, but still boots, when the database has no tables yet", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        const { app } = await boot({
            mode: "baas",
            bootstrappers: [fakeBootstrapper([])]
        });

        expect(warn.mock.calls.flat().join(" ")).toMatch(/found no tables/);
        // Nothing to serve, so no data API.
        expect(await mounted(app, "/api/data/anything")).toBe(false);
    });
});

describe("mode: cms (default)", () => {
    it("defaults to cms and serves collections from config", async () => {
        const { app } = await boot({
            collections: [collection("posts")],
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        // A driver without introspection is fine here — cms declares collections.
        expect(await mounted(app, "/api/data/posts")).toBe(true);
    });

    it("mounts the schema editor outside production when a collectionsDir is set", async () => {
        const { app } = await boot({
            collections: [collection("posts")],
            collectionsDir: "/tmp/rebase-init-mode-test",
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        expect(await mounted(app, "/api/schema-editor/collection/save", "POST")).toBe(true);
    });

    it("does not mount the schema editor in production", async () => {
        process.env.NODE_ENV = "production";

        const { app } = await boot({
            collections: [collection("posts")],
            collectionsDir: "/tmp/rebase-init-mode-test",
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        expect(await mounted(app, "/api/schema-editor/collection/save", "POST")).toBe(false);
    });
});

describe("schemaEditor override", () => {
    it("can be forced off in cms mode", async () => {
        const { app } = await boot({
            collections: [collection("posts")],
            collectionsDir: "/tmp/rebase-init-mode-test",
            schemaEditor: false,
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        expect(await mounted(app, "/api/schema-editor/collection/save", "POST")).toBe(false);
    });

    it("warns and stays off when forced on with nowhere to write", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        const { app } = await boot({
            collections: [collection("posts")],
            schemaEditor: true,
            bootstrappers: [fakeBootstrapper(undefined)]
        });

        expect(warn.mock.calls.flat().join(" ")).toMatch(/no collectionsDir/);
        expect(await mounted(app, "/api/schema-editor/collection/save", "POST")).toBe(false);
    });
});
