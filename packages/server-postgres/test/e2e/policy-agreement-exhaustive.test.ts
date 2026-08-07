/**
 * E2E: Postgres and the JavaScript evaluator agree, for every expression of a
 * bounded size — not just the ones someone listed.
 *
 * `policy-agreement.test.ts` next door checks eight hand-picked expressions
 * against three callers. It exists because a *string* comparison could never
 * have caught the `authenticated()` bug: the SQL looked right and meant the
 * opposite. That reasoning does not stop at eight expressions, and the
 * primitives it covers are exactly the ones somebody already thought about.
 *
 * This file enumerates the grammar instead: every leaf, every `not` of a leaf,
 * and every `and`/`or` pair of leaves — 480 expressions — evaluated against
 * three callers and three rows chosen to put a NULL in every column position.
 * That is complete at depth two, which is where the interesting disagreements
 * live, because the disagreement is never about nesting. It is about a
 * primitive, or about what happens when one operand is NULL.
 *
 * The claim being checked is the one the shared model is *for*: the admin UI
 * decides what to show by running `evaluatePolicy`, the database decides what to
 * return by running the compiled SQL, and those two answers are supposed to be
 * the same by construction.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { ANONYMOUS_USER_ID, policy, type PolicyExpression } from "@rebasepro/types";
import { evaluatePolicy, policyToPostgres, type TriState } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { RLS_BOOTSTRAP_SQL } from "../../src/schema/rls-bootstrap-sql.js";
import { applyAuthContext } from "../../src/security/rls-enforcement.js";

let container: PgContainer;
let pool: pg.Pool;

/**
 * Callers a *client* can be. The server context is deliberately absent: the JS
 * evaluator answers `false` for `serverContext()` by design, because a client
 * is never the server, so comparing the two there would be checking a
 * disagreement that is intended.
 */
const CALLERS = [
    { name: "anonymous", uid: null as string | null, roles: [] as string[] },
    { name: "editor", uid: "user_1", roles: ["editor"] },
    { name: "admin", uid: "user_2", roles: ["admin"] }
];

/**
 * Rows chosen so that every column is NULL in exactly one of them.
 *
 * NULL is the whole reason this differential can find anything: SQL is
 * three-valued and JavaScript is not, so every place the evaluator has to
 * decide what a missing value means is a place the two can part company.
 */
const ROWS = [
    { id: "r1", owner_id: "user_1", n: 10, flag: true, maybe_null: "x" },
    { id: "r2", owner_id: "user_9", n: 1, flag: false, maybe_null: null },
    { id: "r3", owner_id: null, n: null, flag: null, maybe_null: "y" }
];

/** Leaf expressions, each labelled so a failure names itself. */
const LEAVES: { name: string; expr: PolicyExpression }[] = [
    { name: "true", expr: policy.true() },
    { name: "false", expr: policy.false() },
    { name: "authenticated()", expr: policy.authenticated() },
    { name: "rolesOverlap([admin])", expr: policy.rolesOverlap(["admin"]) },
    { name: "rolesOverlap([editor,viewer])", expr: policy.rolesOverlap(["editor", "viewer"]) },
    { name: "rolesContain([admin,editor])", expr: policy.rolesContain(["admin", "editor"]) },
    { name: "uid == 'user_1'", expr: policy.compare(policy.authUid(), "eq", policy.literal("user_1")) },
    {
        name: "uid != ANON",
        expr: policy.compare(policy.authUid(), "neq", policy.literal(ANONYMOUS_USER_ID))
    },
    { name: "owner_id == uid", expr: policy.compare(policy.field("owner_id"), "eq", policy.authUid()) },
    { name: "owner_id != uid", expr: policy.compare(policy.field("owner_id"), "neq", policy.authUid()) },
    { name: "n > 5", expr: policy.compare(policy.field("n"), "gt", policy.literal(5)) },
    { name: "n <= 5", expr: policy.compare(policy.field("n"), "lte", policy.literal(5)) },
    { name: "flag == true", expr: policy.compare(policy.field("flag"), "eq", policy.literal(true)) },
    { name: "maybe_null == 'x'", expr: policy.compare(policy.field("maybe_null"), "eq", policy.literal("x")) },
    { name: "maybe_null != 'x'", expr: policy.compare(policy.field("maybe_null"), "neq", policy.literal("x")) }
];

/** Every expression of depth ≤ 2 over {@link LEAVES}. */
function enumerateExpressions(): { name: string; expr: PolicyExpression }[] {
    const out = [...LEAVES];
    for (const l of LEAVES) out.push({ name: `not(${l.name})`, expr: policy.not(l.expr) });
    for (const a of LEAVES) {
        for (const b of LEAVES) {
            out.push({ name: `and(${a.name}, ${b.name})`, expr: policy.and(a.expr, b.expr) });
            out.push({ name: `or(${a.name}, ${b.name})`, expr: policy.or(a.expr, b.expr) });
        }
    }
    return out;
}

const EXPRESSIONS = enumerateExpressions();

/** How many expressions go into one `SELECT`. Keeps a failure cheap to isolate. */
const CHUNK = 30;

/**
 * Evaluate many compiled expressions against one row, as one caller, in a
 * single round trip.
 *
 * Goes through the real `applyAuthContext` rather than setting the GUCs here,
 * so the anonymous-sentinel substitution under test is the driver's own and not
 * a copy of it — the copy is what made the original bug invisible.
 */
