import { policy, type CollectionConfig, type User } from "@rebasepro/types";
import { checkOperation } from "@rebasepro/cms-types";

/**
 * `policy.registered()` in the panel's client-side evaluator: a guest — a real
 * uid from anonymous sign-in — is not an account. The SQL half of the rule is
 * tested in `@rebasepro/common` (`policy-registered.test.ts`).
 */
describe("policy.registered()", () => {
    /**
     * `checkOperation` is what a caller with a user reaches: the admin UI, for
     * what it offers. It built its context from `uid` and `roles` and left the
     * flag behind, so every guest it was handed was an account.
     */
    describe("checked for a user", () => {
        const briefings: CollectionConfig = {
            slug: "briefings",
            name: "Briefings",
            properties: {},
            securityRules: [{ operations: ["all"], condition: policy.registered() }]
        };
        const person = (isAnonymous: boolean): User => ({
            uid: "user-4", displayName: null, email: null, photoURL: null,
            providerId: "anonymous", isAnonymous, roles: []
        });

        it("refuses a guest on every operation", () => {
            for (const operation of ["select", "insert", "update", "delete"] as const) {
                expect(checkOperation(briefings, { user: person(true) }, null, operation, { onUnknown: "deny" })).toBe(false);
            }
        });

        it("admits the same uid as an account", () => {
            expect(checkOperation(briefings, { user: person(false) }, null, "select", { onUnknown: "deny" })).toBe(true);
        });
    });
});
