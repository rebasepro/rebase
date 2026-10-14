import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { describeRulesDropped, ensureCollectionPolicies } from "../src/schema/ensure-collection-policies";
import type { Queryable } from "../src/schema/ensure-collection-tables";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";

/**
 * Provisioning that drops a collection's every generated rule says so.
 *
 * A backend built from the scaffold's `collections` array, before that array
 * carried the index's `defaultSecurityRules`, saw `posts` with no rules and
 * provisioned it locked: the boot dropped the twelve generated policies the
 * defaults had made, for every server sharing the database, and logged
 * "Applied 12 RLS policy statement(s)". Dropping a superseded generated policy
 * is right — an edited rule must not leave its old grant behind — but a
 * collection that declares no rule at all while the database still holds the
 * ones it had is what a lost `defaultSecurityRules` looks like. The result
 * names each policy so the boot can warn.
 */

const posts = (securityRules?: unknown[]): CollectionConfig => ({
    name: "Posts", slug: "posts", table: "posts", schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, author_id: { name: "A", type: "string" } },
    ...(securityRules ? { securityRules } : {})
}) as unknown as CollectionConfig;

const DEFAULTS = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];

async function database(): Promise<{ db: PGlite; queryable: Queryable }> {
    const db = new PGlite();
    await db.exec('CREATE TABLE "public"."posts" ("id" TEXT PRIMARY KEY, "author_id" TEXT);');
    for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
    const queryable: Queryable = {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            const results = await db.exec(text);
            return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
        }
    };
    return { db, queryable };
}

async function policyNames(db: PGlite): Promise<string[]> {
    const { rows } = await db.query<{ policyname: string }>(
        "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' ORDER BY policyname");
    return rows.map(r => r.policyname);
}

describe("provisioning a collection that lost its rules", () => {
    it("names every generated policy it drops for a collection that now declares none", async () => {
        const { db, queryable } = await database();
        try {
            await ensureCollectionPolicies(queryable, [posts(DEFAULTS)]);
            const generated = (await policyNames(db)).filter(name => /^posts_(select|insert|update|delete|all)_[0-9a-f]{7}/.test(name));
            expect(generated.length).toBeGreaterThan(0);

            const result = await ensureCollectionPolicies(queryable, [posts()]);

            expect(result.rulesDropped).toEqual([{ table: "public.posts", policies: generated }]);
            // Dropped all the same: the declared state wins, and the boot warns.
            expect(await policyNames(db)).toEqual(expect.not.arrayContaining(generated));
        } finally {
            await db.close();
        }
    }, 30_000);

    it("says nothing when a rule was edited, which supersedes its old policy by design", async () => {
        const { db, queryable } = await database();
        try {
            await ensureCollectionPolicies(queryable, [posts(DEFAULTS)]);
            const result = await ensureCollectionPolicies(queryable, [posts([{ operation: "all", ownerField: "author_id" }])]);

            expect(result.orphansDropped).toBeGreaterThan(0);
            expect(result.rulesDropped).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("says nothing on a boot that changes nothing", async () => {
        const { db, queryable } = await database();
        try {
            await ensureCollectionPolicies(queryable, [posts()]);
            expect((await ensureCollectionPolicies(queryable, [posts()])).rulesDropped).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);
});

describe("the warning", () => {
    it("names each policy, what it means for the table, and the likely cause", () => {
        const line = describeRulesDropped({ table: "public.posts", policies: ["posts_insert_3561e70_0", "posts_select_841c287"] });
        expect(line).toContain('"public.posts" declares no securityRules');
        expect(line).toContain("posts_insert_3561e70_0, posts_select_841c287");
        expect(line).toContain("Only administrators reach its rows now");
        expect(line).toContain("defaultSecurityRules");
        expect(line).toContain("collectionsDir");
    });
});
