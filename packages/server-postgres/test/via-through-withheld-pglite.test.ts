/**
 * A `via` that steps through a table the server does not serve is closed
 * whole (FINAL-FIX-PRODUCT L-1; security look 4, F-1): dropped from an
 * include and refused in a filter or a nested path — for every caller, the
 * trusted plane included, since the server itself does not serve that table —
 * and refused (503 `TABLE_WITHHELD`) on a write. On a real Postgres (PGlite), the driver every
 * door reaches.
 *
 * Before: with `staff` withheld, `cases?include=authorTeamVia` still read
 * through it, and `authorDeskVia` — omitted while `staff` was served, because
 * it joins on the `access.read`-closed `staff.desk_code` — came back, the
 * withheld table's column rules no longer counting.
 *
 * The served-table check follows the many-to-many choice (R-2): a table whose
 * `via` passes through a table that fails the protection rule is withheld
 * with it, the cause named.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { RebaseApiError, col, defineTable, rel, type RelationDescriptor } from "@rebasepro/types";
import { UNSERVED_TABLE, canReadRelation, compileSchema, viaJoinTableNames, type RelatedTables } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { withFieldViewer } from "../src/services/field-viewer";
import { findUnprotectedServedTables, withheldTableMessage } from "../src/security/served-table-protection";
import { planTablePolicies } from "../src/schema/generate-postgres-ddl-logic";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const teams = defineTable("teams", {
    columns: { id: col.integer().primaryKey(), label: col.text() },
    rls: "admin-only"
});
const desks = defineTable("desks", {
    columns: { code: col.text().primaryKey(), floor: col.text() },
    rls: "admin-only"
});
const staff = defineTable("staff", {
    columns: { id: col.integer().primaryKey(), name: col.text(), teamId: col.integer(), deskCode: col.text().access({ read: ["admin"] }) },
    rls: "admin-only"
});
const cases = defineTable("cases", {
    columns: { id: col.integer().primaryKey(), title: col.text(), authorId: col.integer() },
    relations: {
        authorTeamVia: rel.via(() => teams, {
            cardinality: "one",
            steps: [{ table: "staff", on: { from: "author_id", to: "id" } }, { table: "teams", on: { from: "team_id", to: "id" } }]
        }),
        authorDeskVia: rel.via(() => desks, {
            cardinality: "one",
            steps: [{ table: "staff", on: { from: "author_id", to: "id" } }, { table: "desks", on: { from: "desk_code", to: "code" } }]
        }),
        // One hop, writable: its link is a column of `staff` itself.
        authorVia: rel.via(() => staff, { cardinality: "one", steps: [{ table: "staff", on: { from: "author_id", to: "id" } }] })
    },
    rls: "admin-only"
});

const COMPILED = compileSchema([teams, desks, staff, cases]);
const queryable = (db: PGlite) => ({ query: async <T = unknown>(s: string, v?: unknown[]) => ({ rows: (await db.query<T>(s, v)).rows }) });

let db: PGlite;
let driver: PostgresBackendDriver;
let registry: PostgresTableRegistry;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(renderPostgresDdl(planSchema(COMPILED, { databaseExtensions: [] }), { includePolicies: false, includeSearch: false, includeVector: false }));
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: COMPILED.map(t => t.descriptor), defaultSchema: "public" });
    registry = new PostgresTableRegistry();
    registry.registerTables(COMPILED);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    await db.exec(`
        INSERT INTO teams (id, label) VALUES (1, 't1');
        INSERT INTO desks (code, floor) VALUES ('D9', 'f9');
        INSERT INTO staff (id, name, team_id, desk_code) VALUES (1, 's1', 1, 'D9');
        INSERT INTO cases (id, title, author_id) VALUES (1, 'c1', 1);
    `);
});

afterAll(async () => {
    await db.close();
});

const editor = { roles: ["editor"] };
const admin = { roles: ["admin"] };
type Read = Parameters<PostgresBackendDriver["fetchCollection"]>[0];
const readAs = (viewer: { roles: string[] }, request: Read) => withFieldViewer(viewer, () => driver.fetchCollection(request));

async function codeOf(work: () => Promise<unknown>): Promise<string> {
    try {
        await work();
        return "served";
    } catch (error) {
        if (error instanceof RebaseApiError) return String(error.code);
        return typeof error === "object" && error !== null && "code" in error ? String(error.code) : String(error);
    }
}

function relationOf(name: string): RelationDescriptor {
    const relation = COMPILED.find(table => table.descriptor.slug === "cases")?.descriptor.relations.find(candidate => candidate.name === name);
    if (!relation) throw new Error(`cases.${name}`);
    return relation;
}

describe("a via through a withheld table", () => {
    it("is served through a served table (a guard on the fixture)", async () => {
        const rows = await readAs(editor, { path: "cases", include: ["authorTeamVia"] });
        expect(rows[0]).toMatchObject({ authorTeamVia: { label: "t1" } });
        const hidden = await readAs(editor, { path: "cases", include: ["authorDeskVia"] });
        expect(hidden[0]).not.toHaveProperty("authorDeskVia");
    });

    it("is dropped from an include for every caller, the admin included, once the table it passes through is withheld", async () => {
        registry.withhold("staff", "withheld for the test");
        try {
            for (const viewer of [editor, admin]) {
                const rows = await readAs(viewer, { path: "cases", include: ["authorTeamVia", "authorDeskVia"] });
                expect(rows).toHaveLength(1);
                expect(rows[0]).not.toHaveProperty("authorTeamVia");
                expect(rows[0]).not.toHaveProperty("authorDeskVia");
            }
        } finally {
            restore();
        }
    });

    it("is refused in a filter and a nested path, not read on the trusted plane, and refused on a write", async () => {
        registry.withhold("staff", "withheld for the test");
        try {
            expect(await codeOf(() => readAs(editor, { path: "cases", filter: { "authorTeamVia.label": ["==", "t1"] } }))).toBe("FIELD_NOT_READABLE");
            // The trusted plane (no viewer) does not read through it either.
            const trusted = await driver.fetchCollection({ path: "cases", include: ["authorTeamVia"] });
            expect(trusted[0]).not.toHaveProperty("authorTeamVia");
            expect(await codeOf(() => driver.fetchCollection({ path: "cases/1/authorTeamVia" }))).toBe("TABLE_WITHHELD");
            expect(await codeOf(() => readAs(editor, { path: "cases/1/authorTeamVia" }))).toBe("TABLE_WITHHELD");
            // A writable `via` is one hop, so the table it passes through is its target: refused as such.
            expect(await codeOf(() => driver.save({ path: "cases", id: 1, values: { authorVia: 1 }, status: "existing" }))).toBe("TABLE_WITHHELD");
        } finally {
            restore();
        }
    });

    it("judges a step the lookup cannot serve as a column nobody may read", () => {
        const table = COMPILED.find(entry => entry.descriptor.slug === "cases")?.descriptor;
        if (!table) throw new Error("cases");
        const unserved: RelatedTables = name => name === "staff" ? UNSERVED_TABLE : COMPILED.find(entry => entry.descriptor.table === name)?.descriptor;
        expect(canReadRelation(table, relationOf("authorTeamVia"), undefined, unserved)).toBe(false);
        expect(canReadRelation(table, relationOf("authorTeamVia"), { roles: ["admin"] }, unserved)).toBe(false);
        // A table the lookup does not describe (an implicit junction) has no rules: unchanged.
        const unknown: RelatedTables = name => name === "staff" ? undefined : COMPILED.find(entry => entry.descriptor.table === name)?.descriptor;
        expect(canReadRelation(table, relationOf("authorTeamVia"), { roles: ["editor"] }, unknown)).toBe(true);
        const via = relationOf("authorDeskVia");
        if (via.kind !== "via") throw new Error("authorDeskVia is a via");
        expect(viaJoinTableNames(via)).toEqual(["staff", "desks"]);
    });

    it("the registry answers a table this database does not have as not served, and a junction as undescribed", () => {
        const lookup = registry.relatedTables();
        expect(lookup("no_such_table")).toBe(UNSERVED_TABLE);
        expect(lookup("staff")).toMatchObject({ slug: "staff" });
    });
});

/** Put `staff` back: a fresh registry with the same tables, swapped in. */
function restore(): void {
    const next = new PostgresTableRegistry();
    next.registerTables(COMPILED);
    for (const name of registry.getPgTableNames()) {
        const table = registry.getPgTable(name);
        if (table) next.registerPgTable(table, name);
    }
    registry.replaceWith(next);
}

