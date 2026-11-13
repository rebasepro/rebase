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
 * - `tracks.similarVia`: the `similar` link as a `via` join path.
 * - `categories.parent` / `categories.children`: a `belongsTo` to self and its
 *   `hasMany` inverse; `categories.grandchildren`: a `via` through the same
 *   table twice; `categories.parentVia`: a one-step to-one `via` back into
 *   the table.
 *
 * A `via` read joins every step's table into one statement, so each table but
 * the target is aliased — joined under its own name, the second occurrence is
 * refused ("table name specified more than once").
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
import { RelationService } from "../src/services/RelationService";
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
        covers: rel.manyToMany(() => tracks),
        // The `similar` link again, as a read-only join path.
        similarVia: rel.via(() => tracks, {
            steps: [
                { table: "tracks_similar", on: { from: "id", to: "track_id" } },
                { table: "tracks", on: { from: "similar_id", to: "id" } }
            ]
        })
    },
    rls: "admin-only"
});

const categories = defineTable("categories", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: {
        parent: rel.belongsTo(() => categories, { localKey: "parent_id" }),
        children: rel.hasMany(() => categories, { foreignKey: "parent_id" }),
        // Two hops through the same table: the children of the children.
        grandchildren: rel.via(() => categories, {
            steps: [
                { table: "categories", on: { from: "id", to: "parent_id" } },
                { table: "categories", on: { from: "id", to: "parent_id" } }
            ]
        }),
        // The parent again, as a to-one join path: one step back into the table.
        parentVia: rel.via(() => categories, {
            steps: [{ table: "categories", on: { from: "parent_id", to: "id" } }],
            cardinality: "one"
        })
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
    let registry: ReturnType<typeof buildTableRegistry>;
    let orm: ReturnType<typeof drizzle>;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(renderPostgresDdl(plan, { includePolicies: false, includeSearch: false, includeVector: false }));
        const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
        expect(catalogue.missing).toEqual([]);
        registry = buildTableRegistry({ compiledTables: compiled, tables: catalogue.tables, relations: catalogue.relations });
        orm = drizzle(db, { schema: { ...catalogue.tables, ...catalogue.relations } });
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
        expect(idsOf((await restOne("tracks", idA, ["similarVia"]))?.similarVia)).toEqual([idB, idC]);
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
        expect(idsOf((await restOne("categories", root, ["grandchildren"]))?.grandchildren)).toEqual([right]);

        // A nested create through the self relation sets the parent key.
        const nested = await driver.save({ path: `categories/${right}/children`, status: "new", values: { name: "leaf" } });
        expect(await rows(`SELECT parent_id FROM categories WHERE id = ${Number(nested.id)}`)).toEqual([{ parent_id: right }]);

        // Detach from the child's side, then delete the leaf.
        await driver.save({ path: "categories", id: Number(nested.id), status: "existing", values: { parent: null } });
        expect(await rows(`SELECT parent_id FROM categories WHERE id = ${Number(nested.id)}`)).toEqual([{ parent_id: null }]);
        await driver.delete({ row: { path: "categories", id: Number(nested.id) } });
        expect((await rows("SELECT name FROM categories ORDER BY id")).map(row => row.name)).toEqual(["root", "left", "right"]);
    });
    /**
     * A tree: root → left, right; left → l1, l2; right → r1; l1 → l1a.
     * Every `via` read below revisits `categories`.
     */
    const seedTree = async () => {
        const make = async (name: string, parent?: number) =>
            Number((await driver.save({ path: "categories", status: "new", values: parent ? { name, parent } : { name } })).id);
        const root = await make("root");
        const left = await make("left", root);
        const right = await make("right", root);
        const l1 = await make("l1", left);
        const l2 = await make("l2", left);
        const r1 = await make("r1", right);
        const l1a = await make("l1a", l1);
        return { root, left, right, l1, l2, r1, l1a };
    };

    it("reads a `via` that revisits its own table: one row, a collection, a window, a `where` and `_count`", async () => {
        const t = await seedTree();

        // One row, both kinds: the to-many through the table twice, the to-one through it once.
        const fromRoot = await restOne("categories", t.root, ["grandchildren", "parentVia"]);
        expect(idsOf(fromRoot?.grandchildren)).toEqual([t.l1, t.l2, t.r1]);
        expect(fromRoot?.parentVia ?? null).toBeNull();
        expect(idOf((await restOne("categories", t.l1, ["parentVia"]))?.parentVia)).toBe(t.left);

        // A collection: every parent's rows in one statement, each grouped under its own row.
        const listed = await driver.restFetchService.fetchCollectionForRest(
            "categories", { orderBy: "id", order: "asc" }, ["grandchildren", "parentVia"]
        );
        expect(listed.map(row => [row.id, idsOf(row.grandchildren), idOf(row.parentVia) ?? null])).toEqual([
            [t.root, [t.l1, t.l2, t.r1], null],
            [t.left, [t.l1a], t.root],
            [t.right, [], t.root],
            [t.l1, [], t.left],
            [t.l2, [], t.left],
            [t.r1, [], t.right],
            [t.l1a, [], t.l1]
        ]);

        // A window per parent (ranked in a subquery that joins the same aliases), with the total before the limit.
        const windowed = await driver.restFetchService.fetchOneForRest("categories", String(t.root), {
            grandchildren: { limit: 2, orderBy: [["name", "desc"]], count: true }
        });
        expect((windowed?.grandchildren as Record<string, unknown>[]).map(row => row.name)).toEqual(["r1", "l2"]);
        expect(windowed?._count).toEqual({ grandchildren: 3 });

        // The include's `where` binds to the target, not to the source that shares its table.
        const narrowed = await driver.restFetchService.fetchOneForRest("categories", String(t.root), {
            grandchildren: { where: { name: ["==", "l2"] } }
        });
        expect(idsOf(narrowed?.grandchildren)).toEqual([t.l2]);

        // A self-reference two levels deep through nested includes, the `via` at the bottom.
        const nested = await driver.restFetchService.fetchOneForRest("categories", String(t.root), {
            children: { include: { children: { include: ["grandchildren"] } } }
        });
        const leftNode = (nested?.children as Record<string, unknown>[]).find(row => row.id === t.left);
        const l1Node = (leftNode?.children as Record<string, unknown>[]).find(row => row.id === t.l1);
        expect(idsOf(l1Node?.grandchildren)).toEqual([]);
        const rootGrand = await driver.restFetchService.fetchOneForRest("categories", String(t.root), {
            children: { include: ["grandchildren"] }
        });
        expect((rootGrand?.children as Record<string, unknown>[]).map(row => [row.id, idsOf(row.grandchildren)]))
            .toEqual([[t.left, [t.l1a]], [t.right, []]]);
    });

    it("lists and counts a `via` that revisits its own table under a nested path", async () => {
        const t = await seedTree();
        const relations = new RelationService(orm, registry);
        expect((await relations.fetchRelatedEntities("categories", t.root, "grandchildren")).map(row => Number(row.id)).sort((a, b) => a - b))
            .toEqual([t.l1, t.l2, t.r1]);
        expect((await relations.fetchRelatedEntities("categories", t.l1a, "parentVia")).map(row => Number(row.id))).toEqual([t.l1]);
        expect(await relations.countRelatedEntities("categories", t.root, "grandchildren")).toBe(3);
        const nestedList = await driver.restFetchService.fetchCollectionForRest(`categories/${t.root}/grandchildren`, { orderBy: "id", order: "asc" });
        expect(nestedList.map(row => row.id)).toEqual([t.l1, t.l2, t.r1]);
        expect(await driver.restFetchService.fetchOneForRest(`categories/${t.root}/grandchildren`, String(t.l1a))).toBeNull();
        expect((await driver.restFetchService.fetchOneForRest(`categories/${t.root}/grandchildren`, String(t.l2)))?.name).toBe("l2");
    });

    it("refuses to filter or sort by a `via` relation, and says why", async () => {
        await seedTree();
        await expect(driver.restFetchService.fetchCollectionForRest("categories", { filter: { "grandchildren.name": ["==", "l1"] } }))
            .rejects.toThrow("`via` relation, whose join path is authored one way only");
        await expect(driver.restFetchService.fetchCollectionForRest("categories", { orderBy: "count(grandchildren)" }))
            .rejects.toThrow("`via` relations are authored one way only");
    });
});
