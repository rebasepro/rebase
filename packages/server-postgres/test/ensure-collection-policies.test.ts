import { CollectionConfig } from "@rebasepro/types";
import { planCollectionPolicies } from "../src/schema/generate-postgres-ddl-logic";
import { ensureCollectionPolicies } from "../src/schema/ensure-collection-policies";
import type { Queryable } from "../src/schema/ensure-collection-tables";

/**
 * The boot-time RLS applier and the plan behind it.
 *
 * `planCollectionPolicies` is what makes a managed tenant's tables servable at
 * boot; `ensureCollectionPolicies` runs it against the database. Both are unit
 * tested here without Postgres — the end-to-end behaviour is pinned against a
 * real container in `test/e2e/managed-boot-acceptance.test.ts`.
 */

const tiers: CollectionConfig = {
    name: "Tiers", slug: "tiers", table: "tiers", schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, label: { name: "L", type: "string" } },
    securityRules: [{ operation: "select", access: "public" }]
} as unknown as CollectionConfig;

const customers: CollectionConfig = {
    name: "Customers", slug: "customers", table: "customers", schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        owner_id: { name: "O", type: "string" }
    },
    securityRules: [{ operation: "all", ownerField: "owner_id" }]
} as unknown as CollectionConfig;

describe("planCollectionPolicies", () => {
    it("emits an ENABLE RLS statement and CREATE POLICY statements per declared table", () => {
        const plans = planCollectionPolicies([tiers, customers]);
        const byTable = Object.fromEntries(plans.map(p => [p.table, p]));

        expect(byTable.tiers.enableRls).toBe(`ALTER TABLE "public"."tiers" ENABLE ROW LEVEL SECURITY;`);
        expect(byTable.tiers.qualified).toBe("public.tiers");
        // Every statement is a complete, single command (ends in ';', no newline).
        for (const s of byTable.tiers.policyStatements) expect(s.trimEnd().endsWith(";")).toBe(true);
        expect(byTable.tiers.policyStatements.some(s => /^CREATE POLICY/.test(s))).toBe(true);
        expect(byTable.customers.policyStatements.some(s => /CREATE POLICY/.test(s))).toBe(true);
    });

    it("includes junction tables — boot creates them, so it must police them too", () => {
        const tags: CollectionConfig = {
            slug: "tags", table: "tags", name: "Tags", properties: { name: { type: "string" } }
        } as unknown as CollectionConfig;
        const posts: CollectionConfig = {
            slug: "posts", table: "posts", name: "Posts",
            properties: { title: { type: "string" } },
            relations: [{
                kind: "manyToMany", relationName: "tags", target: () => tags,
                through: { table: "posts_to_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }]
        } as unknown as CollectionConfig;

        const plans = planCollectionPolicies([posts, tags]);
        const tables = plans.map(p => p.table);
        expect(tables).toContain("posts");
        expect(tables).toContain("tags");
        // A junction left un-policed is readable and writable by every signed-in
        // user, so it may never be created without its derived RLS.
        expect(tables).toContain("posts_to_tags");
        const junction = plans.find(p => p.table === "posts_to_tags")!;
        expect(junction.enableRls).toMatch(/ENABLE ROW LEVEL SECURITY/);
        expect(junction.policyStatements.some(s => /^CREATE POLICY/.test(s))).toBe(true);
    });
});

/** A fake DB: reports the named tables as present, records DDL, fails on cue. */
function fakeDb(present: string[], failOn?: RegExp): { queryable: Queryable; ran: string[] } {
    const ran: string[] = [];
    const queryable: Queryable = {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            if (/information_schema\.columns/i.test(text)) {
                const rows = present.map(t => {
                    const [table_schema, table_name] = t.split(".");
                    return { table_schema, table_name, column_name: "id" };
                });
                return { rows: rows as unknown as T[] };
            }
            if (/pg_type/i.test(text)) return { rows: [] };
            if (/pg_constraint/i.test(text)) return { rows: [] };
            // Column comments — where a generated search column's fingerprint
            // lives. A catalogue read, like the three above, not DDL.
            if (/pg_description/i.test(text)) return { rows: [] };
            ran.push(text);
            if (failOn && failOn.test(text)) throw new Error("boom");
            return { rows: [] };
        }
    };
    return { queryable, ran };
}

describe("ensureCollectionPolicies", () => {
    it("applies policies to tables that exist and counts the CREATE POLICY statements", async () => {
        const { queryable, ran } = fakeDb(["public.tiers", "public.customers"]);
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(result.tablesSecured).toBe(2);
        expect(result.failures).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.policiesApplied).toBe(ran.filter(s => /^CREATE POLICY/.test(s)).length);
        expect(result.policiesApplied).toBeGreaterThan(0);
        // RLS was enabled before any policy statement ran.
        expect(ran[0]).toMatch(/ENABLE ROW LEVEL SECURITY/);
    });

    it("skips a declared table the database does not have, without failing", async () => {
        const { queryable } = fakeDb(["public.tiers"]); // customers absent
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(result.tablesSecured).toBe(1);
        expect(result.skipped.map(s => s.table)).toEqual(["public.customers"]);
        expect(result.failures).toEqual([]);
    });

    it("records a per-table failure and keeps going (fail closed, never crash-loop)", async () => {
        // Only customers' statements fail; tiers must still be secured.
        const { queryable } = fakeDb(["public.tiers", "public.customers"], /"customers"/);
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(result.failures.map(f => f.table)).toEqual(["public.customers"]);
        expect(result.tablesSecured).toBe(1); // tiers succeeded
    });
});
