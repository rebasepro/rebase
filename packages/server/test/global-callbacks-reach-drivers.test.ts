import { Hono } from "hono";
import type { CollectionCallbacks, CollectionConfig, DatabaseAdapter } from "@rebasepro/types";
import { CollectionRegistry } from "@rebasepro/common";

import { initializeRebaseBackend } from "../src/init";

/**
 * `initializeRebaseBackend({ callbacks })` reaches the drivers that run them.
 *
 * Global callbacks were set on the backend's own `collectionRegistry`, and no
 * driver reads that one: each builds a registry in `initializeDriver` and
 * resolves callbacks from it. So every global hook — an `afterRead` masking PII
 * across collections, an audit `afterSave`, a tenant-scoping `beforeQuery` —
 * was declared, documented and never called.
 *
 * The driver-side tests could not see it: each mocks `getGlobalCallbacks` on
 * the registry it hands the driver, which is precisely the step boot skipped.
 * These drive the entrypoint, with a registry of the class the drivers extend.
 */

const collection = (slug: string, extra: Record<string, unknown> = {}): CollectionConfig =>
    ({ slug, name: slug, table: slug, properties: { id: { name: "ID", type: "string", isId: "uuid" } }, ...extra } as unknown as CollectionConfig);

/** A Postgres-typed adapter whose driver keeps its own registry, as both real drivers do. */
function adapter(options: { type?: string; registry?: CollectionRegistry | null } = {}): DatabaseAdapter {
    const registry = options.registry === undefined ? new CollectionRegistry() : options.registry;
    return {
        type: options.type ?? "postgres",
        async initializeDriver() {
            return {
                internals: {},
                driver: {} as never,
                ...(registry ? { collectionRegistry: registry } : {})
            } as never;
        },
        async ensureCollectionSchema() {
            return { applied: 0 };
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} } as never;
        }
    } as unknown as DatabaseAdapter;
}

async function boot(database: DatabaseAdapter, extra: Record<string, unknown> = {}) {
    return initializeRebaseBackend({
        app: new Hono() as never,
        server: {} as never,
        collections: [collection("leads")],
        database,
        ...extra
    } as never);
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    process.env.NODE_ENV = "test";
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
});

describe("global callbacks", () => {
    it("are handed to the registry the driver resolves them from", async () => {
        const registry = new CollectionRegistry();
        const callbacks: CollectionCallbacks = { afterRead: ({ row }) => row };

        await boot(adapter({ registry }), { callbacks });

        expect(registry.getGlobalCallbacks()).toBe(callbacks);
    });

    it("include a global `beforeQuery` on a Postgres driver", async () => {
        const registry = new CollectionRegistry();
        const callbacks: CollectionCallbacks = { beforeQuery: () => undefined };

        await boot(adapter({ registry }), { callbacks });

        expect(registry.getGlobalCallbacks()?.beforeQuery).toBe(callbacks.beforeQuery);
    });

    it("refuse to boot over a driver that returns no registry to hand them to", async () => {
        // The driver would serve every collection with the hooks off, and an
        // `afterRead` that masks a field is exactly the hook nobody notices is
        // missing until the field is read.
        await expect(boot(adapter({ registry: null }), { callbacks: { afterRead: ({ row }) => row } }))
            .rejects.toThrow(/returned no collection registry that accepts global callbacks/);
    });

    it("refuse a global `beforeQuery` on a driver that does not compile one", async () => {
        await expect(boot(adapter({ type: "mongodb" }), { callbacks: { beforeQuery: () => undefined } }))
            .rejects.toThrow(/a global `beforeQuery`.*served by `mongodb`/);
    });

    it("still boot a driver with no registry when none are declared", async () => {
        await expect(boot(adapter({ registry: null }))).resolves.toBeDefined();
    });
});

describe("setCollectionCallbacks", () => {
    it("refuses a `beforeQuery` attached to a collection Postgres does not serve", async () => {
        // The boot-time check read the callbacks the collection declared, not
        // ones attached afterwards, so this is the one path around it.
        const backend = await boot(adapter(), {
            collections: [collection("leads"), collection("events", { engine: "mongodb" })]
        });

        expect(() => backend.setCollectionCallbacks("events", { beforeQuery: () => undefined }))
            .toThrow(/events\.callbacks\.beforeQuery/);
    });

    it("accepts one on a Postgres collection", async () => {
        const backend = await boot(adapter());

        expect(() => backend.setCollectionCallbacks("leads", { beforeQuery: () => undefined })).not.toThrow();
    });
});
