/**
 * The rule forms added with the Postgres-first `rls`, run against Postgres.
 *
 * `fixtures/policy-shapes-new.ts` declares the spec's §4.1 `rls` block and
 * the other new combinations — a `PolicyShorthand` condition / check (NULL
 * included), `access: "public" | "authenticated"` with a condition or a
 * check. The planner's policies for them are applied to PGlite and every
 * caller reads, inserts, updates and deletes every row, as the role the
 * server gives them, through the real `applyAuthContext` (a superuser
 * bypasses RLS, and a policy test run as one passes whatever the policies
 * say).
 *
 * Three things are held here:
 *
 * - **Frozen output.** The policies (names and SQL) equal
 *   `fixtures/policy-shapes-new.recorded.json`, recorded by the release that
 *   introduced these shapes. A policy's name is its identity in a deployed
 *   database, so it must never move; never re-record this file to make it pass.
 * - **Meaning.** Anonymous callers see only `status = 'published'` posts, an
 *   editor sees all of them, nobody but an admin deletes one; and the
 *   `reports` rules admit what they say.
 * - **The import.** The stored policies, read from `pg_policies` and imported
 *   the way the Studio and "Import from table" do, compile back to policies
 *   that admit exactly the same rows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql as drizzleSql } from "drizzle-orm";
import type { PostgresPolicy } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { policyToSecurityRule } from "@rebasepro/common";
import { compileRulePolicies } from "./helpers/legacy-policies";

import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { applyAuthContext, REBASE_USER_ROLE } from "../src/security/rls-enforcement";
import { isGeneratedPolicyName } from "../src/security/policy-drift";
import type { RequestIdentity } from "../src/security/rls-settings";
import { adminRequestRoleFor, REBASE_ADMIN_ROLE } from "@rebasepro/types";
import { planTablePolicies } from "../src/schema/generate-postgres-ddl-logic";
import {
    NEW_POLICY_SHAPE_CALLERS,
    NEW_POLICY_SHAPE_COLLECTIONS,
    NEW_POLICY_SHAPE_DDL,
    NEW_POLICY_SHAPE_ROWS,
    type NewPolicyShapeCaller
} from "./fixtures/policy-shapes-new";
import { compileSet } from "./helpers/plan-tables";

const RECORDED: Record<string, string[]> = JSON.parse(
    readFileSync(path.join(__dirname, "fixtures", "policy-shapes-new.recorded.json"), "utf8")
).policies;

type Tx = { execute(query: unknown): Promise<unknown> };

/** The literal for a fixture value. Fixture data only — never caller input. */
const literal = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
};

const rowsOf = (result: unknown): Record<string, unknown>[] =>
    typeof result === "object" && result !== null && "rows" in result && Array.isArray(result.rows) ? result.rows : [];

/** The SQLSTATE of a failed statement, through drizzle's wrapper. */
const sqlState = (err: unknown): string => {
    const codeOf = (value: unknown): string | undefined =>
        typeof value === "object" && value !== null && "code" in value && typeof value.code === "string" ? value.code : undefined;
    const cause = typeof err === "object" && err !== null && "cause" in err ? err.cause : undefined;
    return codeOf(cause) ?? codeOf(err) ?? "unknown";
};

class Rollback extends Error {}

const ADMIN_REQUEST_ROLE = adminRequestRoleFor(REBASE_USER_ROLE);

const IDENTITY: RequestIdentity = {
    roleFor: () => REBASE_USER_ROLE,
    settingsFor: () => [],
    adminRoleFor: () => ADMIN_REQUEST_ROLE
};

