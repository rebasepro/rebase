/**
 * Introspection reads a table's row-level security, and lets it decide.
 *
 * - A table whose policies hand each caller their own rows is the app's data:
 *   not "a 3-row code list" because a young database holds three customers,
 *   and not a child hidden from the navigation.
 * - Each policy becomes a rule of the table's `rls` the push recreates as it was,
 *   so the database's own policies are no longer orphans the next `db push`
 *   warns about, or drops.
 *
 * The real thing, introspect then push against Postgres, is
 * `test/e2e/introspect-policies-e2e.test.ts`.
 */
import { classifyTables } from "../src/schema/introspect-db-structure";
import { describeRlsOffTables, generateSchemaModules } from "../src/schema/introspect-db-logic";
import { formatPolicyDrift, type PolicyDrift, type PolicyRef } from "../src/security/policy-drift";
import { autoStamp, buildSchema, column, foreignKey, rlsPolicy, serialPk } from "./helpers/schema-metadata";

const OWNER = "(owner_id = current_setting('app.uid'::text, true))";

/** U2's shop: three customers, one order, each row a user's. */
function shop(policies: ReturnType<typeof rlsPolicy>[]) {
    return buildSchema({
        tables: [
            {
                name: "customers",
                columns: [
                    serialPk("customers"),
                    column("customers", "name", { is_nullable: "NO" }),
                    column("customers", "email"),
                    column("customers", "owner_id", { is_nullable: "NO" }),
                    autoStamp("customers", "created_at")
                ]
            },
            {
                name: "orders",
                columns: [
                    serialPk("orders"),
                    column("orders", "customer_id", { data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                    column("orders", "owner_id", { is_nullable: "NO" })
                ]
            }
        ],
        fks: [foreignKey("orders", "customer_id", "customers")],
        rowCounts: { customers: 3 },
        policies
    });
}

describe("classifying a table by its row-level security", () => {
    it("reads rows a policy hands to each caller as the app's data", () => {
        const { metadata, tables } = shop([
            rlsPolicy("customers", "customers_owner", { qual: OWNER, with_check: OWNER }),
            rlsPolicy("orders", "orders_owner", { qual: OWNER })
        ]);
        const roles = classifyTables(metadata, tables);
        expect(roles.get("customers")).toMatchObject({ role: "entity", reason: expect.stringContaining("customers_owner") });
        expect(roles.get("orders")?.role).toBe("entity");
    });

    it("reads rebase.uid(), the retired auth.uid() and the JWT the same way", () => {
        for (const qual of ["(owner_id = rebase.uid())", "(owner_id = (auth.uid())::text)", "((current_setting('app.jwt'::text, true))::jsonb ->> 'sub') = owner_id"]) {
            const { metadata, tables } = shop([rlsPolicy("customers", "p", { cmd: "SELECT", qual })]);
            expect(classifyTables(metadata, tables).get("customers")?.role).toBe("entity");
        }
    });

    it("leaves a code list that anyone may read a code list", () => {
        const { metadata, tables } = shop([rlsPolicy("customers", "everyone_reads", { cmd: "SELECT", qual: "true" })]);
        const roles = classifyTables(metadata, tables);
        expect(roles.get("customers")?.role).toBe("lookup");
        expect(roles.get("orders")?.role).toBe("owned-child");
    });

    it("classifies as before when the policies were not read", () => {
        const { metadata, tables } = shop([]);
        const { policies: _unread, ...withoutPolicies } = metadata;
        expect(classifyTables(withoutPolicies, tables).get("customers")?.role).toBe("lookup");
    });
});

describe("writing a table's policies into its `rls`", () => {
    function generated(policies: ReturnType<typeof rlsPolicy>[], rlsEnabled?: boolean, table = "customers"): string {
        const { metadata, tables } = shop(policies);
        if (rlsEnabled !== undefined) for (const row of metadata.tables) row.rls_enabled = rlsEnabled;
        const generation = generateSchemaModules({ metadata, classifications: classifyTables(metadata, tables) });
        const found = generation.tables.find(t => t.table === table);
        if (!found) throw new Error(`no ${table} module`);
        return found.schemaModule;
    }

    it("writes each as a rule with its name, command, mode and both clauses", () => {
        const source = generated([rlsPolicy("customers", "customers_owner", { qual: OWNER, with_check: OWNER })]);
        expect(source).toContain(
            "    rls: [\n" +
            "        {\n" +
            "            name: \"customers_owner\",\n" +
            "            operation: \"all\",\n" +
            "            mode: \"permissive\",\n" +
            `            using: ${JSON.stringify(OWNER)},\n` +
            `            withCheck: ${JSON.stringify(OWNER)}\n` +
            "        }\n" +
            "    ],\n" +
            "    defaultPolicies: false"
        );
    });

    it("keeps a restrictive policy restrictive, and a TO list that is not public", () => {
        const source = generated([rlsPolicy("customers", "staff_only", {
            permissive: "RESTRICTIVE", roles: ["staff"], cmd: "UPDATE", qual: "true"
        })]);
        expect(source).toContain(`mode: "restrictive"`);
        expect(source).toContain(`pgRoles: ["staff"]`);
        expect(source).toContain(`operation: "update"`);
    });

    /** The admin baseline every table is given, as a database Rebase built holds it. */
    const BASELINE = [
        rlsPolicy("customers", "customers_default_admin_read", { cmd: "SELECT", qual: "true" }),
        rlsPolicy("customers", "customers_default_admin_write_insert", { cmd: "INSERT", with_check: "true" }),
        rlsPolicy("customers", "customers_default_admin_write_update", { cmd: "UPDATE", qual: "true", with_check: "true" }),
        rlsPolicy("customers", "customers_default_admin_write_delete", { cmd: "DELETE", qual: "true" })
    ];

    it("is \"admin-only\" when the baseline is all the table holds, and leaves the baseline out of the rules", () => {
        expect(generated(BASELINE, true)).toContain("rls: \"admin-only\"");
        const source = generated([...BASELINE, rlsPolicy("customers", "customers_owner", { qual: OWNER })], true);
        expect(source).toContain(`name: "customers_owner"`);
        expect(source).not.toContain("customers_default_admin_read");
        expect(source).not.toContain("defaultPolicies");
    });

    // U2's shop: `orders` had only its owner policy, so an admin read no row of
    // it. A push that added the baseline let the admin read every row.
    it("opts a table out of the admin baseline its own policies do not grant", () => {
        const source = generated([rlsPolicy("customers", "customers_owner", { qual: OWNER, with_check: OWNER })], true);
        expect(source).toMatch(/\n {4}rls: \[[\s\S]*customers_owner[\s\S]*\],\n {4}defaultPolicies: false/);
    });

    it("keeps the part of a baseline the table has, as rules, when it lacks the rest", () => {
        const source = generated(BASELINE.slice(0, 2), true);
        expect(source).toContain("defaultPolicies: false");
        expect(source).toContain(`name: "customers_default_admin_read"`);
        expect(source).toContain(`name: "customers_default_admin_write_insert"`);
        expect(source).not.toContain("customers_default_admin_write_update");
    });

    it("writes a rule that grants nothing for RLS on with no policy at all, which no one but its owner reads", () => {
        const source = generated([], true);
        expect(source).toContain(`{ name: "customers_closed", operation: "all", using: "false" }`);
        expect(source).toContain("defaultPolicies: false");
    });

    it("keeps the baseline and the table's own policies for a table with RLS off, and says what the push will do to it", () => {
        const source = generated([rlsPolicy("customers", "customers_owner", { qual: OWNER })], false);
        expect(source).toContain(`name: "customers_owner"`);
        expect(source).not.toContain("defaultPolicies");
        expect(source).toMatch(/\/\/ ⚠ Row-level security is off on this table, so every request reaches every row\. `rebase db push`\n\/\/ switches it on/);
        expect(generated([], false)).toContain("rls: \"admin-only\"");
        expect(describeRlsOffTables(["orders", "customers"])).toMatch(
            /^2 table\(s\) have row-level security off, so every request reaches every row: customers, orders\.\n`rebase db push` switches it on/);
        expect(describeRlsOffTables([])).toBeUndefined();
    });

    it("decides by the policies alone when RLS was not read", () => {
        expect(generated([rlsPolicy("customers", "customers_owner", { qual: OWNER })])).toContain("defaultPolicies: false");
        expect(generated([])).toContain("rls: \"admin-only\"");
    });

    it("says an owned-child with the right article", () => {
        expect(generated([], undefined, "orders")).toContain("// Introspected as an owned-child:");
    });
});

describe("the doctor's word for a policy no table describes", () => {
    const ref = (name: string): PolicyRef => ({
        schema: "public", table: "orders", name, roles: ["public"], command: "ALL", hasUsing: true, hasWithCheck: false
    });
    const drift = (orphaned: PolicyRef[]): PolicyDrift => ({ missing: [], orphaned, diverged: [], insecure: [], rlsDisabled: [] });

    it("does not call a hand-written policy left behind by a push, nor tell its author to drop it", () => {
        const report = formatPolicyDrift(drift([ref("orders_owner")]));
        expect(report).not.toMatch(/left behind by an earlier push/i);
        expect(report).toContain("written by hand or by another tool");
        expect(report).toContain("`rls` in backend/schema");
    });

    it("says a superseded generated policy is what the next push drops", () => {
        const report = formatPolicyDrift(drift([ref("orders_select_1a2b3c4")]));
        expect(report).toMatch(/left behind by an earlier push/);
        expect(report).toMatch(/next `rebase db push` drops it/);
    });
});
