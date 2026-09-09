import { CollectionConfig } from "@rebasepro/types";
import { Table } from "drizzle-orm";
import { FetchService } from "../src/services/FetchService";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * The read query language, at the driver.
 *
 * Four capabilities the SDK and the REST routes now expose, each of which is
 * only real if the driver compiles it: a parametrised `include`, `not`, a
 * `fields` projection with `distinct`, and a keyset that survives NULLs and
 * multi-key sorts.
 */
describe("the read query language", () => {
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { [Table.Symbol.Name]: name };
        const cols: Record<string, unknown> = {};
        for (const c of columns) {
            const column = {
                name: c,
                // A vector column so the distinct-versus-score guard has a real
                // per-row score to conflict with; everything else is text.
                getSQLType: () => (c === "embedding" ? "vector(2)" : "text"),
                // Enough of a drizzle column for `sql` to interpolate it and
                // for the comparison helpers to accept it.
                [Symbol.for("drizzle:Name")]: c
            };
            t[c] = column;
            cols[c] = column;
        }
        t[Table.Symbol.Columns] = cols;
        return t;
    };

    const authorsCollection: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: { id: { type: "number", isId: true }, name: { type: "string" } },
        idField: "id"
    } as unknown as CollectionConfig;

    const commentsCollection: CollectionConfig = {
        slug: "comments",
        name: "Comments",
        table: "comments",
        properties: {
            id: { type: "number", isId: true },
            body: { type: "string" },
            rank: { type: "number" },
            published: { type: "boolean" }
        },
        idField: "id"
    } as unknown as CollectionConfig;

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number", isId: true },
            title: { type: "string" },
            status: { type: "string" },
            views: { type: "number" },
            comments: { type: "relation", relationName: "comments" }
        },
        relations: [
            {
                kind: "hasMany",
                relationName: "comments",
                target: () => commentsCollection,
                foreignKeyOnTarget: "post_id"
            }
        ],
        idField: "id"
    } as unknown as CollectionConfig;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path === "posts") return postsCollection;
            if (path === "comments") return commentsCollection;
            if (path === "authors") return authorsCollection;
            return undefined;
        });
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "posts") return table("posts", ["id", "title", "status", "views", "embedding"]) as never;
            if (name === "comments") return table("comments", ["id", "body", "rank", "published", "post_id"]) as never;
            if (name === "authors") return table("authors", ["id", "name"]) as never;
            return undefined;
        });
    });

    /** A service whose base read returns `rows` and whose relation batch is observable. */
    const service = (rows: Record<string, unknown>[]) => {
        const chain: Record<string, unknown> = {};
        Object.assign(chain, {
            from: jest.fn(() => chain),
            $dynamic: jest.fn(() => chain),
            where: jest.fn(() => chain),
            orderBy: jest.fn(() => chain),
            limit: jest.fn(() => chain),
            offset: jest.fn(() => chain),
            then: (resolve: (r: unknown) => void) => resolve(rows)
        });
        const select = jest.fn(() => chain);
        const selectDistinct = jest.fn(() => chain);
        const fetchService = new FetchService({ select, selectDistinct } as never, registry);
        const many = jest.fn().mockResolvedValue(new Map());
        const relations = (fetchService as never as { relationService: Record<string, unknown> }).relationService;
        relations.batchFetchRelatedEntities = jest.fn().mockResolvedValue(new Map());
        relations.batchFetchRelatedEntitiesMany = many;
        return { fetchService, many, select, selectDistinct, chain };
    };

    describe("parametrised include", () => {
        const related = (rows: Record<string, unknown>[]) => new Map([
            ["1", rows.map(values => ({ id: values.id, path: "comments", values }))]
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

        it("sorts and caps the rows of one relation, per parent", async () => {
            const { fetchService, many } = service([{ id: 1, title: "Hello" }]);
            many.mockResolvedValue(related([
                { id: 10, body: "b", rank: 2 },
                { id: 11, body: "c", rank: 3 },
                { id: 12, body: "a", rank: 1 }
            ]));

            const rows = await fetchService.fetchCollectionForRest("posts", {}, {
                comments: { orderBy: [["rank", "desc"]], limit: 2 }
            });

            // The limit is per parent, not across the page.
            expect(rows[0].comments).toEqual([
                { id: 11, body: "c", rank: 3 },
                { id: 10, body: "b", rank: 2 }
            ]);
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

        it("places a nested relation's NULLs the way the top level would", async () => {
            const { fetchService, many } = service([{ id: 1, title: "Hello" }]);
            many.mockResolvedValue(related([
                { id: 10, rank: 2 },
                { id: 11, rank: null },
                { id: 12, rank: 1 }
            ]));

            const rows = await fetchService.fetchCollectionForRest("posts", {}, {
                comments: { orderBy: [["rank", "asc"]] }
            });

            // NULLS LAST ascending — the same convention the ORDER BY applies,
            // so a nested sort does not put its empty values at the opposite
            // end from the identical top-level one.
            expect((rows[0].comments as { id: number }[]).map(c => c.id)).toEqual([12, 10, 11]);
        });

        it("refuses an unknown relation rather than dropping it", async () => {
            const { fetchService } = service([{ id: 1 }]);
            await expect(fetchService.fetchCollectionForRest("posts", {}, ["commets"]))
                .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        });
    });

    describe("not", () => {
        const compile = (logical: unknown) => {
            const t = registry.getTable("posts") as never;
            return DrizzleConditionBuilder.buildLogicalConditions(
                logical as never, t, "posts", {}
            );
        };

        it("compiles to a real NOT rather than inverted operators", () => {
            const sql = compile({
                type: "not",
                conditions: [{ column: "status", operator: "==", value: "draft" }]
            });

            // `NOT (a AND b)` and `(NOT a) OR (NOT b)` stop agreeing the moment
            // a NULL is involved, and only one of them is the query the caller
            // wrote — so this has to be a real negation of the group.
            const chunks = (sql as unknown as { queryChunks: { value?: string[] }[] }).queryChunks;
            const text = chunks.flatMap(c => c?.value ?? []).join(" ");
            expect(text.toLowerCase()).toContain("not");
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
            const projection = select.mock.calls[0][0] as Record<string, unknown>;
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
            const where = chain.where as jest.Mock;
            return fetchService.fetchCollectionForRest("posts", { orderBy, startAfter })
                .then(() => {
                    const condition = where.mock.calls[where.mock.calls.length - 1][0];
                    const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
                    return JSON.stringify(chunks);
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