async function bootDatabase(): Promise<PGlite> {
    const db = new PGlite();
    for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;`);
    await db.exec("GRANT USAGE ON SCHEMA public, rebase TO " + REBASE_USER_ROLE + ";");
    await db.exec(`CREATE ROLE ${REBASE_ADMIN_ROLE} NOLOGIN NOINHERIT;`);
    await db.exec(`CREATE ROLE ${ADMIN_REQUEST_ROLE} NOLOGIN NOINHERIT;`);
    await db.exec(`GRANT ${REBASE_USER_ROLE}, ${REBASE_ADMIN_ROLE} TO ${ADMIN_REQUEST_ROLE} WITH INHERIT TRUE, SET FALSE;`);
    return db;
}

/** Run `body` as the caller, in a transaction that is always rolled back. */
async function asCaller(db: PGlite, caller: NewPolicyShapeCaller, body: (tx: Tx) => Promise<void>): Promise<void> {
    try {
        await drizzle(db).transaction(async (tx) => {
            if (caller.auth) await applyAuthContext(tx, caller.auth, IDENTITY);
            else await tx.execute(drizzleSql.raw(`SET LOCAL ROLE ${ADMIN_REQUEST_ROLE}`));
            await body(tx);
            throw new Rollback();
        });
    } catch (err) {
        if (!(err instanceof Rollback)) throw err;
    }
}

/** One statement, isolated by a savepoint so a refusal does not abort the rest. */
async function attempt(tx: Tx, statement: string, ok: "rows" | "success" = "rows"): Promise<string> {
    await tx.execute(drizzleSql.raw("SAVEPOINT cell"));
    try {
        const rows = rowsOf(await tx.execute(drizzleSql.raw(statement)));
        await tx.execute(drizzleSql.raw("ROLLBACK TO SAVEPOINT cell"));
        return ok === "success" || rows.length > 0 ? "ok" : "none";
    } catch (err) {
        await tx.execute(drizzleSql.raw("ROLLBACK TO SAVEPOINT cell"));
        return `refused:${sqlState(err)}`;
    }
}

/** What every caller can do to every row: `<table> | <caller> | <op> [<id>]` → outcome. */
async function outcomeMatrix(db: PGlite): Promise<Record<string, string>> {
    const outcomes: Record<string, string> = {};
    for (const caller of NEW_POLICY_SHAPE_CALLERS) {
        await asCaller(db, caller, async (tx) => {
            for (const [table, { rows, inserts }] of Object.entries(NEW_POLICY_SHAPE_ROWS)) {
                const visible = rowsOf(await tx.execute(drizzleSql.raw(`SELECT id FROM ${table} ORDER BY 1`)))
                    .map(r => String(r.id));
                outcomes[`${table} | ${caller.name} | select`] = visible.join(",");
                const touch = Object.keys(rows[0]).find(c => c !== "id") ?? "id";
                for (const row of rows) {
                    outcomes[`${table} | ${caller.name} | update ${row.id}`] = await attempt(tx,
                        `UPDATE ${table} SET ${touch} = ${touch} WHERE id = ${literal(row.id)} RETURNING 1`);
                    outcomes[`${table} | ${caller.name} | delete ${row.id}`] = await attempt(tx,
                        `DELETE FROM ${table} WHERE id = ${literal(row.id)} RETURNING 1`);
                }
                for (const row of inserts) {
                    const columns = Object.keys(row);
                    // No RETURNING: an insert is judged by WITH CHECK alone,
                    // not by whether the caller may read the row back.
                    outcomes[`${table} | ${caller.name} | insert ${row.id}`] = await attempt(tx,
                        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(c => literal(row[c])).join(", ")})`, "success");
                }
            }
        });
    }
    return outcomes;
}

async function replacePolicies(db: PGlite, statements: string[]): Promise<void> {
    await db.exec(`
        DO $$ DECLARE r record; BEGIN
            FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
                EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
            END LOOP;
        END $$;
    `);
    for (const statement of statements) await db.exec(statement);
}

/** The stored policies, imported as rules the way the Studio does, and compiled back. */
async function importedFromDatabase(db: PGlite): Promise<string[]> {
    const live = await db.query<{
        tablename: string; policyname: string; permissive: PostgresPolicy["permissive"]; roles: string[] | string;
        cmd: PostgresPolicy["cmd"]; qual: string | null; with_check: string | null;
    }>("SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public'");
    const statements = live.rows.flatMap(row => {
        const roles = Array.isArray(row.roles) ? row.roles : row.roles.replace(/[{}]/g, "").split(",");
        const rule = policyToSecurityRule({ ...row, roles });
        const table: LegacyCollectionConfig = { slug: row.tablename, table: row.tablename, name: row.tablename, properties: {} };
        return compileRulePolicies(table, rule).map(p =>
            `CREATE POLICY "${p.name}" ON "public"."${row.tablename}" AS ${p.mode.toUpperCase()} ` +
            `FOR ${p.operation.toUpperCase()} TO ${p.roles.map(r => `"${r}"`).join(", ")}` +
            (p.using ? ` USING (${p.using})` : "") + (p.withCheck ? ` WITH CHECK (${p.withCheck})` : "") + ";");
    });
    expect(statements).toHaveLength(live.rows.length);
    return statements;
}

const currentPlans = () => planTablePolicies(compileSet(NEW_POLICY_SHAPE_COLLECTIONS));
const currentStatements = () => currentPlans().flatMap(p => p.policyStatements);
const createStatements = (statements: string[]) => statements.filter(s => /^CREATE POLICY/.test(s));

