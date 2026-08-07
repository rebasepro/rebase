/**
 * Properties of the policy parser/compiler pair.
 *
 * `sqlToPolicy` and `policyToPostgres` are inverses of each other in the only
 * sense that matters operationally: a policy body written by one is read back
 * by the other, and what comes back is written into a database as DDL. The
 * `sqlToPolicy` doc comment says so explicitly — "this output also round-trips
 * back into DDL … decomposing a clause the parser only partly understands is
 * not a cosmetic mistake — it emits invalid SQL".
 *
 * That sentence is a specification. Everything here is that sentence, made
 * checkable and quantified over the whole expression grammar rather than over
 * a fixture list.
 *
 * These are not a substitute for the example tests in
 * `test/policyToPostgres.test.ts`; examples pin the exact SQL a known rule must
 * produce, which is a different and equally necessary claim. Properties cover
 * the inputs nobody thought to write down.
 */

import fc from "fast-check";
import { PolicyExpression, policy } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";
import { sqlToPolicy } from "../../src/util/policy/sqlToPolicy";
import { findAnonymousGrants } from "../../src/util/policy/sqlToPolicy";
import { policyToPostgres } from "../../src/util/policy/policyToPostgres";
import { evaluatePolicy, TriState } from "../../src/util/policy/evaluatePolicy";
import { policyExpression, innerPolicyExpression, evalContext, snakeIdentifier } from "./arbitraries";

/**
 * Run count. High enough to explore the grammar, low enough to stay in CI.
 *
 * `FC_RUNS=200000 pnpm test` for a deep hunt — worth doing after changing the
 * parser or the compiler, since the point of a property is that it keeps paying
 * out when you spend more on it.
 */
const RUNS = Number(process.env.FC_RUNS ?? 2000);

/** `policyToPostgres ∘ sqlToPolicy` — one full trip through SQL and back. */
const reparse = (sql: string): string => policyToPostgres(sqlToPolicy(sql));

describe("policy SQL — structural properties", () => {

    it("compiles every expression to a non-empty string without throwing", () => {
        fc.assert(fc.property(policyExpression, expr => {
            const sql = policyToPostgres(expr);
            expect(typeof sql).toBe("string");
            expect(sql.length).toBeGreaterThan(0);
        }), { numRuns: RUNS });
    });

    /**
     * Unbalanced parens are how a decomposition bug surfaces as a Postgres
     * syntax error at `CREATE POLICY` time — that is, at migration time, on
     * someone's deploy.
     */
    it("emits balanced parentheses, counting only those outside string literals", () => {
        fc.assert(fc.property(policyExpression, expr => {
            expect(parenBalance(policyToPostgres(expr))).toBe(0);
        }), { numRuns: RUNS });
    });

    /**
     * The property that would have caught the `EXISTS (… AND …)` tear.
     *
     * Compiling, parsing and recompiling must reach a fixed point after one
     * trip. It does not require the parser to understand everything — an
     * unparsed clause becomes `raw` and `raw` is reproduced verbatim, so it
     * settles immediately. What it forbids is a clause that keeps *changing*
     * under re-reading, which is precisely what happens when the parser splits
     * something it should have left alone: the halves re-emit with different
     * parens, and parsing those gives a different tree again.
     *
     * A policy body is read and rewritten repeatedly in normal use — the admin
     * UI reads it back, the Studio saves it, boot recompiles it — so a
     * non-fixed-point is not a theoretical concern. It is a rule that mutates a
     * little on every save.
     */
    it("reaches a fixed point after one compile→parse→compile round trip", () => {
        fc.assert(fc.property(policyExpression, expr => {
            const once = policyToPostgres(expr);
            const twice = reparse(once);
            expect(reparse(twice)).toBe(twice);
        }), { numRuns: RUNS });
    });

    /**
     * An alias introduced by a subquery may only be referenced inside that
     * subquery's parentheses. This is the "missing FROM-clause entry for table"
     * error stated as a scope invariant, and unlike paren balance it actually
     * discriminates the bug: `(EXISTS (SELECT 1 FROM m WHERE a)) AND (m.b = …)`
     * is perfectly balanced and still nonsense.
     */
    it("never references a subquery alias outside the subquery that binds it", () => {
        fc.assert(fc.property(policyExpression, expr => {
            const sql = policyToPostgres(expr);
            for (const violation of aliasScopeViolations(sql)) {
                throw new Error(`alias ${violation} referenced outside its EXISTS in: ${sql}`);
            }
        }), { numRuns: RUNS });
    });

    /**
     * Column naming has to be a fixed point too, for the same reason: the
     * compiler snake-cases a field name on every trip through SQL, so if
     * `toSnakeCase` were not idempotent a column would drift a little each time
     * a policy was re-saved, and eventually name a column that does not exist.
     */
    it("derives column names idempotently", () => {
        fc.assert(fc.property(fc.string({ maxLength: 24 }), name => {
            expect(toSnakeCase(toSnakeCase(name))).toBe(toSnakeCase(name));
        }), { numRuns: RUNS });
    });
});

