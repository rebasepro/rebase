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

    describe("junction relations are nested, plain ones are not", () => {

        /** A FetchService whose `posts` query builder records what it was asked for. */
        const setup = (rows: Record<string, unknown>[] = []) => {
            const findMany = jest.fn().mockResolvedValue(rows);
            const db = { query: { posts: { findMany } } };
            return { service: new FetchService(db as any, registry),
findMany };
        };

        it("nests a many-to-many through its junction and leaves a belongsTo flat", async () => {
            const { service, findMany } = setup();

            await service.fetchCollectionForRest("posts", {}, ["tags", "author"]);

            // The two shapes are the whole point of the branch. `tags` reaches
            // its targets through `posts_tags`, so Drizzle needs a second level
            // of `with` to get past the junction row; `author` is a foreign key
            // on this very table and needs none. Collapse the distinction and a
            // m2m read returns the junction rows themselves — `{ post_id, tag_id }`
            // instead of the tags — with no error anywhere to say so.
            expect(findMany).toHaveBeenCalledTimes(1);
            expect(findMany.mock.calls[0][0].with).toEqual({
                tags: { with: { tag_id: true } },
                author: true
            });
        });

        it("nests nothing for a relation that is not a junction", async () => {
            const { service, findMany } = setup();

            await service.fetchCollectionForRest("posts", {}, ["author"]);

            expect(findMany.mock.calls[0][0].with).toEqual({ author: true });
        });
    });

    describe("fetchOneForRest eager-loads only what `include` asks for", () => {

        /** `select` is only reached if the relational path bails; it returns nothing. */
        const setup = (row: Record<string, unknown> | undefined) => {
            const findFirst = jest.fn().mockResolvedValue(row);
            const chain: any = {
                from: jest.fn(() => chain),
                where: jest.fn(() => chain),
                limit: jest.fn(() => Promise.resolve([]))
            };
            const db = {
                query: { posts: { findFirst } },
                select: jest.fn(() => chain)
            };
            return { service: new FetchService(db as any, registry),
findFirst };
        };

        it("builds a `with` config for a non-empty include", async () => {
            const { service, findFirst } = setup({ id: 1,
title: "Hello" });

            await service.fetchOneForRest("posts", 1, ["author"]);

            expect(findFirst.mock.calls[0][0].with).toEqual({ author: true });
        });

        it("omits `with` entirely for an empty include", async () => {
            const { service, findFirst } = setup({ id: 1,
title: "Hello" });

            await service.fetchOneForRest("posts", 1, []);

            // `include: []` means "no relations", not "all of them". The empty
            // array is still truthy, so only the length test keeps it from
            // reaching `buildWithConfig`, which reads an empty include as
            // "include everything" — the request would silently JOIN every
            // relation on the collection and pay for all of them.
            expect(findFirst).toHaveBeenCalledTimes(1);
            expect(findFirst.mock.calls[0][0]).not.toHaveProperty("with");
        });

        it("omits `with` entirely when include is absent", async () => {
            const { service, findFirst } = setup({ id: 1,
title: "Hello" });

            await service.fetchOneForRest("posts", 1, undefined);

            // The undefined check has to come first: reading `.length` off an
            // absent include throws inside the try, and the catch downgrades
            // that to a warning and a fallback db.select — a silently slower
            // read that still answers 200.
            expect(findFirst).toHaveBeenCalledTimes(1);
            expect(findFirst.mock.calls[0][0]).not.toHaveProperty("with");
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
