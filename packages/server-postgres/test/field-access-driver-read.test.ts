/**
 * Per-field `access.read` on the driver's own reads — the ones the WebSocket's
 * `FETCH_COLLECTION` / `FETCH_ONE` and the MCP tools call.
 *
 * `field-access-read.test.ts` pins the row pipeline's two renderings. This pins
 * the doors that reach rows without going through either: `fetchCollection`
 * parses its rows itself, and so does `fetchOne` when the relational query API
 * is not available. Both served every declared column, so a plain user who sent
 * one socket frame for `users` received every co-member's password hash while
 * `GET /api/data/users` withheld it.
 *
 * Nothing is modelled: a real driver over PGlite, scoped with `withAuth` the
 * way the socket scopes it.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, DataDriver, User } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const staffTable = pgTable("staff", {
    id: serial("id").primaryKey(),
    name: varchar("name"),
    salary: integer("salary"),
    passwordHash: varchar("password_hash")
});

function staffCollection(): CollectionConfig {
    return {
        name: "Staff",
        slug: "staff",
        table: "staff",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            salary: { name: "Salary", type: "number", access: { read: ["hr"] } },
            passwordHash: { name: "Password hash", type: "string", columnName: "password_hash", excludeFromApi: true }
        }
    } as unknown as CollectionConfig;
}

const PLAIN_USER = { uid: "u1", roles: ["user"] } as unknown as User;
const HR_USER = { uid: "u2", roles: ["hr"] } as unknown as User;
const ADMIN_USER = { uid: "u3", roles: ["admin"] } as unknown as User;

let db: PGlite;

/**
 * `withSchema: false` builds drizzle without a schema, so `db.query` has no
 * builder for the table and `fetchOne` takes its `db.select` fallback.
 */
function driverOver(pglite: PGlite, options: { withSchema: boolean } = { withSchema: true }): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([staffCollection()]);
    registry.registerTable(staffTable, "staff");
    const orm = (options.withSchema ? drizzle(pglite, { schema: { staff: staffTable } }) : drizzle(pglite)) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

function scoped(user: User, options?: { withSchema: boolean }): Promise<DataDriver> {
    return driverOver(db, options).withAuth(user);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE staff (id serial PRIMARY KEY, name varchar, salary integer, password_hash varchar);
        INSERT INTO staff (name, salary, password_hash) VALUES
            ('ann', 100, 'hash-a'), ('bob', 200, 'hash-b'), ('cid', 300, 'hash-c');
    `);
});

afterEach(async () => {
    await db.close();
});

describe("fetchCollection (WS FETCH_COLLECTION, MCP query_collection)", () => {
    it("withholds a role-restricted field and an excludeFromApi one from a plain user", async () => {
        const rows = await (await scoped(PLAIN_USER)).fetchCollection({ path: "staff" });
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row).not.toHaveProperty("salary");
            expect(row).not.toHaveProperty("passwordHash");
            expect(row).not.toHaveProperty("password_hash");
        }
        expect(rows.map(r => r.name).sort()).toEqual(["ann", "bob", "cid"]);
    });

    it("serves the role-restricted field to a caller holding the role, and the excluded one to nobody", async () => {
        for (const user of [HR_USER, ADMIN_USER]) {
            const rows = await (await scoped(user)).fetchCollection({ path: "staff" });
            expect(rows.map(r => r.salary).sort()).toEqual([100, 200, 300]);
            for (const row of rows) expect(row).not.toHaveProperty("passwordHash");
        }
    });

    it("withholds them from a text search, which reaches rows through the same parse", async () => {
        const rows = await (await scoped(PLAIN_USER)).fetchCollection({ path: "staff", searchString: "ann" });
        expect(rows.map(r => r.name)).toEqual(["ann"]);
        expect(rows[0]).not.toHaveProperty("salary");
        expect(rows[0]).not.toHaveProperty("passwordHash");
    });
});

describe("fetchOne (WS FETCH_ONE, MCP get_document)", () => {
    it("withholds them on the relational-query path", async () => {
        const row = await (await scoped(PLAIN_USER)).fetchOne({ path: "staff", id: 1 });
        expect(row?.name).toBe("ann");
        expect(row).not.toHaveProperty("salary");
        expect(row).not.toHaveProperty("passwordHash");
    });

    it("withholds them on the db.select fallback too", async () => {
        const row = await (await scoped(PLAIN_USER, { withSchema: false })).fetchOne({ path: "staff", id: 1 });
        expect(row?.name).toBe("ann");
        expect(row).not.toHaveProperty("salary");
        expect(row).not.toHaveProperty("passwordHash");
        expect(row).not.toHaveProperty("password_hash");
    });

    it("serves the role-restricted field on the fallback to a caller holding the role", async () => {
        const row = await (await scoped(HR_USER, { withSchema: false })).fetchOne({ path: "staff", id: 2 });
        expect(row?.salary).toBe(200);
        expect(row).not.toHaveProperty("passwordHash");
    });
});

describe("the trusted server plane", () => {
    it("still reads a role-restricted field through the unscoped driver", async () => {
        const rows = await driverOver(db).fetchCollection({ path: "staff" });
        expect(rows.map(r => r.salary).sort()).toEqual([100, 200, 300]);
    });
});

describe("a tenancy membership read", () => {
    /**
     * Not a read served to anyone: the driver reading which tenants a writer
     * belongs to, to stamp or refuse the tenant on their write. The caller's
     * field rules describe what they may *receive*, so they are not applied to
     * it — a membership table whose tenant column members may not read would
     * otherwise leave every member belonging to no tenant at all.
     */
    const membersTable = pgTable("members", {
        id: serial("id").primaryKey(),
        userId: varchar("user_id"),
        orgId: varchar("org_id")
    });
    const notesTable = pgTable("notes", {
        id: serial("id").primaryKey(),
        orgId: varchar("org_id"),
        body: varchar("body")
    });

    function tenancyDriver(): PostgresBackendDriver {
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([
            {
                name: "Members", slug: "members", table: "members",
                properties: {
                    id: { name: "ID", type: "number", isId: "increment" },
                    userId: { name: "User", type: "string", columnName: "user_id" },
                    orgId: { name: "Org", type: "string", columnName: "org_id", access: { read: ["admin"] } }
                }
            },
            {
                name: "Notes", slug: "notes", table: "notes",
                tenant: { field: "orgId", from: { membership: { collection: "members", userField: "userId", tenantField: "orgId" } } },
                properties: {
                    id: { name: "ID", type: "number", isId: "increment" },
                    orgId: { name: "Org", type: "string", columnName: "org_id" },
                    body: { name: "Body", type: "string" }
                }
            }
        ] as unknown as CollectionConfig[]);
        registry.registerTable(membersTable, "members");
        registry.registerTable(notesTable, "notes");
        const orm = drizzle(db, { schema: { members: membersTable, notes: notesTable } }) as never;
        return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    }

    it("still finds the writer's tenant when members may not read the tenant column", async () => {
        await db.exec(`
            CREATE TABLE members (id serial PRIMARY KEY, user_id varchar, org_id varchar);
            CREATE TABLE notes (id serial PRIMARY KEY, org_id varchar, body varchar);
            INSERT INTO members (user_id, org_id) VALUES ('u1', 'o1');
        `);
        const driver = await tenancyDriver().withAuth(PLAIN_USER);
        await driver.save({ path: "notes", values: { body: "hello" }, status: "new" });
        const stored = await db.query<{ org_id: string }>("SELECT org_id FROM notes");
        expect(stored.rows).toEqual([{ org_id: "o1" }]);
    });
});
