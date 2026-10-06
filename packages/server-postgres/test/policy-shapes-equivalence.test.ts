/**
 * The compiled RLS policies admit exactly the rows they admitted before their
 * row-independent parts were hoisted into initPlans — for every policy shape
 * the compiler emits, every caller, and every operation.
 *
 * The compiler wraps each part of a policy that does not read the row —
 * `rebase.uid() IS NULL`, a roles test, a claim — in a scalar subquery, so
 * Postgres evaluates it once per statement instead of once per row, and plans
 * with a sane estimate instead of the 1.5% it assigns those clauses. That is a
 * change to the SQL of every policy in every database. Authorization has to
 * come out of it unchanged, and a text snapshot cannot show that: two strings
 * that differ can admit the same rows, and two that look alike need not.
 *
 * So this runs both. `fixtures/policy-shapes.recorded.json` holds the policies
 * the previous compiler emitted for the corpus in `fixtures/policy-shapes.ts`.
 * They are applied to a real Postgres (PGlite), every caller reads, inserts,
 * updates and deletes every row; then the current compiler's policies replace
 * them and the same matrix runs again. The two must agree cell for cell.
 *
 * Every request runs as `rebase_user` with the real `applyAuthContext` — a
 * superuser bypasses RLS, and a test of policies that runs as one is green no
 * matter what the policies say. The server context is `rebase_user` with no
 * identity at all, which is what `rebase.uid() IS NULL` is there to admit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql as drizzleSql } from "drizzle-orm";
import type { CollectionConfig, PostgresPolicy } from "@rebasepro/types";
import { compileRulePolicies, policyToSecurityRule } from "@rebasepro/common";

import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { applyAuthContext, REBASE_USER_ROLE } from "../src/security/rls-enforcement";
import { planCollectionPolicies } from "../src/schema/generate-postgres-ddl-logic";
import {
    POLICY_SHAPE_CALLERS,
    POLICY_SHAPE_COLLECTIONS,
    POLICY_SHAPE_DDL,
    POLICY_SHAPE_ROWS,
    type PolicyShapeCaller
} from "./fixtures/policy-shapes";

const RECORDED: Record<string, string[]> = JSON.parse(
    readFileSync(path.join(__dirname, "fixtures", "policy-shapes.recorded.json"), "utf8")
).policies;

type Tx = { execute(query: unknown): Promise<unknown> };

/** The literal for a fixture value. Fixture data only — never caller input. */
const literal = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
};

/** The columns that identify a row of `table`. */
const keyColumns = (table: string): string[] => (table === "posts_tags" ? ["post_id", "tag_id"] : ["id"]);
const keyOf = (table: string, row: Record<string, unknown>): string =>
    keyColumns(table).map(c => String(row[c])).join(":");
const whereKey = (table: string, row: Record<string, unknown>): string =>
    keyColumns(table).map(c => `${c} = ${literal(row[c])}`).join(" AND ");

const rowsOf = (result: unknown): Record<string, unknown>[] =>
    (result as { rows?: Record<string, unknown>[] }).rows ?? [];

/** The SQLSTATE of a failed statement, through drizzle's wrapper. */
const sqlState = (err: unknown): string => {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "unknown";
};

class Rollback extends Error {}

