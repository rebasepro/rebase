import { policy, type CollectionConfig, type User } from "@rebasepro/types";

import { evaluatePolicy } from "../src/util/policy/evaluatePolicy";
import { policyToPostgres } from "../src/util/policy/policyToPostgres";
import { checkOperation } from "../src/util/permissions";

/**
 * Two different things are called "anonymous", and conflating them is the bug.
 *
 * `ANONYMOUS_USER_ID` is the sentinel a request carrying NO session is given, so
 * that `rebase.uid()` is never NULL on the user path. `policy.authenticated()`
 * already excludes it, which is what makes it mean "signed in" rather than
 * "anyone".
 *
 * Anonymous SIGN-IN is the other thing: `POST /auth/anonymous` mints a real user
 * row, with a real uid and a real session. Such a caller passes every test that
 * looks at the uid — same shape, same default role — so on a deployment with
 * anonymous sign-in enabled, every rule meaning "a signed-in person" also meant
 * "anybody at all", since pressing Continue as guest asks for no email, no
 * password and no agreement to anything.
 *
 * `policy.registered()` is the rule that can tell them apart, and it can only
 * exist because the fact now reaches the database at all — see
 * `rebase.is_anonymous()`.
 */
describe("policy.registered()", () => {
    describe("compiled to Postgres", () => {
        const sql = policyToPostgres(policy.registered());

        it("requires a session", () => {
            expect(sql).toContain("rebase.uid() IS NOT NULL");
        });

        it("still excludes the no-session sentinel, as authenticated() does", () => {
            // Every spelling, not just the current one: a policy compiled here
            // is written into the database and outlives the server that wrote
            // it.
            expect(sql).toContain("'anonymous'");
            expect(sql).toContain("'anon'");
        });

        it("and excludes a guest", () => {
            expect(sql).toContain("NOT rebase.is_anonymous()");
        });

        it("is strictly narrower than authenticated()", () => {
            const authenticated = policyToPostgres(policy.authenticated());
            expect(sql).not.toBe(authenticated);
            expect(authenticated).not.toContain("is_anonymous");
        });
    });

    describe("evaluated in the client", () => {
        const evaluate = (ctx: { uid?: string | null; isAnonymous?: boolean }) =>
            evaluatePolicy(policy.registered(), { ...ctx, entity: null });

        it("admits a real account", () => {
            expect(evaluate({ uid: "user-1" })).toBe(true);
        });

        it("refuses a guest, who has a perfectly real uid", () => {
            expect(evaluate({ uid: "user-2", isAnonymous: true })).toBe(false);
        });

        it("refuses a caller with no session", () => {
            expect(evaluate({ uid: "anonymous" })).toBe(false);
            expect(evaluate({ uid: null })).toBe(false);
        });

        /**
         * The two evaluators disagreeing is a client optimistically rendering a
         * row the database will refuse, or hiding one it would have allowed.
         * `authenticated()` is the case that shows the difference: it admits the
         * guest that `registered()` turns away.
         */
        it("differs from authenticated() exactly where the guest is", () => {
            const guest = { uid: "user-2", isAnonymous: true, entity: null };
            expect(evaluatePolicy(policy.authenticated(), guest)).toBe(true);
            expect(evaluatePolicy(policy.registered(), guest)).toBe(false);
        });

        it("reads a missing flag as an account, not a guest", () => {
            // A caller that does not know keeps the behaviour it had, rather
            // than having all of its users reclassified.
            expect(evaluate({ uid: "user-3" })).toBe(true);
        });
    });

    /**
     * `checkOperation` is what a caller with a user reaches: the Mongo driver
     * for every row it holds (`fetchOne`, `save`, `delete`) and the admin UI for
     * what it offers. It built its context from `uid` and `roles` and left the
     * flag behind, so every guest it was handed was an account.
     */
    describe("checked for a user", () => {
        const briefings = {
            slug: "briefings",
            name: "Briefings",
            properties: {},
            securityRules: [{ operations: ["all"], condition: policy.registered() }]
        } as unknown as CollectionConfig;
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
