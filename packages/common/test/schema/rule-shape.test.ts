import { describe, expect, it } from "@jest/globals";
import { TABLE_BRAND, col, policy, type AnyTableDef, type CollectionConfig, type PostgresCollectionConfig, type SecurityRule } from "@rebasepro/types";
import { getPolicyNameHash, isNewShapeRule } from "@rebasepro/utils";

import { compileTables } from "../../src/schema/compile-tables";
import { isSchemaDefinitionError, type SchemaDefinitionProblem } from "../../src/schema/errors";
import { collectionsToTableDefs } from "../../src/schema/lift-collection";
import { printRls } from "../../src/schema/print-table";
import { compileRulePolicies, evaluatePolicy, policyConditionToExpression, policyToPostgres, securityRuleToConditions } from "../../src/util/policy";

/**
 * Security review S-1 and S-6.
 *
 * S-1: a rule combining clauses the `SecurityRule` union excludes —
 * `{ access: "authenticated", ownerField }` — compiled to whichever clause the
 * policy compiler checked first, so the owner test was dropped and every
 * signed-in caller read every row. Such a rule is now refused at compile and
 * at migration, and the compiler itself is total: should one reach it
 * anyway, every clause is ANDed in.
 *
 * S-6: `access: "registered"` — a signed-in caller with an account, not a
 * guest — beside `"authenticated"`, which admits guest sessions.
 */

/** A rule the types refuse, as a JavaScript project or a migrated config can hand it over. */
function untyped(base: SecurityRule, extra: Record<string, unknown>): SecurityRule {
    return Object.assign({}, base, extra);
}

const columns = () => ({ id: col.uuid().primaryKey(), owner: col.text(), status: col.text() });

function tableWith(rules: SecurityRule[]): AnyTableDef {
    return { brand: TABLE_BRAND, name: "docs", config: { columns: columns(), rls: [rules[0], ...rules.slice(1)] } };
}

function problemsOf(rules: SecurityRule[]): SchemaDefinitionProblem[] {
    try {
        compileTables([tableWith(rules)]);
    } catch (error) {
        if (isSchemaDefinitionError(error)) return [...error.problems];
        throw error;
    }
    return [];
}

const docs: CollectionConfig = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    properties: {
        id: { type: "string", isId: "uuid" },
        owner: { type: "string" },
        status: { type: "string" }
    }
};

/** What the shorthand `{ status: value }` desugars to. */
const statusIs = (value: string) => policyConditionToExpression({ status: value });

const usingOf = (rule: SecurityRule): string | undefined => compileRulePolicies(docs, rule)[0]?.using;
const checkOf = (rule: SecurityRule): string | undefined => compileRulePolicies(docs, rule)[0]?.withCheck;

