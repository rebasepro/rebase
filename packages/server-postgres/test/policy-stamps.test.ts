import { PGlite } from "@electric-sql/pglite";
import { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionPolicies } from "../src/schema/ensure-collection-policies";
import type { Queryable } from "../src/schema/ensure-collection-tables";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { checkPolicyDrift, hasDrift } from "../src/security/policy-drift";

/**
 * A boot that changes nothing leaves the policies alone.
 *
 * Every boot used to drop and re-create every policy — at 200 collections,
 * 1,920 DROP/CREATE pairs, one ACCESS EXCLUSIVE lock per table and about a
 * second, and under a `pg_dump` the whole retry budget. Each policy now carries
 * a stamp (`COMMENT ON POLICY … IS 'rebase:<hash>'`) over the statement that
 * was rendered and the definition Postgres stored, and a table is re-applied
 * only when either half differs. These pin both directions: nothing runs when
 * nothing changed, and everything that used to be repaired still is — a
 * changed rule, a policy altered by hand, a dropped or superseded one, RLS
 * switched off, a policy some other tool wrote without a stamp.
 */

const tiers = (rule: Record<string, unknown> = { operation: "select", access: "public" }): CollectionConfig => ({
    name: "Tiers", slug: "tiers", table: "tiers", schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, label: { name: "L", type: "string" } },
    securityRules: [rule]
}) as unknown as CollectionConfig;

const customers: CollectionConfig = {
    name: "Customers", slug: "customers", table: "customers", schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        owner_id: { name: "O", type: "string" }
    },
    securityRules: [{ operation: "all", ownerField: "owner_id" }]
} as unknown as CollectionConfig;

/** Statements that change a policy or take a table's lock to do so. */
const POLICY_DDL = /\b(?:CREATE|DROP|ALTER) POLICY\b|\bCOMMENT ON POLICY\b|ENABLE ROW LEVEL SECURITY|SET LOCAL lock_timeout/i;

interface Harness {
    db: PGlite;
    queryable: Queryable;
    /** Every statement sent, in order. */
    ran: string[];
    /** The ones that wrote. */
    ddl: () => string[];
    /** `name → USING` for every policy on a table. */
    policies: (table: string) => Promise<Record<string, string | null>>;
}

/**
 * A real database (PGlite). `simple` sends each string over the simple
 * protocol, as node-postgres does; otherwise over the extended protocol, which
 * takes one statement per query — the per-statement fallback.
 */
async function harness(simple = true): Promise<Harness> {
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
            if (!simple || values) return db.query<T>(text, values);
            const results = await db.exec(text);
            return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
        }
    };
    return {
        db, queryable, ran,
        ddl: () => ran.filter(text => POLICY_DDL.test(text)),
        policies: async (table) => {
            const { rows } = await db.query<{ policyname: string; qual: string | null }>(
                `SELECT policyname, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = '${table}'`
            );
            return Object.fromEntries(rows.map(row => [row.policyname, row.qual]));
        }
    };
}

describe("a boot that changes nothing", () => {
    it("issues no policy DDL and takes no table lock", async () => {
        const h = await harness();
        try {
            const first = await ensureCollectionPolicies(h.queryable, [tiers(), customers]);
            expect(first.policiesApplied).toBeGreaterThan(0);
            const before = { tiers: await h.policies("tiers"), customers: await h.policies("customers") };

            h.ran.length = 0;
            const second = await ensureCollectionPolicies(h.queryable, [tiers(), customers]);

            expect(h.ddl()).toEqual([]);
            // Two catalogue reads, nothing else.
            expect(h.ran).toHaveLength(2);
            expect(second).toMatchObject({
                policiesApplied: 0, tablesSecured: 2, unchanged: 2, orphansDropped: 0,
                failures: [], unsecured: [], deferred: [], skipped: []
            });
            expect({ tiers: await h.policies("tiers"), customers: await h.policies("customers") }).toEqual(before);
        } finally {
            await h.db.close();
        }
    }, 30_000);

    it("issues none on a handle that takes one statement per query either", async () => {
        const h = await harness(false);
        try {
            await ensureCollectionPolicies(h.queryable, [tiers(), customers]);
            h.ran.length = 0;
            const second = await ensureCollectionPolicies(h.queryable, [tiers(), customers]);
            expect(h.ddl()).toEqual([]);
            expect(second.unchanged).toBe(2);
        } finally {
            await h.db.close();
        }
    }, 30_000);

    it("is not reported as drift: the stamp is a comment, which no drift check reads", async () => {
        const h = await harness();
        try {
            await ensureCollectionPolicies(h.queryable, [tiers(), customers]);
            const { rows } = await h.db.query<{ stamp: string | null }>(
                "SELECT obj_description(oid, 'pg_policy') AS stamp FROM pg_policy"
            );
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) expect(row.stamp).toMatch(/^rebase:[0-9a-f]{64}$/);
            const drift = await checkPolicyDrift(h.queryable, [tiers(), customers]);
            expect(drift.missing).toEqual([]);
            expect(drift.orphaned).toEqual([]);
            expect(drift.diverged).toEqual([]);
            expect(drift.rlsDisabled).toEqual([]);
            expect(hasDrift({ ...drift, insecure: [] })).toBe(false);
        } finally {
            await h.db.close();
        }
    }, 30_000);
});

