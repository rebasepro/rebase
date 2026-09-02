import { applyAuthContext } from "../src/security/rls-enforcement";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";

/**
 * The database's own view of who is asking.
 *
 * Anonymous sign-in mints a real user row with a real uid, so inside a policy a
 * guest and a registered account were the same principal: same `rebase.uid()`,
 * same default role, nothing to tell them apart. Every rule meaning "a signed-in
 * person" therefore also meant "anybody who pressed Continue as guest" — which
 * needs no email, no password and no agreement to anything.
 *
 * The fact was on the user row the whole time (`is_anonymous`) and simply never
 * reached the identity the policies read.
 */
describe("the guest flag in the RLS identity", () => {
    /**
     * The statement `applyAuthContext` builds, flattened.
     *
     * A drizzle `SQL` is a chunk list rather than a string, and its bound values
     * are `Param` objects among the chunks — so this walks the whole structure
     * and collects every primitive it finds. Asserting on the rendered SQL
     * alone would miss which VALUE was bound, which is the half under test.
     */
    function capture() {
        const seen: string[] = [];
        const walk = (node: unknown): void => {
            if (node === null || node === undefined) return;
            if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
                seen.push(String(node));
                return;
            }
            if (Array.isArray(node)) {
                for (const item of node) walk(item);
                return;
            }
            if (typeof node === "object") {
                for (const value of Object.values(node as Record<string, unknown>)) walk(value);
            }
        };
        const tx = { execute: async (query: unknown) => { walk(query); } };
        return { tx, seen, text: () => seen.join(" ") };
    }

    it("writes app.is_anonymous for a guest", async () => {
        const { tx, seen, text } = capture();

        await applyAuthContext(tx, { uid: "user-1", roles: [], isAnonymous: true });

        expect(text()).toContain("app.is_anonymous");
        expect(seen).toContain("true");
    });

    it("writes it as false for an account", async () => {
        const { tx, seen, text } = capture();

        await applyAuthContext(tx, { uid: "user-1", roles: [], isAnonymous: false });

        expect(text()).toContain("app.is_anonymous");
        expect(seen).toContain("false");
    });

    /**
     * Absent means "not a guest". A caller that predates this — a realtime
     * subscription, a custom validator — keeps the behaviour it had rather than
     * having every one of its users reclassified.
     */
    it("treats an absent flag as an account", async () => {
        const { tx, seen } = capture();

        await applyAuthContext(tx, { uid: "user-1", roles: [] });

        expect(seen).toContain("false");
    });

    it("puts the same fact in the JWT claims, so the two cannot disagree", async () => {
        const { tx, seen } = capture();

        await applyAuthContext(tx, { uid: "user-1", roles: ["viewer"], isAnonymous: true });

        const claims = seen.find((value) => value.startsWith("{") && value.includes("is_anonymous"));
        expect(claims).toBeDefined();
        expect(JSON.parse(claims!)).toMatchObject({ is_anonymous: true });
    });
});

describe("the rebase.is_anonymous() helper", () => {
    const sql = RLS_BOOTSTRAP_STATEMENTS.join("\n");

    it("is created alongside the other RLS helpers", () => {
        // A policy compiled to reference it against a database that lacks it
        // fails with "function does not exist", so it has to be in the same
        // idempotent preamble the others are.
        expect(sql).toContain("CREATE OR REPLACE FUNCTION rebase.is_anonymous()");
    });

    /**
     * The direction matters. An older backend against a newer database leaves
     * the GUC unset, and reading that as "guest" would deny every request a
     * `registered()` policy covers — a lockout on deploy. Reading it as "not a
     * guest" preserves exactly the behaviour that deployment already had.
     */
    it("defaults to false when the GUC is unset", () => {
        expect(sql).toContain("'false'");
        expect(sql).toMatch(/current_setting\('app\.is_anonymous', true\)/);
    });
});
