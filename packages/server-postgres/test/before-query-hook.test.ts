/**
 * `beforeQuery` narrows every read path, or it narrows none of them.
 *
 * `afterRead` sees rows that were already fetched, so nothing in userland could
 * influence *which* rows a read asked for: a tenant scope had to be pushed into
 * every call site, written as an RLS policy, or the driver patched. That is the
 * gap this hook closes, and the whole value of closing it rests on one property
 * — that it holds everywhere. A hook honoured by the listing and not by the
 * count is a page that reads "1 of 4 results"; honoured by the listing and not
 * by `include` is a scope an `?include=` goes around; honoured by the listing
 * and not by the single get is a row you can read by guessing its id.
 *
 * So nothing here is modelled. A real `PostgresBackendDriver` over PGlite, a
 * real generated-shaped Drizzle schema, four rows in two tenants, and every
 * read path asked for them in turn. A test that captured the composed `SQL`
 * object instead would pass for a condition that was built and then dropped.
 *
 * The fail-closed half is checked too: a service built with no call-context
 * provider must *refuse* a read of a hooked collection rather than serve it
 * whole, because that is what makes "no bypass" a property of the code rather
 * than of whoever adds the next read path.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { CollectionConfig, User } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { FetchService } from "../src/services/FetchService";
import { configureUnknownFilterFields } from "../src/utils/drizzle-conditions";

// ── Schema ──────────────────────────────────────────────────────────────────

const ownersTable = pgTable("owners", {
    id: serial("id").primaryKey(),
    name: varchar("name")
});

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    tenant: varchar("tenant"),
    ownerId: integer("owner_id")
});

const ownersRelations = relations(ownersTable, ({ many }) => ({
    docs: many(docsTable)
}));

const docsRelations = relations(docsTable, ({ one }) => ({
    owner: one(ownersTable, { fields: [docsTable.ownerId], references: [ownersTable.id] })
}));

/** The scope the hook applies, or `undefined` to add nothing. */
let scopeTenant: string | undefined;
/** Whatever the hook should return instead, for the misuse cases. */
let returnInstead: (() => unknown) | undefined;
/** Every `operation` the hook was invoked with, in order. */
let operations: string[];

function ownersCollection(): CollectionConfig {
    return {
        name: "Owners",
        slug: "owners",
        table: "owners",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            docs: {
                name: "Docs",
                type: "relation",
                relation: { kind: "hasMany", target: () => docsCollection(), foreignKeyOnTarget: "owner_id" }
            }
        }
    } as unknown as CollectionConfig;
}

function docsCollection(): CollectionConfig {
    return {
        name: "Docs",
        slug: "docs",
        table: "docs",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            owner: {
                name: "Owner",
                type: "relation",
                relation: { kind: "belongsTo", target: () => ownersCollection(), localKey: "owner_id" }
            }
        },
        callbacks: {
            beforeQuery: ({ operation, context }) => {
                operations.push(operation);
                if (returnInstead) return returnInstead() as never;
                const tenant = scopeTenant ?? (context.user as { tenant?: string } | undefined)?.tenant;
                if (!tenant) return;
                return { filter: { tenant: ["==", tenant] } };
            }
        }
    } as unknown as CollectionConfig;
}

const TENANT_USER = { uid: "u1", roles: ["user"], tenant: "a" } as unknown as User;

let db: PGlite;

function registryFor(): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([ownersCollection(), docsCollection()]);
    registry.registerTable(ownersTable, "owners");
    registry.registerTable(docsTable, "docs");
    registry.registerRelations?.(ownersRelations, "owners");
    registry.registerRelations?.(docsRelations, "docs");
    return registry;
}

