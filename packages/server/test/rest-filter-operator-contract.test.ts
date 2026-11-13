/**
 * The four audit probes, over HTTP.
 *
 * `query-parser.test.ts` pins the parser; this pins the *response*. The whole
 * point of the defect was that a bad operator never reached an error path at
 * all — it reached the driver as a filter — so the assertions that matter are
 * the status code, the envelope, and the fact that the driver was never called
 * with a query built out of the caller's mistake.
 *
 * Against a live server holding one row `{id:1, title:"Hello"}` the old
 * behaviour was:
 *
 *   where={"title":["~~","Nope"]}       → 200, 0 rows
 *   where={"title":["!!","Hello"]}      → 200, 1 row — a FALSE POSITIVE
 *   where={"title":["contains","Hell"]} → 200, 0 rows
 *   where={"id":[">>",0]}               → 500 INTERNAL_ERROR, dbMessage
 *                                         `invalid input syntax for type integer: ">>"`
 */
import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { logger } from "../src/utils/logger";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { tablesFromCollections } from "./helpers/tables";

const collections: LegacyCollectionConfig[] = [
    { slug: "posts", name: "Posts", singularName: "Post", properties: {} }
];

/** The one row the audit ran against. */
const ROW = { id: 1, title: "Hello" };

function harness(): { app: Hono<HonoEnv>; fetches: unknown[] } {
    const fetches: unknown[] = [];
    const driver: DataDriver = {
        key: "postgres",
        initialised: true,
        fetchCollection: async (params) => {
            fetches.push(params);
            return [ROW];
        },
        fetchOne: async () => undefined,
        count: async () => 1,
        save: async () => ({}),
        delete: async () => {},
        checkUniqueField: async () => true,
        admin: {}
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/api/data/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/api/data", new RestApiGenerator(tablesFromCollections(collections), driver).generateRoutes());
    return { app, fetches };
}

async function get(url: string): Promise<{ status: number; json: any; fetches: unknown[] }> {
    const { app, fetches } = harness();
    const res = await app.fetch(new Request(`http://localhost${url}`));
    return { status: res.status, json: JSON.parse(await res.text()), fetches };
}

function where(filter: Record<string, unknown>): string {
    return `/api/data/posts?where=${encodeURIComponent(JSON.stringify(filter))}`;
}

describe("GET /api/data/<collection>?where= with an operator that does not exist", () => {
    const probes: [string, Record<string, unknown>][] = [
        ["~~", { title: ["~~", "Nope"] }],
        ["!!", { title: ["!!", "Hello"] }],
        ["contains", { title: ["contains", "Hell"] }],
        [">>", { id: [">>", 0] }]
    ];

    it.each(probes)("answers 400 UNKNOWN_FILTER_OPERATOR for '%s'", async (operator, filter) => {
        const res = await get(where(filter));

        expect(res.status).toBe(400);
        expect(res.json.error.code).toBe("UNKNOWN_FILTER_OPERATOR");
        expect(res.json.error.message).toContain(`'${operator}'`);
        expect(res.json.error.details.operator).toBe(operator);
        // Nothing reached the driver: the request is refused at the boundary,
        // not compiled into a query whose answer happens to be wrong.
        expect(res.fetches).toEqual([]);
    });

    it("no longer hands back the row a filter was written to exclude", async () => {
        // The dangerous one. `["!!","Hello"]` became `title IN ('!!','Hello')`,
        // which MATCHES — 200, one row, and the caller concluded their filter
        // had been applied.
        const res = await get(where({ title: ["!!", "Hello"] }));
        expect(res.status).not.toBe(200);
        expect(JSON.stringify(res.json)).not.toContain("Hello world");
        expect(res.json.error).toBeDefined();
    });

    it("no longer 500s with a raw Postgres error", async () => {
        const res = await get(where({ id: [">>", 0] }));
        expect(res.status).toBe(400);
        expect(res.json.error.code).not.toBe("INTERNAL_ERROR");
        expect(res.json.error.details.dbMessage).toBeUndefined();
    });

    /**
     * A client typo is not an incident. The request never reached the database
     * and the response body already names what to fix, so `ApiError.expected`
     * puts it at debug — otherwise one frontend holding a stale operator writes
     * a `⚠️` line per request, forever, and warn stops meaning anything.
     */
    it("logs the rejection at debug rather than as an incident", async () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
        const debug = jest.spyOn(logger, "debug").mockImplementation(() => {});
        try {
            await get(where({ title: ["contains", "Hell"] }));
            expect(warn).not.toHaveBeenCalled();
            expect(debug).toHaveBeenCalledTimes(1);
            expect(String(debug.mock.calls[0][0])).toContain("UNKNOWN_FILTER_OPERATOR");
        } finally {
            warn.mockRestore();
            debug.mockRestore();
        }
    });
});

describe("GET /api/data/<collection> — filters that must keep working", () => {
    it("serves a canonical tuple", async () => {
        const res = await get(where({ title: ["==", "Hello"] }));
        expect(res.status).toBe(200);
        expect(res.fetches).toHaveLength(1);
    });

    it("serves a genuine two-item value list", async () => {
        const res = await get(where({ title: ["Hello", "World"] }));
        expect(res.status).toBe(200);
        expect((res.fetches[0] as { filter: unknown }).filter)
            .toEqual({ title: ["in", ["Hello", "World"]] });
    });

    it("serves the PostgREST dot-string dialect", async () => {
        const res = await get("/api/data/posts?title=eq.Hello");
        expect(res.status).toBe(200);
        expect((res.fetches[0] as { filter: unknown }).filter)
            .toEqual({ title: ["==", "Hello"] });
    });

    it("serves repeated dot-string params", async () => {
        const res = await get("/api/data/posts?id=gte.1&id=lt.9");
        expect(res.status).toBe(200);
        expect((res.fetches[0] as { filter: unknown }).filter)
            .toEqual({ id: [[">=", "1"], ["<", "9"]] });
    });

    it("serves repeated plain params as an in-list", async () => {
        const res = await get("/api/data/posts?title=Hello&title=World");
        expect(res.status).toBe(200);
        expect((res.fetches[0] as { filter: unknown }).filter)
            .toEqual({ title: ["in", ["Hello", "World"]] });
    });
});

/**
 * PostgREST's null test and negation, over HTTP. An agent using the MCP
 * `list_documents` tool wrote `difficulty: "is.null"` and got "not a valid
 * smallint" back: it reached the driver as `difficulty = 'is.null'`.
 */
describe("GET /api/data/<collection> — PostgREST spellings this dialect writes differently", () => {
    it.each([
        ["/api/data/posts?difficulty=is.null", "isnull.null"],
        ["/api/data/posts?difficulty=not.is.null", "notnull.null"],
        ["/api/data/posts?status=not.eq.draft", "neq.draft"],
        [where({ difficulty: "is.null" }), "isnull.null"],
        [`/api/data/posts?or=${encodeURIComponent("(difficulty.is.null,difficulty.eq.1)")}`, "difficulty.isnull.null"]
    ])("%s answers 400 naming %s, and never reaches the driver", async (url, spelling) => {
        const res = await get(url);
        expect(res.status).toBe(400);
        expect(res.json.error.code).toBe("UNKNOWN_FILTER_OPERATOR");
        expect(res.json.error.message).toContain(spelling);
        expect(res.fetches).toEqual([]);
    });

    it("serves the spelling that works", async () => {
        const res = await get("/api/data/posts?difficulty=isnull.null");
        expect(res.status).toBe(200);
        expect(res.fetches).toHaveLength(1);
    });
});
