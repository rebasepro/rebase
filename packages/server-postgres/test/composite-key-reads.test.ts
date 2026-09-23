/**
 * A row of a composite-key collection is addressed by every key column.
 *
 * The writes always matched the whole key; the single-row reads matched only
 * the first column. `members(project_id, user_id)` addressed as `p1:::bob`
 * read whichever `p1` row Postgres found first — so a delete's `beforeDelete`
 * judged alice (a plain member) and let bob (the owner) be deleted, a save's
 * `previousValues` described another row, and a uniqueness check excluding bob
 * excluded every member of `p1`.
 *
 * Paging had the same flaw: the listing broke ties on the first key column
 * and the cursor carried only that part, so three members of one project,
 * paged one at a time, came back as one.
 *
 * A real driver over PGlite, asked for bob, and asked to page.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, OrderByTuple } from "@rebasepro/types";
import { cursorToStartAfter, decodeCursor } from "@rebasepro/common";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const membersTable = pgTable("members", {
    projectId: varchar("project_id").notNull(),
    userId: varchar("user_id").notNull(),
    role: varchar("role"),
    handle: varchar("handle")
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);

/** The rows each `beforeDelete` was shown, in order. */
let judged: Record<string, unknown>[] = [];

const members: CollectionConfig = {
    name: "Members",
    slug: "members",
    table: "members",
    properties: {
        projectId: { name: "Project", type: "string", isId: true, columnName: "project_id" },
        userId: { name: "User", type: "string", isId: true, columnName: "user_id" },
        role: { name: "Role", type: "string" },
        handle: { name: "Handle", type: "string" }
    },
    callbacks: {
        beforeDelete: ({ row }) => {
            judged.push(row);
            if (row.role === "owner") throw new Error("cannot remove the owner");
        }
    }
};

let db: PGlite;

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([members]);
    registry.registerTable(membersTable, "members");
    const orm = drizzle(pglite, { schema: { members: membersTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

beforeEach(async () => {
    judged = [];
    db = new PGlite();
    await db.waitReady;
    // alice first, so a read that matches `project_id` alone finds her.
    await db.exec(`
        CREATE TABLE members (
            project_id varchar NOT NULL, user_id varchar NOT NULL, role varchar, handle varchar,
            PRIMARY KEY (project_id, user_id)
        );
        INSERT INTO members VALUES
            ('p1', 'alice', 'member', 'al'),
            ('p1', 'bob', 'owner', 'bo'),
            ('p1', 'carol', 'member', 'ca');
    `);
});

afterEach(async () => {
    await db.close();
});

describe("a single-row read of a composite-key collection", () => {
    it("fetchOne reads the row every key part names", async () => {
        const driver = driverOver(db);
        const row = await driver.fetchOne({ path: "members", id: "p1:::bob" });
        expect(row?.userId).toBe("bob");
        expect(row?.role).toBe("owner");
    });

    it("fetchOneForRest reads the row every key part names", async () => {
        const driver = driverOver(db);
        const row = await driver.restFetchService!.fetchOneForRest("members", "p1:::carol");
        expect(row?.userId).toBe("carol");
    });

    it("a key whose second part names no row is absent, not its sibling", async () => {
        const driver = driverOver(db);
        expect(await driver.fetchOne({ path: "members", id: "p1:::dave" })).toBeUndefined();
        expect(await driver.restFetchService!.fetchOneForRest("members", "p1:::dave")).toBeNull();
    });
});

describe("what the read feeds", () => {
    it("a delete's beforeDelete judges the row being deleted, and its refusal keeps it", async () => {
        const driver = driverOver(db);
        await expect(driver.delete({
            row: { id: "p1:::bob", path: "members", values: {} },
            collection: members
        })).rejects.toThrow("cannot remove the owner");

        expect(judged.map(r => r.userId)).toEqual(["bob"]);
        const left = await db.query<{ user_id: string }>("SELECT user_id FROM members ORDER BY user_id");
        expect(left.rows.map(r => r.user_id)).toEqual(["alice", "bob", "carol"]);
    });

    it("a uniqueness check excluding one member still sees the others", async () => {
        const driver = driverOver(db);
        // alice holds `al`: bob taking it is not unique, whoever is excluded.
        expect(await driver.checkUniqueField("members", "handle", "al", "p1:::bob", members)).toBe(false);
        // bob keeping his own is.
        expect(await driver.checkUniqueField("members", "handle", "bo", "p1:::bob", members)).toBe(true);
    });
});

describe("paging a composite-key collection", () => {
    beforeEach(async () => {
        // Members of a second project, so the first key column alone ties
        // three rows and separates two.
        await db.exec(`
            INSERT INTO members VALUES
                ('p2', 'alice', 'member', 'al2'),
                ('p2', 'dave', 'owner', 'da');
        `);
    });

    /** Every member, page by page, following each page's cursor to the end. */
    async function pageThrough(driver: PostgresBackendDriver, orderBy: OrderByTuple[] | undefined, limit: number): Promise<string[]> {
        const rest = driver.restFetchService!;
        const seen: string[] = [];
        let startAfter: Record<string, unknown> | undefined;
        // Bounded, so a cursor that never advances fails the test instead of hanging it.
        for (let page = 0; page < 20; page++) {
            const rows = await rest.fetchCollectionForRest("members", { orderBy, limit, startAfter });
            seen.push(...rows.map(row => `${row.projectId}/${row.userId}`));
            if (rows.length < limit) break;
            const cursor = rest.cursorFor!("members", rows[rows.length - 1], orderBy);
            expect(cursor).toBeDefined();
            startAfter = cursorToStartAfter(decodeCursor(cursor!));
        }
        return seen;
    }

    it.each([
        ["no orderBy", undefined, 1],
        ["no orderBy", undefined, 2],
        ["role asc", [["role", "asc"]] as OrderByTuple[], 1],
        ["role desc", [["role", "desc"]] as OrderByTuple[], 2]
    ])("%s, %i at a time, serves every member once, in the listing's order", async (_label, orderBy, limit) => {
        const driver = driverOver(db);
        const whole = (await driver.restFetchService!.fetchCollectionForRest("members", { orderBy }))
            .map(row => `${row.projectId}/${row.userId}`);
        expect(whole).toHaveLength(5);

        expect(await pageThrough(driver, orderBy, limit)).toEqual(whole);
    });

    it("the listing is ordered by every key column, so offset pages agree with it", async () => {
        const driver = driverOver(db);
        const rest = driver.restFetchService!;
        const whole = (await rest.fetchCollectionForRest("members", {})).map(row => `${row.projectId}/${row.userId}`);
        // Both key columns descending: the tie-break the cursor seeks on.
        expect(whole).toEqual(["p2/dave", "p2/alice", "p1/carol", "p1/bob", "p1/alice"]);
    });

    it("a cursor that names only part of the key is refused, not read as a row", async () => {
        const driver = driverOver(db);
        await expect(driver.restFetchService!.fetchCollectionForRest("members", {
            limit: 1, startAfter: { id: "p1", values: {} }
        })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    });
});
