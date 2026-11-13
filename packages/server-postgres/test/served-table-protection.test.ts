/**
 * The catalogue check behind "a declared table the database does not protect
 * is not served" (SEC-FIX-2 F-2, tightened in SEC-FIX-3), on a real Postgres
 * (PGlite), and what the registry does with a table it withholds. The boot and
 * refresh wiring is driven end to end in `e2e/declared-table-protection-e2e`.
 *
 * A declared table is served when RLS is on, at least one of its declared
 * policies is present by the name the provisioning path gives it, and no
 * declared restrictive policy is missing (or permissive in the database). A
 * missing permissive policy narrows access: served, with a warning. A policy
 * the schema does not declare counts for nothing — "any one policy" was the
 * old rule, and a stray `USING (true)` passed it.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { RebaseApiError, col, defineTable, rel } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { findServedTableProtection, findUnprotectedServedTables, withheldTableMessage } from "../src/security/served-table-protection";
import { planTablePolicies } from "../src/schema/generate-postgres-ddl-logic";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";

const stray = defineTable("locked", { columns: { id: col.serial().primaryKey() }, rls: [{ operation: "select", access: "public" }] });
const open = defineTable("open_notes", { columns: { id: col.serial().primaryKey() }, rls: "admin-only" });
const bare = defineTable("bare", { columns: { id: col.serial().primaryKey() }, rls: [{ operation: "select", access: "public" }] });
const absent = defineTable("absent", { columns: { id: col.serial().primaryKey() }, rls: "admin-only" });
const full = defineTable("complete", { columns: { id: col.serial().primaryKey() }, rls: [{ operation: "select", access: "public" }] });
const gated = defineTable("gated", {
    columns: { id: col.serial().primaryKey(), org: col.text() },
    rls: [
        { operation: "select", access: "public" },
        { operation: "select", mode: "restrictive", using: "{org} = 'acme'" }
    ]
});
const flipped = defineTable("flipped", {
    columns: { id: col.serial().primaryKey(), org: col.text() },
    rls: [
        { operation: "select", access: "public" },
        { operation: "select", mode: "restrictive", using: "{org} = 'acme'" }
    ]
});
const narrow = defineTable("narrow", {
    columns: { id: col.serial().primaryKey() },
    rls: [{ operation: "select", access: "public" }, { operation: "insert", access: "authenticated" }]
});
// SEC-FIX-4 R-2: a many-to-many's implicit junction, held to the same rule.
const tagged = defineTable("tagged", {
    columns: { id: col.serial().primaryKey() },
    relations: { labels: rel.manyToMany(() => labels) },
    rls: [{ operation: "select", access: "public" }]
});
const labels = defineTable("labels", { columns: { id: col.serial().primaryKey() }, rls: [{ operation: "select", access: "public" }] });
const COMPILED = compileSchema([stray, open, bare, absent, full, gated, flipped, narrow, tagged, labels]);
const PLANS = new Map(planTablePolicies(COMPILED.filter(table => table.descriptor.kind === "table")).map(plan => [plan.table, plan]));

/** The planned policies of a table, by the names provisioning gives them. */
const planned = (table: string) => PLANS.get(table)?.policies ?? [];

/** The SQL name of `tagged.labels`' junction, as the plan names it. */
function junctionName(): string {
    const relation = COMPILED.find(table => table.descriptor.slug === "tagged")?.descriptor.relations.find(candidate => candidate.name === "labels");
    if (relation?.kind !== "manyToMany") throw new Error("tagged.labels is a many-to-many");
    return relation.through.table;
}

/** `CREATE POLICY` under a planned name, with a body the check does not judge. */
function createAs(table: string, name: string, restrictive: boolean): string {
    return `CREATE POLICY "${name}" ON ${table} AS ${restrictive ? "RESTRICTIVE" : "PERMISSIVE"} FOR ALL USING (true);`;
}

let db: PGlite;
const run = async (text: string) => (await db.query<Record<string, unknown>>(text)).rows;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const statements = [
        // RLS on, but its only policy is one the schema does not declare.
        "CREATE TABLE locked (id serial PRIMARY KEY);",
        "ALTER TABLE locked ENABLE ROW LEVEL SECURITY;",
        "CREATE POLICY anything ON locked FOR SELECT USING (true);",
        "CREATE TABLE open_notes (id serial PRIMARY KEY);",
        "CREATE TABLE bare (id serial PRIMARY KEY);",
        "ALTER TABLE bare ENABLE ROW LEVEL SECURITY;",
        // Every declared policy, and a stray one beside them: served.
        "CREATE TABLE complete (id serial PRIMARY KEY);",
        "ALTER TABLE complete ENABLE ROW LEVEL SECURITY;",
        ...planned("complete").map(policy => createAs("complete", policy.name, policy.restrictive)),
        "CREATE POLICY extra ON complete FOR SELECT USING (true);",
        // The grant without its restrictive gate.
        "CREATE TABLE gated (id serial PRIMARY KEY, org text);",
        "ALTER TABLE gated ENABLE ROW LEVEL SECURITY;",
        ...planned("gated").filter(policy => !policy.restrictive).map(policy => createAs("gated", policy.name, false)),
        // The gate present by name, but permissive in the database.
        "CREATE TABLE flipped (id serial PRIMARY KEY, org text);",
        "ALTER TABLE flipped ENABLE ROW LEVEL SECURITY;",
        ...planned("flipped").map(policy => createAs("flipped", policy.name, false)),
        // One permissive grant of two: narrower than declared.
        "CREATE TABLE narrow (id serial PRIMARY KEY);",
        "ALTER TABLE narrow ENABLE ROW LEVEL SECURITY;",
        ...planned("narrow").slice(0, 1).map(policy => createAs("narrow", policy.name, policy.restrictive)),
        // Both endpoints fully protected; their junction left with RLS off.
        "CREATE TABLE tagged (id serial PRIMARY KEY);",
        "ALTER TABLE tagged ENABLE ROW LEVEL SECURITY;",
        ...planned("tagged").map(policy => createAs("tagged", policy.name, policy.restrictive)),
        "CREATE TABLE labels (id serial PRIMARY KEY);",
        "ALTER TABLE labels ENABLE ROW LEVEL SECURITY;",
        ...planned("labels").map(policy => createAs("labels", policy.name, policy.restrictive)),
        `CREATE TABLE ${junctionName()} (tagged_id integer, labels_id integer);`
    ];
    await db.exec(statements.join("\n"));
});

