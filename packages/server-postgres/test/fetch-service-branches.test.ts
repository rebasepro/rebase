import { CollectionConfig } from "@rebasepro/types";
import { integer, pgTable, text, vector } from "drizzle-orm/pg-core";
import { FetchService } from "../src/services/FetchService";
import { RelationService } from "../src/services/RelationService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { arrayRowsFor, recordingDb, type QueryResponder } from "./helpers/spg-b-recording-db";

/**
 * Four decisions inside `FetchService` that no other test looks at, each of
 * which fails silently rather than loudly:
 *
 *   1. whether a relation is loaded *through* its junction table,
 *   2. whether relations are eager-loaded at all for a single REST read,
 *   3. whether a vector distance comes back as a number,
 *   4. whether a null relation value is left null instead of becoming `{}`.
 *
 * None of them throws when it goes wrong. The response is still 200, still
 * well-formed, and still wrong — a many-to-many read returns junction rows
 * instead of targets, an `include: []` read pays for every join it did not
 * ask for, a distance sorts as a string, and an absent one-to-one turns into
 * an empty object the client cannot tell from a real row.
 */
describe("FetchService — read-shape branches", () => {

    const registry = new FixtureTableRegistry();

    // Real drizzle tables: a vector search resolves the property it was given
    // against the real columns, and a read compiles to real SQL.
    registry.registerPgTable(pgTable("posts", {
        id: integer("id").primaryKey(),
        title: text("title"),
        author_id: integer("author_id"),
        embedding: vector("embedding", { dimensions: 2 })
    }), "posts");
    registry.registerPgTable(pgTable("authors", { id: integer("id").primaryKey(), name: text("name") }), "authors");
    registry.registerPgTable(pgTable("tags", { id: integer("id").primaryKey(), name: text("name") }), "tags");

    const tagsCollection: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: {
            id: { type: "number",
isId: true },
            name: { type: "string" }
        }
    };

    const authorsCollection: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: {
            id: { type: "number",
isId: true },
            name: { type: "string" }
        }
    };

    // One relation of each shape the junction branch has to tell apart: a
    // many-to-many that goes through `posts_tags`, and an owning belongsTo
    // that goes through nothing at all.
    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number",
