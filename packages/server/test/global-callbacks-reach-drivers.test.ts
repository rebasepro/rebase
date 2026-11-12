import { Hono } from "hono";
import { createServer } from "node:http";
import { col, defineTable, type DatabaseAdapter, type TableDescriptor, type TableHooks } from "@rebasepro/types";
import { jest } from "@jest/globals";
import { CollectionRegistry, createCallContext } from "@rebasepro/common";

import { initializeRebaseBackend, type RebaseBackendConfig } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";

/**
 * `initializeRebaseBackend({ hooks })` — the global table hooks
 * `backend/hooks.ts` exports — reaches the drivers that run them.
 *
 * Global hooks were once set on the backend's own `collectionRegistry`, and no
 * driver reads that one: each builds a registry in `initializeDriver` and
 * resolves callbacks from it. So every global hook — an `afterRead` masking PII
 * across tables, an audit `afterSave`, a tenant-scoping `beforeQuery` — was
 * declared, documented and never called.
 *
 * These drive the entrypoint, with a registry of the class the drivers extend,
 * and check that a hook receives the descriptor of the table it runs for.
 */

const leads = (hooks?: TableHooks) => defineTable("leads", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text() },
    rls: "admin-only",
    ...(hooks ? { hooks } : {})
});
/** A Postgres-typed adapter whose driver keeps its own registry, as both real drivers do. */
function adapter(options: { type?: string; registry?: CollectionRegistry | null } = {}): DatabaseAdapter {
    const registry = options.registry === undefined ? new CollectionRegistry() : options.registry;
    return {
        type: options.type ?? "postgres",
        async initializeDriver() {
            return {
                internals: {},
                driver: fakeDataDriver(),
                ...(registry ? { collectionRegistry: registry } : {})
            };
        },
        async ensureCollectionSchema() {
            return { applied: 0 };
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    };
}

async function boot(database: DatabaseAdapter, extra: Partial<RebaseBackendConfig> = {}) {
    return initializeRebaseBackend({
        app: new Hono<HonoEnv>(),
        server: createServer(),
        tables: [leads()],
        database,
        ...extra
    });
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    process.env.NODE_ENV = "test";
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
});

/** The legacy callback props the drivers call a global hook with. */
const readProps = (row: Record<string, unknown>) => ({
    collection: { slug: "leads", name: "leads", properties: {} },
    path: "leads",
    row,
    context: createCallContext()
});

describe("global hooks", () => {
    it("are handed to the registry the driver resolves them from, with the table's descriptor", async () => {
        const registry = new CollectionRegistry();
        const seen: TableDescriptor[] = [];
        const hooks: TableHooks = { afterRead: ({ table, values }) => { seen.push(table); return { ...values, masked: true }; } };

        await boot(adapter({ registry }), { hooks });

        const afterRead = registry.getGlobalCallbacks()?.afterRead;
        expect(afterRead).toBeDefined();
        expect(await afterRead?.(readProps({ id: "1" }))).toEqual({ id: "1", masked: true });
        expect(seen.map(table => table.slug)).toEqual(["leads"]);
    });

    it("include a global `beforeQuery` on a Postgres driver", async () => {
        const registry = new CollectionRegistry();

        await boot(adapter({ registry }), { hooks: { beforeQuery: () => undefined } });

        expect(typeof registry.getGlobalCallbacks()?.beforeQuery).toBe("function");
    });

    it("refuse to boot over a driver that returns no registry to hand them to", async () => {
        // The driver would serve every table with the hooks off, and an
        // `afterRead` that masks a field is exactly the hook nobody notices is
        // missing until the field is read.
        await expect(boot(adapter({ registry: null }), { hooks: { afterRead: ({ values }) => values } }))
            .rejects.toThrow(/returned no collection registry that accepts global callbacks/);
    });

    it("refuse to boot a backend that declares no tables — an introspected table has no descriptor to hand them", async () => {
        await expect(boot(adapter(), { tables: [], hooks: { afterRead: ({ values }) => values } }))
            .rejects.toThrow(/declares no tables/);
    });

    it("still boot a driver with no registry when none are declared", async () => {
        await expect(boot(adapter({ registry: null }))).resolves.toBeDefined();
    });
});

describe("setTableHooks", () => {
    it("accepts a `beforeQuery` on a declared table", async () => {
        const backend = await boot(adapter());

        expect(() => backend.setTableHooks("leads", { beforeQuery: () => undefined })).not.toThrow();
    });

    it("replaces what the table declared, says so, and adapts the new hooks to the descriptor", async () => {
        const backend = await boot(adapter(), { tables: [leads({ beforeSave: ({ values }) => values })] });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const seen: string[] = [];

        backend.setTableHooks("leads", { afterSave: ({ table }) => { seen.push(table.slug); } });
        const warned = warn.mock.calls.map(call => String(call[0])).join("\n");
        expect(warned).toMatch(/replaced 'beforeSave'/);
        expect(warned).toMatch(/assigned, not merged/);

        // Replacement is the contract — the cloud relies on it — so the
        // table now carries exactly what was attached.
        const callbacks = backend.collectionRegistry.get("leads")?.callbacks;
        expect(Object.keys(callbacks ?? {})).toEqual(["afterSave"]);
        await callbacks?.afterSave?.({
            collection: { slug: "leads", name: "leads", properties: {} }, path: "leads", id: "1", values: {}, status: "new", context: createCallContext()
        });
        expect(seen).toEqual(["leads"]);
        warn.mockRestore();
    });

    it("warns when the table is not declared", async () => {
        const backend = await boot(adapter());
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

        backend.setTableHooks("nope", { afterSave: () => undefined });

        expect(warn.mock.calls.map(call => String(call[0])).join("\n")).toMatch(/Table "nope" not found/);
        warn.mockRestore();
    });

    it("exposes the compiled descriptors on the instance", async () => {
        const backend = await boot(adapter());

        expect(backend.getTableDescriptors().map(table => table.slug)).toEqual(["leads"]);
        expect(backend.getTableDescriptor("leads")?.primaryKey).toEqual(["id"]);
        expect(backend.getTableDescriptor("nope")).toBeUndefined();
    });
});
