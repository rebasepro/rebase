/**
 * A key column the caller cannot read stays unread from the other side
 * (SEC-FIX-4 R-1): a `hasMany` / `hasOne` whose `foreignKey` is that column,
 * and a `via` whose join reads it, answer as the `belongsTo` bound to it does
 * — omitted from an include (role-restricted), unknown (private), refused in a
 * relation-path filter — at depth 1 and 2. On a real Postgres (PGlite), the
 * driver read every door reaches.
 *
 * Before: `staff?include=handledCases` grouped each case under the staff row
 * its hidden `handlerId` points at, `?handledCases.title=eq.c1` answered who
 * handles c1, and `cases?include=handlerVia` embedded what
 * `include=handler` refused. Also in 0.30.x.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { withFieldViewer } from "../src/services/field-viewer";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const teams = defineTable("teams", {
    columns: { id: col.integer().primaryKey(), label: col.text() },
    relations: { members: rel.hasMany(() => staff, { foreignKey: "team_id" }) },
    rls: "admin-only"
});
const staff = defineTable("staff", {
    columns: { id: col.integer().primaryKey(), name: col.text(), teamId: col.integer() },
    relations: {
        handledCases: rel.hasMany(() => cases, { foreignKey: "handler_id" }),
        informedCases: rel.hasMany(() => cases, { foreignKey: "informant_id" }),
        primaryCase: rel.hasOne(() => cases, { foreignKey: "handler_id" }),
        // Joined on columns nobody restricts: must stay exactly as it was.
        notes: rel.hasMany(() => cases, { foreignKey: "author_id" })
    },
    rls: "admin-only"
});
const cases = defineTable("cases", {
    columns: {
        id: col.integer().primaryKey(),
        title: col.text(),
        handlerId: col.integer().access({ read: ["admin"] }),
        informantId: col.integer().private(),
        authorId: col.integer()
    },
    relations: {
        handler: rel.belongsTo(() => staff, { localKey: "handler_id" }),
        handlerVia: rel.via(() => staff, { cardinality: "one", steps: [{ table: "staff", on: { from: "handler_id", to: "id" } }] }),
        informantVia: rel.via(() => staff, { cardinality: "one", steps: [{ table: "staff", on: { from: "informant_id", to: "id" } }] }),
        authorVia: rel.via(() => staff, { cardinality: "one", steps: [{ table: "staff", on: { from: "author_id", to: "id" } }] })
    },
    rls: "admin-only"
});

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

let db: PGlite;
let driver: PostgresBackendDriver;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const compiled = compileSchema([teams, staff, cases]);
    await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
        includePolicies: false, includeSearch: false, includeVector: false
    }));
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
    const registry = new PostgresTableRegistry();
    registry.registerTables(compiled);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    await db.exec(`
        INSERT INTO teams (id, label) VALUES (1, 't1');
        INSERT INTO staff (id, name, team_id) VALUES (1, 's1', 1), (2, 's2', 1), (3, 's3', 1);
        INSERT INTO cases (id, title, handler_id, informant_id, author_id) VALUES (1, 'c1', 2, 3, 1);
    `);
});

afterAll(async () => {
    await db.close();
});

type Row = Record<string, unknown>;
const editor = { roles: ["editor"] };
const admin = { roles: ["admin"] };
const read = (viewer: { roles: string[] }, props: Parameters<PostgresBackendDriver["fetchCollection"]>[0]) =>
    withFieldViewer(viewer, () => driver.fetchCollection(props));
async function refusal(viewer: { roles: string[] }, props: Parameters<PostgresBackendDriver["fetchCollection"]>[0]): Promise<string | undefined> {
    try {
        await read(viewer, props);
        return undefined;
    } catch (error) {
        return typeof error === "object" && error !== null && "code" in error ? String(error.code) : String(error);
    }
}
const byId = (rows: Row[], id: number): Row | undefined => rows.find(row => row.id === id);

describe("a relation is exactly as readable as every column its join reads", () => {
    it("depth 1: a hasMany / hasOne on a hidden foreign key is omitted, and an unrestricted one is not", async () => {
        const rows = await read(editor, { path: "staff", include: ["handledCases", "primaryCase", "notes"] });
        for (const row of rows) {
            expect(row).not.toHaveProperty("handledCases");
            expect(row).not.toHaveProperty("primaryCase");
        }
        expect(byId(rows, 1)?.notes).toEqual([expect.objectContaining({ id: 1, title: "c1" })]);
        // A caller the key admits sees the grouping.
        const asAdmin = await read(admin, { path: "staff", include: ["handledCases"] });
        expect(byId(asAdmin, 2)?.handledCases).toEqual([expect.objectContaining({ id: 1 })]);
    });

    it("depth 1: one on a private foreign key is never served, the admin included", async () => {
        for (const viewer of [editor, admin]) {
            const answer = await refusal(viewer, { path: "staff", include: ["informedCases"] });
            if (answer === undefined) {
                const rows = await read(viewer, { path: "staff", include: ["informedCases"] });
                for (const row of rows) expect(row).not.toHaveProperty("informedCases");
            } else {
                expect(answer).toBe("UNKNOWN_RELATION");
            }
        }
    });

    it("depth 1: a via over a hidden column is omitted; over an open one it is served", async () => {
        const rows = await read(editor, { path: "cases", include: ["handlerVia", "authorVia"] });
        expect(rows[0]).not.toHaveProperty("handlerVia");
        expect(rows[0]?.authorVia).toEqual(expect.objectContaining({ id: 1, name: "s1" }));
        const privateVia = await refusal(editor, { path: "cases", include: ["informantVia"] });
        if (privateVia === undefined) {
            expect((await read(editor, { path: "cases", include: ["informantVia"] }))[0]).not.toHaveProperty("informantVia");
        } else {
            expect(privateVia).toBe("UNKNOWN_RELATION");
        }
    });

    it("depth 2: a readable table reached through it is unreachable", async () => {
        const rows = await read(editor, { path: "teams", include: ["members.handledCases", "members.notes"] });
        const members = rows[0]?.members;
        expect(Array.isArray(members)).toBe(true);
        for (const member of Array.isArray(members) ? members : []) expect(member).not.toHaveProperty("handledCases");
        expect(JSON.stringify(rows)).toContain("\"notes\"");
    });

    it("a relation-path filter through it answers as through the key: refused, or unknown when the key is private", async () => {
        expect(await refusal(editor, { path: "staff", filter: { "handledCases.title": ["==", "c1"] } })).toBe("FIELD_NOT_READABLE");
        expect(await refusal(editor, { path: "staff", filter: { "primaryCase.title": ["==", "c1"] } })).toBe("FIELD_NOT_READABLE");
        expect(await refusal(editor, { path: "staff", filter: { "informedCases.title": ["==", "c1"] } })).toMatch(/^UNKNOWN_/);
        expect(await refusal(editor, { path: "cases", filter: { "handler.name": ["==", "s2"] } })).toBe("FIELD_NOT_READABLE");
        // Open joins answer as before.
        expect((await read(editor, { path: "staff", filter: { "notes.title": ["==", "c1"] } })).map(row => row.id)).toEqual([1]);
        expect((await read(admin, { path: "staff", filter: { "handledCases.title": ["==", "c1"] } })).map(row => row.id)).toEqual([2]);
    });
});