describe("policy SQL — semantic properties", () => {

    /**
     * The security-relevant one, and the reason the rest of this file exists.
     *
     * A round trip through SQL is allowed to lose precision — an unparsed
     * clause becomes `raw`, which the JS evaluator reports as `"unknown"` and
     * every enforcement caller resolves fail-closed. What it is never allowed
     * to do is turn a denial into a grant. Stated as: if the original
     * expression denies a given caller and row, the re-read expression must not
     * allow them.
     *
     * Restricted to `innerPolicyExpression` (no `existsIn`) because the JS
     * evaluator answers `"unknown"` for a membership subquery by design — it
     * cannot run one — so including them would only exercise the trivially-safe
     * branch and dilute the run budget.
     */
    it("never turns a denial into a grant when re-read from SQL", () => {
        fc.assert(fc.property(innerPolicyExpression, evalContext, (expr, ctx) => {
            const before = evaluatePolicy(expr, ctx as never);
            if (before !== false) return; // only denials constrain us
            const after = evaluatePolicy(sqlToPolicy(policyToPostgres(expr)), ctx as never);
            expect(after).not.toBe(true);
        }), { numRuns: RUNS });
    });

    /**
     * The dual, kept separate because it is a *correctness* claim rather than a
     * *safety* one and is therefore allowed to be weaker: a grant may degrade
     * to `"unknown"` (the clause stopped being understood), but it must not
     * invert to an outright denial, which would hide rows the database will
     * happily return.
     */
    it("never turns a grant into a denial when re-read from SQL", () => {
        fc.assert(fc.property(innerPolicyExpression, evalContext, (expr, ctx) => {
            const before = evaluatePolicy(expr, ctx as never);
            if (before !== true) return;
            const after = evaluatePolicy(sqlToPolicy(policyToPostgres(expr)), ctx as never);
            expect(after).not.toBe(false);
        }), { numRuns: RUNS });
    });

    /**
     * `findAnonymousGrants` runs over policy bodies read back out of a
     * database, so it sees expressions that have been through the round trip
     * rather than the ones the author wrote. A risk that is visible before the
     * trip and invisible after it is a security check that silently turns off —
     * the same failure shape as a linter that stops recognising a dangerous
     * clause because a function got renamed.
     *
     * One-directional on purpose. The trip may *add* findings (a compiled
     * `authenticated()` decomposes into raw fragments, one of which literally
     * reads `rebase.uid() IS NOT NULL`), and that direction is a false positive,
     * not a hole. See `policy-linter-false-positive.property.test.ts`.
     */
    it("keeps every anonymous-grant risk detectable after a round trip", () => {
        fc.assert(fc.property(policyExpression, expr => {
            const before = findAnonymousGrants(expr);
            if (before.length === 0) return;
            const after = findAnonymousGrants(sqlToPolicy(policyToPostgres(expr)));
            expect(after.length).toBeGreaterThan(0);
        }), { numRuns: RUNS });
    });

    /**
     * The three-valued logic must be monotone in the way Kleene logic promises:
     * `and` cannot be more permissive than its least permissive operand.
     * Cheap to state, and it is the invariant every fail-closed caller relies
     * on when it treats `"unknown"` as "do not allow".
     */
    it("evaluates `and` no more permissively than its weakest operand", () => {
        fc.assert(fc.property(
            fc.array(innerPolicyExpression, { minLength: 1, maxLength: 4 }),
            evalContext,
            (operands, ctx) => {
                const combined = evaluatePolicy(policy.and(...operands), ctx as never);
                const each = operands.map(o => evaluatePolicy(o, ctx as never));
                if (each.some(v => v === false)) expect(combined).toBe(false);
                else if (each.some(v => v === "unknown")) expect(combined).toBe("unknown");
                else expect(combined).toBe(true);
            }
        ), { numRuns: RUNS });
    });
});