describe("S-1: combinations the SecurityRule union excludes are refused at compile", () => {
    const cases: [string, SecurityRule][] = [
        ["access: authenticated + ownerField", untyped({ operation: "select", access: "authenticated" }, { ownerField: "owner" })],
        ["access: public + ownerField", untyped({ operation: "select", access: "public" }, { ownerField: "owner" })],
        ["access: registered + ownerField", untyped({ operation: "select", access: "registered" }, { ownerField: "owner" })],
        ["access + using", untyped({ operation: "update", access: "authenticated" }, { using: "status = 'published'" })],
        ["access + withCheck", untyped({ operation: "insert", access: "public" }, { withCheck: "status = 'open'" })],
        ["ownerField + using", untyped({ operation: "select", ownerField: "owner" }, { using: "true" })],
        ["ownerField + withCheck", untyped({ operation: "insert", ownerField: "owner" }, { withCheck: "true" })],
        ["ownerField + condition", untyped({ operation: "select", ownerField: "owner" }, { condition: { status: "x" } })],
        ["ownerField + check", untyped({ operation: "insert", ownerField: "owner" }, { check: { status: "x" } })],
        ["condition + using", untyped({ operation: "select", condition: { status: "x" } }, { using: "true" })],
        ["condition + withCheck", untyped({ operation: "update", condition: { status: "x" } }, { withCheck: "true" })],
        ["check + using", untyped({ operation: "update", using: "true" }, { check: { status: "x" } })],
        ["check + withCheck", untyped({ operation: "insert", withCheck: "true" }, { check: { status: "x" } })]
    ];
    for (const [name, rule] of cases) {
        it(`refuses ${name}, naming the table and the rule's index`, () => {
            const problems = problemsOf([{ operation: "select", roles: ["admin"] }, rule]);
            expect(problems.length).toBeGreaterThan(0);
            expect(problems[0]).toMatchObject({ table: "docs", key: "rls[1]" });
            expect(problems[0].message).toMatch(/^rule #1 combines `\w+` with `\w+`, which the SecurityRule type does not allow/);
        });
    }

    it("names a named rule by its name", () => {
        const problems = problemsOf([untyped({ name: "mine", operation: "select", access: "authenticated" }, { ownerField: "owner" })]);
        expect(problems[0].message).toContain('rule "mine" combines `access` with `ownerField`');
        expect(problems[0].message).toContain("{ ownerField }");
    });

    it("refuses an access, mode, operation or roles value the type does not allow", () => {
        expect(problemsOf([untyped({ operation: "select", roles: ["x"] }, { access: "everyone" })])[0].message)
            .toContain('`access: "everyone"`');
        // A typo of "restrictive" compiled as a permissive policy: a widening.
        expect(problemsOf([untyped({ operation: "select", roles: ["x"] }, { mode: "restricitve" })])[0].message)
            .toContain('would compile as "permissive"');
        expect(problemsOf([untyped({ roles: ["x"] }, { operation: "read" })])[0].message).toContain('`operation: "read"`');
        expect(problemsOf([untyped({ roles: ["x"] }, { operations: ["select", "read"] })])[0].message).toContain("`operations:");
        expect(problemsOf([untyped({ operation: "select" }, { roles: "admin" })])[0].message).toContain('`roles: "admin"`');
    });

    it("accepts every shape the union allows", () => {
        expect(problemsOf([
            { operation: "select", ownerField: "owner", roles: ["editor"] },
            { operation: "select", access: "public" },
            { operation: "select", access: "authenticated" },
            { operation: "select", access: "registered" },
            { operation: "select", access: "public", condition: { status: "published" } },
            { operation: "insert", access: "registered", check: { status: "open" } },
            { operation: "select", condition: { status: "published" }, check: { status: "draft" } },
            { operation: "select", using: "true", withCheck: "true" },
            { operation: "insert", withCheck: "true" },
            { operation: "delete", roles: ["admin"] },
            { operation: "select", access: "public", roles: ["editor"] }
        ])).toEqual([]);
    });
});

describe("S-1: the policy compiler is total — no clause is dropped for another", () => {
    it("ANDs `access` and `ownerField` instead of keeping the access test alone", () => {
        const rule = untyped({ operation: "select", access: "authenticated" }, { ownerField: "owner" });
        const using = usingOf(rule) ?? "";
        expect(using).toContain("owner");
        expect(using).toContain("rebase.uid()");
        expect(using).toContain("NOT IN ('anonymous', 'anon')");
    });

    it("ANDs `access` onto raw `using` instead of dropping it", () => {
        const using = usingOf(untyped({ operation: "update", access: "authenticated" }, { using: "status = 'published'" })) ?? "";
        expect(using).toContain("status = 'published'");
        expect(using).toContain("IS NOT NULL");
    });

    it("keeps `ownerField` beside a `condition`, and `condition` beside raw `withCheck`", () => {
        const ownerAndCondition = securityRuleToConditions(untyped({ operation: "select", ownerField: "owner" }, { condition: { status: "x" } }));
        expect(ownerAndCondition.usingExpr).toEqual(policy.and(
            policy.compare(policy.field("owner"), "eq", policy.authUid()),
            statusIs("x")
        ));
        const check = checkOf(untyped({ operation: "update", condition: { status: "x" } }, { withCheck: "owner = rebase.uid()" })) ?? "";
        expect(check).toContain("status");
        expect(check).toContain("rebase.uid()");
    });

    it("admits nobody for an `access` value it does not know", () => {
        expect(securityRuleToConditions(untyped({ operation: "select" }, { access: "everyone" })).usingExpr).toEqual(policy.false());
    });

    it("compiles every valid shape exactly as before: one clause, unwrapped", () => {
        expect(securityRuleToConditions({ operation: "select", ownerField: "owner" }).usingExpr)
            .toEqual(policy.compare(policy.field("owner"), "eq", policy.authUid()));
        expect(securityRuleToConditions({ operation: "select", access: "public" }).usingExpr).toEqual(policy.true());
        expect(securityRuleToConditions({ operation: "select", access: "authenticated", condition: policy.true() }).usingExpr)
            .toEqual(policy.and(policy.authenticated(), policy.true()));
        expect(securityRuleToConditions({ operation: "insert", access: "authenticated", check: policy.true() }))
            .toEqual({ usingExpr: policy.authenticated(), withCheckExpr: policy.and(policy.authenticated(), policy.true()) });
    });

    it("`roles` beside `access: \"public\"` is the conjunction: holders of the role, on every row", () => {
        expect(securityRuleToConditions({ operation: "select", access: "public", roles: ["editor"] }).usingExpr)
            .toEqual(policy.and(policy.true(), policy.rolesOverlap(["editor"])));
        expect(usingOf({ operation: "select", access: "public", roles: ["editor"] })).toContain("ARRAY['editor']");
    });

    it("a lone structured `check` grants no existing row and checks what is written, like raw `withCheck` alone", () => {
        const rule = untyped({ operation: "insert" }, { check: { status: "open" } });
        expect(problemsOf([rule])).toEqual([]);
        expect(securityRuleToConditions(rule)).toEqual({
            usingExpr: null,
            withCheckExpr: statusIs("open")
        });
    });
});

describe("S-1: the migration lift refuses a legacy rule it would widen", () => {
    const legacy = (rules: SecurityRule[]): PostgresCollectionConfig => ({
        slug: "notes",
        name: "Notes",
        table: "notes",
        properties: { id: { type: "string", isId: "uuid" }, owner: { type: "string" }, status: { type: "string" } },
        securityRules: rules
    });
    const refusalOf = (run: () => unknown): string => {
        try {
            run();
        } catch (error) {
            if (isSchemaDefinitionError(error)) return error.problems.map(p => `${p.table}.${p.key ?? ""}: ${p.message}`).join("\n");
            throw error;
        }
        return "";
    };

    it("says the old version read `{ access: \"authenticated\", ownerField }` as owner-only, and what to write", () => {
        const message = refusalOf(() => collectionsToTableDefs([legacy([
            untyped({ operation: "select", access: "authenticated" }, { ownerField: "owner" })
        ])]));
        expect(message).toContain("notes.securityRules");
        expect(message).toContain("combines `access` with `ownerField`");
        expect(message).toContain("owner-only rows (`owner = rebase.uid()`)");
        expect(message).toContain("`{ ownerField }`");
    });

    it("says what `access` + `using` meant: the raw SQL alone", () => {
        const message = refusalOf(() => collectionsToTableDefs([legacy([
            untyped({ operation: "update", access: "authenticated" }, { using: "status = 'published'" })
        ])]));
        expect(message).toContain("its raw `using` SQL");
    });

    it("refuses the same in `defaultSecurityRules`", () => {
        const message = refusalOf(() => collectionsToTableDefs([legacy([])], {
            defaultSecurityRules: [untyped({ operation: "select", access: "public" }, { ownerField: "owner" })]
        }));
        expect(message).toContain("defaultSecurityRules.[0]");
        expect(message).toContain("every caller (`access: \"public\"`)");
    });

    it("carries what it cannot widen: a role-scoped `access: \"authenticated\"`, ownerField, access + condition", () => {
        const { tables } = collectionsToTableDefs([legacy([
            { operation: "select", access: "authenticated", roles: ["editor"] },
            { operation: "select", ownerField: "owner" },
            { operation: "select", access: "public", condition: { status: "published" } }
        ])]);
        expect(tables).toHaveLength(1);
    });
});

describe("the migration lift notes every legacy rule whose policy now grants something different", () => {
    const legacy = (rules: SecurityRule[]): PostgresCollectionConfig => ({
        slug: "notes",
        name: "Notes",
        table: "notes",
        properties: { id: { type: "string", isId: "uuid" }, owner: { type: "string" }, status: { type: "string" } },
        securityRules: rules
    });
    const meaningNotes = (rules: SecurityRule[]) =>
        collectionsToTableDefs([legacy(rules)]).notCarried.filter(note => note.kind === "meaning");

    it("bare `access: \"authenticated\"`: granted nothing, now every signed-in caller — carried as written", () => {
        const rule: SecurityRule = { operation: "select", access: "authenticated" };
        const { tables, notCarried } = collectionsToTableDefs([legacy([rule])]);
        expect(tables[0].config.rls).toEqual([rule]);
        const notes = notCarried.filter(note => note.kind === "meaning");
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ collection: "notes", field: "securityRules[0]", value: rule });
        expect(notes[0].reason).toContain("granted nothing");
        expect(notes[0].reason).toContain("guests included");
        expect(notes[0].reason).toContain('`access: "registered"`');
        expect(notes[0].reason).toContain("remove the rule");
    });

    it("`access: \"authenticated\"` with a condition: the access was ignored, now it narrows", () => {
        const [note] = meaningNotes([{ operation: "select", access: "authenticated", condition: { status: "published" } }]);
        expect(note.reason).toContain("was ignored");
        expect(note.reason).toContain('`access: "public"`');
    });

    it("`access` with only a `check`, on an operation that reads rows: no existing row before, every row now", () => {
        expect(meaningNotes([{ operation: "update", access: "public", check: { status: "open" } }])[0].reason)
            .toContain("granted no existing row");
        expect(meaningNotes([{ operations: ["all"], access: "authenticated", check: { status: "open" } }])).toHaveLength(1);
        // Inserting under `public` meant the same before and now.
        expect(meaningNotes([{ operation: "insert", access: "public", check: { status: "open" } }])).toEqual([]);
        expect(meaningNotes([{ operation: "insert", access: "authenticated", check: { status: "open" } }])[0].reason)
            .toContain("any caller could insert");
    });

    it("says nothing for a shape that compiles as it did", () => {
        expect(meaningNotes([
            { operation: "select", access: "public" },
            { operation: "select", access: "public", condition: { status: "published" } },
            { operation: "select", ownerField: "owner" },
            { operation: "select", condition: policy.true() },
            { operation: "select", using: "true" },
            { operation: "insert", withCheck: "true" },
            { operation: "delete", roles: ["admin"] },
            { operation: "select", access: "authenticated", roles: ["editor"] }
        ])).toEqual([]);
    });

    it("notes a default rule too", () => {
        const { notCarried } = collectionsToTableDefs([legacy([])], { defaultSecurityRules: [{ operation: "select", access: "authenticated" }] });
        expect(notCarried.filter(note => note.kind === "meaning")).toMatchObject([{ collection: "defaultSecurityRules", field: "defaultSecurityRules[0]" }]);
    });
});

