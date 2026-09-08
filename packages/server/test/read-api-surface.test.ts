import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { encodeCursor } from "@rebasepro/common";
import type { DataDriver } from "@rebasepro/types";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * The read side of the HTTP API: the capabilities the SDK exposes and the REST
 * routes had to grow to match.
 *
 * Every one of these was a gap where the parameter existed and did nothing, or
 * did not exist at all and the caller had no way to ask:
 *
 *  - `?after=` — keyset paging was implemented three times and reachable once,
 *    over the WebSocket. REST could not seek, so any client walking a
 *    collection paged by offset and silently skipped or repeated rows around
 *    concurrent writes.
 *  - `?include=` — top-level names only, and an unknown one was *ignored*,
 *    which answers 200 with the field missing.
 *  - `?fields=` — a trim of the response, not a projection.
 *  - `?distinct=`, `?not=`, `orderBy`'s nulls placement — absent entirely.
 *
 * Asserted at the HTTP boundary rather than on the driver, because the thing
 * being tested is the *contract*: what a caller may send and what comes back.
 */
describe("the REST read surface", () => {
    let driver: jest.Mocked<DataDriver>;
    let fetchCollectionForRest: jest.Mock;
    let fetchOneForRest: jest.Mock;
    let cursorFor: jest.Mock;

    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        singularName: "Post",
        properties: {
            id: { name: "Id", type: "string", isId: true },
            title: { name: "Title", type: "string" },
            views: { name: "Views", type: "number" },
            status: { name: "Status", type: "string" }
        }
    } as unknown as CollectionConfig;

    beforeEach(() => {
        fetchCollectionForRest = jest.fn().mockResolvedValue([{ id: "1", title: "Hello" }]);
        fetchOneForRest = jest.fn().mockResolvedValue({ id: "1", title: "Hello" });
        cursorFor = jest.fn().mockReturnValue("CURSOR");

        driver = {
            key: "postgres",
            initialised: true,
            fetchCollection: jest.fn().mockResolvedValue([]),
            fetchOne: jest.fn().mockResolvedValue(null),
            save: jest.fn(),
            delete: jest.fn(),
            count: jest.fn().mockResolvedValue(10),
            restFetchService: { fetchCollectionForRest, fetchOneForRest, cursorFor }
        } as unknown as jest.Mocked<DataDriver>;
    });

    const app = () => {
        const hono = new Hono();
        hono.onError(errorHandler);
        hono.use("/*", async (c, next) => {
            c.set("driver", driver);
            await next();
        });
        hono.route("/", new RestApiGenerator([posts], driver).generateRoutes());
        return hono;
    };

    const get = (url: string) => app().request(url);
    const json = async (url: string) => {
        const res = await get(url);
        return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    /** The options the list route handed the driver. */
    const listOptions = () => fetchCollectionForRest.mock.calls[0][1] as Record<string, unknown>;
    const listInclude = () => fetchCollectionForRest.mock.calls[0][2];

    describe("include", () => {
        it("carries a dotted path as a nested request", async () => {
            await get("/posts?include=author,comments.author");

            expect(listInclude()).toEqual(["author", "comments.author"]);
        });

        it("carries the parametrised JSON form", async () => {
            const spec = { comments: { limit: 5, orderBy: "created_at:desc", include: { author: true } } };
            await get(`/posts?include=${encodeURIComponent(JSON.stringify(spec))}`);

            // Told apart from the flat form by the leading `{`, and handed to
            // the driver whole — the per-relation knobs are the driver's to
            // compile, not this layer's to flatten away.
            expect(listInclude()).toEqual(spec);
        });

        it("refuses a JSON include that is not an object", async () => {
            const { status, body } = await json("/posts?include=%7Bnot-json");
            expect(status).toBe(400);
            expect((body.error as Record<string, unknown>).code).toBe("INVALID_INCLUDE");
        });

        it("refuses a path that nests deeper than the bound", async () => {
            const { status, body } = await json("/posts?include=a.b.c.d");
            expect(status).toBe(400);
            expect((body.error as Record<string, unknown>).code).toBe("INCLUDE_TOO_DEEP");
        });

        it("still accepts the wildcard", async () => {
            await get("/posts?include=*");
            expect(listInclude()).toEqual(["*"]);
        });
    });

    describe("keyset paging", () => {
        const cursor = encodeCursor([["created_at", "desc"]], { created_at: "2026-01-01", id: "9" }, "9")!;

        it("hands the decoded cursor to the driver as a startAfter", async () => {
            await get(`/posts?after=${encodeURIComponent(cursor)}`);

            expect(listOptions().startAfter).toMatchObject({ id: "9" });
            expect(listOptions().offset).toBeUndefined();
        });

        it("adopts the cursor's sort when the request names none", async () => {
            await get(`/posts?after=${encodeURIComponent(cursor)}`);

            // So a caller can hand `meta.nextCursor` straight back without
            // restating the `orderBy` from the previous call.
            expect(listOptions().orderBy).toEqual([["created_at", "desc"]]);
        });

        it("refuses a cursor produced under a different sort", async () => {
            const { status, body } = await json(
                `/posts?after=${encodeURIComponent(cursor)}&orderBy=title:asc`
            );

            // Seeking anyway returns rows in an order nobody asked for, and —
            // worse — looks like it worked.
            expect(status).toBe(400);
            expect((body.error as Record<string, unknown>).code).toBe("CURSOR_ORDER_MISMATCH");
        });

        it("refuses a cursor alongside an offset", async () => {
            const { status, body } = await json(
                `/posts?after=${encodeURIComponent(cursor)}&offset=20`
            );
            expect(status).toBe(400);
            expect((body.error as Record<string, unknown>).code).toBe("CURSOR_WITH_OFFSET");
        });

        it("refuses a cursor it did not issue", async () => {
            const { status, body } = await json("/posts?after=not-a-cursor");
            expect(status).toBe(400);
            expect((body.error as Record<string, unknown>).code).toBe("INVALID_CURSOR");
        });

        it("issues meta.nextCursor while there is a page left", async () => {
            const { body } = await json("/posts?limit=1");
            expect((body.meta as Record<string, unknown>).nextCursor).toBe("CURSOR");
        });

        it("issues no cursor on the last page", async () => {
            driver.count = jest.fn().mockResolvedValue(1) as never;
            const { body } = await json("/posts?limit=1");
            const meta = body.meta as Record<string, unknown>;
            expect(meta.hasMore).toBe(false);
            expect(meta.nextCursor).toBeUndefined();
        });

        it("reads hasMore from a probe row rather than the offset arithmetic", async () => {
            // Every seeked page runs at offset 0, so `offset + rows.length <
            // total` compares one page against the whole collection and says
            // "more" forever. The extra row asked for is the answer instead.
            fetchCollectionForRest.mockResolvedValue([{ id: "1" }, { id: "2" }]);
            const { body } = await json(`/posts?limit=2&after=${encodeURIComponent(cursor)}`);

            expect(listOptions().limit).toBe(3);
            // Two rows came back for a limit of 2, so the probe row was not
            // there: this is the last page.
            expect((body.meta as Record<string, unknown>).hasMore).toBe(false);
            expect((body.data as unknown[]).length).toBe(2);
        });

        it("serves the page without the probe row", async () => {
            fetchCollectionForRest.mockResolvedValue([{ id: "1" }, { id: "2" }, { id: "3" }]);
            const { body } = await json(`/posts?limit=2&after=${encodeURIComponent(cursor)}`);

            expect((body.data as unknown[]).length).toBe(2);
            expect((body.meta as Record<string, unknown>).hasMore).toBe(true);
        });
    });

    describe("fields and distinct", () => {
        it("pushes `fields` to the driver as a projection", async () => {
            await get("/posts?fields=id,title");

            // Not a trim of the response: the columns named are the columns
            // read, which is also what makes `distinct` mean anything.
            expect(listOptions().fields).toEqual(["id", "title"]);
        });

        it("accepts `distinct=true`", async () => {
            await get("/posts?distinct=true&fields=status");
            expect(listOptions().distinct).toBe(true);
        });

        it("refuses a `distinct` that is neither true nor false", async () => {
            // Read as "no", a typo'd `?distinct=ture` returns duplicate rows
            // while looking exactly like it worked.
            const { status, body } = await json("/posts?distinct=ture");
            expect(status).toBe(400);
            expect((body.error as Record<string, unknown>).code).toBe("INVALID_DISTINCT");
        });

        it("does not read `distinct` or `after` as filter fields", async () => {
            // Both are reserved: left off that list they compile as a filter on
            // a column of that name, which is a 400 on the one request that
            // needs the parameter.
            await get("/posts?distinct=false");
            expect(listOptions().filter).toBeUndefined();
        });
    });

    describe("not", () => {
        it("compiles `?not=` into a negated group", async () => {
            await get("/posts?not=" + encodeURIComponent("(status.eq.draft,views.gte.10)"));

            expect(listOptions().logical).toEqual({
                type: "not",
                conditions: [
                    { column: "status", operator: "==", value: "draft" },
                    { column: "views", operator: ">=", value: "10" }
                ]
            });
        });

        it("nests a group inside the negation", async () => {
            await get("/posts?not=" + encodeURIComponent("(or(status.eq.draft,status.eq.review))"));

            expect(listOptions().logical).toMatchObject({
                type: "not",
                conditions: [{ type: "or" }]
            });
        });

        it("keeps `or` winning over `not`", async () => {
            // The precedence `or`/`and` already had, with the third added at
            // the end rather than in the middle, where it would have silently
            // changed which of two existing parameters was honoured.
            await get("/posts?or=" + encodeURIComponent("(status.eq.draft)")
                + "&not=" + encodeURIComponent("(status.eq.review)"));

            expect((listOptions().logical as Record<string, unknown>).type).toBe("or");
        });
    });

    describe("orderBy nulls placement", () => {
        it("reads the third segment of the shorthand", async () => {
            await get("/posts?orderBy=published_at:desc:last");

            // The default puts every row with no date at the very top of a
            // "newest first" list, and the only escape used to be an
            // `is-not-null` filter that dropped those rows entirely.
            expect(listOptions().orderBy).toEqual([["published_at", "desc", "last"]]);
        });

        it("reads `nulls` from the JSON array form", async () => {
            const spec = [{ field: "published_at", direction: "desc", nulls: "last" }];
            await get(`/posts?orderBy=${encodeURIComponent(JSON.stringify(spec))}`);

            expect(listOptions().orderBy).toEqual([["published_at", "desc", "last"]]);
        });

        it("leaves a sort without one exactly as it was", async () => {
            await get("/posts?orderBy=title:desc");
            expect(listOptions().orderBy).toEqual([["title", "desc"]]);
        });

        it("refuses a placement that is not first or last", async () => {
            const { status, body } = await json("/posts?orderBy=title:desc:middle");
            expect(status).toBe(400);
            expect((body.error as Record<string, unknown>).code).toBe("INVALID_ORDER_BY");
        });
    });

    describe("get by id", () => {
        it("takes the same include spelling the list route does", async () => {
            await get("/posts/1?include=comments.author");
            expect(fetchOneForRest.mock.calls[0][2]).toEqual(["comments.author"]);
        });

        it("pushes `fields` down rather than trimming the response", async () => {
            await get("/posts/1?fields=id,title");
            expect(fetchOneForRest.mock.calls[0][4]).toEqual({ fields: ["id", "title"] });
        });
    });
});