async function evalBatch(
    exprs: { name: string; expr: PolicyExpression }[],
    caller: { uid: string | null; roles: string[] },
    rowId: string
): Promise<(boolean | null | { error: string })[]> {
    const db = drizzle(pool);
    const compiled = exprs.map(e => policyToPostgres(e.expr));

    try {
        return await db.transaction(async (tx) => {
            await applyAuthContext(tx, { uid: caller.uid as string, roles: caller.roles });
            const select = compiled.map((sql, i) => `(${sql}) AS c${i}`).join(", ");
            const result = await tx.execute(
                drizzleSql.raw(`SELECT ${select} FROM things WHERE id = '${rowId}'`)
            );
            const row = (result as unknown as { rows: Record<string, boolean | null>[] }).rows[0];
            return compiled.map((_, i) => row[`c${i}`]);
        });
    } catch {
        // One expression in the batch failed to execute. Re-run them singly so
        // the failure is attributed rather than swallowed — an expression that
        // does not run is itself a finding about the compiler.
        const results: (boolean | null | { error: string })[] = [];
        for (let i = 0; i < exprs.length; i++) {
            try {
                results.push(await db.transaction(async (tx) => {
                    await applyAuthContext(tx, { uid: caller.uid as string, roles: caller.roles });
                    const r = await tx.execute(
                        drizzleSql.raw(`SELECT (${compiled[i]}) AS c FROM things WHERE id = '${rowId}'`)
                    );
                    return (r as unknown as { rows: { c: boolean | null }[] }).rows[0].c;
                }));
            } catch (err) {
                results.push({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
            }
        }
        return results;
    }
}

/** What Postgres's answer means for access: NULL denies, exactly like false. */
const grants = (pgResult: boolean | null): boolean => pgResult === true;

interface Divergence {
    expression: string;
    caller: string;
    row: string;
    js: TriState;
    postgres: boolean | null | string;
}

let divergences: { permissive: Divergence[]; restrictive: Divergence[]; errored: Divergence[] };

beforeAll(async () => {
    container = await startPgContainer();
    pool = new pg.Pool({ connectionString: container.connectionString });
    await pool.query(RLS_BOOTSTRAP_SQL);
    await pool.query(`
        CREATE TABLE things (
            id text PRIMARY KEY,
            owner_id text,
            n integer,
            flag boolean,
            maybe_null text
        )
    `);
    for (const r of ROWS) {
        await pool.query(
            "INSERT INTO things (id, owner_id, n, flag, maybe_null) VALUES ($1, $2, $3, $4, $5)",
            [r.id, r.owner_id, r.n, r.flag, r.maybe_null]
        );
    }

    // Everything is collected in one pass so each `it` below reports on a
    // dimension of the same result set rather than re-running 4000 queries.
    divergences = { permissive: [], restrictive: [], errored: [] };

    for (const caller of CALLERS) {
        for (const row of ROWS) {
            const entity = { id: row.id, path: "things", values: { ...row } } as never;
            for (let start = 0; start < EXPRESSIONS.length; start += CHUNK) {
                const chunk = EXPRESSIONS.slice(start, start + CHUNK);
                const results = await evalBatch(chunk, caller, row.id);

                chunk.forEach((e, i) => {
                    const pgResult = results[i];
                    const js = evaluatePolicy(e.expr, {
                        uid: caller.uid,
                        roles: caller.roles,
                        entity
                    });
                    const record: Divergence = {
                        expression: e.name,
                        caller: caller.name,
                        row: row.id,
                        js,
                        postgres: typeof pgResult === "object" && pgResult !== null && "error" in pgResult
                            ? pgResult.error
                            : pgResult
                    };
                    if (typeof pgResult === "object" && pgResult !== null && "error" in pgResult) {
                        divergences.errored.push(record);
                        return;
                    }
                    if (js === "unknown") return; // a deliberate abstention; both fail closed
                    if (js === true && !grants(pgResult)) divergences.permissive.push(record);
                    if (js === false && grants(pgResult)) divergences.restrictive.push(record);
                });
            }
        }
    }
}, 300_000);

afterAll(async () => {
    await pool?.end();
    if (container) await stopPgContainer(container.containerName);
});

describe("policy model: exhaustive Postgres/JavaScript agreement", () => {

    it("covers the grammar it claims to", () => {
        // 15 leaves + 15 nots + 15² ands + 15² ors.
        expect(EXPRESSIONS).toHaveLength(15 + 15 + 225 + 225);
        expect(CALLERS.length * ROWS.length).toBe(9);
    });

    /** Every compiled expression must actually run against a real table. */
    it("compiles to SQL Postgres can execute", () => {
        expect(summarize(divergences.errored)).toEqual([]);
    });

    /**
     * **The safety direction.** The admin UI shows a row as permitted when
     * `evaluatePolicy` says true. If Postgres would deny it, the user is shown
     * something they cannot act on — and, worse, the panel has told them a rule
     * grants access that does not.
     */
    it("is never more permissive in JavaScript than in Postgres", () => {
        expect(summarize(divergences.permissive)).toEqual([]);
    });

    /**
     * **The fidelity direction.** The mirror image: a row hidden by the panel
     * that the database would happily return. Less dangerous, equally wrong,
     * and the reason the model's promise is *agreement* rather than
     * conservatism.
     */
    it("is never more restrictive in JavaScript than in Postgres", () => {
        expect(summarize(divergences.restrictive)).toEqual([]);
    });
});

/** Compact, sorted, deduplicated — a failure should read as a list of causes. */
function summarize(records: Divergence[]): string[] {
    return [...new Set(records.map(r =>
        `${r.expression} | caller=${r.caller} row=${r.row} | js=${String(r.js)} pg=${String(r.postgres)}`
    ))].sort();
}