async function bootDatabase(): Promise<PGlite> {
    const db = new PGlite();
    for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;`);
    await db.exec("GRANT USAGE ON SCHEMA public, rebase TO " + REBASE_USER_ROLE + ";");
    return db;
}

/**
 * Run `body` as the caller, inside a transaction that is always rolled back,
 * so a write one cell makes is never seen by the next.
 */
async function asCaller(db: PGlite, caller: PolicyShapeCaller, body: (tx: Tx) => Promise<void>): Promise<void> {
    try {
        await drizzle(db).transaction(async (tx) => {
            if (caller.auth) {
                await applyAuthContext(tx as never, caller.auth, REBASE_USER_ROLE);
            } else {
                // The server context: the restricted role with no identity set.
                await tx.execute(drizzleSql.raw(`SET LOCAL ROLE ${REBASE_USER_ROLE}`));
            }
            await body(tx as unknown as Tx);
            throw new Rollback();
        });
    } catch (err) {
        if (!(err instanceof Rollback)) throw err;
    }
}

/** One statement, isolated by a savepoint so a refusal does not abort the rest. */
async function attempt(tx: Tx, statement: string): Promise<string> {
    await tx.execute(drizzleSql.raw("SAVEPOINT cell"));
    try {
        const rows = rowsOf(await tx.execute(drizzleSql.raw(statement)));
        await tx.execute(drizzleSql.raw("ROLLBACK TO SAVEPOINT cell"));
        return rows.length > 0 ? "ok" : "none";
    } catch (err) {
        await tx.execute(drizzleSql.raw("ROLLBACK TO SAVEPOINT cell"));
        return `refused:${sqlState(err)}`;
    }
}

/**
 * What every caller can do to every row: one cell per (table, caller,
 * operation, row).
 */
async function outcomeMatrix(db: PGlite): Promise<Record<string, string>> {
    const outcomes: Record<string, string> = {};
    for (const caller of POLICY_SHAPE_CALLERS) {
        await asCaller(db, caller, async (tx) => {
            for (const [table, { rows, inserts }] of Object.entries(POLICY_SHAPE_ROWS)) {
                const keyExpr = keyColumns(table).join(" || ':' || ");
                const visible = rowsOf(await tx.execute(drizzleSql.raw(
                    `SELECT ${keyExpr} AS k FROM ${table} ORDER BY 1`
                ))).map(r => String(r.k));
                outcomes[`${table} | ${caller.name} | select`] = visible.join(",");

                const touch = Object.keys(rows[0]).find(c => !keyColumns(table).includes(c)) ?? keyColumns(table)[1];
                for (const row of rows) {
                    const key = keyOf(table, row);
                    outcomes[`${table} | ${caller.name} | update ${key}`] = await attempt(tx,
                        `UPDATE ${table} SET ${touch} = ${touch} WHERE ${whereKey(table, row)} RETURNING 1`);
                    outcomes[`${table} | ${caller.name} | delete ${key}`] = await attempt(tx,
                        `DELETE FROM ${table} WHERE ${whereKey(table, row)} RETURNING 1`);
                }
                for (const row of inserts) {
                    const columns = Object.keys(row);
                    outcomes[`${table} | ${caller.name} | insert ${keyOf(table, row)}`] = await attempt(tx,
                        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(c => literal(row[c])).join(", ")}) RETURNING 1`);
                }
            }
        });
    }
    return outcomes;
}

/** Remove every policy on the corpus tables, then run `statements`. */
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

/**
 * The policies on the corpus tables, read from `pg_policies`, imported as rules
 * the way the Studio and "Import from table" do, and compiled back.
 */
async function importedFromDatabase(db: PGlite): Promise<string[]> {
    const live = await db.query<{
        tablename: string; policyname: string; permissive: PostgresPolicy["permissive"]; roles: string[] | string;
        cmd: PostgresPolicy["cmd"]; qual: string | null; with_check: string | null;
    }>("SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public'");
    const statements = live.rows.flatMap(row => {
        const roles = Array.isArray(row.roles) ? row.roles : row.roles.replace(/[{}]/g, "").split(",");
        const rule = policyToSecurityRule({ ...row, roles });
        const table = { slug: row.tablename, table: row.tablename, name: row.tablename, properties: {} } as unknown as CollectionConfig;
        return compileRulePolicies(table, rule).map(p =>
            `CREATE POLICY "${p.name}" ON "public"."${row.tablename}" AS ${p.mode.toUpperCase()} ` +
            `FOR ${p.operation.toUpperCase()} TO ${p.roles.map(r => `"${r}"`).join(", ")}` +
            (p.using ? ` USING (${p.using})` : "") + (p.withCheck ? ` WITH CHECK (${p.withCheck})` : "") + ";");
    });
    expect(statements).toHaveLength(live.rows.length);
    return statements;
}

