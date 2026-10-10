import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import { createRebaseClient, type FindParams } from "@rebasepro/client";
import { buildSdkData, cond, encodeCursor, or } from "@rebasepro/common";
import { DEFAULT_LIST_LIMIT, type CollectionConfig, type DataDriver } from "@rebasepro/types";

import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";

/**
 * One `find()`, two doors: the SDK over HTTP, and the in-process data plane a
 * function or a cron is handed (`buildSdkData`, the `rebase.data` of a
 * handler). Both take the same `FindParams`, and the docs describe one query
 * language — so for any of them the driver must be asked the same question
 * through either door.
 *
 * It was not. The in-process `find()` hand-listed the options it forwarded and
 * left out `vectorSearch` and `searchExplain`: `.vectorSearch(…).find()` inside
 * a function returned the newest rows in id order, no `_distance`, no error —
 * the read the caller asked for, minus the only part that made it a search. Its
 * count was taken beside a distinct read and a thresholded vector search, which
 * the HTTP listing deliberately does not count, and so reported a total for a
 * set of rows other than the one it served.
 *
 * Each case below runs through the real client and the real REST router on one
 * recording driver, then through `buildSdkData` on another, and compares what
 * each driver was asked: the page read (options and include) and the count.
 */

const authors = {
    slug: "authors", name: "Authors", table: "authors",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" }
    }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts", name: "Posts", table: "posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        status: { type: "string" },
        views: { type: "number" },
        embedding: { type: "vector", dimensions: 3 },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } }
    }
} as unknown as CollectionConfig;

const ROWS = [
    { id: 3, title: "c", status: "draft", views: 30 },
    { id: 2, title: "b", status: "published", views: 20 },
    { id: 1, title: "a", status: "published", views: 10 }
];

interface Asked {
    page: unknown[][];
    count: Record<string, unknown>[];
}

/** A driver that answers three rows and a count of 42, and writes down the reads it is asked for. */
function recordingDriver(): { driver: DataDriver; asked: Asked } {
    const asked: Asked = { page: [], count: [] };
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const driver = {
        key: "postgres",
        initialised: true,
        restFetchService: {
            async fetchCollectionForRest(...args: unknown[]) {
                asked.page.push(clone(args));
                // `fields` is a projection the driver pushes into the SELECT;
                // a distinct read leaves the key out of it.
                const { fields, distinct } = (args[1] ?? {}) as { fields?: string[]; distinct?: boolean };
                const columns = fields ? [...new Set([...(distinct ? [] : ["id"]), ...fields])] : undefined;
                return ROWS.map(row => columns
                    ? Object.fromEntries(columns.map(column => [column, row[column as keyof typeof row]]))
                    : { ...row });
            },
            async fetchOneForRest() {
                return undefined;
            },
            cursorFor: (_path: string, row: Record<string, unknown>) => encodeCursor(undefined, row, row.id)
        },
        async count(props: Record<string, unknown>) {
            // The HTTP door also hands the collection's config; the question is the rest.
            const { collection: _collection, ...question } = props;
            asked.count.push(clone(question));
            return 42;
        },
        async fetchCollection() {
            throw new Error("a driver with a REST pipeline is read through it");
        },
        async fetchOne() {
            return undefined;
        },
        save: async () => ({}),
        delete: async () => undefined
    } as unknown as DataDriver;
    return { driver, asked };
}

function overHttp(driver: DataDriver) {
    const app = new Hono();
    app.onError(errorHandler as never);
    app.use("/*", async (c, next) => {
        c.set("driver" as never, driver as never);
        c.set("user" as never, { uid: "user-1", roles: [] } as never);
        await next();
    });
    app.route("/api/data", new RestApiGenerator([authors, posts], driver).generateRoutes() as never);
    return createRebaseClient({
        baseUrl: "http://rebase.test",
        realtime: false,
        token: "t",
        fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
            app.request(String(input).replace("http://rebase.test", ""), init)) as typeof fetch
    }).data.collection("posts");
}

/**
 * What was asked, without what the two doors spell differently and the driver
 * reads the same way:
 *
 * - a filter value: the URL carries `"10"` where in-process code passes `10`,
 *   and the driver casts either to the column's type;
 * - `searchExplain: false`, the HTTP door's "not asked", which the in-process
 *   door leaves unset;
 * - a vector search's `distance`, which the HTTP parser defaults to `cosine`
 *   and the driver defaults to `cosine` when it arrives unset.
 */
function question(asked: Asked): Asked {
    const spelled = (value: unknown): unknown =>
        Array.isArray(value) ? value.map(spelled)
            : value !== null && typeof value === "object"
                ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, spelled(inner)]))
                : typeof value === "number" || typeof value === "boolean" ? String(value) : value;
    const read = (options: Record<string, unknown>): Record<string, unknown> => {
        const out = { ...options };
        if (out.filter) out.filter = spelled(out.filter);
        if (out.logical) out.logical = spelled(out.logical);
        if (out.searchExplain === false) delete out.searchExplain;
        const vectorSearch = out.vectorSearch as Record<string, unknown> | undefined;
        if (vectorSearch) out.vectorSearch = { distance: "cosine", ...vectorSearch };
        return out;
    };
    return {
        page: asked.page.map(([path, options, include]) => [path, read(options as Record<string, unknown>), include]),
        count: asked.count.map(read)
    };
}

