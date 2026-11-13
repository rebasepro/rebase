import { isRedactedSecurityRule } from "@rebasepro/types";
import type { SecurityRule, User } from "@rebasepro/types";
import type { CollectionConfig, AuthState } from "@rebasepro/cms-types";
import { securityRuleToConditions } from "@rebasepro/common";
import { checkOperation } from "@rebasepro/cms-types";

/**
 * The marker `GET /api/schema/tables` serves in place of a rule whose SQL it
 * withheld (`{ …targeting, redacted: true }`), in the panel's client-side
 * evaluator: it answers "unknown" exactly as for a raw rule. That nothing ever
 * compiles a policy from it is tested in `@rebasepro/common`.
 */

function caller(roles: string[], uid = "u-1"): AuthState<User> {
    return {
        user: { uid, email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false, roles }
    };
}
const anonymous: AuthState<User> = { user: null };

function table(securityRules: SecurityRule[]): CollectionConfig {
    return { name: "notes", slug: "notes", table: "notes", properties: { id: { name: "id", type: "string", isId: "uuid" } }, securityRules };
}

describe("the redacted marker in the evaluator", () => {
    it("is recognised by its guard, and nothing else is", () => {
        expect(isRedactedSecurityRule({ operation: "select", redacted: true })).toBe(true);
        expect(isRedactedSecurityRule({ operation: "select", using: "true" })).toBe(false);
        expect(isRedactedSecurityRule({ operation: "select", access: "public" })).toBe(false);
    });

    it("answers unknown, the way a raw rule does: allowed for panel gating, denied for enforcement", () => {
        const redacted = table([{ operation: "update", redacted: true }]);
        const raw = table([{ operation: "update", using: "owner_id = rebase.uid()" }]);
        for (const t of [redacted, raw]) {
            expect(checkOperation(t, caller([]), null, "update")).toBe(true);
            expect(checkOperation(t, caller([]), null, "update", { onUnknown: "deny" })).toBe(false);
            // A rule for one operation says nothing about another.
            expect(checkOperation(t, caller([]), null, "delete")).toBe(false);
        }
    });

    it("keeps its roles: a caller without them is refused outright, not 'unknown'", () => {
        const t = table([{ operation: "insert", roles: ["editor"], redacted: true }]);
        expect(checkOperation(t, caller(["editor"]), null, "insert")).toBe(true);
        expect(checkOperation(t, caller([]), null, "insert")).toBe(false);
    });

    it("keeps its access: an anonymous caller fails an `authenticated` marker", () => {
        const t = table([{ operation: "select", access: "authenticated", redacted: true }]);
        expect(checkOperation(t, caller([]), null, "select")).toBe(true);
        expect(checkOperation(t, anonymous, null, "select")).toBe(false);
    });

    it("never grants as a restrictive rule", () => {
        const t = table([{ operation: "select", mode: "restrictive", redacted: true }]);
        expect(checkOperation(t, caller(["admin"]), null, "select")).toBe(false);
    });

    it("desugars both clauses to SQL nothing here evaluates", () => {
        const { usingExpr, withCheckExpr } = securityRuleToConditions({ operation: "update", redacted: true });
        expect(usingExpr?.kind).toBe("raw");
        expect(withCheckExpr?.kind).toBe("raw");
    });
});
