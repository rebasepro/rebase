/**
 * `rebase db push --dry-run` says what the push will do to row-level security,
 * and the push does exactly that.
 *
 * After `schema introspect` on a database whose tables had their own policies
 * and no admin baseline, the dry run said "No changes: the database already
 * matches these collections" — Atlas, whose plan was all it showed, has no
 * model for a policy — and the push then created eight
 * `<table>_default_admin_*` policies that let an admin read and write every
 * row.
 *
 * The plan is read here, then the push's own policy steps run against the same
 * database — the RLS lock, `policies.sql` with its stamps, the reconcile — and
 * what changed in the catalogue is held to what the plan said, item by item.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { applyPoliciesFile, stampableTables } from "../src/cli-push";
import { lockCollectionTables, policyStampSql } from "../src/schema/ensure-collection-policies";
import { generatePostgresPoliciesDdl, planCollectionPolicies } from "../src/schema/generate-postgres-ddl-logic";
import { formatPolicyPushPlan, planPolicyPush, policyPlanChanges, type PolicyPushPlan } from "../src/schema/push-policy-plan";
import { checkPolicyDrift, dropOrphanedPolicies, type Queryable } from "../src/security/policy-drift";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";

const OWNER = "owner_id = current_setting('app.uid', true)";

const collection = (table: string, extra: Record<string, unknown> = {}): CollectionConfig => ({
    name: table, slug: table, table, schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, owner_id: { name: "Owner", type: "string" } },
    ...extra
}) as unknown as CollectionConfig;

/** `orders` as introspection read it: its one hand-written policy, as a rule. */
const ordersRule = { name: "orders owner [hand]", operation: "all", using: OWNER, withCheck: OWNER };

const SETUP = `
CREATE TABLE public.orders (id text PRIMARY KEY, owner_id text);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders owner [hand]" ON public.orders FOR ALL USING (${OWNER}) WITH CHECK (${OWNER});

CREATE TABLE public.notes (id text PRIMARY KEY, owner_id text);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_select_1a2b3c4 ON public.notes FOR SELECT USING (true);

CREATE TABLE public.tags (id text PRIMARY KEY, owner_id text);

CREATE TABLE public.docs (id text PRIMARY KEY, owner_id text);
ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY docs_read ON public.docs FOR ALL USING (true);

CREATE TABLE public.items (id text PRIMARY KEY, owner_id text);

CREATE TABLE public.legacy (id text PRIMARY KEY);
ALTER TABLE public.legacy ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_read ON public.legacy FOR SELECT USING (true);
`;

type Definition = { cmd: string; permissive: string; roles: string; qual: string | null; with_check: string | null };

interface Catalogue {
    policies: Map<string, Definition>;
    rlsOn: Set<string>;
}

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

async function catalogue(db: PGlite): Promise<Catalogue> {
    const policies = await db.query<Definition & { tablename: string; policyname: string }>(
        `SELECT tablename, policyname, cmd, permissive, array_to_string(roles, ',') AS roles, qual, with_check
           FROM pg_policies WHERE schemaname = 'public'`);
    const rls = await db.query<{ relname: string }>(
        "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity");
    return {
        policies: new Map(policies.rows.map(({ tablename, policyname, ...definition }) =>
            [`public.${tablename}.${policyname}`, definition])),
        rlsOn: new Set(rls.rows.map(row => `public.${row.relname}`))
    };
}

/** What `rebase db push` does after Atlas, to row-level security, in its order. */
async function push(client: Queryable, collections: CollectionConfig[]): Promise<void> {
    await lockCollectionTables(client, collections);
    const policiesSql = generatePostgresPoliciesDdl(collections);
    const statements = stampableTables(planCollectionPolicies(collections), policiesSql)
        .map(plan => policyStampSql(plan))
        .filter((statement): statement is string => statement !== undefined);
    await applyPoliciesFile(client, policiesSql, { statements });
    await dropOrphanedPolicies(client, await checkPolicyDrift(client, collections), collections);
}

const keys = (refs: { schema: string; table: string; name: string }[]): string[] =>
    refs.map(p => `${p.schema}.${p.table}.${p.name}`).sort();

/** What changed between two readings of the catalogue. */
function changesBetween(before: Catalogue, after: Catalogue) {
    const created = [...after.policies.keys()].filter(key => !before.policies.has(key)).sort();
    const dropped = [...before.policies.keys()].filter(key => !after.policies.has(key)).sort();
    const redefined = [...after.policies.keys()]
        .filter(key => before.policies.has(key) && JSON.stringify(before.policies.get(key)) !== JSON.stringify(after.policies.get(key)))
        .sort();
    const rlsSwitchedOn = [...after.rlsOn].filter(table => !before.rlsOn.has(table)).sort();
    return { created, dropped, redefined, rlsSwitchedOn };
}