describe("everything a boot used to repair, it still repairs", () => {
    /** Applied once; then `tamper`; then a boot, whose DDL is returned. */
    async function afterTampering(
        tamper: (h: Harness, names: Record<string, string[]>) => Promise<void>,
        collections: CollectionConfig[] = [tiers(), customers]
    ) {
        const h = await harness();
        await ensureCollectionPolicies(h.queryable, [tiers(), customers]);
        const pristine = { tiers: await h.policies("tiers"), customers: await h.policies("customers") };
        const names = { tiers: Object.keys(pristine.tiers), customers: Object.keys(pristine.customers) };
        await tamper(h, names);
        h.ran.length = 0;
        const result = await ensureCollectionPolicies(h.queryable, collections);
        const ddl = h.ddl();
        const after = { tiers: await h.policies("tiers"), customers: await h.policies("customers") };
        // And the boot after that is quiet again: the repair was stamped.
        h.ran.length = 0;
        await ensureCollectionPolicies(h.queryable, collections);
        const settled = h.ddl();
        await h.db.close();
        return { result, ddl, pristine, after, settled };
    }

    const touches = (ddl: string[], table: string) => ddl.some(text => text.includes(`"public"."${table}"`));

    it("a policy altered by hand is re-applied — its table only", async () => {
        const { result, ddl, pristine, after, settled } = await afterTampering(async (h, names) => {
            await h.db.exec(`ALTER POLICY "${names.customers[0]}" ON "public"."customers" USING (true)`);
        });
        expect(touches(ddl, "customers")).toBe(true);
        expect(touches(ddl, "tiers")).toBe(false);
        expect(after).toEqual(pristine);
        expect(result.unchanged).toBe(1);
        expect(settled).toEqual([]);
    }, 30_000);

    it("a policy whose roles were changed by hand is re-applied", async () => {
        const { ddl, pristine, after, settled } = await afterTampering(async (h, names) => {
            await h.db.exec("CREATE ROLE someone_else");
            await h.db.exec(`ALTER POLICY "${names.tiers[0]}" ON "public"."tiers" TO someone_else`);
        });
        expect(touches(ddl, "tiers")).toBe(true);
        expect(after).toEqual(pristine);
        expect(settled).toEqual([]);
    }, 30_000);

    it("a rule whose SQL changed under the same policy name is re-applied", async () => {
        // A named rule keeps its policy name whatever its condition says, so
        // nothing but the rendered statement tells the two versions apart.
        const before = tiers({ name: "tiers_read", operation: "select", access: "public" });
        const after = tiers({ name: "tiers_read", operation: "select", roles: ["admin"] });
        const h = await harness();
        try {
            await ensureCollectionPolicies(h.queryable, [before]);
            expect((await h.policies("tiers")).tiers_read).toBe("true");

            h.ran.length = 0;
            await ensureCollectionPolicies(h.queryable, [after]);
            expect(touches(h.ddl(), "tiers")).toBe(true);
            expect((await h.policies("tiers")).tiers_read).not.toBe("true");

            h.ran.length = 0;
            await ensureCollectionPolicies(h.queryable, [after]);
            expect(h.ddl()).toEqual([]);
        } finally {
            await h.db.close();
        }
    }, 30_000);

    it("a dropped policy is re-created", async () => {
        const { ddl, pristine, after, settled } = await afterTampering(async (h, names) => {
            await h.db.exec(`DROP POLICY "${names.customers[0]}" ON "public"."customers"`);
        });
        expect(touches(ddl, "customers")).toBe(true);
        expect(touches(ddl, "tiers")).toBe(false);
        expect(after).toEqual(pristine);
        expect(settled).toEqual([]);
    }, 30_000);

    it("a superseded generated policy is dropped", async () => {
        const { result, ddl, pristine, after, settled } = await afterTampering(async (h) => {
            await h.db.exec(`CREATE POLICY "tiers_select_0000000" ON "public"."tiers" FOR SELECT USING (true)`);
        });
        expect(touches(ddl, "tiers")).toBe(true);
        expect(result.orphansDropped).toBe(1);
        expect(after).toEqual(pristine);
        expect(settled).toEqual([]);
    }, 30_000);

    it("a table whose RLS was switched off is locked again", async () => {
        const { ddl, settled } = await afterTampering(async (h) => {
            await h.db.exec(`ALTER TABLE "public"."customers" DISABLE ROW LEVEL SECURITY`);
        });
        expect(ddl.some(text => /ALTER TABLE "public"\."customers" ENABLE ROW LEVEL SECURITY/.test(text))).toBe(true);
        expect(settled).toEqual([]);
    }, 30_000);

    it("a policy written without a stamp — by `db push`, by hand, by an older release — is re-applied once", async () => {
        const { ddl, pristine, after, settled } = await afterTampering(async (h, names) => {
            await h.db.exec(`COMMENT ON POLICY "${names.tiers[0]}" ON "public"."tiers" IS NULL`);
        });
        expect(touches(ddl, "tiers")).toBe(true);
        expect(touches(ddl, "customers")).toBe(false);
        expect(after).toEqual(pristine);
        expect(settled).toEqual([]);
    }, 30_000);

    it("a hand-written policy under a name of its own is left alone, as it always was", async () => {
        const { ddl, after } = await afterTampering(async (h) => {
            await h.db.exec(`CREATE POLICY "tiers_are_public" ON "public"."tiers" FOR SELECT USING (true)`);
        });
        expect(ddl).toEqual([]);
        expect(after.tiers.tiers_are_public).toBe("true");
    }, 30_000);
});
