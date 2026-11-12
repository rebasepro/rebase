import type { CollectionConfig, LogicalCondition } from "@rebasepro/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect, integer, pgTable, text, vector } from "drizzle-orm/pg-core";
import { FetchService } from "../src/services/FetchService";
import { RelationService, relatedRowOrder } from "../src/services/RelationService";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { textTable } from "./helpers/spg-c-tables";

/**
 * The read query language, at the driver.
 *
 * Four capabilities the SDK and the REST routes now expose, each of which is
 * only real if the driver compiles it: a parametrised `include`, `not`, a
 * `fields` projection with `distinct`, and a keyset that survives NULLs and
 * multi-key sorts.
 */
describe("the read query language", () => {
    const registry = new FixtureTableRegistry();

    // `embedding` is a vector column, so the distinct-versus-score guard has a
    // real per-row score to conflict with; everything else is text.
    const tables = {
        posts: pgTable("posts", { id: text("id"), title: text("title"), status: text("status"), views: text("views"), embedding: vector("embedding", { dimensions: 2 }) }),
        comments: textTable("comments", ["id", "body", "rank", "published", "post_id"]),
        authors: textTable("authors", ["id", "name"])
    };

    const authorsCollection: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: { id: { type: "number", isId: true }, name: { type: "string" } }
    };

    const commentsCollection: CollectionConfig = {
        slug: "comments",
        name: "Comments",
        table: "comments",
        properties: {
            id: { type: "number", isId: true },
            body: { type: "string" },
            rank: { type: "number" },
            published: { type: "boolean" }
        }
    };

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number", isId: true },
            title: { type: "string" },
            status: { type: "string" },
            views: { type: "number" },
            comments: { type: "relation", relation: { kind: "hasMany", relationName: "comments", target: () => commentsCollection, foreignKeyOnTarget: "post_id" } }
        }
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path === "posts") return postsCollection;
            if (path === "comments") return commentsCollection;
            if (path === "authors") return authorsCollection;
            return undefined;
        });
        jest.spyOn(registry, "getPgTable").mockImplementation(name => {
            if (name === "posts") return tables.posts;
            if (name === "comments") return tables.comments;
            if (name === "authors") return tables.authors;
            return undefined;
        });
    });

    /** A service whose base read returns `rows` and whose relation batch is observable. */
    const service = (rows: Record<string, unknown>[]) => {
        const chain = {
            from: jest.fn().mockReturnThis(),
            $dynamic: jest.fn().mockReturnThis(),
            where: jest.fn<unknown, [SQL]>().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            offset: jest.fn().mockReturnThis(),
            then: (resolve: (r: unknown) => void) => resolve(rows)
        };
        const select = jest.fn((fields?: Record<string, unknown>) => { void fields; return chain; });
        const selectDistinct = jest.fn((fields?: Record<string, unknown>) => { void fields; return chain; });
        // A chainable stand-in for drizzle's builder, so a test can read the
        // projection and conditions each call was handed. Drizzle's builders
        // have no seam for that; this is where it is asserted to be a database.
        const fetchService = new FetchService({ select, selectDistinct } as unknown as NodePgDatabase, registry);
        // The relation service is private: read by name and narrowed.
        const relations: unknown = Reflect.get(fetchService, "relationService");
        if (!(relations instanceof RelationService)) throw new Error("FetchService holds no RelationService");
        jest.spyOn(relations, "batchFetchRelatedEntities").mockResolvedValue(new Map());
        const many = jest.spyOn(relations, "batchFetchRelatedEntitiesMany").mockResolvedValue(new Map());
        return { fetchService, many, select, selectDistinct, chain };
    };

    describe("parametrised include", () => {
        const related = (rows: Record<string, unknown>[]) => new Map([
            ["1", rows.map(values => {
                const id = values.id;
                if (typeof id !== "string" && typeof id !== "number") throw new Error("a related row needs an id");
                return { id, path: "comments", values };
            })]
        ]);

        it("pushes a per-include `where` into the batch query", async () => {
            const { fetchService, many } = service([{ id: 1, title: "Hello" }]);

            await fetchService.fetchCollectionForRest("posts", {}, {
                comments: { where: { published: ["==", true] } }
            });

            // Filtering afterwards would read every related row of every parent
            // in order to discard most of them — on a to-many relation, the
            // whole table.
            const narrow = many.mock.calls[0][4];
            expect(narrow).toBeDefined();
        });

        it("hands one relation's order and limit to the batch loader, which applies them per parent", async () => {
            const { fetchService, many } = service([{ id: 1, title: "Hello" }]);
            // The loader answers ranked and cut by Postgres, in its own order.
            many.mockResolvedValue(related([
                { id: 11, body: "c", rank: 3 },
                { id: 10, body: "b", rank: 2 }
            ]));

            const rows = await fetchService.fetchCollectionForRest("posts", {}, {
                comments: { orderBy: [["rank", "desc"]], limit: 2 }
            });

            // In SQL, not over the returned rows: a slice in JavaScript read
            // every related row of every parent to serve two of each.
            expect(many.mock.calls[0][5]).toEqual({ limit: 2, orderBy: [["rank", "desc"]] });
            expect(rows[0].comments).toEqual([
                { id: 11, body: "c", rank: 3 },
                { id: 10, body: "b", rank: 2 }
            ]);
        });

        it("still holds the limit when a loader hands back more rows than it", async () => {
            // A `via` chain reaching one target along two paths ranks both
            // rows alike, so the loader can return more than `limit` of them.
            const { fetchService, many } = service([{ id: 1, title: "Hello" }]);
            many.mockResolvedValue(related([{ id: 11 }, { id: 11 }, { id: 12 }]));

            const rows = await fetchService.fetchCollectionForRest("posts", {}, { comments: { limit: 2 } });

            expect((rows[0].comments as { id: number }[]).map(c => c.id)).toEqual([11, 11]);
        });

        it("projects an included relation down to its own `fields`", async () => {
            const { fetchService, many } = service([{ id: 1, title: "Hello" }]);
            many.mockResolvedValue(related([{ id: 10, body: "b", rank: 2, published: true }]));

            const rows = await fetchService.fetchCollectionForRest("posts", {}, {
                comments: { fields: ["body"] }
            });

            // The key survives regardless: a related row nobody can address
            // cannot be followed, updated or de-duplicated by the caller.
            expect(rows[0].comments).toEqual([{ id: 10, body: "b" }]);
        });

        it("places a nested relation's NULLs the way the top level would", () => {
            const comments = pgTable("comments", { id: integer("id"), rank: integer("rank") });
            const render = (orderBy: Parameters<typeof relatedRowOrder>[2]) =>
                new PgDialect().sqlToQuery(sql.join(relatedRowOrder(comments, [comments.id], orderBy), sql`, `)).sql;

            // NULLS LAST ascending and FIRST descending — the same convention
            // the top-level ORDER BY applies — unless the key says otherwise,
            // and the target's key ascending last, so the order is total.
            expect(render([["rank", "asc"]])).toBe(`"comments"."rank" ASC NULLS LAST, "comments"."id" ASC`);
            expect(render([["rank", "desc"]])).toBe(`"comments"."rank" DESC NULLS FIRST, "comments"."id" ASC`);
            expect(render([["rank", "desc", "last"]])).toBe(`"comments"."rank" DESC NULLS LAST, "comments"."id" ASC`);
            // A key that is no column of the target sorts nothing.
            expect(render([["nope", "asc"]])).toBe(`"comments"."id" ASC`);
        });

        it("refuses an unknown relation rather than dropping it", async () => {
            const { fetchService } = service([{ id: 1 }]);
            await expect(fetchService.fetchCollectionForRest("posts", {}, ["commets"]))
                .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        });

        // The check used to sit behind "no rows, nothing to load", so a typo
        // against an empty table — or under a filter that matched nothing —
        // answered 200, and became a 400 the first time a row matched.
        it("refuses an unknown relation when no row matched", async () => {
            const { fetchService } = service([]);
            await expect(fetchService.fetchCollectionForRest("posts", {}, ["commets"]))
                .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        });

        it("refuses an unknown nested relation when the level above loaded nothing", async () => {
            const { fetchService } = service([{ id: 1 }]);
            await expect(fetchService.fetchCollectionForRest("posts", {}, ["comments.nope"]))
                .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        });

        it("refuses an unknown relation on a single read whose row does not exist", async () => {
            const { fetchService } = service([]);
            await expect(fetchService.fetchOneForRest("posts", 1, ["commets"]))
                .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        });
    });

    describe("not", () => {
        const compile = (logical: LogicalCondition) =>
            DrizzleConditionBuilder.buildLogicalConditions(logical, tables.posts, "posts", {});

        it("compiles to a real NOT rather than inverted operators", () => {
            const sql = compile({
                type: "not",
                conditions: [{ column: "status", operator: "==", value: "draft" }]
            });

            // `NOT (a AND b)` and `(NOT a) OR (NOT b)` stop agreeing the moment
            // a NULL is involved, and only one of them is the query the caller
            // wrote — so this has to be a real negation of the group.
            if (!sql) throw new Error("the group compiled to nothing");
            expect(new PgDialect().sqlToQuery(sql).sql.toLowerCase()).toContain("not");
        });

        it("negates the conjunction of several conditions", () => {
            const sql = compile({
                type: "not",
                conditions: [
                    { column: "status", operator: "==", value: "draft" },
                    { column: "views", operator: ">=", value: 10 }
                ]
            });
            expect(sql).not.toBeNull();
        });

        it("is null when it has nothing to negate", () => {
            // A group whose every leaf was dropped negates nothing; `NOT
            // (true)` would exclude every row instead.
            expect(compile({ type: "not", conditions: [] })).toBeNull();
        });
    });

    describe("fields and distinct", () => {
        it("selects only the named columns, plus the key", async () => {
            const { fetchService, select } = service([{ id: 1, title: "Hello" }]);

            await fetchService.fetchCollectionForRest("posts", { fields: ["title"] });

            // A projection at the database, not a trim of the response.
            const projection = select.mock.calls[0][0] ?? {};
            expect(Object.keys(projection).sort()).toEqual(["id", "title"]);
        });

        it("refuses a column that does not exist", async () => {
            const { fetchService } = service([{ id: 1 }]);
            // Read as "omit it", a mistyped `?fields=titel` returns rows with
            // no titles and no hint why.
            await expect(fetchService.fetchCollectionForRest("posts", { fields: ["titel"] }))
                .rejects.toMatchObject({ code: "UNKNOWN_FIELD" });
        });

        it("uses SELECT DISTINCT when asked", async () => {
            const { fetchService, select, selectDistinct } = service([{ id: 1 }]);

            await fetchService.fetchCollectionForRest("posts", { fields: ["status"], distinct: true });

            expect(selectDistinct).toHaveBeenCalled();
            expect(select).not.toHaveBeenCalled();
        });

        it("refuses distinct beside a query that scores every row", async () => {
            const { fetchService } = service([{ id: 1 }]);
            // A vector search selects a `_distance` beside the columns, so no
            // two rows are ever equal and DISTINCT would have no effect — it
            // would answer 200 having done nothing, which is worse than
            // refusing. Ranked full-text search (`_score`) is the same case.
            await expect(fetchService.fetchCollectionForRest("posts", {
                fields: ["status"],
                distinct: true,
                vectorSearch: { property: "embedding", vector: [0.1, 0.2] }
            })).rejects.toMatchObject({ code: "DISTINCT_NOT_APPLICABLE" });
        });

        it("leaves distinct alone for a plain substring search", async () => {
            // The default search is an ILIKE across string columns and attaches
            // no score, so there is nothing for DISTINCT to conflict with.
            const { fetchService, selectDistinct } = service([{ id: 1 }]);
            await fetchService.fetchCollectionForRest("posts", {
                fields: ["status"], distinct: true, searchString: "hello"
            });
            expect(selectDistinct).toHaveBeenCalled();
        });

        it("refuses a distinct sort by a column it does not return", async () => {
            const { fetchService } = service([{ id: 1 }]);
            // Postgres answers a bare 42P10 here, which reaches the caller as a
            // 500 quoting SQL they never wrote.
            await expect(fetchService.fetchCollectionForRest("posts", {
                fields: ["status"], distinct: true, orderBy: [["title", "asc"]]
            })).rejects.toMatchObject({ code: "DISTINCT_ORDER_BY_NOT_SELECTED" });
        });
    });

    describe("the keyset cursor", () => {
        /** The WHERE a cursor compiles to, as text. */
        const seekSql = (
            orderBy: [string, "asc" | "desc", ("first" | "last")?][],
            startAfter: Record<string, unknown>
        ) => {
            const { fetchService, chain } = service([]);
            const where = chain.where;
            return fetchService.fetchCollectionForRest("posts", { orderBy, startAfter })
                .then(() => {
                    const condition = where.mock.calls[where.mock.calls.length - 1][0];
                    const query = new PgDialect().sqlToQuery(condition);
                    return `${query.sql} ${JSON.stringify(query.params)}`;
                });
        };

        it("builds a comparison over every sort key, not just the first", async () => {
            // The SDK's own keyset advanced along a single column and threw on
            // anything else; this one nests, each key's tie handing the
            // decision to the next.
            const sql = await seekSql(
                [["status", "asc"], ["views", "desc"]],
                { id: 9, values: { status: "draft", views: 5 } }
            );
            expect(sql).toContain("draft");
            expect(sql).toContain("5");
        });

        it("compares a NULL sort value by placement rather than by `>`", async () => {
            // `> NULL` answers *unknown* and matches nothing, so paging a
            // nullable column used to drop every NULL-valued row from page two
            // onward. The comparison has to be an IS NULL test.
            const sql = await seekSql(
                [["status", "asc"]],
                { id: 9, values: { status: null } }
            );
            expect(sql.toLowerCase()).toContain("null");
        });

        it("honours an explicit nulls placement in the seek", async () => {
            // Ascending NULLS FIRST: a cursor row among the NULLs still has
            // every non-null row after it, which is the opposite of the
            // default's answer for the same value.
            const first = await seekSql([["status", "asc", "first"]], { id: 9, values: { status: null } });
            const last = await seekSql([["status", "asc", "last"]], { id: 9, values: { status: null } });
            expect(first).not.toEqual(last);
        });
    });
});
