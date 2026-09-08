import { CollectionConfig } from "@rebasepro/types";
import { Table } from "drizzle-orm";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

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

    const registry = new PostgresCollectionRegistry();

    // Drizzle names a table by symbol and `getTableName` reads it; a table
    // without one never resolves to a query builder, which quietly routes the
    // read down the db.select fallback instead of the path under test.
    //
    // The columns are reachable through `Table.Symbol.Columns` — the way
    // `getTableColumns` reads them — and carry their SQL type, because a vector
    // search now resolves the property it was given against the real columns
    // rather than indexing the table object by name. A stub without them is a
    // table whose columns do not exist, and the read is refused as such.
    const table = (name: string, columns: string[], sqlTypes: Record<string, string> = {}) => {
        const t: Record<string, unknown> = { [Table.Symbol.Name]: name };
        const cols: Record<string, unknown> = {};
        for (const c of columns) {
            const column = { name: c, getSQLType: () => sqlTypes[c] ?? "text" };
            t[c] = column;
            cols[c] = column;
        }
        t[Table.Symbol.Columns] = cols;
        return t;
    };

    const tagsCollection: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: {
            id: { type: "number",
isId: true },
            name: { type: "string" }
        },
        idField: "id"
    };

    const authorsCollection: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: {
            id: { type: "number",
isId: true },
            name: { type: "string" }
        },
        idField: "id"
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
            author: { type: "relation",
relationName: "author" },
            tags: { type: "relation",
relationName: "tags" }
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
        ],
        idField: "id"
    };

    beforeEach(() => {
        jest.restoreAllMocks();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path === "posts") return postsCollection;
            if (path === "authors") return authorsCollection;
            if (path === "tags") return tagsCollection;
            return undefined;
        });
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "posts") return table("posts", ["id", "title", "author_id", "embedding"], { embedding: "vector(2)" }) as any;
            if (name === "authors") return table("authors", ["id", "name"]) as any;
            if (name === "tags") return table("tags", ["id", "name"]) as any;
            return undefined;
        });
    });

    /**
     * A FetchService over a `db.select` chain that yields `rows`, with the
     * relation batch loaders stubbed so a test can see exactly which relations
     * a read asked for.
     *
     * `db.query` is deliberately absent. The relational query API is no longer
     * reachable from any read: it compiles a to-many relation into a lateral
     * join, which this file's own comments measured at 7s+ for 350 rows, and
     * the batched loader below replaced it everywhere.
     */
    const selectService = (rows: Record<string, unknown>[]) => {
        const chain: any = {
            from: jest.fn(() => chain),
            $dynamic: jest.fn(() => chain),
            where: jest.fn(() => chain),
            orderBy: jest.fn(() => chain),
            limit: jest.fn(() => chain),
            offset: jest.fn(() => chain),
            then: (resolve: (r: unknown) => void) => resolve(rows)
        };
        const db = { select: jest.fn(() => chain), selectDistinct: jest.fn(() => chain) };
        const service = new FetchService(db as any, registry);
        const one = jest.fn().mockResolvedValue(new Map());
        const many = jest.fn().mockResolvedValue(new Map());
        const relations = (service as any).relationService;
        relations.batchFetchRelatedEntities = one;
        relations.batchFetchRelatedEntitiesMany = many;
        return { service, db, one, many };
    };

    /** The relation keys a read loaded, whichever cardinality they were. */
    const loadedRelations = (one: jest.Mock, many: jest.Mock): string[] => [
        ...one.mock.calls.map(call => call[2] as string),
        ...many.mock.calls.map(call => call[2] as string)
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
        const oneRowService = (row: Record<string, unknown> | undefined) => {
            const chain: any = {
                from: jest.fn(() => chain),
                where: jest.fn(() => chain),
                limit: jest.fn(() => Promise.resolve(row ? [row] : []))
            };
            const db = { select: jest.fn(() => chain) };
            const service = new FetchService(db as any, registry);
            const one = jest.fn().mockResolvedValue(new Map());
            const many = jest.fn().mockResolvedValue(new Map());
            const relations = (service as any).relationService;
            relations.batchFetchRelatedEntities = one;
            relations.batchFetchRelatedEntitiesMany = many;
            return { service, one, many };
        };

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
            const chain: any = {
                from: jest.fn(() => chain),
                $dynamic: jest.fn(() => chain),
                where: jest.fn(() => chain),
                orderBy: jest.fn(() => chain),
                limit: jest.fn(() => chain),
                offset: jest.fn(() => chain),
                then: (resolve: (rows: unknown) => void) => resolve([
                    // node-postgres hands back float8/numeric as a string, which
                    // is exactly the case the coercion exists for.
                    { table_row: { id: 1,
title: "Nearest" },
_distance: "0.25" },
                    { table_row: { id: 2,
title: "Further" },
_distance: 0.5 }
                ])
            };
            const db = { select: jest.fn(() => chain) };
            const service = new FetchService(db as any, registry);

            // Asserted at this seam rather than on the return value: the CMS
            // path parses rows against `properties`, and `_distance` is not a
            // declared property, so it is dropped before a caller could see it.
            // The coercion still has to be right — the rows are ordered by this
            // value, and a string sorts lexicographically ("0.5" < "0.25").
            let handed: Record<string, unknown>[] = [];
            jest.spyOn(service as any, "processRowResults")
                .mockImplementation(async (...args: unknown[]) => {
                    handed = args[0] as Record<string, unknown>[];
                    return handed;
                });

            await service.fetchRowsWithConditions("posts", {
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
