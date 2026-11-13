/**
 * A `via` step that joins on any of several conditions reads a link stored in
 * either of two columns.
 *
 * The case that asked for it: a friendship kept as one row with the smaller
 * account first, so a person is `a` on some of their friendships and `b` on
 * the rest. With one condition per step, their friends had to be two
 * relations — "Friends" and "More friends" — and neither was the list.
 *
 * A real driver over PGlite, through every door that reads a relation: the
 * one-parent loader, a single get, the batched REST include, and the nested
 * listing and count the admin's relation table asks for. Then the door that
 * must stay shut: a step with alternatives has no one column to write into.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const peopleTable = pgTable("people", { id: serial("id").primaryKey(), name: varchar("name") });
const friendshipsTable = pgTable("friendships", {
    id: serial("id").primaryKey(),
    a: integer("a"),
    b: integer("b"),
    games: integer("games")
});

function people(withFriendPeople = false): LegacyCollectionConfig {
    return {
        name: "People", slug: "people", table: "people",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            friends: {
                name: "Friends",
                type: "relation",
                relation: {
                    kind: "via",
                    target: () => friendships(),
                    cardinality: "many",
                    joinPath: [{ table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] }]
                }
            },
            // On to the people at either end: both steps list alternatives,
            // so the inner join and the correlation of the EXISTS are each OR-ed.
            // Only in its own test: a chain from a table back to itself is read
            // at a nested address (aliased EXISTS) but not yet loaded with its
            // parent, whose reverse joins name `people` twice.
            ...(withFriendPeople ? { friendPeople: {
                name: "Friend people",
                type: "relation",
                relation: {
                    kind: "via",
                    target: () => people(true),
                    cardinality: "many",
                    joinPath: [
                        { table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] },
                        { table: "people", on: [{ from: "a", to: "id" }, { from: "b", to: "id" }] }
                    ]
                }
            } } : {})
        }
    };
}

function friendships(): LegacyCollectionConfig {
    return {
        name: "Friendships", slug: "friendships", table: "friendships",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            a: { name: "A", type: "number" },
            b: { name: "B", type: "number" },
            games: { name: "Games", type: "number" }
        }
    };
}

let db: PGlite;

function driverOver(pglite: PGlite, withFriendPeople = false): PostgresBackendDriver {
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([people(withFriendPeople), friendships()]);
    registry.registerPgTable(peopleTable, "people");
    registry.registerPgTable(friendshipsTable, "friendships");
    const orm = drizzle(pglite, { schema: { people: peopleTable, friendships: friendshipsTable } });
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    // Bea (2) is `b` beside Ada and `a` beside Cy: her friends sit in both columns.
    await db.exec(`
        CREATE TABLE people (id serial PRIMARY KEY, name varchar);
        CREATE TABLE friendships (id serial PRIMARY KEY, a integer, b integer, games integer);
        INSERT INTO people (id, name) VALUES (1, 'Ada'), (2, 'Bea'), (3, 'Cy'), (4, 'Dov');
        INSERT INTO friendships (id, a, b, games) VALUES (10, 1, 2, 5), (11, 2, 3, 1), (12, 1, 3, 2);
    `);
});

afterEach(async () => {
    await db.close();
});

type Related = { id?: unknown };
const refIds = (value: unknown) => (value as Related[]).map(row => String(row.id)).sort();

describe("a via step with alternatives", () => {
    it("loads one parent's rows from either column", async () => {
        const rows = await driverOver(db).dataService.fetchRelatedEntities("people", 2, "friends");
        expect(rows.map(r => Number(r.id)).sort()).toEqual([10, 11]);
    });

    it("fills the relation on a single get", async () => {
        const row = await driverOver(db).fetchOne({ path: "people", id: 2, include: ["friends"] });
        expect(refIds(row?.friends)).toEqual(["10", "11"]);
    });

    it("batches an include across parents, each getting its own rows", async () => {
        const driver = driverOver(db);
        const [ada, bea, dov] = await Promise.all([1, 2, 4].map(id => driver.restFetchService.fetchOneForRest("people", id, ["friends"])));
        const ids = (row: Record<string, unknown> | null | undefined) =>
            (row?.friends as Record<string, unknown>[]).map(f => Number(f.id)).sort();
        expect(ids(ada)).toEqual([10, 12]);
        expect(ids(bea)).toEqual([10, 11]);
        expect(ids(dov)).toEqual([]);
    });

    it("lists and counts them at the nested address the relation table reads", async () => {
        const driver = driverOver(db);
        const listed = await driver.fetchCollection({ path: "people/3/friends" });
        expect(listed.map(r => Number(r.id)).sort()).toEqual([11, 12]);
        expect(await driver.count({ path: "people/3/friends" })).toBe(2);
    });

    it("is read-only: a write naming it is refused before anything is written", async () => {
        const driver = driverOver(db);
        await expect(driver.save({ path: "people", id: 4, values: { friends: [{ id: 10 }] }, status: "existing" }))
            .rejects.toThrow(/either-column `via` relation, which is read-only/);
        const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM friendships WHERE a = 4 OR b = 4");
        expect(rows[0].n).toBe(0);
    });

    // The second step's alternatives also match the column that holds the
    // parent, so each person is among their own friends: what the docs warn of.
    it("lists people through two steps of alternatives, the parent among them", async () => {
        const driver = driverOver(db, true);
        const listed = await driver.fetchCollection({ path: "people/2/friendPeople" });
        expect(listed.map(r => Number(r.id)).sort()).toEqual([1, 2, 3]);
        expect(await driver.count({ path: "people/2/friendPeople" })).toBe(3);
        expect(await driver.fetchCollection({ path: "people/4/friendPeople" })).toEqual([]);
    });
});