function driverOver(pglite: PGlite, user?: User): PostgresBackendDriver {
    const registry = registryFor();
    const orm = drizzle(pglite, { schema: { owners: ownersTable, docs: docsTable, ownersRelations, docsRelations } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user);
}

beforeEach(async () => {
    scopeTenant = undefined;
    returnInstead = undefined;
    operations = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE owners (id serial PRIMARY KEY, name varchar);
        CREATE TABLE docs (
            id serial PRIMARY KEY,
            title varchar,
            tenant varchar,
            owner_id integer REFERENCES owners(id)
        );
        INSERT INTO owners (id, name) VALUES (1, 'Ada');
        SELECT setval('owners_id_seq', 1);
        INSERT INTO docs (title, tenant, owner_id) VALUES
            ('alpha report', 'a', 1),
            ('beta report',  'a', 1),
            ('gamma report', 'b', 1),
            ('delta report', 'b', 1);
    `);
});

afterEach(async () => {
    configureUnknownFilterFields("error");
    await db.close();
});

/** The ids of tenant b's rows, which every scoped read must not return. */
async function tenantBIds(): Promise<number[]> {
    const res = await db.query<{ id: number }>("SELECT id FROM docs WHERE tenant = 'b' ORDER BY id");
    return res.rows.map(r => r.id);
}

describe("beforeQuery narrows the read", () => {
    it("is not invoked, and changes nothing, for a collection that declares none", async () => {
        const driver = driverOver(db, TENANT_USER);
        const rows = await driver.fetchCollection({ path: "owners" });
        expect(rows).toHaveLength(1);
        expect(operations).toEqual([]);
    });

    it("narrows the listing", async () => {
        const driver = driverOver(db, TENANT_USER);
        const rows = await driver.fetchCollection({ path: "docs" });
        expect(rows.map(r => r.tenant).sort()).toEqual(["a", "a"]);
    });

    it("narrows the count, so `total` describes the rows that were served", async () => {
        const driver = driverOver(db, TENANT_USER);
        expect(await driver.count({ path: "docs" })).toBe(2);
    });

    it("narrows the REST listing", async () => {
        const driver = driverOver(db, TENANT_USER);
        const rows = await driver.restFetchService.fetchCollectionForRest("docs", {});
        expect(rows.map(r => r.tenant).sort()).toEqual(["a", "a"]);
    });

    it("narrows the aggregate, which is otherwise a way to count rows you cannot select", async () => {
        const driver = driverOver(db, TENANT_USER);
        const rows = await driver.restFetchService.aggregate!("docs", {
            aggregates: [{ fn: "count", alias: "n" }]
        });
        expect(rows[0].n).toBe(2);
    });

    it("narrows the search", async () => {
        const driver = driverOver(db, TENANT_USER);
        // Every row matches the text; only the scope separates them.
        const rows = await driver.restFetchService.fetchCollectionForRest("docs", { searchString: "report" });
        expect(rows.map(r => r.tenant).sort()).toEqual(["a", "a"]);
    });

    it("narrows the single get, so a hidden row cannot be read by guessing its id", async () => {
        const driver = driverOver(db, TENANT_USER);
        const [hidden] = await tenantBIds();
        expect(await driver.fetchOne({ path: "docs", id: hidden })).toBeUndefined();
        expect(await driver.restFetchService.fetchOneForRest("docs", hidden)).toBeNull();
    });

    it("still serves the rows inside the scope by id", async () => {
        const driver = driverOver(db, TENANT_USER);
        const res = await db.query<{ id: number }>("SELECT id FROM docs WHERE tenant = 'a' ORDER BY id");
        const row = await driver.fetchOne({ path: "docs", id: res.rows[0].id });
        expect(row?.tenant).toBe("a");
    });

    it("narrows the rows loaded for an `include`, which is the target's own scope", async () => {
        const driver = driverOver(db, TENANT_USER);
        const rows = await driver.restFetchService.fetchCollectionForRest("owners", {}, { docs: true });
        const docs = rows[0].docs as Record<string, unknown>[];
        expect(docs.map(d => d.tenant).sort()).toEqual(["a", "a"]);
        expect(operations).toContain("relation");
    });

    it("narrows a nested-path listing and its count together", async () => {
        const driver = driverOver(db, TENANT_USER);
        const rows = await driver.restFetchService.fetchCollectionForRest("owners/1/docs", {});
        expect(rows).toHaveLength(2);
        expect(await driver.count({ path: "owners/1/docs" })).toBe(2);
    });

    it("adds to the caller's own filter rather than replacing it", async () => {
        const driver = driverOver(db, TENANT_USER);
        // `beta` is in tenant a, `gamma` is in tenant b. A replaced filter would
        // return gamma; a dropped scope would return both.
        const rows = await driver.fetchCollection({
            path: "docs",
            filter: { title: ["ilike", "%a report%"] }
        } as never);
        expect(rows.map(r => r.title).sort()).toEqual(["alpha report", "beta report"]);
    });

    it("AND-es a logical group it returns, so an `or` inside one still only narrows", async () => {
        returnInstead = () => ({
            logical: {
                type: "or",
                conditions: [
                    { column: "title", operator: "==", value: "alpha report" },
                    { column: "title", operator: "==", value: "gamma report" }
                ]
            }
        });
        const driver = driverOver(db, TENANT_USER);
        const rows = await driver.fetchCollection({
            path: "docs",
            filter: { tenant: ["==", "a"] }
        } as never);
        // The caller's filter AND the hook's disjunction: alpha only.
        expect(rows.map(r => r.title)).toEqual(["alpha report"]);
    });

    it("serves every row when the hook declines to narrow", async () => {
        const driver = driverOver(db);   // no user, so no tenant
        expect(await driver.count({ path: "docs" })).toBe(4);
        expect(operations.length).toBeGreaterThan(0);
    });

    it("leaves `checkUniqueField` asking about the whole table", async () => {
        // Uniqueness is a property of the table, not of the rows this caller can
        // see. Narrowed, this would answer "unique" for a title a hidden row
        // already holds and the insert would then fail on the constraint.
        const driver = driverOver(db, TENANT_USER);
        expect(await driver.checkUniqueField("docs", "title", "gamma report")).toBe(false);
    });
});

describe("beforeQuery refuses rather than widening", () => {
    it("refuses a read whose service was built with no call-context provider", async () => {
        const orm = drizzle(db, { schema: { docs: docsTable } }) as never;
        // The construction a future read path would get wrong. It must not be
        // the one that quietly serves every row.
        const service = new FetchService(orm, registryFor());
        await expect(service.count("docs")).rejects.toThrow(/without a call-context provider/);
    });

    it("refuses a filter naming a column the table does not have, even in `warn` mode", async () => {
        // The process-wide mode exists for callers that knowingly send unknown
        // filter keys. A scope condition is not that: dropping it widens the
        // read, which is the whole reason the mode defaults to `error`.
        configureUnknownFilterFields("warn");
        returnInstead = () => ({ filter: { renamed_tenant: ["==", "a"] } });
        const driver = driverOver(db, TENANT_USER);
        await expect(driver.count({ path: "docs" })).rejects.toThrow();
    });

    it("refuses an object that expresses no condition at all", async () => {
        returnInstead = () => ({});
        const driver = driverOver(db, TENANT_USER);
        await expect(driver.count({ path: "docs" }))
            .rejects.toThrow(/neither `filter` nor `logical`/);
    });
});

describe("beforeQuery gates a write at the row it addresses", () => {
    /** The authenticated driver — the one every request from outside reaches. */
    async function authed(user: User = TENANT_USER) {
        const base = driverOver(db, user);
        return await base.withAuth(user) as unknown as {
            save: (props: Record<string, unknown>) => Promise<Record<string, unknown>>;
            delete: (props: Record<string, unknown>) => Promise<void>;
        };
    }

    const titleOf = async (id: number): Promise<string | undefined> =>
        (await db.query<{ title: string }>("SELECT title FROM docs WHERE id = $1", [id])).rows[0]?.title;

    it("refuses an update to a row the hook excludes, with a 404 rather than a 500", async () => {
        // It used to reach the write, land it, and *then* fail on the narrowed
        // read-back with "Could not fetch row after save." — a 500 naming an
        // internal step, for a row the caller was never allowed to address.
        const driver = await authed();
        const [hidden] = await tenantBIds();

        await expect(driver.save({ path: "docs", id: hidden, values: { title: "hacked" }, status: "existing" }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it("leaves that row exactly as it was", async () => {
        const driver = await authed();
        const [hidden] = await tenantBIds();

        await expect(driver.save({ path: "docs", id: hidden, values: { title: "hacked" }, status: "existing" }))
            .rejects.toThrow();

        expect(await titleOf(hidden)).toBe("gamma report");
    });

    it("still saves a row inside the scope", async () => {
        const driver = await authed();
        const { rows } = await db.query<{ id: number }>("SELECT id FROM docs WHERE tenant = 'a' ORDER BY id");

        await driver.save({ path: "docs", id: rows[0].id, values: { title: "edited" }, status: "existing" });

        expect(await titleOf(rows[0].id)).toBe("edited");
    });

    it("answers the same 404 for a delete, which is where the wording comes from", async () => {
        const driver = await authed();
        const [hidden] = await tenantBIds();

        await expect(driver.delete({ row: { id: hidden, path: "docs" }, path: "docs" }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(await titleOf(hidden)).toBe("gamma report");
    });

    it("still deletes a row inside the scope", async () => {
        const driver = await authed();
        const { rows } = await db.query<{ id: number }>("SELECT id FROM docs WHERE tenant = 'a' ORDER BY id");

        await driver.delete({ row: { id: rows[0].id, path: "docs" }, path: "docs" });

        expect(await titleOf(rows[0].id)).toBeUndefined();
    });

    it("changes nothing for a collection that declares no hook", async () => {
        // The gate is deliberately conditional on the hook: without one, the
        // pre-read stays best-effort history enrichment, and a read that cannot
        // resolve a key is still not a reason to fail a write.
        const driver = await authed();

        await driver.save({ path: "owners", id: 1, values: { name: "Ada Lovelace" }, status: "existing" });

        const { rows } = await db.query<{ name: string }>("SELECT name FROM owners WHERE id = 1");
        expect(rows[0].name).toBe("Ada Lovelace");
    });
});
