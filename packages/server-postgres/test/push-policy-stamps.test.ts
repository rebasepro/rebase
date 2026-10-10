import { PGlite } from "@electric-sql/pglite";
import { CollectionConfig } from "@rebasepro/types";
import { applyPoliciesFile, stampableTables } from "../src/cli-push";
import { ensureCollectionPolicies, policyStampSql } from "../src/schema/ensure-collection-policies";
import { generatePostgresPoliciesDdl, planCollectionPolicies } from "../src/schema/generate-postgres-ddl-logic";
import type { Queryable } from "../src/schema/ensure-collection-tables";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";

/**
 * The first boot after a `db push` finds the push's policies current.
 *
 * A boot leaves a table's policies alone when each carries a `rebase:<hash>`
 * stamp over the statement that made it and the definition Postgres stored.
 * `policies.sql` wrote none, so the first boot after every push dropped and
 * re-created every policy — at 200 collections about a second and an ACCESS
 * EXCLUSIVE lock per table, and under a `pg_dump` the whole retry budget. The
 * push now stamps what it creates, the way the boot does.
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
    // `rebase.uid()` in the expression: what makes the stamp depend on the
    // search_path the definition is read back under.
    securityRules: [{ operation: "all", ownerField: "owner_id" }]
} as unknown as CollectionConfig;

const POLICY_DDL = /\b(?:CREATE|DROP|ALTER) POLICY\b|\bCOMMENT ON POLICY\b|ENABLE ROW LEVEL SECURITY/i;

async function database(): Promise<{ db: PGlite; queryable: Queryable; ran: string[] }> {
    const db = new PGlite();
    await db.exec(
        'CREATE TABLE "public"."tiers" ("id" TEXT PRIMARY KEY, "label" TEXT);' +
        'CREATE TABLE "public"."customers" ("id" TEXT PRIMARY KEY, "owner_id" TEXT);'
    );
    for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
    const ran: string[] = [];
    const queryable: Queryable = {
        async query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
            ran.push(text);
            if (values) return db.query<T>(text, values);
            const results = await db.exec(text);
            return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
        }
    };
    return { db, queryable, ran };
}

/** What `db push` does: the generated file, and the stamps for what it creates. */
async function push(queryable: Queryable, collections: CollectionConfig[], searchPath: string | undefined) {
    const policiesSql = generatePostgresPoliciesDdl(collections);
    const statements = stampableTables(planCollectionPolicies(collections), policiesSql)
        .map(plan => policyStampSql(plan))
        .filter((s): s is string => s !== undefined);
    return applyPoliciesFile(queryable, policiesSql, { statements, searchPath });
}

describe("the boot after a db push", () => {
    it("re-applies nothing: the push stamped what it created", async () => {
        const { db, queryable, ran } = await database();
        try {
            const pushed = await push(queryable, [tiers, customers], undefined);
            expect(pushed).toEqual({ stamped: 2, stampError: undefined });

            ran.length = 0;
            const boot = await ensureCollectionPolicies(queryable, [tiers, customers]);
            expect(ran.filter(text => POLICY_DDL.test(text))).toEqual([]);
            expect(boot).toMatchObject({ policiesApplied: 0, tablesSecured: 2, unchanged: 2, failures: [], deferred: [] });
        } finally {
            await db.close();
        }
    }, 30_000);

    /**
     * A push connection as the `rebase` role reads `rebase.uid()` as `uid()`
     * (the role's own schema leads the default path); the boot pins `public`.
     * The stamp is taken under the boot's path, or it never matches.
     */
    it("stamps under the boot's search_path, not the push connection's", async () => {
        const { db, queryable } = await database();
        try {
            await db.exec("SET search_path TO rebase, public");
            await push(queryable, [tiers, customers], "public");

            await db.exec("SET search_path TO public");
            const boot = await ensureCollectionPolicies(queryable, [tiers, customers]);
            expect(boot).toMatchObject({ policiesApplied: 0, unchanged: 2 });
        } finally {
            await db.close();
        }
    }, 30_000);

    it("leaves nothing set on the connection", async () => {
        const { db, queryable } = await database();
        try {
            await db.exec("SET search_path TO rebase, public");
            await push(queryable, [tiers, customers], "public");
            const { rows } = await db.query<{ path: string }>("SELECT current_setting('search_path') AS path");
            expect(rows[0].path).toBe("rebase, public");
            // Not inside a transaction the push left open.
            await expect(db.exec("BEGIN; COMMIT;")).resolves.toBeDefined();
        } finally {
            await db.close();
        }
    }, 30_000);

    it("stamps only tables whose statements the file carries verbatim", () => {
        const plans = planCollectionPolicies([tiers, customers]);
        // A file generated from other rules for `tiers`: its policies are not
        // the ones the plan describes, so a stamp would be a lie.
        const other = generatePostgresPoliciesDdl([
            { ...tiers, securityRules: [{ operation: "select", access: "authenticated" }] } as unknown as CollectionConfig,
            customers
        ]);
        expect(stampableTables(plans, other).map(plan => plan.table)).toEqual(["customers"]);
    });

    it("keeps the policies when a stamp cannot be written", async () => {
        const { db, queryable } = await database();
        try {
            const policiesSql = generatePostgresPoliciesDdl([tiers]);
            const result = await applyPoliciesFile(queryable, policiesSql, { statements: ["SELECT no_such_function()"] });
            expect(result.stamped).toBe(0);
            expect(result.stampError).toMatch(/no_such_function/);
            const { rows } = await db.query<{ n: number }>(
                "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'tiers'"
            );
            expect(rows[0].n).toBeGreaterThan(0);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("applies none of the file when one policy fails", async () => {
        const { db, queryable } = await database();
        try {
            const policiesSql = `${generatePostgresPoliciesDdl([tiers])}\nCREATE POLICY "broken" ON "public"."nowhere" USING (true);`;
            await expect(applyPoliciesFile(queryable, policiesSql, { statements: [] })).rejects.toThrow(/nowhere/);
            const { rows } = await db.query<{ n: number }>(
                "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'tiers'"
            );
            expect(rows[0].n).toBe(0);
        } finally {
            await db.close();
        }
    }, 30_000);
});
