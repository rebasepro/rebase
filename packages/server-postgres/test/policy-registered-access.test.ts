/**
 * `access: "registered"` against Postgres (security review S-6).
 *
 * On a project with anonymous sign-in, a guest session has a real uid, so a
 * rule written `access: "authenticated"` admits anyone who presses "Continue
 * as guest". `access: "registered"` compiles to `policy.registered()` — signed
 * in AND `NOT rebase.is_anonymous()` — and is the rule that turns the guest
 * away. Both rules are compiled by the real policy compiler and applied to
 * PGlite; every caller runs as the role the server gives them, through the
 * real `applyAuthContext` (a superuser bypasses RLS, and a policy test run as
 * one passes whatever the policies say).
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql as drizzleSql } from "drizzle-orm";
import { adminRequestRoleFor, type CollectionConfig, type SecurityRule } from "@rebasepro/types";
import { compileRulePolicies } from "@rebasepro/common";

import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { applyAuthContext, REBASE_USER_ROLE, type AuthContext } from "../src/security/rls-enforcement";
import type { RequestIdentity } from "../src/security/rls-settings";

class Rollback extends Error {}

const IDENTITY: RequestIdentity = {
    roleFor: () => REBASE_USER_ROLE,
    settingsFor: () => [],
    adminRoleFor: () => adminRequestRoleFor(REBASE_USER_ROLE)
};

const rowsOf = (result: unknown): Record<string, unknown>[] =>
    typeof result === "object" && result !== null && "rows" in result && Array.isArray(result.rows) ? result.rows : [];

function table(name: string): CollectionConfig {
    return { slug: name, table: name, name, properties: { id: { type: "string" }, body: { type: "string" } } };
}

function createPolicies(name: string, rules: SecurityRule[]): string[] {
    return rules.flatMap(rule => compileRulePolicies(table(name), rule).map(p =>
        `CREATE POLICY "${p.name}" ON "public"."${name}" AS ${p.mode.toUpperCase()} FOR ${p.operation.toUpperCase()} ` +
        `TO ${p.roles.map(r => `"${r}"`).join(", ")}` +
        (p.using ? ` USING (${p.using})` : "") + (p.withCheck ? ` WITH CHECK (${p.withCheck})` : "") + ";"));
}

const GUEST: AuthContext = { uid: "guest-1", roles: [], isAnonymous: true };
const ACCOUNT: AuthContext = { uid: "user-1", roles: [], isAnonymous: false };
const NO_SESSION: AuthContext = { uid: "anonymous", roles: [] };

describe("access: \"registered\" in Postgres", () => {
    let db: PGlite;

    beforeAll(async () => {
        db = new PGlite();
        for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
        await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;`);
        await db.exec(`GRANT USAGE ON SCHEMA public, rebase TO ${REBASE_USER_ROLE};`);
        for (const name of ["reviews_registered", "reviews_authenticated"]) {
            await db.exec(`CREATE TABLE ${name} (id text PRIMARY KEY, body text);`);
            await db.exec(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`);
            await db.exec(`GRANT SELECT, INSERT ON ${name} TO ${REBASE_USER_ROLE};`);
            await db.exec(`INSERT INTO ${name} VALUES ('r1', 'hello');`);
        }
        for (const statement of [
            ...createPolicies("reviews_registered", [
                { operation: "select", access: "registered" },
                { operation: "insert", access: "registered", check: { body: "ok" } }
            ]),
            ...createPolicies("reviews_authenticated", [
                { operation: "select", access: "authenticated" },
                { operation: "insert", access: "authenticated", check: { body: "ok" } }
            ])
        ]) await db.exec(statement);
    });

    afterAll(async () => {
        await db?.close();
    });

    /** What `auth` sees of a table and whether it may insert into it, in a transaction always rolled back. */
    async function as(auth: AuthContext, name: string): Promise<{ rows: string; insert: "ok" | "refused" }> {
        let outcome: { rows: string; insert: "ok" | "refused" } = { rows: "", insert: "refused" };
        try {
            await drizzle(db).transaction(async (tx) => {
                await applyAuthContext(tx, auth, IDENTITY);
                const rows = rowsOf(await tx.execute(drizzleSql.raw(`SELECT id FROM ${name} ORDER BY id`))).map(r => String(r.id)).join(",");
                await tx.execute(drizzleSql.raw("SAVEPOINT cell"));
                let insert: "ok" | "refused" = "ok";
                try {
                    await tx.execute(drizzleSql.raw(`INSERT INTO ${name} VALUES ('n1', 'ok')`));
                } catch {
                    insert = "refused";
                }
                await tx.execute(drizzleSql.raw("ROLLBACK TO SAVEPOINT cell"));
                outcome = { rows, insert };
                throw new Rollback();
            });
        } catch (err) {
            if (!(err instanceof Rollback)) throw err;
        }
        return outcome;
    }

    it("refuses a guest session the reads and writes `authenticated` admits", async () => {
        expect(await as(GUEST, "reviews_registered")).toEqual({ rows: "", insert: "refused" });
        expect(await as(GUEST, "reviews_authenticated")).toEqual({ rows: "r1", insert: "ok" });
    });

    it("admits a caller with an account under both", async () => {
        expect(await as(ACCOUNT, "reviews_registered")).toEqual({ rows: "r1", insert: "ok" });
        expect(await as(ACCOUNT, "reviews_authenticated")).toEqual({ rows: "r1", insert: "ok" });
    });

    it("refuses a request with no session under both", async () => {
        expect(await as(NO_SESSION, "reviews_registered")).toEqual({ rows: "", insert: "refused" });
        expect(await as(NO_SESSION, "reviews_authenticated")).toEqual({ rows: "", insert: "refused" });
    });
});
