import { Hono } from "hono";
import { createServer } from "node:http";
import { col, defineTable, type DatabaseAdapter, type TableDescriptor, type TableHooks, type TableRegistryInterface } from "@rebasepro/types";
import { jest } from "@jest/globals";
import { createCallContext } from "@rebasepro/common";

import { initializeRebaseBackend, type RebaseBackendConfig } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";

/**
 * `initializeRebaseBackend({ hooks })` — the global table hooks
 * `backend/hooks.ts` exports — reaches the drivers that run them.
 *
 * Global hooks were once set on the backend's own `collectionRegistry`, and no
 * driver reads that one: each builds a registry in `initializeDriver` and
 * runs hooks from it. So every global hook — an `afterRead` masking PII
 * across tables, an audit `afterSave`, a tenant-scoping `beforeQuery` — was
 * declared, documented and never called.
 *
 * These drive the entrypoint, with a registry of the class the drivers extend,
 * and check that the hooks reach it as declared — native `TableHooks`, which
 * the driver calls with the descriptor of the table each runs for.
 */

/** A driver registry that takes global hooks, as the Postgres driver's does. */
class HookRegistry implements TableRegistryInterface {
    globalHooks?: TableHooks;
    getTable(): undefined {
        return undefined;
    }
    setGlobalHooks(hooks: TableHooks): void {
        this.globalHooks = hooks;
    }
}

const leads = (hooks?: TableHooks) => defineTable("leads", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text() },
    rls: "admin-only",
    ...(hooks ? { hooks } : {})
});
/** A Postgres-typed adapter whose driver keeps its own registry, as both real drivers do. */
/** The hooks a driver's registry was handed after boot (`setTableHooks`), by slug. */
class DriverTableHooks {
    readonly attached = new Map<string, TableHooks>();
    setTableHooks(slug: string, hooks: TableHooks): boolean {
        this.attached.set(slug, hooks);
        return true;
    }
}

function adapter(options: { type?: string; registry?: HookRegistry | null; introspected?: TableDescriptor[]; driverRegistry?: DriverTableHooks } = {}): DatabaseAdapter {
    const registry = options.registry === undefined ? new HookRegistry() : options.registry;
    return {
        type: options.type ?? "postgres",
        async initializeDriver() {
            return {
                internals: {},
                driver: options.driverRegistry ? Object.assign(fakeDataDriver(), { registry: options.driverRegistry }) : fakeDataDriver(),
                ...(options.introspected ? { tables: options.introspected } : {}),
                ...(registry ? { collectionRegistry: registry } : {})
            };
        },
        async ensureTableSchema() {
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

/** The props a driver calls a hook with, for a table it serves. */
const readProps = (table: TableDescriptor, values: Record<string, unknown>) => ({
    table,
    path: table.slug,
    values,
    context: createCallContext()
});

const leadsDescriptor: TableDescriptor = {
    name: "leads", slug: "leads", table: "leads", schema: "public", kind: "table",
    columns: [{ key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true, default: { kind: "random-uuid" } }],
    primaryKey: ["id"],
    relations: [],
    rls: { posture: "rules", rules: [{ name: "leads_read", operation: "select", using: "true" }], defaultPolicies: false }
};

describe("global hooks", () => {
    it("are handed to the registry the driver runs them from, as declared", async () => {
        const registry = new HookRegistry();
        const seen: TableDescriptor[] = [];
        const hooks: TableHooks = { afterRead: ({ table, values }) => { seen.push(table); return { ...values, masked: true }; } };

        await boot(adapter({ registry }), { hooks });

        // The very object: nothing between the declaration and the driver.
        expect(registry.globalHooks).toBe(hooks);
        expect(await registry.globalHooks?.afterRead?.(readProps(leadsDescriptor, { id: "1" }))).toEqual({ id: "1", masked: true });
        expect(seen).toEqual([leadsDescriptor]);
    });

    it("include a global `beforeQuery` on a Postgres driver", async () => {
        const registry = new HookRegistry();

        await boot(adapter({ registry }), { hooks: { beforeQuery: () => undefined } });

        expect(typeof registry.globalHooks?.beforeQuery).toBe("function");
    });

    it("refuse to boot over a driver that returns no registry to hand them to", async () => {
        // The driver would serve every table with the hooks off, and an
        // `afterRead` that masks a field is exactly the hook nobody notices is
        // missing until the field is read.
        await expect(boot(adapter({ registry: null }), { hooks: { afterRead: ({ values }) => values } }))
            .rejects.toThrow(/returned no registry that accepts global hooks/);
    });

    it("reach a driver that serves introspected tables — whose own descriptors the driver hands them", async () => {
        const registry = new HookRegistry();
        const hooks: TableHooks = { afterRead: ({ values }) => values };
        await boot(adapter({ registry, introspected: [leadsDescriptor] }), { tables: [], hooks });

        expect(registry.globalHooks).toBe(hooks);
    });

    it("refuse to boot when an introspecting driver describes no tables — a hook would have none to receive", async () => {
        await expect(boot(adapter(), { tables: [], hooks: { afterRead: ({ values }) => values } }))
            .rejects.toThrow(/cannot derive tables from the database schema/);
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

    it("replaces what the table declared, says so, and hands the new hooks to the driver as written", async () => {
        const driverRegistry = new DriverTableHooks();
        const backend = await boot(adapter({ driverRegistry }), { tables: [leads({ beforeSave: ({ values }) => values })] });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const hooks: TableHooks = { afterSave: () => undefined };

        backend.setTableHooks("leads", hooks);
        const warned = warn.mock.calls.map(call => String(call[0])).join("\n");
        expect(warned).toMatch(/replaced 'beforeSave'/);
        expect(warned).toMatch(/assigned, not merged/);

        // Replacement is the contract — the cloud relies on it — so the
        // driver runs exactly what was attached: the very object, native.
        expect(driverRegistry.attached.get("leads")).toBe(hooks);
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