describe("the new rls shapes, against Postgres", () => {
    let db: PGlite;

    beforeAll(async () => {
        db = await bootDatabase();
        await db.exec(NEW_POLICY_SHAPE_DDL);
        for (const [table, { rows }] of Object.entries(NEW_POLICY_SHAPE_ROWS)) {
            await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
            await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${REBASE_USER_ROLE};`);
            for (const row of rows) {
                const columns = Object.keys(row);
                await db.exec(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(c => literal(row[c])).join(", ")});`);
            }
        }
        await replacePolicies(db, currentStatements());
    });

    afterAll(async () => {
        await db?.close();
    });

    it("compiles to the recorded policies — names and SQL frozen", () => {
        const current = Object.fromEntries(currentPlans().map(p => [p.qualified, createStatements(p.policyStatements)]));
        expect(current).toEqual(RECORDED);
    });

    it("names every hashed policy so boot recognises it as generated", () => {
        const names = createStatements(currentStatements()).map(s => /^CREATE POLICY "([^"]+)" ON "public"\."([^"]+)"/.exec(s)!);
        const hashed = names.filter(([, name]) => !name.includes("_default_admin"));
        expect(hashed.length).toBeGreaterThanOrEqual(7);
        for (const [, name, table] of hashed) expect({ name, generated: isGeneratedPolicyName(name, table) }).toEqual({ name, generated: true });
    });

    it("lets anonymous callers read only the published posts, an editor all of them, and only an admin delete", async () => {
        const m = await outcomeMatrix(db);
        expect(m["posts | anonymous | select"]).toBe("p1");
        expect(m["posts | alice | select"]).toBe("p1");
        expect(m["posts | bob (editor) | select"]).toBe("p1,p2");
        expect(m["posts | dave (admin) | select"]).toBe("p1,p2");

        expect(m["posts | anonymous | update p1"]).toBe("none");
        expect(m["posts | anonymous | insert pn"]).toBe("refused:42501");
        expect(m["posts | bob (editor) | update p2"]).toBe("ok");
        expect(m["posts | bob (editor) | insert pn"]).toBe("ok");

        for (const caller of ["anonymous", "alice", "bob (editor)"]) {
            for (const id of ["p1", "p2"]) expect({ caller, id, outcome: m[`posts | ${caller} | delete ${id}`] }).toEqual({ caller, id, outcome: "none" });
        }
        expect(m["posts | dave (admin) | delete p1"]).toBe("ok");
    });

    it("admits what the authenticated + shorthand rules say, NULL and uuid columns included", async () => {
        const m = await outcomeMatrix(db);
        // select: signed in, and not soft-deleted (`deleted_at IS NULL`).
        expect(m["reports | anonymous | select"]).toBe("");
        expect(m["reports | alice | select"]).toBe("r1,r2");
        // insert: signed in, and the row must be an open, unflagged one.
        expect(m["reports | alice | insert rn1"]).toBe("ok");
        expect(m["reports | alice | insert rn2"]).toBe("refused:42501");
        expect(m["reports | anonymous | insert rn1"]).toBe("refused:42501");
        // update: only open rows, and they must stay open and unflagged.
        expect(m["reports | alice | update r1"]).toBe("ok");
        expect(m["reports | alice | update r2"]).toBe("none");
        expect(m["reports | anonymous | update r1"]).toBe("none");
        // delete: anyone, on rows of ORG_A they can see (uuid compared to a literal).
        expect(m["reports | alice | delete r1"]).toBe("ok");
        expect(m["reports | alice | delete r2"]).toBe("none");
    });

    it("admits any signed-in caller, and no anonymous one, under bare `access: \"authenticated\"`", async () => {
        const m = await outcomeMatrix(db);
        expect(m["members | anonymous | select"]).toBe("");
        expect(m["members | anonymous | insert mn"]).toBe("refused:42501");
        for (const caller of ["alice", "bob (editor)"]) {
            expect({ caller, select: m[`members | ${caller} | select`], insert: m[`members | ${caller} | insert mn`] })
                .toEqual({ caller, select: "m1,m2", insert: "ok" });
            // The rule grants select and insert only.
            expect({ caller, outcome: m[`members | ${caller} | delete m1`] }).toEqual({ caller, outcome: "none" });
        }
    });

    it("imports its stored policies back into rules that admit exactly what they did", async () => {
        await replacePolicies(db, currentStatements());
        const stored = await outcomeMatrix(db);
        await replacePolicies(db, await importedFromDatabase(db));
        const imported = await outcomeMatrix(db);
        await replacePolicies(db, currentStatements());
        expect(imported).toEqual(stored);
    });
});
