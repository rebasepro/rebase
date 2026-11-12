import { describe, expect, it } from "@jest/globals";
import { col, defineTable, isRedactedSecurityRule } from "@rebasepro/types";
import type { AuthState, CollectionConfig, SecurityRule, User } from "@rebasepro/types";
import {
    SchemaDefinitionError,
    canReadField,
    canReadWithAccess,
    checkOperation,
    compileRulePolicies,
    compileTables,
    securityRuleToConditions
} from "../src";

/**
 * The marker `GET /api/schema/tables` serves in place of a rule whose SQL it
 * withheld (`{ …targeting, redacted: true }`): the evaluator answers it
 * "unknown" exactly as it answers a raw rule, and nothing ever compiles a
 * policy from it.
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

describe("the redacted marker is never a policy", () => {
    it("compileRulePolicies refuses it, naming the table", () => {
        expect(() => compileRulePolicies(table([]), { operation: "select", redacted: true }))
            .toThrow(/"notes".*redacted: true/s);
    });

    it("a table authoring one is refused when it is compiled", () => {
        const notes = defineTable("notes", {
            columns: { id: col.uuid().primaryKey().defaultRandom() },
            rls: [{ operation: "select", redacted: true }]
        });
        expect(() => compileTables([notes])).toThrow(SchemaDefinitionError);
        expect(() => compileTables([notes])).toThrow(/redacted/);
    });
});

describe("canReadWithAccess — canReadField's predicate, for a rule not on a property", () => {
    const viewers = [undefined, { roles: [] }, { roles: ["hr"] }, { roles: ["admin"] }, { roles: ["other"] }];
    const rules = [undefined, {}, { read: [] }, { read: ["hr"] }, { write: ["hr"] }];
    it("agrees with canReadField for every rule and viewer", () => {
        for (const access of rules) {
            for (const viewer of viewers) {
                const property = { name: "x", type: "string" as const, ...(access ? { access } : {}) };
                expect(canReadWithAccess(access, viewer)).toBe(canReadField(property, viewer));
            }
        }
    });
});
