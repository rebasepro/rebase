import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import type { AuthState, CollectionConfig, SecurityRule, User } from "@rebasepro/types";
import {
    SchemaDefinitionError,
    canReadField,
    canReadWithAccess,
    compileRulePolicies,
    compileTables
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