describe("S-6: access: \"registered\"", () => {
    const registered: SecurityRule = { operation: "select", access: "registered" };

    it("compiles alone to the account test, which excludes a guest", () => {
        expect(securityRuleToConditions(registered).usingExpr).toEqual(policy.registered());
        expect(usingOf(registered)).toContain("NOT (SELECT rebase.is_anonymous())");
        expect(usingOf({ operation: "select", access: "authenticated" })).not.toContain("is_anonymous");
    });

    it("gates a condition and a check exactly like \"authenticated\"", () => {
        expect(securityRuleToConditions({ operation: "update", access: "registered", condition: { status: "open" }, check: { status: "done" } })).toEqual({
            usingExpr: policy.and(policy.registered(), statusIs("open")),
            withCheckExpr: policy.and(policy.registered(), statusIs("done"))
        });
        expect(securityRuleToConditions({ operation: "insert", access: "registered", check: { status: "open" } }).usingExpr)
            .toEqual(policy.registered());
    });

    it("is a new shape, named apart from \"authenticated\" and from the legacy hash space", () => {
        expect(isNewShapeRule(registered)).toBe(true);
        expect(getPolicyNameHash(registered)).not.toBe(getPolicyNameHash({ operation: "select", access: "authenticated" }));
        expect(getPolicyNameHash({ operation: "select", access: "registered", condition: { status: "x" } }))
            .not.toBe(getPolicyNameHash({ operation: "select", access: "authenticated", condition: { status: "x" } }));
    });

    it("is evaluated client-side as the database does: a guest refused, an account admitted", () => {
        const { usingExpr } = securityRuleToConditions(registered);
        if (!usingExpr) throw new Error("expected a USING clause");
        expect(evaluatePolicy(usingExpr, { uid: "u1", isAnonymous: true, entity: null })).toBe(false);
        expect(evaluatePolicy(usingExpr, { uid: "u1", isAnonymous: false, entity: null })).toBe(true);
        const authenticated = securityRuleToConditions({ operation: "select", access: "authenticated" }).usingExpr;
        if (!authenticated) throw new Error("expected a USING clause");
        expect(evaluatePolicy(authenticated, { uid: "u1", isAnonymous: true, entity: null })).toBe(true);
    });

    it("compiles, and prints back as written", () => {
        const [descriptor] = compileTables([tableWith([registered, { operation: "insert", access: "registered", check: { status: "open" } }])]);
        expect(descriptor.rls.rules).toEqual([registered, { operation: "insert", access: "registered", check: { status: "open" } }]);
        expect(printRls(descriptor.rls)).toContain('access: "registered"');
        expect(policyToPostgres(policy.registered())).toContain("is_anonymous");
    });
});
