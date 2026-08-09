import { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionPolicies } from "../src/schema/ensure-collection-policies";
import type { Queryable } from "../src/schema/ensure-collection-tables";

/**
 * A rule that was tightened must stop granting.
 *
 * A generated policy's name embeds a hash of the rule's semantics, so editing a
 * rule does not update a policy — it creates a new one under a new name and
 * abandons the old. Postgres ORs permissive policies, so the abandoned one goes
 * on granting: a `USING (true)` narrowed to an owner check kept admitting
 * everyone, forever, while the deploy logged success.
 *
 * `rebase db push` reconciles orphans, and cannot reach a managed tenant's
 * in-cluster database — which is the reason this boot-time applier exists at
 * all. So the reconciliation has to happen here too.
 */
describe("ensureCollectionPolicies drops orphaned generated policies", () => {
    const customers: CollectionConfig = {
        name: "Customers", slug: "customers", table: "customers", schema: "public",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            owner_id: { name: "O", type: "string" }
        },
        securityRules: [{ operation: "all", ownerField: "owner_id" }]
    } as unknown as CollectionConfig;

    /** A database holding `policies` on public.customers. */
    function db(policies: string[]) {
        const ran: string[] = [];
        const queryable: Queryable = {
            async query<T>(text: string): Promise<{ rows: T[] }> {
                if (/information_schema\.columns/i.test(text)) {
                    return { rows: [{ table_schema: "public", table_name: "customers", column_name: "id" }] as unknown as T[] };
                }
                if (/pg_type|pg_constraint|pg_description/i.test(text)) return { rows: [] };
                if (/FROM pg_policies/i.test(text)) {
                    return { rows: policies.map(policyname => ({ policyname })) as unknown as T[] };
                }
                ran.push(text);
                return { rows: [] };
            }
        };
        return { queryable, ran };
    }

    // The plan emits its own `DROP POLICY IF EXISTS` before each `CREATE`, so
    // the SQL text cannot tell a reconciler drop from a plan drop. Count via
    // `orphansDropped`, which only the reconciler increments, and use the SQL
    // only to confirm the specific name was named.
    const dropsOf = (ran: string[]) =>
        ran.filter(s => /^DROP POLICY/i.test(s)).map(s => /"([^"]+)"/.exec(s)?.[1]);

    it("drops a stale generated policy the current rules no longer produce", async () => {
        // The shape a tightened rule leaves behind: same table, generated name,
        // different hash.
        // Generated names are `<table>_<op>_<7 hex>`; anything else is treated
        // as hand-written and left alone.
        const stale = "customers_select_0000000";
        const { queryable, ran } = db([stale]);

        const result = await ensureCollectionPolicies(queryable, [customers]);

        expect(dropsOf(ran)).toContain(stale);
        expect(result.orphansDropped).toBeGreaterThan(0);
    });

    it("leaves a hand-written policy alone", async () => {
        // Dropping a policy is destructive, so the line is drawn at the
        // generated-name shape — the same predicate `db push` uses.
        const { queryable, ran } = db(["tenant_isolation"]);

        const result = await ensureCollectionPolicies(queryable, [customers]);

        expect(dropsOf(ran)).not.toContain("tenant_isolation");
        expect(result.orphansDropped).toBe(0);
    });

    it("keeps the policies the current rules do produce", async () => {
        // The control, and the one that matters: a reconciler that dropped
        // everything would satisfy the first test and leave the table with no
        // policies at all. Learn the names the plan creates, then present a
        // database already holding exactly those and require zero drops.
        const discover = db([]);
        await ensureCollectionPolicies(discover.queryable, [customers]);
        const createdNames = discover.ran
            .filter(s => /^CREATE POLICY/i.test(s))
            .map(s => /"([^"]+)"/.exec(s)![1]);
        expect(createdNames.length).toBeGreaterThan(0);

        const second = db(createdNames);
        const result = await ensureCollectionPolicies(second.queryable, [customers]);

        expect(result.orphansDropped).toBe(0);
    });
});
