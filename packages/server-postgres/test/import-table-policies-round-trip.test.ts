/**
 * A table's policies, imported into a collection and compiled back, are the
 * policies it had.
 *
 * "Import from table" in the collection editor reads a table's metadata through
 * the driver's `fetchTableMetadata`, and `buildCollectionFromTableMetadata`
 * turns each policy into a `securityRules` entry — which `db push` then
 * compiles back into the database. Neither half described a policy the way the
 * other needed:
 *
 * - The metadata read `pg_policy`, not `pg_policies`: the command came back as
 *   `polcmd`'s one-letter code (`r`, `a`, `*`), which the importer did not
 *   recognise, so every rule compiled to FOR ALL, and a `SELECT ... USING
 *   (true)` became a write grant; `TO public` came back as `-`; and whether
 *   the policy was restrictive was never selected, so a tenant gate came back
 *   permissive.
 * - The importer filed the `TO` list under application `roles`, and dropped a
 *   WITH CHECK that had no USING beside it.
 *
 * So this runs the real round trip on PGlite: policies written by hand, read
 * through the driver, imported, compiled with the generator `db push` uses, and
 * created on a fresh copy of the table — and asks Postgres whether the two sets
 * of policies say the same thing.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { buildCollectionFromTableMetadata } from "@rebasepro/common";
import type { PostgresCollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { generatePolicyStatements } from "../src/schema/generate-postgres-ddl-logic";

const TABLE = `
    CREATE ROLE authenticated;
    CREATE TABLE orders (id serial PRIMARY KEY, tenant_id int, owner_id int, total int);
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
`;

const POLICIES = `
    CREATE POLICY tenant_isolation ON orders AS RESTRICTIVE FOR ALL TO public USING (tenant_id = 1);
    CREATE POLICY members_read ON orders FOR SELECT TO authenticated USING (true);
    CREATE POLICY own_insert ON orders FOR INSERT WITH CHECK (owner_id = 7);
    CREATE POLICY own_update ON orders FOR UPDATE USING (owner_id = 7) WITH CHECK (total >= 0);
`;

interface PolicyRow {
    policyname: string;
    permissive: string;
    roles: string[];
    cmd: string;
    qual: string | null;
    with_check: string | null;
}

const open: PGlite[] = [];

async function database(sql: string): Promise<PGlite> {
    const db = new PGlite();
    open.push(db);
    await db.waitReady;
    await db.exec(sql);
    return db;
}

afterEach(async () => {
    await Promise.all(open.splice(0).map(db => db.close()));
});

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    const orm = drizzle(pglite) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

/**
 * What a policy does, as Postgres applies it: a policy with no WITH CHECK
 * checks new rows with its USING, and a clause the command does not take is
 * not there. The generator writes the WITH CHECK out where Postgres would have
 * borrowed the USING, so the two are compared by effect rather than by text.
 */
async function policiesOf(db: PGlite): Promise<Record<string, Omit<PolicyRow, "policyname">>> {
    const { rows } = await db.query<PolicyRow>(
        `SELECT policyname, permissive, roles::text[] AS roles, cmd, qual, with_check
         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders'`
    );
    return Object.fromEntries(rows.map(row => [row.policyname, {
        permissive: row.permissive,
        roles: [...row.roles].sort(),
        cmd: row.cmd,
        qual: row.cmd === "INSERT" ? null : row.qual,
        with_check: row.cmd === "SELECT" || row.cmd === "DELETE" ? null : (row.with_check ?? row.qual)
    }]));
}

describe("importing a table's policies and compiling them back", () => {
    it("reads the policies as pg_policies names them", async () => {
        const source = await database(TABLE + POLICIES);
        const metadata = await driverOver(source).fetchTableMetadata("orders");
        const byName = Object.fromEntries(metadata.policies.map(p => [p.policy_name, p]));

        expect(byName.tenant_isolation).toMatchObject({ cmd: "ALL", permissive: "RESTRICTIVE", roles: ["public"] });
        expect(byName.members_read).toMatchObject({ cmd: "SELECT", permissive: "PERMISSIVE", roles: ["authenticated"] });
        expect(byName.own_insert).toMatchObject({ cmd: "INSERT", permissive: "PERMISSIVE", roles: ["public"], with_check: "(owner_id = 7)" });
        expect(byName.own_insert.qual ?? null).toBeNull();
    });

    it("recreates every policy with the same mode, TO list, command and clauses", async () => {
        const source = await database(TABLE + POLICIES);
        const metadata = await driverOver(source).fetchTableMetadata("orders");
        const imported = buildCollectionFromTableMetadata("orders", metadata);

        const collection: PostgresCollectionConfig = {
            name: imported.name,
            slug: imported.slug,
            table: imported.table,
            properties: imported.properties,
            securityRules: imported.securityRules
        };
        const statements = (collection.securityRules ?? [])
            .flatMap(rule => generatePolicyStatements(collection, rule, () => undefined));

        const target = await database(TABLE);
        for (const statement of statements) await target.exec(statement);

        const original = await policiesOf(source);
        const recreated = await policiesOf(target);
        expect(Object.keys(recreated).sort()).toEqual(Object.keys(original).sort());
        expect(recreated).toEqual(original);

        // The two fail-opens and the fail-closed this pins, said outright.
        expect(recreated.tenant_isolation.permissive).toBe("RESTRICTIVE");
        expect(recreated.tenant_isolation.qual).not.toMatch(/roles/);
        expect(recreated.members_read.cmd).toBe("SELECT");
        expect(recreated.own_insert.with_check).not.toBe("false");
    });
});