describe("policy SQL — parser totality", () => {

    /**
     * The parser is handed strings from outside the compiler too: policy bodies
     * typed into the Studio, and bodies read from a database that a DBA edited
     * by hand. It must not throw on any of them — a crash here takes out the
     * schema view for the whole project.
     */
    it("parses arbitrary strings without throwing", () => {
        fc.assert(fc.property(fc.string({ maxLength: 120 }), sql => {
            expect(() => sqlToPolicy(sql)).not.toThrow();
        }), { numRuns: RUNS });
    });

    it("parses adversarial SQL-shaped strings without throwing", () => {
        const sqlish = fc.stringMatching(/^[a-z_'()=!<> ,.]{0,60}$/);
        fc.assert(fc.property(sqlish, sql => {
            expect(() => policyToPostgres(sqlToPolicy(sql))).not.toThrow();
        }), { numRuns: RUNS });
    });

    /**
     * Whatever the parser makes of an unrecognised string, recompiling it must
     * settle. Same fixed-point argument as above, but entered from the other
     * side — from SQL rather than from an expression — because that is the
     * direction the Studio takes.
     */
    it("settles on arbitrary SQL-shaped input", () => {
        const sqlish = fc.stringMatching(/^[a-z_'()=!<> ,.]{0,60}$/);
        fc.assert(fc.property(sqlish, sql => {
            const once = reparse(sql);
            expect(reparse(once)).toBe(once);
        }), { numRuns: RUNS });
    });
});

describe("policy SQL — existsIn scoping", () => {

    /**
     * Two sibling subqueries must not share an alias, or the inner one shadows
     * the outer and correlated predicates silently bind to the wrong table —
     * the same class as the unqualified-`id` bug, where a bare column name in
     * an RLS subquery bound to the inner relation and made the check vacuous.
     */
    it("gives every subquery in one expression a distinct alias", () => {
        const twoSubqueries = fc.tuple(snakeIdentifier, snakeIdentifier, snakeIdentifier)
            .map(([a, b, col]) => policy.and(
                policy.existsIn({
                    collection: a,
                    where: policy.compare(policy.field(col), "eq", policy.outerField(col))
                }),
                policy.existsIn({
                    collection: b,
                    where: policy.compare(policy.field(col), "eq", policy.outerField(col))
                })
            ));
        fc.assert(fc.property(twoSubqueries, expr => {
            const aliases = [...policyToPostgres(expr).matchAll(/"(_ex\d+)"\s+WHERE|"(_ex\d+)"/g)]
                .map(m => m[1] ?? m[2]);
            const declared = [...policyToPostgres(expr).matchAll(/AS?\s*"(_ex\d+)"|"(_ex\d+)"\s+WHERE/g)];
            expect(new Set(aliases).size).toBeGreaterThanOrEqual(declared.length > 0 ? 1 : 0);
            // The real claim: no alias is introduced twice.
            const introductions = [...policyToPostgres(expr).matchAll(/FROM\s+"[^"]+"\."[^"]+"\s+"(_ex\d+)"/g)]
                .map(m => m[1]);
            expect(new Set(introductions).size).toBe(introductions.length);
        }), { numRuns: RUNS });
    });
});

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Net paren depth, ignoring parens inside single-quoted literals and treating
 * `''` as an escaped quote — the same lexing rule `splitTopLevel` uses, so the
 * check agrees with the code it is checking about what counts as a string.
 */
function parenBalance(sql: string): number {
    let depth = 0;
    let inString = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (inString) {
            if (ch === "'") {
                if (sql[i + 1] === "'") i++;
                else inString = false;
            }
            continue;
        }
        if (ch === "'") { inString = true; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth < 0) return depth;
    }
    return depth;
}

/**
 * Aliases referenced outside the parenthesised body of the `EXISTS` that
 * introduced them.
 *
 * Walks the string once, tracking paren depth and recording the depth at which
 * each `FROM … "_exN"` binding appeared. A later `"_exN".` reference at a
 * shallower depth is out of scope.
 */
function aliasScopeViolations(sql: string): string[] {
    const boundAt = new Map<string, number>();
    const violations: string[] = [];
    let depth = 0;
    let inString = false;

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (inString) {
            if (ch === "'") {
                if (sql[i + 1] === "'") i++;
                else inString = false;
            }
            continue;
        }
        if (ch === "'") { inString = true; continue; }
        if (ch === "(") { depth++; continue; }
        if (ch === ")") {
            depth--;
            // Leaving a scope retires every alias bound deeper than we now are.
            for (const [alias, d] of boundAt) if (d > depth) boundAt.delete(alias);
            continue;
        }
        const bind = /^FROM\s+"[^"]+"\."[^"]+"\s+"(_ex\d+)"/.exec(sql.slice(i));
        if (bind) {
            boundAt.set(bind[1], depth);
            i += bind[0].length - 1;
            continue;
        }
        const ref = /^"(_ex\d+)"\./.exec(sql.slice(i));
        if (ref) {
            if (!boundAt.has(ref[1])) violations.push(ref[1]);
            i += ref[0].length - 1;
        }
    }
    return violations;
}

/** Re-exported for the sibling suite, which needs the same lexing rule. */
export { parenBalance };

/** Keeps TypeScript from widening the import away in a `--isolatedModules` build. */
export type { PolicyExpression, TriState };
