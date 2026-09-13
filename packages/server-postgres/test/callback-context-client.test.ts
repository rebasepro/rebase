/**
 * `context.client` in a collection callback, as a running server hands it —
 * checked against what the type says it is.
 *
 * The type said `RebaseClient`, `data` included. The object is the server
 * singleton, which has had no `data` since the admin plane was given one name
 * (`dataAsAdmin`), and the driver passed it through a cast. So
 * `context.client.data.collection(...)` compiled and threw "Cannot read
 * properties of undefined" in production: the saas control plane's stop/start
 * hooks read through it, flipped the project's status and paused nothing
 * (found 2026-09-13). Its test fixture modelled `client: { data }` — the shape
 * the code assumed, not the one it got — so that suite was green throughout.
 *
 * So nothing here is modelled. The client comes from `initializeRebaseBackend`,
 * which builds the singleton and attaches it to the driver; the context comes
 * from a real `PostgresBackendDriver` over PGlite; the write goes through the
 * singleton's own `dataAsAdmin`, the scoped transaction path a request takes.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionCallbacks, CollectionConfig, InitializedDriver, RebaseCallContext } from "@rebasepro/types";
import { initializeRebaseBackend, rebase, _resetRebaseMock } from "@rebasepro/server";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

/**
 * Whether the callback context's `client` type declares `data` — the contract,
 * stated once. The annotation makes this a compile error the moment the type
 * and the literal disagree; the assertions below fail the moment the running
 * server disagrees with the literal. Restoring `context.client.data` for real
 * therefore takes both halves: a type that declares it and a server that
 * provides it.
 */
type ClientDeclaresData = "data" extends keyof RebaseCallContext["client"] ? true : false;
const CLIENT_DECLARES_DATA: ClientDeclaresData = false;

/** Whether `client` carries a `data` accessor anyone could query through. */
function exposesData(client: object): boolean {
    const data = (client as { data?: { collection?: unknown } }).data;
    return typeof data?.collection === "function";
}

const widgetsTable = pgTable("widgets", {
    id: varchar("id").primaryKey(),
    name: varchar("name")
});

let db: PGlite;
let seen: RebaseCallContext[];
/** Whether the callback below reaches for `context.client` — most never do. */
let readsClient: boolean;

const callbacks: CollectionCallbacks = {
    beforeSave: async ({ values, context }) => {
        seen.push(context);
        // The accessor a callback's queries are meant to use, on the write's
        // own transaction.
        await context.data.collection("widgets").find();
        if (readsClient) void context.client.functions;
        return values;
    }
};

function widgets(): CollectionConfig {
    return {
        name: "Widgets",
        slug: "widgets",
        table: "widgets",
        properties: {
            id: { name: "ID", type: "string", isId: true, validation: { required: true } },
            name: { name: "Name", type: "string" }
        },
        callbacks
    } as unknown as CollectionConfig;
}

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([widgets()]);
    registry.registerTable(widgetsTable, "widgets");
    const orm = drizzle(pglite) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

/** The shape `PostgresBootstrapper.initializeDriver` returns, minus the database work. */
function bootstrapperFor(driver: PostgresBackendDriver): BackendBootstrapper {
    return {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: { driver } } as unknown as InitializedDriver;
        }
    } as unknown as BackendBootstrapper;
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(async () => {
    process.env.NODE_ENV = "test";
    seen = [];
    readsClient = false;
    db = new PGlite();
    await db.waitReady;
    await db.exec("CREATE TABLE widgets (id varchar PRIMARY KEY, name varchar)");
});

afterEach(async () => {
    _resetRebaseMock();
    process.env.NODE_ENV = originalNodeEnv;
    await db.close();
});

describe("a collection callback's `context.client`, on a booted server", () => {
    async function boot(): Promise<PostgresBackendDriver> {
        const driver = driverOver(db);
        await initializeRebaseBackend({
            app: new Hono() as never,
            server: {} as never,
            collections: [widgets()],
            bootstrappers: [bootstrapperFor(driver)]
        } as never);
        return driver;
    }

    it("agrees with its type about `data` on a write through `rebase.dataAsAdmin`", async () => {
        await boot();

        await rebase.dataAsAdmin.collection("widgets").create({ id: "w1", name: "one" });

        expect(seen).toHaveLength(1);
        const { client } = seen[0];
        // The singleton itself, not a stand-in: its admin plane is the one
        // `rebase.dataAsAdmin` just wrote through.
        expect(client.dataAsAdmin).toBe(rebase.dataAsAdmin);
        expect(exposesData(client)).toBe(CLIENT_DECLARES_DATA);
    });

    it("agrees with its type about `data` on a write through the base driver", async () => {
        const driver = await boot();

        await driver.save({ path: "widgets", values: { id: "w2", name: "two" }, status: "new" });

        expect(seen).toHaveLength(1);
        const { client } = seen[0];
        expect(client.dataAsAdmin).toBe(rebase.dataAsAdmin);
        expect(exposesData(client)).toBe(CLIENT_DECLARES_DATA);
    });
});

describe("a driver that was never given the server client", () => {
    it("runs callbacks that do not read `context.client`", async () => {
        const driver = driverOver(db);

        await driver.save({ path: "widgets", values: { id: "w3", name: "three" }, status: "new" });

        expect(seen).toHaveLength(1);
        const rows = await db.query("SELECT id FROM widgets");
        expect(rows.rows).toEqual([{ id: "w3" }]);
    });

    it("refuses a callback that reads `context.client`, by name and as the server's fault", async () => {
        const driver = driverOver(db);
        readsClient = true;

        const write = driver.save({ path: "widgets", values: { id: "w4", name: "four" }, status: "new" });

        // A 500, not the 400 `CALLBACK_REJECTED` a callback's own throw becomes:
        // the callback did nothing wrong.
        await expect(write).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
        await expect(write).rejects.toThrow(/never given the server client/);
        const rows = await db.query("SELECT id FROM widgets");
        expect(rows.rows).toEqual([]);
    });
});