isId: true },
            title: { type: "string" },
            author: { type: "relation" },
            tags: { type: "relation" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "author",
                target: () => authorsCollection,
                localKey: "author_id"
            },
            {
                kind: "manyToMany",
                relationName: "tags",
                target: () => tagsCollection,
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id"
                }
            }
        ]
    };

    beforeEach(() => {
        jest.restoreAllMocks();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path === "posts") return postsCollection;
            if (path === "authors") return authorsCollection;
            if (path === "tags") return tagsCollection;
            return undefined;
        });
    });

    /**
     * A FetchService over a database whose every select yields `rows`, with the
     * relation batch loaders stubbed so a test can see exactly which relations
     * a read asked for.
     *
     * `db.query` is deliberately absent. The relational query API is no longer
     * reachable from any read: it compiles a to-many relation into a lateral
     * join, which this file's own comments measured at 7s+ for 350 rows, and
     * the batched loader below replaced it everywhere.
     */
    const serviceOver = (respond: QueryResponder) => {
        const { db } = recordingDb(respond);
        const service = new FetchService(db, registry);
        const one = jest.spyOn(RelationService.prototype, "batchFetchRelatedEntities").mockResolvedValue(new Map());
        const many = jest.spyOn(RelationService.prototype, "batchFetchRelatedEntitiesMany").mockResolvedValue(new Map());
        return { service, one, many };
    };
    const selectService = (rows: Record<string, unknown>[]) =>
        serviceOver(({ text: sqlText }) => arrayRowsFor(sqlText, rows));

    /** The relation keys a read loaded, whichever cardinality they were. */
    const loadedRelations = (
        one: ReturnType<typeof selectService>["one"],
        many: ReturnType<typeof selectService>["many"]
    ): string[] => [
        ...one.mock.calls.map(call => call[2]),
        ...many.mock.calls.map(call => call[2])
    ].sort();

    describe("include names exactly the relations that are loaded", () => {

        it("loads each named relation once, in one batched query", async () => {
            const { service, one, many } = selectService([{ id: 1, title: "Hello", author_id: 7 }]);

            await service.fetchCollectionForRest("posts", {}, ["tags", "author"]);

            // One query per relation, not one per row — and no lateral join.
            expect(loadedRelations(one, many)).toEqual(["author", "tags"]);
            expect(one).toHaveBeenCalledTimes(1);
            expect(many).toHaveBeenCalledTimes(1);
        });

        it("loads nothing but what was named", async () => {
            const { service, one, many } = selectService([{ id: 1, title: "Hello", author_id: 7 }]);

            await service.fetchCollectionForRest("posts", {}, ["author"]);

            expect(loadedRelations(one, many)).toEqual(["author"]);
        });

        it("refuses a name that is not a relation instead of dropping it", async () => {
            const { service } = selectService([{ id: 1, title: "Hello" }]);

            // Silently ignoring it answers 200 with the field missing, which is
            // indistinguishable from a row that has no related row — so a typo
            // in an `include` looked exactly like empty data.
            await expect(service.fetchCollectionForRest("posts", {}, ["authr"]))
                .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        });

        it("loads every relation for `*`", async () => {
            const { service, one, many } = selectService([{ id: 1, title: "Hello", author_id: 7 }]);

            await service.fetchCollectionForRest("posts", {}, ["*"]);

            expect(loadedRelations(one, many)).toEqual(["author", "tags"]);
        });
    });

    describe("fetchOneForRest loads only what `include` asks for", () => {

        /** `fetchOneForRest` reads one row through `db.select(...).limit(1)`. */
        const oneRowService = (row: Record<string, unknown> | undefined) => selectService(row ? [row] : []);

        it("loads a named relation", async () => {
            const { service, one, many } = oneRowService({ id: 1, title: "Hello", author_id: 7 });

            await service.fetchOneForRest("posts", 1, ["author"]);

            expect(loadedRelations(one, many)).toEqual(["author"]);
        });

        it("loads nothing for an empty include", async () => {
            const { service, one, many } = oneRowService({ id: 1, title: "Hello" });

            await service.fetchOneForRest("posts", 1, []);

            // `include: []` means "no relations", not "all of them". The empty
            // array is still truthy, and reading it as the wildcard would load
            // every relation on the collection and pay for all of them.
            expect(loadedRelations(one, many)).toEqual([]);
        });

        it("loads nothing when include is absent", async () => {
            const { service, one, many } = oneRowService({ id: 1, title: "Hello" });

            await service.fetchOneForRest("posts", 1, undefined);

            expect(loadedRelations(one, many)).toEqual([]);
        });

        it("returns the same relation shape a list read does", async () => {
            // The two used to be separate implementations — `findFirst({with})`
            // here, `findMany({with})` there, each with its own fallback — and
            // they disagreed about a to-one relation that resolves to nothing:
            // absent on one, `null` on the other.
            const { service } = oneRowService({ id: 1, title: "Hello", author_id: 7 });

            const row = await service.fetchOneForRest("posts", 1, ["author"]);

            expect(row).toMatchObject({ id: 1, author: null });
        });
    });

    describe("vector search distances arrive as numbers", () => {

        it("coerces a string _distance and passes a numeric one through", async () => {
            // The nearest-neighbour select reads the row's columns and then the
            // distance. node-postgres hands back float8/numeric as a string,
            // which is exactly the case the coercion exists for.
            const { service } = serviceOver(() => [
                [1, "Nearest", null, null, "0.25"],
                [2, "Further", null, null, 0.5]
            ]);

            // Asserted on the REST read, which keeps `_distance`: the CMS path
            // parses rows against `properties`, and `_distance` is not a
            // declared property, so it is dropped there. The coercion has to be
            // right either way — the rows are ordered by this value, and a
            // string sorts lexicographically ("0.5" < "0.25").
            const handed = await service.fetchCollectionForRest("posts", {
                vectorSearch: { property: "embedding",
vector: [0.1, 0.2] }
            });

            expect(handed).toHaveLength(2);
            expect(typeof handed[0]._distance).toBe("number");
            expect(handed[0]._distance).toBe(0.25);
            expect(typeof handed[1]._distance).toBe("number");
            expect(handed[1]._distance).toBe(0.5);
        });
    });
});
