/**
 * Relations from a table to itself, end to end on PGlite: planned, created,
 * linked, read with `include` from both sides, unlinked and deleted.
 *
 * Every resolver that pairs a relation's source table with its target — the
 * junction resolution, the planner's canonical side, the generated drizzle
 * relations, the inverse matching that reads a `hasMany` back through its
 * `belongsTo`, the junction reads and writes — has the same table on both
 * ends here, so a resolver keyed by table rather than by (table, column)
 * collapses the two ends into one.
 *
 * - `tracks.similar`: a `manyToMany` from tracks to tracks, with a pivot
 *   column; `tracks.similarTo` reads the same junction from the other end.
 * - `tracks.covers`: a `manyToMany` from tracks to tracks with no pivot.
 * - `categories.parent` / `categories.children`: a `belongsTo` to self and its
 *   `hasMany` inverse.
 *
 * Not here: a `via` whose steps return to a table already in the query. The
 * read joins each step's table under its own name, so the second occurrence
 * is refused ("table name specified more than once"); it never read, on
 * `main` either.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { withPinnedPlannerWorld } from "../src/schema/render-outputs";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { buildTableRegistry } from "../src/model/build-registry";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import type { Queryable } from "../src/schema/ensure-tables";

const tracks = defineTable("tracks", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: {
        similar: rel.manyToMany(() => tracks, {
            through: "tracks_similar",
            sourceKey: "track_id",
            targetKey: "similar_id",
            pivot: { score: col.integer() }
        }),
        similarTo: rel.manyToMany(() => tracks, {
            through: "tracks_similar",
            sourceKey: "similar_id",
            targetKey: "track_id",
            pivot: { score: col.integer() }
        }),
        covers: rel.manyToMany(() => tracks)
    },
    rls: "admin-only"
});

const categories = defineTable("categories", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: {
        parent: rel.belongsTo(() => categories, { localKey: "parent_id" }),
        children: rel.hasMany(() => categories, { foreignKey: "parent_id" })
    },
    rls: "admin-only"
});

const compiled = compileSchema([tracks, categories]);
const plan = withPinnedPlannerWorld(() => planSchema(compiled, { databaseExtensions: [] }));

const queryable = (db: PGlite): Queryable => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

describe("self-referencing relations: the plan", () => {
    const table = (name: string) => {
        const found = plan.tables.find(candidate => candidate.table === name);
        if (!found) throw new Error(`no planned table "${name}"`);
        return found;
    };

    it("plans one junction per link, each with both key columns pointing at the same table", () => {
        expect(plan.tables.map(t => t.table)).toEqual(["tracks", "tracks_similar", "tracks_tracks", "categories"]);
        expect(table("tracks_similar").columns.map(c => [c.column, c.foreignKey?.targetTable])).toEqual([
            ["track_id", "tracks"], ["similar_id", "tracks"], ["score", undefined]
        ]);
        expect(table("tracks_similar").primaryKey).toEqual(["track_id", "similar_id"]);
        // The default keys: the source's singular slug, the relation's name.
        expect(table("tracks_tracks").columns.map(c => [c.column, c.foreignKey?.targetTable])).toEqual([
            ["track_id", "tracks"], ["cover_id", "tracks"]
        ]);
    });

    it("plans the self-referencing belongsTo column with its foreign key into its own table", () => {
        const parent = table("categories").columns.find(c => c.foreignKey);
        expect(parent?.foreignKey).toMatchObject({ column: "parent_id", targetTable: "categories", targetColumn: "id" });
    });

    it("names each junction's policies apart", () => {
        const names = plan.tables.flatMap(t => t.policies.map(policy => `${t.table}.${policy.name}`));
        expect(new Set(names).size).toBe(names.length);
        expect(table("tracks_similar").policies.length).toBeGreaterThan(0);
        expect(table("tracks_tracks").policies.length).toBeGreaterThan(0);
    });
});

describe("self-referencing relations: on a database", () => {
    let db: PGlite;
    let driver: PostgresBackendDriver;
    let realtime: RealtimeService;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(renderPostgresDdl(plan, { includePolicies: false, includeSearch: false, includeVector: false }));
        const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
        expect(catalogue.missing).toEqual([]);
        const registry = buildTableRegistry({ compiledTables: compiled, tables: catalogue.tables, relations: catalogue.relations });
        const orm = drizzle(db, { schema: { ...catalogue.tables, ...catalogue.relations } });
        realtime = new RealtimeService(orm, registry);
        driver = new PostgresBackendDriver(orm, realtime, registry);
        realtime.setDataDriver(driver);
    });

    afterEach(async () => {
        await realtime.destroy();
        await db.close();
    });

    const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
    const idOf = (value: unknown): number | undefined =>
        typeof value === "object" && value !== null && "id" in value ? Number(value.id) : undefined;
    const idsOf = (value: unknown): (number | undefined)[] =>
        (Array.isArray(value) ? value : []).map(idOf).sort((a, b) => (a ?? 0) - (b ?? 0));
    const restOne = (path: string, id: number, include: string[]) =>
        driver.restFetchService.fetchOneForRest(path, String(id), include);

    it("links a track to tracks, reads the link from both ends, unlinks it, and deletes", async () => {
        const a = await driver.save({ path: "tracks", status: "new", values: { title: "A" } });
        const b = await driver.save({ path: "tracks", status: "new", values: { title: "B" } });
        const c = await driver.save({ path: "tracks", status: "new", values: { title: "C" } });
        const [idA, idB, idC] = [a, b, c].map(row => Number(row.id));

        await driver.save({ path: "tracks", id: idA, status: "existing", values: { similar: [idB, idC], covers: [idB] } });
        expect(await rows("SELECT track_id, similar_id FROM tracks_similar ORDER BY similar_id"))
            .toEqual([{ track_id: idA, similar_id: idB }, { track_id: idA, similar_id: idC }]);
        expect(await rows("SELECT track_id, cover_id FROM tracks_tracks")).toEqual([{ track_id: idA, cover_id: idB }]);

        // Forward: A's similar tracks are B and C.
        const fromA = await restOne("tracks", idA, ["similar", "similarTo", "covers"]);
        expect(idsOf(fromA?.similar)).toEqual([idB, idC]);
        expect(idsOf(fromA?.similarTo)).toEqual([]);
        expect(idsOf(fromA?.covers)).toEqual([idB]);
        // Backward, through the same junction: B is similar to A.
        const fromB = await restOne("tracks", idB, ["similar", "similarTo", "covers"]);
        expect(idsOf(fromB?.similar)).toEqual([]);
        expect(idsOf(fromB?.similarTo)).toEqual([idA]);
        expect(idsOf(fromB?.covers)).toEqual([]);

        // A collection read batches every row's links in one query per relation.
        const listed = await driver.fetchCollection({ path: "tracks", include: ["similar", "similarTo"], orderBy: "id", order: "asc" });
        expect(listed.map(row => [idsOf(row.similar), idsOf(row.similarTo)])).toEqual([
            [[idB, idC], []], [[], [idA]], [[], [idA]]
        ]);

        // The pivot column rides on the link.
        await driver.updateRelationPivot({ path: `tracks/${idA}/similar`, targetId: String(idB), pivot: { score: 7 } });
        expect(await rows(`SELECT score FROM tracks_similar WHERE similar_id = ${idB}`)).toEqual([{ score: 7 }]);

        // Unlink C from A's side; the other link stays.
        await driver.save({ path: "tracks", id: idA, status: "existing", values: { similar: [idB] } });
        expect(await rows("SELECT track_id, similar_id FROM tracks_similar")).toEqual([{ track_id: idA, similar_id: idB }]);
        // Unlink from the other end: B drops A from `similarTo`.
        await driver.save({ path: "tracks", id: idB, status: "existing", values: { similarTo: [] } });
        expect(await rows("SELECT * FROM tracks_similar")).toEqual([]);

        // Deleting a linked track takes its junction rows with it.
        await driver.save({ path: "tracks", id: idC, status: "existing", values: { similar: [idA] } });
        await driver.delete({ row: { path: "tracks", id: idA } });
        expect(await rows("SELECT * FROM tracks_similar")).toEqual([]);
        expect(await rows("SELECT * FROM tracks_tracks")).toEqual([]);
        expect((await rows("SELECT id FROM tracks ORDER BY id")).map(row => row.id)).toEqual([idB, idC]);
    });

    it("links categories to a parent, reads parent and children, re-parents, and deletes", async () => {
        const root = Number((await driver.save({ path: "categories", status: "new", values: { name: "root" } })).id);
        const left = Number((await driver.save({ path: "categories", status: "new", values: { name: "left", parent: root } })).id);
        const right = Number((await driver.save({ path: "categories", status: "new", values: { name: "right", parent: root } })).id);
        expect(await rows("SELECT name, parent_id FROM categories ORDER BY id"))
            .toEqual([{ name: "root", parent_id: null }, { name: "left", parent_id: root }, { name: "right", parent_id: root }]);

        const fromRoot = await restOne("categories", root, ["parent", "children"]);
        expect(fromRoot?.parent ?? null).toBeNull();
        expect(idsOf(fromRoot?.children)).toEqual([left, right]);
        const fromLeft = await restOne("categories", left, ["parent", "children"]);
        expect(idOf(fromLeft?.parent)).toBe(root);
        expect(idsOf(fromLeft?.children)).toEqual([]);

        // Re-parent `right` under `left`, through the parent's side.
        await driver.save({ path: "categories", id: left, status: "existing", values: { children: [right] } });
        expect(await rows("SELECT name, parent_id FROM categories ORDER BY id"))
            .toEqual([{ name: "root", parent_id: null }, { name: "left", parent_id: root }, { name: "right", parent_id: left }]);
        expect(idsOf((await restOne("categories", root, ["children"]))?.children)).toEqual([left]);
        expect(idsOf((await restOne("categories", left, ["children"]))?.children)).toEqual([right]);

        // A nested create through the self relation sets the parent key.
        const nested = await driver.save({ path: `categories/${right}/children`, status: "new", values: { name: "leaf" } });
        expect(await rows(`SELECT parent_id FROM categories WHERE id = ${Number(nested.id)}`)).toEqual([{ parent_id: right }]);

        // Detach from the child's side, then delete the leaf.
        await driver.save({ path: "categories", id: Number(nested.id), status: "existing", values: { parent: null } });
        expect(await rows(`SELECT parent_id FROM categories WHERE id = ${Number(nested.id)}`)).toEqual([{ parent_id: null }]);
        await driver.delete({ row: { path: "categories", id: Number(nested.id) } });
        expect((await rows("SELECT name FROM categories ORDER BY id")).map(row => row.name)).toEqual(["root", "left", "right"]);
    });
});
