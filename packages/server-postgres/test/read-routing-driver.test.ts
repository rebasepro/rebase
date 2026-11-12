/**
 * Authenticated reads through a real driver, with a read replica beside the
 * primary — two PGlite databases holding different rows, so every answer says
 * which one served it.
 *
 * The rules: a read goes to the replica; a principal's own write pins its
 * reads to the primary; the service identity and reads inside a write stay on
 * the primary; a replica that fails a read for its own reasons hands it to the
 * primary, and one that answers the read (an error of the read's own) does
 * not. Against a real hot standby and PgBouncer: `e2e/pooler-replica-e2e.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, User } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import { ReadRouter } from "../src/read-routing";
import { testUser } from "./helpers/spg-c-user";
import { runInWriteScope, WriteTransactionScope } from "../src/services/write-transaction-scope";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const notesTable = pgTable("notes", {
    id: serial("id").primaryKey(),
    title: varchar("title")
});

const notes: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" }
    }
};

const ALICE: User = testUser("alice", ["user"]);
const BOB: User = testUser("bob", ["user"]);
const SERVICE: User = testUser("service", ["admin"]);

let primary: PGlite;
let replica: PGlite;
let driver: PostgresBackendDriver;
let router: ReadRouter<NodePgDatabase>;
let lag = 0;

async function seeded(title: string): Promise<PGlite> {
    const db = new PGlite();
    await db.waitReady;
    await db.exec(`CREATE TABLE notes (id serial PRIMARY KEY, title varchar); INSERT INTO notes (title) VALUES ('${title}');`);
    return db;
}

beforeEach(async () => {
    primary = await seeded("from-primary");
    replica = await seeded("from-replica");
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([notes]);
    registry.registerPgTable(notesTable, "notes");
    const primaryDb = drizzle(primary, { schema: { notes: notesTable } });
    const replicaDb = drizzle(replica, { schema: { notes: notesTable } });
    // PGlite's drizzle databases stand in for node-postgres's: the driver and its read router name
    // NodePgDatabase, whose `$client` is a pg pool, and no typed bridge between the two exists.
    const primaryNodePg = primaryDb as unknown as NodePgDatabase;
    driver = new PostgresBackendDriver(primaryNodePg, new RealtimeService(primaryNodePg, registry), registry);
    lag = 0;
    // The replica, as the primary above.
    const replicaRouter = new ReadRouter(replicaDb as unknown as NodePgDatabase, async () => lag, { stickyMs: 60_000, maxLagMs: 1000 });
    router = replicaRouter;
    await router.sample();
    driver.readRouter = replicaRouter;
});

afterEach(async () => {
    await primary.close();
    await replica.close();
});

const titles = async (user: User) =>
    (await (await driver.withAuth(user)).fetchCollection({ path: "notes" })).map(row => row.title);

describe("authenticated reads with a read replica", () => {
    it("serve fetchCollection, fetchOne, count and readTogether from the replica", async () => {
        const scoped = await driver.withAuth(ALICE);
        expect(await titles(ALICE)).toEqual(["from-replica"]);
        expect((await scoped.fetchOne({ path: "notes", id: 1 }))?.title).toBe("from-replica");
        expect(await scoped.count!({ path: "notes" })).toBe(1);
        expect(await scoped.readTogether!(async (d) => (await d.fetchCollection({ path: "notes" }))[0].title)).toBe("from-replica");
    });

    it("pin a principal that wrote to the primary, and only that principal", async () => {
        await (await driver.withAuth(ALICE)).save({ path: "notes", values: { title: "alice wrote" }, status: "new" });
        expect((await titles(ALICE)).sort()).toEqual(["alice wrote", "from-primary"]);
        expect(await titles(BOB)).toEqual(["from-replica"]);
    });

    it("keep the service identity on the primary", async () => {
        expect(await titles(SERVICE)).toEqual(["from-primary"]);
    });

    it("keep a read inside a write's transaction on the primary", async () => {
        // A scope is a write's once it is bound to the write's transaction.
        const scope = new WriteTransactionScope();
        // PGlite again, standing in for the node-postgres database the scope names.
        scope.bind(drizzle(primary) as unknown as NodePgDatabase, async () => []);
        const inWrite = await runInWriteScope(scope, () => titles(BOB));
        expect(inWrite).toEqual(["from-primary"]);
    });

    it("go to the primary while the replica is behind", async () => {
        lag = 5000;
        await router.sample();
        expect(await titles(BOB)).toEqual(["from-primary"]);
    });

    it("are retried on the primary when the replica fails for its own reasons", async () => {
        const conflict = Object.assign(new Error("canceling statement due to conflict with recovery"), { code: "40001" });
        jest.spyOn(router.db, "transaction").mockRejectedValueOnce(conflict);
        expect(await titles(BOB)).toEqual(["from-primary"]);
        // …and the replica is left alone for a while.
        expect(router.route("bob")).toEqual({ target: "primary", reason: "unavailable" });
    });

    it("are not retried when the replica's error is the read's own answer", async () => {
        await replica.exec("DROP TABLE notes");
        await expect(titles(BOB)).rejects.toThrow();
    });
});
