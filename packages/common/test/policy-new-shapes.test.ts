/**
 * The two rule forms the Postgres-first spec's `rls` example uses, added as
 * NEW shapes:
 *
 * - a `PolicyShorthand` condition / check — `{ status: "published" }`, an AND
 *   of column equalities, `null` meaning `IS NULL`;
 * - `access: "public" | "authenticated"` combined with a condition / check —
 *   "anyone (or any signed-in caller) may do this, on rows matching …".
 *
 * Each is pinned from the type guard through the compiler, the policy name,
 * the client-side evaluator and the import path back from `pg_policies`. The
 * other half of the contract — that no OLD shape hashes, compiles or names
 * differently — is held by the golden corpus and `check:derived-names`, and
 * by the legacy pins at the bottom of this file.
 */
import {
    POLICY_EXPRESSION_KINDS,
    isPolicyShorthand,
    policy,
    type AuthState,
    type Entity,
    type PolicyCondition,
    type PolicyExpression,
    type SecurityRule,
    type User
} from "@rebasepro/types";
import {
    type LegacyCollectionConfig
} from "@rebasepro/common/migrate";
import { getPolicyNameHash, getPolicyNamesForRule, isNewShapeRule, newShapeHashInput } from "@rebasepro/utils";
import {
    policyConditionToExpression,
    policyShorthandColumns,
    policyToSecurityRule,
    sqlToPolicy
} from "../src/util/policy";
import {
    compileRulePolicies,
    policyToPostgres
} from "./helpers/legacy-policies";

const SIGNED_IN = "(SELECT rebase.uid()) IS NOT NULL AND (SELECT rebase.uid()) NOT IN ('anonymous', 'anon')";