afterAll(async () => {
    await db.close();
});

describe("findUnprotectedServedTables", () => {
    it("plans the policies each case needs (a guard on the fixtures themselves)", () => {
        expect(planned("gated").some(policy => policy.restrictive)).toBe(true);
        expect(planned("narrow").filter(policy => !policy.restrictive).length).toBeGreaterThan(1);
    });

    it("withholds RLS off, no declared policy (a stray one does not count), and a missing or permissive restrictive gate — and only those", async () => {
        const found = await findUnprotectedServedTables(run, COMPILED);
        expect(found.map(({ slug, problem }) => [slug, problem]).sort()).toEqual([
            ["bare", "no-policies"],
            ["flipped", "restrictive-missing"],
            ["gated", "restrictive-missing"],
            ["locked", "no-policies"],
            ["open_notes", "rls-off"],
            ["tagged", "rls-off"]
        ]);
        const gate = found.find(table => table.slug === "gated");
        expect(gate?.missingPolicies).toEqual(planned("gated").filter(policy => policy.restrictive).map(policy => policy.name));
        expect(gate?.remediationSql).toContain("AS RESTRICTIVE");
    });

    it("withholds the table whose many-to-many junction is unprotected, not the related one, and says why (R-2)", async () => {
        const found = await findUnprotectedServedTables(run, COMPILED);
        const tagged = found.find(table => table.slug === "tagged");
        expect(tagged?.junction).toBe(`public.${junctionName()}`);
        expect(tagged?.remediationSql).toContain("ENABLE ROW LEVEL SECURITY");
        expect(found.map(table => table.slug)).not.toContain("labels");
        expect(withheldTableMessage({ slug: "tagged", problem: "rls-off", junction: "public.x" })).toContain("junction");
    });

    it("serves a table missing a permissive policy, and names the policy", async () => {
        const { unprotected, narrowed } = await findServedTableProtection(run, COMPILED);
        expect(unprotected.map(table => table.slug)).not.toContain("narrow");
        expect(narrowed.map(({ slug, missingPolicies }) => [slug, missingPolicies])).toEqual([
            ["narrow", planned("narrow").slice(1).map(policy => policy.name)]
        ]);
    });

    it("gives the statements a provisioning boot would have run", async () => {
        const found = await findUnprotectedServedTables(run, COMPILED);
        const open = found.find(table => table.slug === "open_notes");
        expect(open?.remediationSql).toMatch(/^ALTER TABLE .*open_notes.* ENABLE ROW LEVEL SECURITY;/);
        expect(open?.remediationSql).toContain("CREATE POLICY");
        const bare = found.find(table => table.slug === "bare");
        expect(bare?.remediationSql).not.toContain("ENABLE ROW LEVEL SECURITY");
        expect(bare?.remediationSql).toContain("CREATE POLICY");
    });

    it("issues one read and no schema change", async () => {
        const statements: string[] = [];
        await findUnprotectedServedTables(async (text) => {
            statements.push(text);
            return run(text);
        }, COMPILED);
        expect(statements).toHaveLength(1);
        expect(statements[0].trim()).toMatch(/^SELECT /);
    });

    it("says why a withheld table is not served, never the SQL", () => {
        for (const problem of ["rls-off", "no-policies", "restrictive-missing"] as const) {
            const message = withheldTableMessage({ slug: "t", problem });
            expect(message).toContain('"t" is not served');
            expect(message).not.toMatch(/CREATE|ALTER/);
        }
    });
});

describe("a withheld table in the registry", () => {
    const registry = (): PostgresTableRegistry => {
        const r = new PostgresTableRegistry();
        r.registerTables(COMPILED);
        r.withhold("open_notes", withheldTableMessage({ slug: "open_notes", problem: "rls-off" }));
        return r;
    };

    it("is not served, and a request naming it is refused with the reason (503 TABLE_WITHHELD)", () => {
        const r = registry();
        expect(r.getTable("open_notes")).toBeUndefined();
        expect(r.tables().map(table => table.slug)).not.toContain("open_notes");
        for (const name of ["open_notes", "open-notes"]) {
            try {
                r.tableAt(name);
                throw new Error("expected a refusal");
            } catch (error) {
                expect(error).toBeInstanceOf(RebaseApiError);
                expect(error).toMatchObject({ status: 503, code: "TABLE_WITHHELD", message: expect.not.stringContaining("ALTER TABLE") });
            }
        }
        expect(() => r.requireTable("open_notes")).toThrow(/row-level security is disabled/);
        expect(r.tableAt("nothing_here")).toBeUndefined();
    });

    it("stays withheld across a swap that carries it", () => {
        const r = registry();
        const next = new PostgresTableRegistry();
        next.registerTables(COMPILED);
        for (const [slug, message] of r.withheld()) next.withhold(slug, message);
        r.replaceWith(next);
        expect(r.getTable("open_notes")).toBeUndefined();
        expect([...r.withheld().keys()]).toEqual(["open_notes"]);
    });
});
