/**
 * E2E: a freshly provisioned managed tenant database serves data after boot,
 * with no `db push` and no human touching the database.
 *
 * ## What this pins
 *
 * A managed Rebase Cloud deploy attaches an empty Postgres and boots someone
 * else's compiled bundle against it. The runtime is the only thing that can
 * reach that database (it lives inside the cluster), so the runtime must bring
 * the schema up itself — both halves:
 *
 *   1. the collection TABLES  (`ensureCollectionTables`), and
 *   2. their RLS POLICIES     (`ensureCollectionPolicies`).
 *
 * Before this, only tables were ever wired in — and even that was dropped by
 * the adapter→bootstrapper wrapper — so a managed tenant came up 500ing every
 * data route (no tables) or, with tables, 401ing every read (no policies). This
 * test reproduces the exact boot sequence against a real, empty Postgres using
 * the real modules, and asserts the database ends up servable: a public-select
 * collection reads, an authorized write lands, and an unauthorized one does not.
 *
 * It deliberately runs NO `rebase db push` / `db migrate` and edits no
 * DATABASE_URL — the whole point is that a managed deploy needs neither.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureCollectionTables, type Queryable } from "../../src/schema/ensure-collection-tables.js";
import { ensureCollectionPolicies } from "../../src/schema/ensure-collection-policies.js";
import { ensureAuthTablesExist } from "../../src/auth/ensure-tables.js";
import {
    detectConnectionPosture,
    ensureAppRole,
    REBASE_USER_ROLE,
    type RawSqlRunner
} from "../../src/security/rls-enforcement.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

// ── The bundle's collections, as compiled config — no hand-written DDL ───────
//
// `tiers` is world-readable (a pricing table); `customers` is per-owner (each
// user sees and writes only their own rows); `secrets` declares no rules at all
// and must therefore be locked to everyone but the server/admin context.
const tiersCollection: CollectionConfig = {
    name: "Tiers",
    slug: "tiers",
    table: "tiers",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        label: { name: "Label", type: "string" }
    },
    securityRules: [{ operation: "select", access: "public" }]
} as unknown as CollectionConfig;

const customersCollection: CollectionConfig = {
    name: "Customers",
    slug: "customers",
    table: "customers",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        name: { name: "Name", type: "string" },
        owner_id: { name: "Owner", type: "string" }
    },
    securityRules: [{ operation: "all", ownerField: "owner_id" }]
} as unknown as CollectionConfig;

const secretsCollection: CollectionConfig = {
    name: "Secrets",
    slug: "secrets",
    table: "secrets",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        value: { name: "Value", type: "string" }
    }
} as unknown as CollectionConfig;

// `orders` points at a customer, and carries a many-to-many to `tiers`. Almost
// every real schema has a shape like this, and for a while none of it survived
// boot: relation columns were skipped and junction tables were never created, so
// a managed tenant got an `orders` table with no `customer_id` (every insert
// 400ed) and no `orders_tiers` at all. Fixtures without a single relation are
// exactly why that shipped, so this one has both.
const ordersCollection: CollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        reference: { name: "Reference", type: "string" },
        customer: {
            name: "Customer",
            type: "relation",
            relation: { kind: "belongsTo", target: () => customersCollection, relationName: "customer" }
        },
        tiers: {
            name: "Tiers",
            type: "relation",
            relation: { kind: "manyToMany", target: () => tiersCollection, relationName: "tiers" }
        }
    },
    securityRules: [
        { operation: "select", access: "public" },
        { operation: "insert", access: "public" }
    ]
} as unknown as CollectionConfig;

const collections = [tiersCollection, customersCollection, secretsCollection, ordersCollection];

// Drizzle tables for the registry the driver reads through. Names must match
// what `ensureCollectionTables` creates (snake_case of the property keys).
const tiersTable = pgTable("tiers", { id: varchar("id").primaryKey(), label: varchar("label") });
const customersTable = pgTable("customers", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    owner_id: varchar("owner_id")
});
const secretsTable = pgTable("secrets", { id: varchar("id").primaryKey(), value: varchar("value") });
const ordersTable = pgTable("orders", {
    id: varchar("id").primaryKey(),
    reference: varchar("reference"),
    customer_id: varchar("customer_id")
});

describe("managed boot: a fresh tenant DB serves data with no db push (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;   // owner/server context — bypasses RLS, used to seed + assert
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    let realtime: RealtimeService;
    let queryable: Queryable;

    const asUser = (uid: string) => driver.withAuth({ uid, roles: [] } as never);
    const countAs = async (uid: string, path: string, collection: CollectionConfig) =>
        (await asUser(uid)).count({ path, collection } as never);
    const rawCount = async (table: string, where = ""): Promise<number> => {
        const r = await admin.query(`SELECT count(*)::int AS c FROM public.${table} ${where}`);
        return (r.rows[0] as { c: number }).c;
    };

    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        queryable = { query: (text: string) => pool.query(text) as Promise<{ rows: unknown[] }> };
        const runSql: RawSqlRunner = async (text) => (await pool.query(text)).rows as Record<string, unknown>[];

        // ── The managed boot sequence, in the runtime's own order ────────────
        // Nothing here is a migration file or a `db push`; it is the four steps
        // the runtime runs at boot against a database it has never seen.

        // 1. Auth: creates the `auth.uid()` / `auth.roles()` helper functions the
        //    generated policies call — `CREATE POLICY` validates they exist.
        await ensureAuthTablesExist(db);

        // 2. Tables (boot phase 1). Additive create of the collection tables.
        await ensureCollectionTables(queryable, collections);

        // 3. The restricted user role authenticated requests run as, with DML
        //    grants on the tables just created (what initializeDriver does).
        const posture = await detectConnectionPosture(runSql);
        expect(posture.privileged).toBe(true);
        await ensureAppRole(runSql, ["public", "rebase", "auth"]);

        // 4. Policies (boot phase 2 — the code under test). Enables RLS and
        //    applies each collection's securityRules as CREATE POLICY.
        const applied = await ensureCollectionPolicies(queryable, collections);
        expect(applied.failures).toEqual([]);
        // Four declared collections plus the derived `orders_tiers` junction.
        expect(applied.tablesSecured).toBe(5);
        expect(applied.policiesApplied).toBeGreaterThan(0);

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple(collections);
        registry.registerTable(tiersTable, "tiers");
        registry.registerTable(customersTable, "customers");
        registry.registerTable(secretsTable, "secrets");
        registry.registerTable(ordersTable, "orders");

        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.rlsUserRole = REBASE_USER_ROLE;

        // Seed through the owner/server context (the trusted plane: an auth
        // flow, a migration, `rebase.sql`) — it bypasses RLS, exactly as a real
        // deployment's server-side seed would. Not `dataAsAdmin`, which is
        // scoped with `withAuth(SERVICE_IDENTITY)` and is RLS-evaluated.
        await admin.query(`INSERT INTO public.tiers (id, label) VALUES ('t-free', 'Free'), ('t-pro', 'Pro')`);
        await admin.query(`INSERT INTO public.secrets (id, value) VALUES ('s1', 'classified')`);
    }, 180_000);

    afterAll(async () => {
        await pool?.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("created the tables at boot (no db push ran)", async () => {
        const rows = await admin.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ANY($1)`,
            [["tiers", "customers", "secrets", "orders", "orders_tiers"]]
        );
        expect(rows.rows.map(r => r.table_name).sort()).toEqual(
            ["customers", "orders", "orders_tiers", "secrets", "tiers"]
        );
    });

    it("gave a relation its foreign-key column, not just its table", async () => {
        // The gap a fixture with no relations could never catch: the table was
        // created, the column its own collection reads was not, and every insert
        // failed with `column "customer_id" of relation "orders" does not exist`.
        const columns = await admin.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'`
        );
        expect(columns.rows.map(r => r.column_name).sort()).toContain("customer_id");

        const fks = await admin.query<{ conname: string }>(
            `SELECT conname FROM pg_constraint
             WHERE conrelid = 'public.orders'::regclass AND contype = 'f'`
        );
        expect(fks.rows.map(r => r.conname)).toContain("orders_customer_id_fkey");
    });

    it("created the junction table behind a many-to-many, keyed and policed", async () => {
        const columns = await admin.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders_tiers'`
        );
        expect(columns.rows.map(r => r.column_name).sort()).toEqual(["order_id", "tier_id"]);

        // A junction created without RLS is readable and writable by every
        // signed-in user, so the table and its policies must arrive together.
        const rls = await admin.query<{ relrowsecurity: boolean }>(
            `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orders_tiers'::regclass`
        );
        expect(rls.rows[0].relrowsecurity).toBe(true);
        const pols = await admin.query<{ policyname: string }>(
            `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders_tiers'`
        );
        expect(pols.rows.length).toBeGreaterThan(0);
    });

    it("rejects a row whose foreign key points nowhere", async () => {
        // Proof the constraint is real and not just a column of the right type.
        await expect(
            admin.query(`INSERT INTO public.orders (id, reference, customer_id) VALUES ('o-bad', 'X', 'nobody')`)
        ).rejects.toThrow(/foreign key|violates/i);
    });

    it("enabled RLS and installed policies on every collection table", async () => {
        const rls = await admin.query<{ relname: string; relrowsecurity: boolean }>(
            `SELECT relname, relrowsecurity FROM pg_class
             WHERE relname = ANY($1) AND relnamespace = 'public'::regnamespace`,
            [["tiers", "customers", "secrets"]]
        );
        for (const row of rls.rows) expect(row.relrowsecurity).toBe(true);

        const pols = await admin.query<{ tablename: string }>(
            `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)`,
            [["tiers", "customers"]]
        );
        // Both the public-select and the per-owner collection carry policies.
        expect(new Set(pols.rows.map(r => r.tablename))).toEqual(new Set(["tiers", "customers"]));
    });

    it("serves a public-select collection to any user context (was 401)", async () => {
        // The symptom that started this: a public collection answered 401
        // because RLS was on with no policy. With the policy applied at boot, a
        // user-context read returns the rows.
        expect(await countAs("anyone", "tiers", tiersCollection)).toBe(2);
        // Even an anonymous principal (empty uid → coerced, never null) reads it.
        expect(await countAs("", "tiers", tiersCollection)).toBe(2);
    });

    it("accepts an authorized write and reads it back", async () => {
        await (await asUser("u1")).save({
            path: "customers",
            collection: customersCollection,
            values: { id: "c1", name: "Acme", owner_id: "u1" }
        } as never);

        expect(await rawCount("customers", "WHERE id = 'c1'")).toBe(1);
        expect(await countAs("u1", "customers", customersCollection)).toBe(1);
    });

    it("denies a write that forges another owner (WITH CHECK)", async () => {
        await expect((await asUser("u1")).save({
            path: "customers",
            collection: customersCollection,
            values: { id: "c-forged", name: "spoof", owner_id: "u2" }
        } as never)).rejects.toBeTruthy();
        expect(await rawCount("customers", "WHERE id = 'c-forged'")).toBe(0);
    });

    it("isolates per-owner reads across tenants (USING)", async () => {
        expect(await countAs("u1", "customers", customersCollection)).toBe(1);
        expect(await countAs("u2", "customers", customersCollection)).toBe(0);
    });

    it("keeps a collection with no rules locked to plain users (secure by default)", async () => {
        expect(await countAs("u1", "secrets", secretsCollection)).toBe(0);
        await expect((await asUser("u1")).save({
            path: "secrets",
            collection: secretsCollection,
            values: { id: "s2", value: "x" }
        } as never)).rejects.toBeTruthy();
        expect(await rawCount("secrets")).toBe(1);
    });

    it("writes a row through its relation, the case that used to 400", async () => {
        await (await asUser("u1")).save({
            path: "orders",
            collection: ordersCollection,
            values: { id: "o1", reference: "ORD-1", customer_id: "c1" }
        } as never);

        expect(await rawCount("orders", "WHERE id = 'o1' AND customer_id = 'c1'")).toBe(1);
        expect(await countAs("anyone", "orders", ordersCollection)).toBe(1);
    });

    it("is idempotent: a second boot changes nothing and still serves", async () => {
        // Both phases, as a restart would run them — the table pass must plan no
        // work at all the second time, or every boot would churn the schema.
        const tablesAgain = await ensureCollectionTables(queryable, collections);
        expect(tablesAgain.actions).toEqual([]);
        expect(tablesAgain.failures).toEqual([]);

        const again = await ensureCollectionPolicies(queryable, collections);
        expect(again.failures).toEqual([]);
        expect(again.tablesSecured).toBe(5);
        // Data still reads exactly the same after a second application.
        expect(await countAs("anyone", "tiers", tiersCollection)).toBe(2);
        expect(await countAs("u1", "customers", customersCollection)).toBe(1);
        expect(await countAs("anyone", "orders", ordersCollection)).toBe(1);
    });
});