const posts: LegacyCollectionConfig = {
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
const withRules = (securityRules: SecurityRule[]): LegacyCollectionConfig => ({ ...posts, securityRules });

describe("isPolicyShorthand", () => {
    it("accepts a plain object of column → literal", () => {
        expect(isPolicyShorthand({ status: "published" })).toBe(true);
        expect(isPolicyShorthand({ rank: 3, featured: false, deletedAt: null, title: "it's" })).toBe(true);
    });

    it("never takes an expression node for a shorthand — every node carries `kind`", () => {
        const nodes: PolicyExpression[] = [
            policy.true(), policy.false(), policy.and(), policy.or(), policy.not(policy.true()),
            policy.compare(policy.field("a"), "eq", policy.literal(1)), policy.rolesOverlap(["x"]),
            policy.rolesContain(["x"]), policy.authenticated(), policy.registered(), policy.serverContext(),
            policy.existsIn({ table: "m", where: policy.true() }), policy.raw("true")
        ];
        expect(nodes.map(n => n.kind).sort()).toEqual([...POLICY_EXPRESSION_KINDS].sort());
        for (const node of nodes) expect(isPolicyShorthand(node)).toBe(false);
    });

    it("refuses anything that is not a non-empty map of literals, and any object with a `kind` key", () => {
        for (const value of [
            {}, { kind: "published" }, { kind: "true" }, { status: "x", kind: "y" }, [], ["a"], null, undefined, "x", 3,
            { status: { nested: true } }, { status: undefined }, { rank: Number.NaN }, { rank: Infinity }, new Date(),
            { tags: ["a"] }
        ]) {
            expect(isPolicyShorthand(value)).toBe(false);
        }
    });
});

describe("policyConditionToExpression", () => {
    it("returns an expression as the same object, so a long-form rule compiles exactly as before", () => {
        const expr = policy.compare(policy.field("status"), "eq", policy.literal("published"));
        expect(policyConditionToExpression(expr)).toBe(expr);
    });

    it("desugars a shorthand to the longhand expression, columns sorted", () => {
        expect(policyConditionToExpression({ status: "published" }))
            .toEqual(policy.compare(policy.field("status"), "eq", policy.literal("published")));
        expect(policyConditionToExpression({ status: "published", orgId: "acme" })).toEqual(policy.and(
            policy.compare(policy.field("orgId"), "eq", policy.literal("acme")),
            policy.compare(policy.field("status"), "eq", policy.literal("published"))
        ));
    });

    it("turns `null` into `IS NULL`, the only spelling that means it", () => {
        expect(policyConditionToExpression({ deletedAt: null })).toEqual(policy.raw("{deletedAt} IS NULL"));
    });

    it("refuses an object whose `kind` no expression has, naming the table and clause", () => {
        expect(() => policyConditionToExpression(loose("{\"kind\":\"published\"}"), { table: "posts", clause: "check" }))
            .toThrow(/"posts".*`check`.*kind: "published".*policy\.compare\(policy\.field\("kind"\)/s);
    });

    it("refuses an empty object — an AND of nothing would grant every row", () => {
        expect(() => policyConditionToExpression({}, { table: "posts" })).toThrow(/"posts".*`\{\}`.*policy\.true\(\)/s);
    });

    it("refuses a value that is not a literal, naming the column", () => {
        expect(() => policyConditionToExpression(loose("{\"status\":\"x\",\"tags\":[\"a\"]}"), { table: "posts" }))
            .toThrow(/"posts".*column "tags"/s);
    });

    it("lists a shorthand's columns, sorted, and nothing for an expression", () => {
        expect(policyShorthandColumns({ status: "a", orgId: "b" })).toEqual(["orgId", "status"]);
        expect(policyShorthandColumns(policy.true())).toEqual([]);
        expect(policyShorthandColumns(undefined)).toEqual([]);
    });
});

describe("compiling the new shapes", () => {
    it("compiles the spec's rls block", () => {
        const compiled = SPEC_RULES.flatMap(rule => compileRulePolicies(posts, rule));
        expect(compiled.map(p => [p.operation, p.roles, p.using, p.withCheck])).toEqual([
            ["select", ["public"], "status = 'published'", null],
            ["select", ["public"], "(SELECT string_to_array(rebase.roles(), ',') && ARRAY['editor'])", null],
            ["insert", ["public"], null, "(SELECT string_to_array(rebase.roles(), ',') && ARRAY['editor'])"],
            ["update", ["public"], "(SELECT string_to_array(rebase.roles(), ',') && ARRAY['editor'])", "(SELECT string_to_array(rebase.roles(), ',') && ARRAY['editor'])"],
            ["delete", ["public"], "(SELECT string_to_array(rebase.roles(), ',') && ARRAY['admin'])", null]
        ]);
    });

    it("compiles a shorthand to exactly the SQL of the longhand expression", () => {
        const shorthand = compileRulePolicies(posts, { operation: "update", condition: { orgId: "o'brien", rank: 3, featured: true } });
        const longhand = compileRulePolicies(posts, {
            operation: "update",
            condition: policy.and(
                policy.compare(policy.field("featured"), "eq", policy.literal(true)),
                policy.compare(policy.field("orgId"), "eq", policy.literal("o'brien")),
                policy.compare(policy.field("rank"), "eq", policy.literal(3))
            )
        });
        expect(shorthand[0].using).toBe("(featured = true) AND (org_id = 'o''brien') AND (rank = 3)");
        expect(shorthand.map(p => [p.using, p.withCheck])).toEqual(longhand.map(p => [p.using, p.withCheck]));
    });

    it("compiles key order away: the same pairs in any order give the same SQL and the same name", () => {
        const a = compileRulePolicies(posts, { operation: "select", access: "public", condition: { status: "published", orgId: "acme" } });
        const b = compileRulePolicies(posts, { operation: "select", access: "public", condition: { orgId: "acme", status: "published" } });
        expect(b).toEqual(a);
    });

    it("compiles `access: \"authenticated\"` + condition for every operation, WITH CHECK from `check ?? condition`", () => {
        const rule: SecurityRule = { operations: ["select", "insert", "update", "delete"], access: "authenticated", condition: { status: "draft" } };
        expect(compileRulePolicies(posts, rule).map(p => [p.operation, p.using, p.withCheck])).toEqual([
            ["select", `(${SIGNED_IN}) AND (status = 'draft')`, null],
            ["insert", null, `(${SIGNED_IN}) AND (status = 'draft')`],
            ["update", `(${SIGNED_IN}) AND (status = 'draft')`, `(${SIGNED_IN}) AND (status = 'draft')`],
            ["delete", `(${SIGNED_IN}) AND (status = 'draft')`, null]
        ]);
        const checked = compileRulePolicies(posts, { operation: "update", access: "authenticated", condition: { status: "draft" }, check: { deletedAt: null, featured: false } });
        expect(checked[0].withCheck).toBe(`(${SIGNED_IN}) AND (("public"."posts".deleted_at IS NULL) AND (featured = false))`);
    });

    it("compiles `access: \"public\"` + condition to the condition alone", () => {
        const [select] = compileRulePolicies(posts, { operation: "select", access: "public", condition: policy.compare(policy.field("rank"), "gt", policy.literal(0)) });
        expect(select.using).toBe("rank > 0");
        const [insert] = compileRulePolicies(posts, { operation: "insert", access: "public", condition: { status: "draft" } });
        expect(insert.withCheck).toBe("status = 'draft'");
    });

    it("compiles access + check alone: USING is the access test", () => {
        const [update] = compileRulePolicies(posts, { operation: "update", access: "authenticated", check: { status: "draft" } });
        expect(update.using).toBe(SIGNED_IN);
        expect(update.withCheck).toBe(`(${SIGNED_IN}) AND (status = 'draft')`);
        const [publicUpdate] = compileRulePolicies(posts, { operation: "update", access: "public", check: { status: "draft" } });
        expect([publicUpdate.using, publicUpdate.withCheck]).toEqual(["true", "status = 'draft'"]);
    });

    it("ANDs `roles` on, and honours `pgRoles` and `mode`, as on every rule", () => {
        const [p] = compileRulePolicies(posts, {
            operation: "select", access: "public", condition: { status: "published" }, roles: ["viewer"], pgRoles: ["app_reader"], mode: "restrictive"
        });
        expect(p.roles).toEqual(["app_reader"]);
        expect(p.mode).toBe("restrictive");
        expect(p.using).toBe("((SELECT NOT (string_to_array(rebase.roles(), ',') && ARRAY['viewer']))) OR (status = 'published')");
    });

    it("refuses a shorthand key that names no column, with the table and the key", () => {
        expect(() => compileRulePolicies(posts, { operation: "select", access: "public", condition: { stauts: "published" } }))
            .toThrow(/"posts" names "stauts" in its `condition`, and "posts" has no such column/);
        expect(() => compileRulePolicies(posts, { operation: "insert", access: "authenticated", check: { owner: "x" } }))
            .toThrow(/"posts" names "owner" in its `check`/);
    });

    it("accepts a `belongsTo` relation key, compiled to its foreign-key column", () => {
        const orgs: LegacyCollectionConfig = { name: "Orgs", slug: "orgs", table: "orgs", properties: { id: { name: "ID", type: "string", isId: "uuid" } } };
        const projects: LegacyCollectionConfig = {
            name: "Projects", slug: "projects", table: "projects",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                org: { name: "Org", type: "relation", relation: { kind: "belongsTo", target: () => orgs, localKey: "org_id" } }
            }
        };
        const [p] = compileRulePolicies(projects, { operation: "select", access: "public", condition: { org: "6f1c2a52-6a0e-4f3c-9a59-2a6f1d0c7a01" } }, { collections: [orgs] });
        expect(p.using).toBe("org_id = '6f1c2a52-6a0e-4f3c-9a59-2a6f1d0c7a01'");
    });
});

describe("policy names of the new shapes", () => {
    it("names them `<table>_<op>_<sha7>`, the form isGeneratedPolicyName recognises", () => {
        for (const rule of SPEC_RULES) {
            for (const name of getPolicyNamesForRule(rule, "posts")) expect(name).toMatch(/^posts_(select|insert|update|delete)_[0-9a-f]{7}(_\d+)?$/);
        }
    });

    it("hashes a shorthand independently of key order", () => {
        const a: SecurityRule = { operation: "select", condition: { status: "published", orgId: "acme", deletedAt: null } };
        const b: SecurityRule = { operation: "select", condition: { deletedAt: null, orgId: "acme", status: "published" } };
        expect(newShapeHashInput(a)).toBe(newShapeHashInput(b));
        expect(getPolicyNameHash(a)).toBe(getPolicyNameHash(b));
    });

    it("hashes different pairs, values or access differently", () => {
        const rules: SecurityRule[] = [
            { operation: "select", condition: { status: "published" } },
            { operation: "select", condition: { status: "draft" } },
            { operation: "select", condition: { status: null } },
            { operation: "select", condition: { state: "published" } },
            { operation: "select", access: "public", condition: { status: "published" } },
            { operation: "select", access: "authenticated", condition: { status: "published" } },
            { operation: "select", access: "authenticated", check: { status: "published" } },
            { operation: "select", access: "public", condition: policy.compare(policy.field("status"), "eq", policy.literal("published")) }
        ];
        const hashes = new Set(rules.map(getPolicyNameHash));
        expect(hashes.size).toBe(8);
    });

    it("classifies exactly the new forms as new, so every legacy rule keeps its legacy input", () => {
        expect(SPEC_RULES.map(isNewShapeRule)).toEqual([true, false, false]);
        expect(isNewShapeRule({ operation: "insert", access: "authenticated", check: policy.true() })).toBe(true);
        expect(isNewShapeRule({ operation: "select", condition: policy.authenticated() })).toBe(false);
        expect(isNewShapeRule({ operation: "select", access: "public" })).toBe(false);
        expect(isNewShapeRule({ operation: "select", ownerField: "orgId" })).toBe(false);
        // Bare `access: "authenticated"`: older releases compiled it to a deny
        // under a legacy name; it is a new shape now, named in the new space.
        expect(isNewShapeRule({ operation: "insert", access: "authenticated" })).toBe(true);
    });

    it("keeps its hash input in a space no legacy input can reach", () => {
        expect(newShapeHashInput(SPEC_RULES[0])).toMatch(/^rls2:\{/);
        expect(newShapeHashInput(SPEC_RULES[0]))
            .toBe("rls2:{\"a\":\"public\",\"c\":{\"=\":[[\"status\",\"published\"]]},\"op\":\"select\"}");
    });

    it("leaves every legacy name where it was", () => {
        // Pinned from contracts/derived-names.txt and the golden corpus.
        expect(getPolicyNamesForRule({ operation: "select", access: "public" }, "articles")).toEqual(["articles_select_841c287"]);
        expect(getPolicyNamesForRule({ operation: "select", ownerField: "orgId" }, "posts")).toEqual(
            getPolicyNamesForRule({ ownerField: "orgId", operation: "select" }, "posts")
        );
    });

    it("moves bare `access: \"authenticated\"` off the name it compiled to as a deny", () => {
        // Was `categories_insert_29ea277` (WITH CHECK (false)); see
        // contracts/derived-names.txt.
        expect(getPolicyNamesForRule({ operation: "insert", access: "authenticated" }, "categories"))
            .toEqual(["categories_insert_2faf7c9"]);
        expect(newShapeHashInput({ operation: "insert", access: "authenticated" }))
            .toBe("rls2:{\"a\":\"authenticated\",\"op\":\"insert\"}");
    });
});

describe("importing a new-shape policy back from the database", () => {
    const shapes: SecurityRule[] = [
        SPEC_RULES[0],
        { operation: "insert", access: "authenticated", condition: { orgId: "acme", status: "draft" } },
        { operation: "update", access: "authenticated", condition: { status: "draft" }, check: { featured: false, deletedAt: null } },
        { operation: "delete", access: "authenticated", condition: { deletedAt: null } }
    ];

    /**
     * The import is the long form: `policyToSecurityRule` gives a raw-SQL rule
     * (`using` / `withCheck`), which the compiler reads through `sqlToPolicy`.
     * The text may gain parentheses on the first trip (the signed-in test is
     * re-read as two raw conjuncts) and must not move after it; that the
     * clauses still admit the same rows is run against Postgres in
     * server-postgres `policy-new-shapes.test.ts`.
     */
    it("imports as a raw-SQL rule that recompiles to a fixed point", () => {
        for (const rule of shapes) {
            for (const compiled of compileRulePolicies(posts, rule)) {
                const imported = policyToSecurityRule({
                    policyname: compiled.name,
                    cmd: compiled.operation === "all" ? "ALL" : compiled.operation === "select" ? "SELECT" : compiled.operation === "insert" ? "INSERT" : compiled.operation === "update" ? "UPDATE" : "DELETE",
                    permissive: "PERMISSIVE",
                    roles: compiled.roles,
                    qual: compiled.using,
                    with_check: compiled.withCheck
                });
                expect(imported.using ?? null).toBe(compiled.using);
                expect(imported.withCheck ?? null).toBe(compiled.withCheck);
                const [again] = compileRulePolicies(posts, imported);
                const operation = compiled.operation;
                const reread: SecurityRule = again.using
                    ? (again.withCheck ? { operation, using: again.using, withCheck: again.withCheck } : { operation, using: again.using })
                    : { operation, withCheck: again.withCheck ?? "false" };
                const [twice] = compileRulePolicies(posts, reread);
                expect([twice.using, twice.withCheck]).toEqual([again.using, again.withCheck]);
                if (rule === SPEC_RULES[0]) expect(again.using).toBe(compiled.using);
            }
        }
    });

    it("reads a shorthand's equality back as the longhand `PolicyExpression`", () => {
        const [select] = compileRulePolicies(posts, SPEC_RULES[0]);
        expect(sqlToPolicy(select.using!)).toEqual(policy.compare(policy.field("status"), "eq", policy.literal("published")));
        expect(policyToPostgres(sqlToPolicy(select.using!), posts)).toBe(select.using);
    });
});
