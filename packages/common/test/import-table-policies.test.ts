import { describe, it, expect } from "@jest/globals";
import type { SecurityRule, TableMetadata, TablePolicyInfo } from "@rebasepro/types";
import { buildCollectionFromTableMetadata } from "../src/util/pg-column-to-property";
import { securityRuleToConditions } from "../src/util/policy/securityRuleToConditions";
import { policyToPostgres } from "../src/util/policy/policyToPostgres";
import { policyToSecurityRule } from "../src/util/policy/policyToSecurityRule";

/**
 * "Import from table" reads a table's live policies into the collection it
 * creates, and the rule it writes is what `db push` compiles back into the
 * database. So each rule has to compile to the policy it was read from.
 *
 * Three ways it did not:
 * - The `TO` list — database roles — went into `roles`, which holds
 *   *application* roles and compiles to a `rebase.roles()` check. A restrictive
 *   `tenant_isolation ... TO public` came back as `NOT (roles && ARRAY['public'])
 *   OR tenant_id = ...`, which every user passes.
 * - A policy with only a WITH CHECK — every INSERT policy — lost it, and a rule
 *   with no clause compiles to `WITH CHECK (false)`: no insert got through.
 * - Whether the policy was restrictive was never read, so a tenant gate came
 *   back permissive, OR'd with every grant beside it.
 */

function importPolicies(...policies: TablePolicyInfo[]): SecurityRule[] {
    const metadata: TableMetadata = { columns: [], foreignKeys: [], junctions: [], policies };
    return buildCollectionFromTableMetadata("orders", metadata).securityRules ?? [];
}

function compiledUsing(rule: SecurityRule): string | null {
    const { usingExpr } = securityRuleToConditions(rule);
    return usingExpr ? policyToPostgres(usingExpr) : null;
}

function compiledWithCheck(rule: SecurityRule): string | null {
    const { withCheckExpr } = securityRuleToConditions(rule);
    return withCheckExpr ? policyToPostgres(withCheckExpr) : null;
}

describe("importing a table's policies into a collection", () => {
    it("keeps a restrictive policy TO public a tenant gate, not a role check every user passes", () => {
        const [rule] = importPolicies({
            policy_name: "tenant_isolation",
            permissive: "RESTRICTIVE",
            cmd: "ALL",
            roles: ["public"],
            qual: "(tenant_id = 1)"
        });

        expect(rule).toEqual({
            name: "tenant_isolation",
            operation: "all",
            mode: "restrictive",
            using: "(tenant_id = 1)"
        });
        expect(rule.roles).toBeUndefined();
        // `public` is every connection, the generator's default `TO`.
        expect(rule.pgRoles).toBeUndefined();
        expect(compiledUsing(rule)).not.toMatch(/roles/);
    });

    it("files a TO list of database roles as pgRoles", () => {
        const [rule] = importPolicies({
            policy_name: "members_read",
            permissive: "PERMISSIVE",
            cmd: "SELECT",
            roles: ["authenticated"],
            qual: "true"
        });

        expect(rule).toEqual({
            name: "members_read",
            operation: "select",
            mode: "permissive",
            pgRoles: ["authenticated"],
            using: "true"
        });
        expect(rule.roles).toBeUndefined();
    });

    it("keeps an INSERT policy's WITH CHECK, which has no USING beside it", () => {
        const [rule] = importPolicies({
            policy_name: "own_insert",
            permissive: "PERMISSIVE",
            cmd: "INSERT",
            roles: ["public"],
            with_check: "(owner_id = rebase.uid())"
        });

        expect(rule).toEqual({
            name: "own_insert",
            operation: "insert",
            mode: "permissive",
            withCheck: "(owner_id = rebase.uid())"
        });
        expect(compiledWithCheck(rule)).toContain("rebase.uid()");
        expect(compiledWithCheck(rule)).not.toBe("false");
    });

    it("refuses a command it cannot name rather than widening the policy to ALL", () => {
        // `pg_policy.polcmd` spells SELECT as `r`. Read as no operation at all,
        // a SELECT policy compiled to FOR ALL, and its USING (true) doubled as
        // the WITH CHECK: a read grant became a write grant.
        expect(() => importPolicies({
            policy_name: "members_read",
            permissive: "PERMISSIVE",
            cmd: "r",
            roles: ["public"],
            qual: "true"
        })).toThrow(/members_read.*"r"/);
    });
});

describe("policyToSecurityRule, which every door that turns a policy into a rule uses", () => {
    it("is the same rule from a pg_policies row the RLS editors read", () => {
        // Studio's RLS editor and the collection editor's RLS tab import a
        // `PostgresPolicy`; "Import from table" a `TablePolicyInfo`. One rule.
        expect(policyToSecurityRule({
            policyname: "own_insert",
            tablename: "orders",
            permissive: "PERMISSIVE",
            cmd: "INSERT",
            roles: ["public"],
            qual: null,
            with_check: "(owner_id = rebase.uid())"
        })).toEqual(importPolicies({
            policy_name: "own_insert",
            permissive: "PERMISSIVE",
            cmd: "INSERT",
            roles: ["public"],
            with_check: "(owner_id = rebase.uid())"
        })[0]);
    });

    it("leaves a policy the editor has not named unnamed, so the generator names it", () => {
        const rule = policyToSecurityRule({ policyname: "", cmd: "SELECT", roles: [], qual: "true" });
        expect(rule).toEqual({ operation: "select", using: "true" });
    });
});
