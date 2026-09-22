import { describe, expect, it } from "@jest/globals";
import type { PostgresPolicy, SecurityRule } from "@rebasepro/types";
import { getPolicyNamesForRule } from "@rebasepro/utils";
import { applyPolicyEdit } from "../src/components/RLSEditor/policyRules";

/**
 * Writing an edited policy back to its rule changes what the editor changed,
 * and nothing else. The editor shows a rule as a policy — and an `ownerField`
 * or `access` rule, or an unnamed one, has parts it cannot show.
 */

/** The policy the editor is opened with for `rule`, as the RLS editor lists it. */
function shown(rule: SecurityRule): PostgresPolicy {
    const [policyname] = getPolicyNamesForRule(rule, "posts");
    return {
        policyname,
        tablename: "posts",
        permissive: rule.mode === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE",
        cmd: rule.operation === "select" ? "SELECT" : "ALL",
        roles: [...(rule.pgRoles ?? ["public"])],
        qual: rule.using ?? null,
        with_check: rule.withCheck ?? null
    };
}

function edit(rule: SecurityRule, change: Partial<PostgresPolicy>) {
    const original = shown(rule);
    const result = applyPolicyEdit([rule], [rule], "posts", original, { ...original, ...change });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.rules[0];
}

describe("an edited policy written back to its rule", () => {
    it("leaves an unnamed rule unnamed when only its mode changed", () => {
        const rule: SecurityRule = { operation: "select", ownerField: "author_id" };
        expect(edit(rule, { permissive: "RESTRICTIVE" }))
            .toEqual({ operation: "select", ownerField: "author_id", mode: "restrictive" });
    });

    it("replaces an ownerField condition with the USING typed in", () => {
        const rule: SecurityRule = { name: "own", operation: "select", ownerField: "author_id" };
        expect(edit(rule, { qual: "published = true" }))
            .toEqual({ name: "own", operation: "select", using: "published = true" });
    });

    it("keeps the rule's application roles, which the editor does not show", () => {
        const rule: SecurityRule = { name: "editors", operation: "select", roles: ["editor"], access: "public" };
        expect(edit(rule, { policyname: "editors_read" }))
            .toEqual({ name: "editors_read", operation: "select", roles: ["editor"], access: "public" });
    });

    it("files a changed TO list under pgRoles, and drops it back at public", () => {
        const rule: SecurityRule = { name: "svc", operation: "select", access: "public" };
        const scoped = edit(rule, { roles: ["rebase_user"] });
        expect(scoped.pgRoles).toEqual(["rebase_user"]);
        expect(scoped).not.toHaveProperty("roles");

        const back = edit({ ...rule, pgRoles: ["rebase_user"] }, { roles: ["public"] });
        expect(back).not.toHaveProperty("pgRoles");
    });
});