const currentPlans = () => planCollectionPolicies(POLICY_SHAPE_COLLECTIONS);
const createStatements = (statements: string[]) => statements.filter(s => /^CREATE POLICY/.test(s));

describe("hoisting row-independent policy predicates into initPlans", () => {
    let db: PGlite;

    beforeAll(async () => {
        db = await bootDatabase();
        await db.exec(POLICY_SHAPE_DDL);
        for (const [table, { rows }] of Object.entries(POLICY_SHAPE_ROWS)) {
            await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
            await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${REBASE_USER_ROLE};`);
            for (const row of rows) {
                const columns = Object.keys(row);
                await db.exec(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(c => literal(row[c])).join(", ")});`);
            }
        }
    });

    afterAll(async () => {
        await db?.close();
    });

    it("keeps every policy's name — the names are hashed from the rule, not the SQL", () => {
        const recordedNames = Object.values(RECORDED).flat().map(s => /^CREATE POLICY "([^"]+)"/.exec(s)?.[1]).sort();
        const currentNames = currentPlans()
            .flatMap(p => createStatements(p.policyStatements))
            .map(s => /^CREATE POLICY "([^"]+)"/.exec(s)?.[1])
            .sort();
        expect(currentNames).toEqual(recordedNames);
    });

    it("covers the corpus: every table the plan polices has a recording and seeded rows", () => {
        const tables = currentPlans().map(p => p.qualified).sort();
        expect(Object.keys(RECORDED).sort()).toEqual(tables);
        expect(tables.map(t => t.replace(/^public\./, "")).sort()).toEqual(Object.keys(POLICY_SHAPE_ROWS).sort());
    });

    it("admits the same rows, for every caller and every operation, as the policies it replaces", async () => {
        await replacePolicies(db, Object.values(RECORDED).flat());
        const before = await outcomeMatrix(db);

        await replacePolicies(db, currentPlans().flatMap(p => p.policyStatements));
        const after = await outcomeMatrix(db);

        // Not vacuous: the corpus has to both admit and refuse, or any two
        // policy sets would agree on it.
        const cells = Object.values(before);
        expect(cells.filter(c => c === "ok").length).toBeGreaterThan(50);
        expect(cells.filter(c => c === "none").length).toBeGreaterThan(50);
        expect(cells.filter(c => c.startsWith("refused:42501")).length).toBeGreaterThan(10);
        // And per table: at least two callers must be able to do different
        // things to it, or its policies are not being exercised at all.
        for (const table of Object.keys(POLICY_SHAPE_ROWS)) {
            const signatures = new Set(POLICY_SHAPE_CALLERS.map(c => Object.entries(before)
                .filter(([cell]) => cell.startsWith(`${table} | ${c.name} | `))
                .map(([, outcome]) => outcome)
                .join(";")));
            expect({ table, callersDiffer: signatures.size > 1 }).toEqual({ table, callersDiffer: true });
        }

        expect(after).toEqual(before);
    });

    /**
     * The other direction: Postgres stores the new spelling as
     * `( SELECT ((rebase.uid() IS NULL) OR …))` and `( SELECT rebase.uid() AS
     * uid)`, and "Import from table" / the Studio's "Import to codebase" turn
     * exactly that text back into a rule that `db push` compiles. A scalar
     * subquery stripped of its parens is `USING (SELECT …)` — a syntax error
     * that leaves the table denying everything — so every stored policy goes
     * through the importer and the compiler here, in both spellings, and the
     * new one has to come back admitting what the old one did.
     *
     * Compared with the old spelling's import here; the next test compares the
     * import with the policies themselves.
     */
    it("imports its own stored policies back into rules that admit what the old spelling's did", async () => {
        await replacePolicies(db, Object.values(RECORDED).flat());
        await replacePolicies(db, await importedFromDatabase(db));
        const importedOld = await outcomeMatrix(db);

        await replacePolicies(db, currentPlans().flatMap(p => p.policyStatements));
        await replacePolicies(db, await importedFromDatabase(db));
        const importedNew = await outcomeMatrix(db);

        expect(importedNew).toEqual(importedOld);
    });

    /**
     * And the import changes nothing: every stored policy, imported and
     * compiled back, admits exactly what it did. The claim-tenancy policy on
     * a uuid column is the one that did not, because the `raw` compiler read
     * the `{8}` and `{12}` in its guard regex as `{column}` placeholders.
     */
    it("imports its own stored policies back into rules that admit exactly what they did", async () => {
        await replacePolicies(db, currentPlans().flatMap(p => p.policyStatements));
        const stored = await outcomeMatrix(db);

        await replacePolicies(db, await importedFromDatabase(db));
        const imported = await outcomeMatrix(db);

        expect(imported).toEqual(stored);
    });

    it("compiles the row-independent part of the injected baseline to an initPlan", async () => {
        const docs = currentPlans().find(p => p.table === "docs")!;
        const read = docs.policyStatements.find(s => s.includes("docs_default_admin_read") && s.startsWith("CREATE"))!;
        expect(read).toContain("USING ((SELECT ");

        await replacePolicies(db, currentPlans().flatMap(p => p.policyStatements));
        const stored = await db.query<{ qual: string }>(
            "SELECT qual FROM pg_policies WHERE policyname = 'docs_default_admin_read'"
        );
        // What Postgres kept: one scalar subquery around the whole predicate.
        expect(stored.rows[0].qual).toMatch(/^\( SELECT \(\(rebase\.uid\(\) IS NULL\) OR /);
    });
});

