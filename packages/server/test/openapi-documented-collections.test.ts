import { describe, expect, it, afterEach } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { database, resetDeclaredResources } from "@rebasepro/types";

/**
 * Which collections the published document describes.
 *
 * The router is built from the collections whose data source has a `"server"`
 * transport — "collections on a direct/custom transport are client-only, the
 * backend must not expose a (mis-engined) endpoint for them" — and the document
 * was generated eight lines later from the *unfiltered* list. So a Firestore
 * collection sitting next to the Postgres ones got a full set of CRUD paths in
 * `/api/docs`, every one of which 404s: the API Explorer offers a Try-It button
 * for each, and a generated client compiles a whole class whose every method
 * fails at runtime. The one collection the backend deliberately refuses to
 * serve was the one it advertised hardest.
 */

const stubDriver = {
    fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
    fetchEntity: async () => undefined,
    saveEntity: async () => ({}),
    deleteEntity: async () => undefined,
    countCollection: async () => 0,
    checkUniqueField: async () => true,
    healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
    admin: { executeSql: async () => [] }
} as never;

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return { driver: stubDriver, collections: [], internals: {} } as unknown as InitializedDriver;
    },
    // Enough for the built-in auth adapter to be constructed; nothing here
    // logs in.
    async initializeAuth() {
        return { userService: {}, authRepository: {} };
    }
} as unknown as BackendBootstrapper;

const collection = (slug: string, extra: Record<string, unknown> = {}): CollectionConfig =>
    ({
        name: slug, slug, table: slug, singularName: slug.slice(0, -1),
        properties: { id: { name: "ID", type: "string", isId: "uuid" } },
        ...extra
    } as unknown as CollectionConfig);

type Booted = { app: Hono; stop: () => void };
const started: Booted[] = [];

async function boot(): Promise<Hono> {
    const app = new Hono();
    // Declared, not configured. `transport` lives on the declaration, so the
    // collection still names only which source it belongs to — and the backend
    // reads the graph these registered rather than a `dataSources` array.
    resetDeclaredResources();
    database();
    database("firestore", { engine: "firestore", transport: "direct" });
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("jobs"), collection("orders", { dataSource: "firestore" })],
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        auth: { requireAuth: false, jwtSecret: "openapi-documented-collections-secret-123456" }
    } as never);
    const booted = {
        app,
        stop: () => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.()
    };
    started.push(booted);
    return app;
}

afterEach(() => {
    while (started.length) started.pop()!.stop();
});

describe("/api/docs", () => {
    it("describes the collections the backend actually serves", async () => {
        const app = await boot();

        const spec = await (await app.request("/api/docs")).json() as { paths: Record<string, unknown> };

        expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/data/jobs", "/data/jobs/{id}"]));
    });

    it("describes no path for a collection on a direct transport", async () => {
        const app = await boot();

        const spec = await (await app.request("/api/docs")).json() as { paths: Record<string, unknown> };

        expect(Object.keys(spec.paths).filter(p => p.includes("orders"))).toEqual([]);
    });

    it("documents nothing it does not route", async () => {
        // The property, not the example: every documented `/data/...` path must
        // answer something other than 404 for the verb it declares.
        const app = await boot();

        const spec = await (await app.request("/api/docs")).json() as { paths: Record<string, unknown> };
        const listPaths = Object.keys(spec.paths).filter(p => /^\/data\/[^/]+$/.test(p));

        expect(listPaths.length).toBeGreaterThan(0);
        for (const path of listPaths) {
            expect({ path, status: (await app.request(`/api${path}`)).status }).not.toMatchObject({ status: 404 });
        }
    });
});