function expectAgreement(plan: PolicyPushPlan, before: Catalogue, after: Catalogue): void {
    const changed = changesBetween(before, after);
    expect(changed.created).toEqual(keys(plan.create));
    expect(changed.dropped).toEqual(keys(plan.drop));
    expect(changed.rlsSwitchedOn).toEqual([...plan.enableRls].sort());
    // Every policy whose definition moved was named, as replaced or as one
    // the plan could not compare; and every one named as replaced moved.
    const named = new Set([...keys(plan.replace.map(r => r.policy)), ...keys(plan.unstamped)]);
    for (const key of changed.redefined) expect(named).toContain(key);
    for (const key of keys(plan.replace.map(r => r.policy))) expect(changed.redefined).toContain(key);
    // What it keeps is there afterwards, exactly as it was.
    for (const key of keys(plan.keep)) expect(after.policies.get(key)).toEqual(before.policies.get(key));
}

describe("the push's row-level security plan", () => {
    let db: PGlite;
    let client: Queryable;

    beforeEach(async () => {
        ({ db, client } = await database());
    });
    afterEach(async () => {
        await db.close();
    });

    const collections = (itemsCondition: string): CollectionConfig[] => [
        collection("orders", { securityRules: [ordersRule] }),
        collection("notes", { securityRules: [{ operation: "select", access: "public" }] }),
        collection("tags"),
        collection("docs", { securityRules: [{ name: "docs_read", operation: "select", using: "true" }] }),
        collection("items", { securityRules: [{ name: "items_read", operation: "select", using: itemsCondition }] })
    ];

    it("says everything the push then does, and the push does nothing else", async () => {
        // `items` as an earlier push left it: stamped, from the rule as it was.
        await push(client, [collection("items", { securityRules: [{ name: "items_read", operation: "select", using: "true" }] })]);
        const declared = collections(OWNER);

        const plan = await planPolicyPush(client, declared);
        const before = await catalogue(db);
        await push(client, declared);
        const after = await catalogue(db);

        expectAgreement(plan, before, after);

        // The finding: introspected `orders` gains the admin baseline, and the
        // plan says so.
        expect(keys(plan.create)).toEqual(expect.arrayContaining([
            "public.orders.orders_default_admin_read",
            "public.orders.orders_default_admin_write_insert",
            "public.orders.orders_default_admin_write_update",
            "public.orders.orders_default_admin_write_delete"
        ]));
        expect(keys(plan.unstamped)).toEqual(["public.orders.orders owner [hand]"]);
        expect(keys(plan.drop)).toEqual(["public.notes.notes_select_1a2b3c4"]);
        expect(plan.enableRls).toEqual(["public.tags"]);
        expect(keys(plan.replace.map(r => r.policy))).toEqual(["public.docs.docs_read", "public.items.items_read"]);
        expect(plan.replace.find(r => r.policy.name === "docs_read")?.why.join(" ")).toMatch(/command: expected SELECT, database has ALL/);
        expect(plan.replace.find(r => r.policy.name === "items_read")?.why.join(" ")).toMatch(/has changed since Rebase wrote it/);
        expect(keys(plan.keep)).toEqual(["public.legacy.legacy_read"]);

        const printed = formatPolicyPushPlan(plan);
        expect(printed.changes.join("\n")).toContain('create policy   public.orders → "orders_default_admin_read" (SELECT TO public)');
        expect(printed.changes.join("\n")).toContain("switch RLS on   public.tags");
        expect(printed.notes.join("\n")).toContain('public.legacy → "legacy_read"');
    });

    it("finds nothing to change right after the push it planned", async () => {
        const declared = collections(OWNER);
        await push(client, declared);

        const again = await planPolicyPush(client, declared);
        expect(policyPlanChanges(again)).toBe(false);
        // Every policy it wrote is stamped now, so none is left to guess about.
        expect(again.unstamped).toEqual([]);
        expect(formatPolicyPushPlan(again).changes).toEqual([]);
    });

    it("plans no baseline for a table that opts out of it, as introspection now writes", async () => {
        const declared = [collection("orders", { securityRules: [ordersRule], disableDefaultPolicies: true })];

        const plan = await planPolicyPush(client, declared);
        const before = await catalogue(db);
        await push(client, declared);
        const after = await catalogue(db);

        expectAgreement(plan, before, after);
        expect(policyPlanChanges(plan)).toBe(false);
        expect([...after.policies.keys()].filter(key => key.startsWith("public.orders."))).toEqual(["public.orders.orders owner [hand]"]);
    });
});