/**
 * The reason for the change, as a plan: on a deep offset page the default
 * policy used to make Postgres abandon the primary key for a sequential scan
 * and a sort of the whole table, because it estimated the policy would pass
 * 1.5% of rows. With the predicate in an initPlan the estimate is 50%, and the
 * page is read backwards off the index.
 */
describe("the planner, under the injected baseline policy", () => {
    let db: PGlite;
    const big = {
        name: "Big", slug: "big", table: "big",
        properties: { id: { name: "ID", type: "number", isId: "increment" }, title: { name: "Title", type: "string" } }
    } as unknown as CollectionConfig;
    const ROWS = 20_000;

    beforeAll(async () => {
        db = await bootDatabase();
        await db.exec(`
            CREATE TABLE big (id integer PRIMARY KEY, title text);
            INSERT INTO big SELECT g, repeat('lorem ipsum ', 10) || g FROM generate_series(1, ${ROWS}) g;
            ALTER TABLE big ENABLE ROW LEVEL SECURITY;
            GRANT SELECT ON big TO ${REBASE_USER_ROLE};
        `);
        for (const statement of planCollectionPolicies([big])[0].policyStatements) await db.exec(statement);
        await db.exec("ANALYZE big;");
    });

    afterAll(async () => {
        await db?.close();
    });

    interface PlanNode { "Node Type": string; "Plan Rows": number; Plans?: PlanNode[] }
    const nodes = (plan: PlanNode): PlanNode[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];

    it("reads a deep offset page off the primary key, with no sort", async () => {
        let plan: PlanNode | undefined;
        await asCaller(db, { name: "admin", auth: { uid: "dave", roles: ["admin"] } }, async (tx) => {
            const result = rowsOf(await tx.execute(drizzleSql.raw(
                "EXPLAIN (FORMAT JSON) SELECT * FROM big ORDER BY id DESC LIMIT 50 OFFSET 5000"
            )));
            const json = result[0]["QUERY PLAN"];
            plan = (typeof json === "string" ? JSON.parse(json) : json)[0].Plan;
        });
        const all = nodes(plan!);
        const scan = all.find(n => /Scan/.test(n["Node Type"]))!;

        expect(all.map(n => n["Node Type"])).not.toContain("Sort");
        expect(scan["Node Type"]).toMatch(/^Index/);
        // The estimate the misplanning came from: the policy used to be
        // expected to pass 1.5% of the table.
        expect(scan["Plan Rows"]).toBeGreaterThanOrEqual(ROWS * 0.1);
    });
});
