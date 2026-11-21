/**
 * `rebase db push --prune-policies` drops the policies on declared tables that
 * no table declares — exactly the ones the dry run lists as left in force —
 * and nothing else.
 *
 * From a migration report: moving a table to `rls: "admin-only"` left its old
 * policies in force. The push listed them ("policies no table describes,
 * which the push leaves in force") and offered no way to drop them, so they
 * went into a hand-written `extras.sql`.
 *
 * Read the way `push-policy-plan.test.ts` reads the push: the plan, then the
 * push's own policy steps against the same database — `policies.sql` with the
 * prune statements in its one transaction, as `applyPolicies` runs it, and the
 * reconcile — and the catalogue held to what the plan said.
 */
import { PGlite } from "@electric-sql/pglite";
import type { LegacyCollectionConfig, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { applyPoliciesFile } from "../src/cli-push";
import { lockTables } from "../src/schema/ensure-policies";
import { generatePostgresPoliciesDdl } from "../src/schema/generate-postgres-ddl-logic";
import { formatPolicyPushPlan, planPolicyPush, policyPlanChanges, summarizePolicyPushPlan } from "../src/schema/push-policy-plan";
import { prunablePolicies, prunedPolicyLines, prunePoliciesSql } from "../src/schema/prune-policies";
import { checkPolicyDrift, dropOrphanedPolicies, type PolicyRef, type Queryable } from "../src/security/policy-drift";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { compileSet } from "./helpers/plan-tables";

const collection = (table: string, extra: Partial<LegacyPostgresCollectionConfig> = {}): LegacyCollectionConfig => ({
    name: table, slug: table, table, schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, owner_id: { name: "Owner", type: "string" } },
    ...extra
});

/**
 * `trips` as a Supabase database had it, now declared with no rules of its
 * own (the admin baseline only, as `rls: "admin-only"` compiles). `legacy` is
 * a table the project does not declare, in the same schema.
 */
const SETUP = `
CREATE TABLE public.trips (id text PRIMARY KEY, owner_id text);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read trips" ON public.trips FOR SELECT USING (true);
CREATE POLICY trips_owner_gate ON public.trips AS RESTRICTIVE FOR UPDATE USING (owner_id = current_setting('app.uid', true));

CREATE TABLE public.legacy (id text PRIMARY KEY);
ALTER TABLE public.legacy ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_read ON public.legacy FOR SELECT USING (true);
`;

const declared = [collection("trips")];

async function database(): Promise<{ db: PGlite; client: Queryable }> {
    const db = new PGlite();
    for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
    await db.exec(SETUP);
    const client: Queryable = {
        async query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
            if (values) return { rows: (await db.query<R>(text, values)).rows };
            const results = await db.exec(text);
            return { rows: (results[results.length - 1]?.rows ?? []) as R[] };
        }
    };
    return { db, client };
}

/** What `rebase db push` does after Atlas, to row-level security, with `pruned` as `--prune-policies` hands it over. */
async function push(client: Queryable, collections: LegacyCollectionConfig[], pruned: PolicyRef[]): Promise<void> {
    await lockTables(client, compileSet(collections));
    let policiesSql = generatePostgresPoliciesDdl(compileSet(collections));
    if (pruned.length > 0) policiesSql = `${policiesSql}\n${prunePoliciesSql(pruned)}\n`;
    await applyPoliciesFile(client, policiesSql, { statements: [] });
    await dropOrphanedPolicies(client, await checkPolicyDrift(client, compileSet(collections)), compileSet(collections));
}

async function policies(db: PGlite): Promise<string[]> {
    const rows = await db.query<{ tablename: string; policyname: string }>(
        "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2");
    return rows.rows.map(row => `public.${row.tablename}.${row.policyname}`);
}

const keys = (refs: { schema: string; table: string; name: string }[]): string[] =>
    refs.map(p => `${p.schema}.${p.table}.${p.name}`).sort();

describe("db push --prune-policies", () => {
    let db: PGlite;
    let client: Queryable;

    beforeEach(async () => {
        ({ db, client } = await database());
    });
    afterEach(async () => {
        await db.close();
    });

    it("without the flag, keeps them and says which ones the flag would drop", async () => {
        const plan = await planPolicyPush(client, compileSet(declared));

        expect(plan.prune).toEqual([]);
        expect(keys(plan.keep)).toEqual(["public.legacy.legacy_read", "public.trips.Anyone can read trips", "public.trips.trips_owner_gate"]);
        expect(keys(plan.prunable)).toEqual(["public.trips.Anyone can read trips", "public.trips.trips_owner_gate"]);
        const notes = formatPolicyPushPlan(plan).notes.join("\n");
        expect(notes).toContain("which the push leaves in force");
        expect(notes).toContain("`rebase db push --prune-policies` drops the 2 on tables backend/schema declares");
    });

    it("plans dropping exactly the ones left in force on declared tables, as a change to row-level security", async () => {
        const plan = await planPolicyPush(client, compileSet(declared), { prunePolicies: true });

        expect(keys(plan.prune)).toEqual(["public.trips.Anyone can read trips", "public.trips.trips_owner_gate"]);
        expect(keys(plan.keep)).toEqual(["public.legacy.legacy_read"]);
        expect(policyPlanChanges(plan)).toBe(true);

        const changes = formatPolicyPushPlan(plan).changes.join("\n");
        expect(changes).toContain("Planned row-level security changes:");
        expect(changes).toContain('drop policy     public.trips → "Anyone can read trips" (SELECT TO public), which no table declares (--prune-policies)');
        expect(changes).toContain('drop policy     public.trips → "trips_owner_gate" (RESTRICTIVE UPDATE TO public)');
        expect(changes).toContain("without a terminal it needs --allow-destructive");
        expect(summarizePolicyPushPlan(plan)).toContain("2 no table declares to drop (--prune-policies)");

        // What the push says before it asks.
        const gate = prunedPolicyLines(plan.prune).join("\n");
        expect(gate).toContain("--prune-policies drops 2 policies no table declares");
        expect(gate).toContain("dropping a restrictive policy widens access");
    });

    it("drops them in the policies' own transaction, and leaves the undeclared table's alone", async () => {
        const plan = await planPolicyPush(client, compileSet(declared), { prunePolicies: true });

        await push(client, declared, plan.prune);

        const after = await policies(db);
        expect(after).toContain("public.legacy.legacy_read");
        expect(after).not.toContain("public.trips.Anyone can read trips");
        expect(after).not.toContain("public.trips.trips_owner_gate");
        expect(after.filter(key => key.startsWith("public.trips."))).toEqual(
            after.filter(key => key.startsWith("public.trips.trips_default_admin_")));

        const again = await planPolicyPush(client, compileSet(declared), { prunePolicies: true });
        expect(again.prune).toEqual([]);
        expect(policyPlanChanges(again)).toBe(false);
    });

    it("never prunes a policy in the framework's `rebase` schema, or on a table no table declares", () => {
        const ref = (schema: string, table: string, name: string): PolicyRef =>
            ({ schema, table, name, roles: ["public"], command: "SELECT", hasUsing: true, hasWithCheck: false });
        const kept = [ref("public", "trips", "old"), ref("public", "legacy", "legacy_read"), ref("rebase", "trips", "framework")];

        expect(keys(prunablePolicies(kept, compileSet(declared)))).toEqual(["public.trips.old"]);
        expect(prunePoliciesSql([ref("public", "trips", "say \"hi\"")])).toBe('DROP POLICY IF EXISTS "say ""hi""" ON "public"."trips";');
    });
});