const cursor = encodeCursor(undefined, { id: 2 }, 2)!;
const longIn = Array.from({ length: 1200 }, (_, i) => i + 1);

/** `[name, params]` — every `FindParams` field, alone or in the combinations whose counting differs. */
const MATRIX: [string, FindParams][] = [
    ["no parameters", {}],
    ["limit and offset", { limit: 2, offset: 1 }],
    ["page", { page: 2, limit: 2 }],
    ["orderBy", { orderBy: [["views", "desc"], ["title", "asc"]] }],
    ["where, one field twice", { where: { status: ["==", "published"], views: [[">=", 10], ["<", 99]] } }],
    ["logical group", { logical: or(cond("status", "==", "draft"), cond("views", ">=", 25)) }],
    ["include", { include: ["author"] }],
    ["fields", { fields: ["id", "status"] }],
    ["fields and distinct", { fields: ["status"], distinct: true }],
    ["count none", { count: "none", limit: 2 }],
    ["cursor", { after: cursor, limit: 2 }],
    ["search with explain", { searchString: "hello", searchExplain: true }],
    ["vector search", { vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3], distance: "l2" }, limit: 2 }],
    ["vector search without a limit", { vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3] } }],
    ["vector search with a threshold", {
        vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3], distance: "cosine", threshold: 0.5 },
        limit: 2
    }],
    ["vector search beside a filter", {
        vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3] },
        where: { status: ["==", "published"] },
        limit: 2
    }],
    ["an `in` list too long for a URL", { where: { id: ["in", longIn] } }]
];

describe("find() asks the driver the same thing in-process as over HTTP", () => {
    it.each(MATRIX)("%s", async (_name, params) => {
        const http = recordingDriver();
        const local = recordingDriver();

        const overWire = await overHttp(http.driver).find(params);
        const inProcess = await buildSdkData(local.driver).collection("posts").find(params);

        expect(question(local.asked)).toEqual(question(http.asked));
        expect(http.asked.page).toHaveLength(1);

        // The same page, and the same answer to "is there more".
        expect(inProcess.data).toEqual(overWire.data);
        expect(inProcess.meta.hasMore).toBe(overWire.meta.hasMore);
        expect(inProcess.meta.nextCursor).toBe(overWire.meta.nextCursor);
        // A total wherever HTTP counted, from the same count.
        if (overWire.meta.total !== undefined) expect(inProcess.meta.total).toBe(overWire.meta.total);
    });

    it("forwards the vector search itself, not only its count", async () => {
        const { driver, asked } = recordingDriver();
        await buildSdkData(driver).collection("posts")
            .vectorSearch("embedding", [0.1, 0.2, 0.3], { distance: "cosine" })
            .limit(2)
            .find();

        expect(asked.page[0][1]).toMatchObject({
            vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3], distance: "cosine" }
        });
    });

    it("does not count a distinct read or a thresholded vector search, as the HTTP listing does not", async () => {
        for (const params of [
            { fields: ["status"], distinct: true },
            { vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3], threshold: 0.5 }, limit: 2 }
        ] satisfies FindParams[]) {
            const { driver, asked } = recordingDriver();
            const { meta } = await buildSdkData(driver).collection("posts").find(params);
            expect({ params, counts: asked.count.length }).toEqual({ params, counts: 0 });
            // Asked for one row past the page instead, so `hasMore` is still known.
            expect(asked.page[0][1]).toMatchObject({ limit: (params.limit ?? DEFAULT_LIST_LIMIT) + 1 });
            expect(meta.hasMore).toBe(ROWS.length > (params.limit ?? DEFAULT_LIST_LIMIT));
        }
    });
});

describe("count() counts the same rows in-process as over HTTP", () => {
    it.each([
        ["no parameters", {}],
        ["where and a logical group", {
            where: { status: ["==", "published"] },
            logical: or(cond("views", ">=", 25), cond("views", "<", 5))
        }],
        ["search", { searchString: "hello" }],
        ["vector search with a threshold", {
            vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3], threshold: 0.5 }
        }]
    ] satisfies [string, FindParams][])("%s", async (_name, params) => {
        const http = recordingDriver();
        const local = recordingDriver();

        const overWire = await overHttp(http.driver).count(params);
        const inProcess = await buildSdkData(local.driver).collection("posts").count!(params);

        expect(question(local.asked).count).toEqual(question(http.asked).count);
        expect(http.asked.count).toHaveLength(1);
        expect(inProcess).toBe(overWire);
    });
});