describe("the served-table check", () => {
    const PLANS = new Map(planTablePolicies(COMPILED.filter(table => table.descriptor.kind === "table")).map(plan => [plan.table, plan]));
    const policiesOf = (table: string) => (PLANS.get(table)?.policies ?? [])
        .map(policy => `CREATE POLICY "${policy.name}" ON ${table} AS ${policy.restrictive ? "RESTRICTIVE" : "PERMISSIVE"} FOR ALL USING (true);`);

    it("withholds a table whose via passes through a table that fails the rule, and names the via; not the table it ends at", async () => {
        const check = new PGlite();
        await check.waitReady;
        try {
            await check.exec([
                // `staff` has RLS off; every other table is protected as declared.
                "CREATE TABLE staff (id integer PRIMARY KEY, name text, team_id integer, desk_code text);",
                ...["teams", "desks", "cases"].flatMap(name => [
                    name === "teams" ? "CREATE TABLE teams (id integer PRIMARY KEY, label text);"
                        : name === "desks" ? "CREATE TABLE desks (code text PRIMARY KEY, floor text);"
                            : "CREATE TABLE cases (id integer PRIMARY KEY, title text, author_id integer);",
                    `ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`,
                    ...policiesOf(name)
                ])
            ].join("\n"));
            const run = async (text: string) => (await check.query<Record<string, unknown>>(text)).rows;
            const found = await findUnprotectedServedTables(run, COMPILED);
            expect(found.map(({ slug }) => slug).sort()).toEqual(["cases", "staff"]);
            const owner = found.find(table => table.slug === "cases");
            expect(owner).toMatchObject({ junction: "public.staff", qualified: "public.staff", problem: "rls-off" });
            expect(owner?.via).toBeDefined();
            expect(owner?.remediationSql).toContain("ENABLE ROW LEVEL SECURITY");
            const message = withheldTableMessage(owner ?? { slug: "cases", problem: "rls-off" });
            expect(message).toContain(`"cases" is not served`);
            expect(message).toContain("`via`");
            expect(message).not.toMatch(/CREATE|ALTER/);
        } finally {
            await check.close();
        }
    });

    it("withholds nothing for a via whose steps are all protected", async () => {
        const check = new PGlite();
        await check.waitReady;
        try {
            await check.exec([
                "CREATE TABLE staff (id integer PRIMARY KEY, name text, team_id integer, desk_code text);",
                "CREATE TABLE teams (id integer PRIMARY KEY, label text);",
                "CREATE TABLE desks (code text PRIMARY KEY, floor text);",
                "CREATE TABLE cases (id integer PRIMARY KEY, title text, author_id integer);",
                ...["staff", "teams", "desks", "cases"].flatMap(name => [`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`, ...policiesOf(name)])
            ].join("\n"));
            const run = async (text: string) => (await check.query<Record<string, unknown>>(text)).rows;
            expect(await findUnprotectedServedTables(run, COMPILED)).toEqual([]);
        } finally {
            await check.close();
        }
    });

    it("leaves the table a via ends at out of it: a withheld target refuses the relation, as for every kind", async () => {
        const check = new PGlite();
        await check.waitReady;
        try {
            await check.exec([
                "CREATE TABLE staff (id integer PRIMARY KEY, name text, team_id integer, desk_code text);",
                "CREATE TABLE teams (id integer PRIMARY KEY, label text);",
                "CREATE TABLE desks (code text PRIMARY KEY, floor text);",
                "CREATE TABLE cases (id integer PRIMARY KEY, title text, author_id integer);",
                ...["staff", "desks", "cases"].flatMap(name => [`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`, ...policiesOf(name)])
            ].join("\n"));
            const run = async (text: string) => (await check.query<Record<string, unknown>>(text)).rows;
            expect((await findUnprotectedServedTables(run, COMPILED)).map(({ slug }) => slug)).toEqual(["teams"]);
        } finally {
            await check.close();
        }
    });
});
