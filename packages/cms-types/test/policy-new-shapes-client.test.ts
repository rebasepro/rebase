/**
 * The panel's client-side evaluator (`checkOperation`) on the two rule shapes
 * the Postgres-first spec's `rls` example added — a `PolicyShorthand`
 * condition and `access` combined with a condition. The compiler, policy
 * names and import path are tested in `@rebasepro/common`
 * (`policy-new-shapes.test.ts`).
 */
import {
    type AuthState,
    type CollectionConfig,
    type Entity,
    type PolicyCondition,
    type SecurityRule,
    type User
} from "@rebasepro/types";
import { compileRulePolicies, evaluatePolicy, securityRuleToConditions } from "@rebasepro/common";
import { checkOperation } from "@rebasepro/cms-types";

const SIGNED_IN = "(SELECT rebase.uid()) IS NOT NULL AND (SELECT rebase.uid()) NOT IN ('anonymous', 'anon')";

const posts: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }] },
        orgId: { name: "Org", type: "string", columnName: "org_id" },
        deletedAt: { name: "Deleted", type: "date" },
        featured: { name: "Featured", type: "boolean" },
        rank: { name: "Rank", type: "number", validation: { integer: true } }
    }
};

/** The spec's §4.1 `rls` block, verbatim. */
const SPEC_RULES: SecurityRule[] = [
    { operation: "select", access: "public", condition: { status: "published" } },
    { operations: ["select", "insert", "update"], roles: ["editor"] },
    { operation: "delete", roles: ["admin"] }
];

const user = (uid: string, roles: string[] = []): AuthState<User> => ({
    user: { uid, email: `${uid}@example.com`, displayName: uid, photoURL: null, providerId: "password", isAnonymous: false, roles }
});
const anonymous: AuthState<User> = { user: null };
const row = (values: Record<string, unknown>): Entity => ({ id: "p1", path: "posts", values });
/** A value from outside the type system — what a JS config or a stored rule can hold. */
const loose = (json: string): PolicyCondition => JSON.parse(json);
const withRules = (securityRules: SecurityRule[]): CollectionConfig => ({ ...posts, securityRules });

describe("the client-side evaluator on the new shapes", () => {
    const collection = withRules(SPEC_RULES);
    const published = row({ status: "published" });
    const draft = row({ status: "draft" });

    it("lets an anonymous visitor read published rows and nothing else", () => {
        expect(checkOperation(collection, anonymous, published, "select")).toBe(true);
        expect(checkOperation(collection, anonymous, draft, "select")).toBe(false);
        expect(checkOperation(collection, anonymous, published, "update")).toBe(false);
        expect(checkOperation(collection, anonymous, published, "delete")).toBe(false);
    });

    it("lets an editor read every row and write, but not delete; an admin deletes", () => {
        const editor = user("ed", ["editor"]);
        expect(checkOperation(collection, editor, draft, "select")).toBe(true);
        expect(checkOperation(collection, editor, draft, "update")).toBe(true);
        expect(checkOperation(collection, editor, draft, "insert")).toBe(true);
        expect(checkOperation(collection, editor, draft, "delete")).toBe(false);
        expect(checkOperation(collection, user("ad", ["admin"]), draft, "delete")).toBe(true);
    });

    it("compiles and evaluates bare `access: \"authenticated\"`: every signed-in caller", () => {
        const rule: SecurityRule = { operations: ["select", "insert"], access: "authenticated" };
        expect(compileRulePolicies(posts, rule).map(p => [p.operation, p.using, p.withCheck])).toEqual([
            ["select", SIGNED_IN, null],
            ["insert", null, SIGNED_IN]
        ]);
        const rules = withRules([rule]);
        for (const op of ["select", "insert"] as const) {
            expect(checkOperation(rules, user("u1"), null, op)).toBe(true);
            expect(checkOperation(rules, anonymous, null, op)).toBe(false);
            expect(checkOperation(rules, user("anon"), null, op)).toBe(false);
        }
        expect(checkOperation(rules, user("u1"), null, "delete")).toBe(false);
    });

    it("tells anonymous from signed-in for `access: \"authenticated\"` + condition", () => {
        const rules = withRules([{ operation: "update", access: "authenticated", condition: { status: "draft" } }]);
        expect(checkOperation(rules, user("u1"), draft, "update")).toBe(true);
        expect(checkOperation(rules, user("u1"), published, "update")).toBe(false);
        expect(checkOperation(rules, anonymous, draft, "update")).toBe(false);
        expect(checkOperation(rules, user("anonymous"), draft, "update")).toBe(false);
    });

    it("stays three-valued without the row: unknown resolves as the caller asks, a failed caller test is a plain no", () => {
        const rules = withRules([{ operation: "select", access: "authenticated", condition: { status: "published" } }]);
        expect(checkOperation(rules, user("u1"), null, "select")).toBe(true);
        expect(checkOperation(rules, user("u1"), null, "select", { onUnknown: "deny" })).toBe(false);
        // Anonymous fails the caller test whatever the row says.
        expect(checkOperation(rules, anonymous, null, "select")).toBe(false);
    });

    it("answers unknown for a `null` shorthand value — `IS NULL` is evaluated by Postgres alone", () => {
        const { usingExpr } = securityRuleToConditions({ operation: "select", condition: { deletedAt: null } });
        expect(evaluatePolicy(usingExpr!, { uid: "u1", entity: row({ deletedAt: null }) })).toBe("unknown");
        const rules = withRules([{ operation: "delete", condition: { deletedAt: null } }]);
        expect(checkOperation(rules, user("u1"), row({ deletedAt: null }), "delete", { onUnknown: "deny" })).toBe(false);
    });

    it("evaluates shorthand pairs against the row", () => {
        const { usingExpr } = securityRuleToConditions({ operation: "select", condition: { status: "published", rank: 2 } });
        expect(evaluatePolicy(usingExpr!, { entity: row({ status: "published", rank: 2 }) })).toBe(true);
        expect(evaluatePolicy(usingExpr!, { entity: row({ status: "published", rank: 3 }) })).toBe(false);
        expect(evaluatePolicy(usingExpr!, { entity: row({ status: "published" }) })).toBe("unknown");
    });
});
