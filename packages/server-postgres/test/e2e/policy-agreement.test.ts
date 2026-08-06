/**
 * E2E: the two consumers of the policy model agree.
 *
 * `securityRuleToConditions` gives both the Postgres DDL generator and the
 * client-side evaluator one definition of what a rule means. That only prevents
 * drift if the two backends also agree on the primitives underneath it, and once
 * they did not: `policyToPostgres` compiled `authenticated` to
 * `auth.uid() IS NOT NULL` while `evaluatePolicy` read it as `ctx.uid != null`.
 * Those are the same sentence and opposite answers, because the driver reports an
 * anonymous request as ANONYMOUS_USER_ID rather than NULL — so the Postgres side
 * was a tautology and `policy.authenticated()` granted to anonymous visitors.
 *
 * A test comparing SQL strings could not have caught that; only executing the
 * SQL can. So each expression is compiled, run in a real Postgres under the real
 * `applyAuthContext`, and checked against what `evaluatePolicy` says for the
 * same caller.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { ANONYMOUS_USER_ID, policy, type PolicyExpression } from "@rebasepro/types";
import { evaluatePolicy, policyToPostgres } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { RLS_BOOTSTRAP_SQL } from "../../src/schema/rls-bootstrap-sql.js";
import { applyAuthContext } from "../../src/security/rls-enforcement.js";

let container: PgContainer;
let pool: pg.Pool;

/** Callers a *client* can be. The server context is not one of them — see below. */
const CALLERS = [
    { name: "anonymous", uid: null, roles: [] as string[] },
    { name: "signed-in user", uid: "user_1", roles: ["editor"] },
    { name: "admin", uid: "user_2", roles: ["admin"] }
];

/** Expressions whose meaning turns on which of the three uid states holds. */
const EXPRESSIONS: { name: string; expr: PolicyExpression }[] = [
    { name: "authenticated()", expr: policy.authenticated() },
    { name: "not(authenticated())", expr: policy.not(policy.authenticated()) },
    { name: "serverContext()", expr: policy.serverContext() },
    { name: "rolesOverlap(['admin'])", expr: policy.rolesOverlap(["admin"]) },
    {
        name: "uid <> ANONYMOUS_USER_ID",
        expr: policy.compare(policy.authUid(), "neq", policy.literal(ANONYMOUS_USER_ID))
    },
    {
        name: "uid = ANONYMOUS_USER_ID",
        expr: policy.compare(policy.authUid(), "eq", policy.literal(ANONYMOUS_USER_ID))
    },
    {
        // The default policies' server-or-admin baseline, on every collection.
        name: "serverContext() OR rolesOverlap(['admin'])",
        expr: policy.or(policy.serverContext(), policy.rolesOverlap(["admin"]))
    },
    {
        name: "authenticated() AND rolesOverlap(['editor'])",
        expr: policy.and(policy.authenticated(), policy.rolesOverlap(["editor"]))
    }
];

/**
 * Evaluate compiled SQL as a user-context request would see it, going through
 * the real `applyAuthContext` so the sentinel substitution under test is the
 * driver's own and not a copy of it.
 */
async function evalInPostgres(expr: PolicyExpression, caller: { uid: string | null; roles: string[] }): Promise<boolean | null> {
    const compiled = policyToPostgres(expr);
    const db = drizzle(pool);
    return db.transaction(async (tx) => {
        await applyAuthContext(tx, { uid: caller.uid as string, roles: caller.roles });
        const result = await tx.execute(drizzleSql.raw(`SELECT (${compiled}) AS r`));
        return (result as unknown as { rows: { r: boolean | null }[] }).rows[0].r;
    });
}

/** The server context sets no user GUC at all — that is what defines it. */
async function evalAsServerContext(expr: PolicyExpression): Promise<boolean | null> {
    const compiled = policyToPostgres(expr);
    const { rows } = await pool.query(`SELECT (${compiled}) AS r`);
    return rows[0].r;
}

beforeAll(async () => {
    container = await startPgContainer();
    pool = new pg.Pool({ connectionString: container.connectionString });
    await pool.query(RLS_BOOTSTRAP_SQL);
}, 120_000);

afterAll(async () => {
    await pool?.end();
    if (container) await stopPgContainer(container.containerName);
});

describe("policy model: Postgres and JavaScript agree", () => {
    for (const caller of CALLERS) {
        for (const { name, expr } of EXPRESSIONS) {
            it(`${name} — ${caller.name}`, async () => {
                const inJs = evaluatePolicy(expr, { uid: caller.uid, roles: caller.roles, entity: null });
                // "unknown" is a deliberate client-side abstention (raw SQL,
                // existsIn); none of these expressions produce it.
                expect(inJs).not.toBe("unknown");
                expect(await evalInPostgres(expr, caller)).toBe(inJs);
            });
        }
    }
});

describe("policy.authenticated()", () => {
    it("is false for an anonymous request — the bug this all exists for", async () => {
        // Before the fix this compiled to `auth.uid() IS NOT NULL`, which the
        // sentinel makes a tautology: a rule reading as "logged-in users only"
        // granted every anonymous visitor full access.
        expect(await evalInPostgres(policy.authenticated(), { uid: null, roles: [] })).toBe(false);
    });

    it("is false in the server context, which is not a signed-in user", async () => {
        expect(await evalAsServerContext(policy.authenticated())).toBe(false);
    });

    it("is true for a signed-in user", async () => {
        expect(await evalInPostgres(policy.authenticated(), { uid: "user_1", roles: [] })).toBe(true);
    });
});

describe("policy.serverContext()", () => {
    it("is true only when no user GUC is set", async () => {
        expect(await evalAsServerContext(policy.serverContext())).toBe(true);
    });

    it("is false for an anonymous request", async () => {
        // The sentinel's whole purpose: an empty user id would read back as NULL
        // and promote an anonymous visitor to the trusted server context.
        expect(await evalInPostgres(policy.serverContext(), { uid: null, roles: [] })).toBe(false);
    });

    it("is false for a blank user id, which must not pass for the server", async () => {
        expect(await evalInPostgres(policy.serverContext(), { uid: "   ", roles: [] })).toBe(false);
    });
});

describe("the default server-or-admin grant", () => {
    const expr = policy.or(policy.serverContext(), policy.rolesOverlap(["admin"]));

    it("admits the server context", async () => {
        expect(await evalAsServerContext(expr)).toBe(true);
    });

    it("admits an admin", async () => {
        expect(await evalInPostgres(expr, { uid: "user_2", roles: ["admin"] })).toBe(true);
    });

    it("shuts out an anonymous visitor", async () => {
        // `not(authenticated())` here instead of `serverContext()` would make
        // this true — the anonymous visitor is not signed in either.
        expect(await evalInPostgres(expr, { uid: null, roles: [] })).toBe(false);
    });

    it("shuts out a signed-in non-admin", async () => {
        expect(await evalInPostgres(expr, { uid: "user_1", roles: ["editor"] })).toBe(false);
    });
});
