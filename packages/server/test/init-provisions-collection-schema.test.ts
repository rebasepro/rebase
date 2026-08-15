import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, DatabaseAdapter } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";

/**
 * `initializeRebaseBackend` provisions the collection schema. Every caller.
 *
 * This used to live in `bootFromBundle`, which meant it ran for managed tenants
 * and for nobody else. An app that ships its own image boots by calling
 * `initializeRebaseBackend` directly, so it got no tables: it came up serving
 * sign-in — auth bootstraps its own tables, which is what made the failure look
 * like a data bug rather than a boot bug — and 500'd every `/api/data/*` route.
 * A green deploy, a healthy `/health`, and weeks of it.
 *
 * The old tests all drove the bundle path, so they passed throughout. These
 * drive the entrypoint both paths share, which is the only place a test can sit
 * and still be true for both.
 */

const collection = (slug: string): CollectionConfig =>
    ({ slug, name: slug, table: slug, properties: { id: { name: "ID", type: "string", isId: "uuid" } } } as unknown as CollectionConfig);

interface Recorder {
    schemaCalls: number;
    policyCalls: number;
    initConfig?: { schemaProvisioning?: { attempted: boolean; reason?: string } };
    order: string[];
}

/** An adapter that records the provisioning protocol it is driven through. */
function recordingAdapter(recorder: Recorder, over: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
    return {
        type: "postgres",
        async initializeDriver(config: unknown) {
            recorder.order.push("initializeDriver");
            recorder.initConfig = config as Recorder["initConfig"];
            return { internals: {}, driver: {} as never } as never;
        },
        async ensureCollectionSchema() {
            recorder.order.push("ensureCollectionSchema");
            recorder.schemaCalls++;
            return { applied: 1 };
        },
        async ensureCollectionPolicies() {
            recorder.order.push("ensureCollectionPolicies");
            recorder.policyCalls++;
            return { applied: 2 };
        },
        async initializeAuth() {
            recorder.order.push("initializeAuth");
            // The shape init.ts destructures; enough to reach the policy phase.
            return { userService: {}, authRepository: {} } as never;
        },
        ...over
    } as unknown as DatabaseAdapter;
}

const recorder = (): Recorder => ({ schemaCalls: 0, policyCalls: 0, order: [] });

async function boot(adapter: DatabaseAdapter, extra: Record<string, unknown> = {}) {
    await initializeRebaseBackend({
        app: new Hono() as never,
        server: {} as never,
        collections: [collection("leads")],
        database: adapter,
        ...extra
    } as never);
}

const originalNodeEnv = process.env.NODE_ENV;
const originalMode = process.env.REBASE_MIGRATE_ON_BOOT;

beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.REBASE_MIGRATE_ON_BOOT;
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalMode === undefined) delete process.env.REBASE_MIGRATE_ON_BOOT;
    else process.env.REBASE_MIGRATE_ON_BOOT = originalMode;
    jest.restoreAllMocks();
});

describe("initializeRebaseBackend provisions the collection schema", () => {
    it("creates tables for an app that passes its own adapter", async () => {
        const rec = recorder();
        await boot(recordingAdapter(rec));

        expect(rec.schemaCalls).toBe(1);
    });

    it("creates the tables BEFORE the driver initializes", async () => {
        // Load-bearing, not cosmetic: the driver introspects the tables during
        // initialization and attaches its change-capture triggers to them, so a
        // table created afterwards stays uninstrumented until the next restart.
        const rec = recorder();
        await boot(recordingAdapter(rec));

        expect(rec.order.indexOf("ensureCollectionSchema")).toBeLessThan(rec.order.indexOf("initializeDriver"));
    });

    it("applies policies AFTER auth initializes", async () => {
        // Also load-bearing: generated policies call the `auth.*` helper
        // functions, and CREATE POLICY validates those exist — they are created
        // during auth initialization.
        const rec = recorder();
        await boot(recordingAdapter(rec), { auth: { collection: collection("users"), jwtSecret: "x".repeat(40) } });

        expect(rec.policyCalls).toBe(1);
        expect(rec.order.indexOf("ensureCollectionPolicies")).toBeGreaterThan(rec.order.indexOf("initializeAuth"));
    });

    it("tells the driver whether provisioning ran, so its drift check can be honest", async () => {
        const rec = recorder();
        await boot(recordingAdapter(rec));

        expect(rec.initConfig?.schemaProvisioning).toEqual({ attempted: true, reason: undefined });
    });

    it("reports the reason to the driver when it declines", async () => {
        process.env.REBASE_MIGRATE_ON_BOOT = "none";
        const rec = recorder();
        await boot(recordingAdapter(rec));

        expect(rec.schemaCalls).toBe(0);
        expect(rec.initConfig?.schemaProvisioning?.attempted).toBe(false);
        expect(rec.initConfig?.schemaProvisioning?.reason).toContain("REBASE_MIGRATE_ON_BOOT=none");
    });

    it("does not create tables for a project that introspects its collections", async () => {
        // Declaring nothing means the database is the source of truth. Creating
        // anything here would push a schema into a database only meant to be
        // read.
        const rec = recorder();
        await initializeRebaseBackend({
            app: new Hono() as never,
            server: {} as never,
            database: recordingAdapter(rec, {
                async initializeDriver(config: unknown) {
                    rec.order.push("initializeDriver");
                    rec.initConfig = config as Recorder["initConfig"];
                    return { internals: {}, driver: {} as never, collections: [collection("found")] } as never;
                }
            } as Partial<DatabaseAdapter>)
        } as never);

        expect(rec.schemaCalls).toBe(0);
    });

    it("survives a schemaless adapter that implements neither hook", async () => {
        // The skip path must not throw: a driver without these methods is a
        // legitimate shape, not a broken one.
        const rec = recorder();
        const schemaless = recordingAdapter(rec);
        delete (schemaless as Partial<BackendBootstrapper>).ensureCollectionSchema;
        delete (schemaless as Partial<BackendBootstrapper>).ensureCollectionPolicies;

        await expect(boot(schemaless)).resolves.not.toThrow();
    });
});
