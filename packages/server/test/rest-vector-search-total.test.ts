/**
 * `meta.total` and `meta.hasMore` under a vector-search threshold, over HTTP.
 *
 * `countRawEntities` forwarded `filter`, `logical` and `searchString` to
 * `driver.count` and dropped `vectorSearch`. A `threshold` is not a hint — it
 * is a WHERE clause on the fetch path — so a similarity-filtered listing was
 * served narrowed rows beside the count of the *unfiltered* set:
 *
 *   GET /api/data/docs?vector_search=embedding&vector=[…]&vector_threshold=0.2
 *     → data: 3 rows, meta.total: 25, meta.hasMore: true
 *
 * and paging forward then handed back empty pages while `hasMore` stayed true,
 * until the offset walked past the inflated total.
 *
 * The fake driver below is the contract the Postgres driver now honours: its
 * `count` applies the same threshold its `fetchCollection` does. The assertions
 * are on the envelope, not on the SQL — the point is that `total` describes the
 * rows in `data`.
 */
import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { CollectionConfig } from "../../types/src/types/collections";
import { VectorSearchParams } from "../../types/src/controllers/data_driver";

const collections = [
    { slug: "docs", name: "Docs", singularName: "Doc", properties: {} }
] as unknown as CollectionConfig[];

/**
 * 25 rows matching the plain filter; distances spread so exactly 3 sit under
 * 0.2 and 8 under 0.5. The list route's default limit for a vector search is
 * 10, so with no threshold the first page is limited but `total` is still 25.
 */
const ROWS = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    title: `Doc ${i + 1}`,
    _distance: i * 0.075
}));

function withinThreshold(vectorSearch?: VectorSearchParams) {
    if (!vectorSearch || vectorSearch.threshold == null) return ROWS;
    return ROWS.filter(r => r._distance < vectorSearch.threshold!);
}

type Recorded = { fetches: unknown[]; counts: unknown[] };

function harness(): { app: Hono; recorded: Recorded } {
    const recorded: Recorded = { fetches: [], counts: [] };

    const driver = {
        key: "postgres",
        initialised: true,
        fetchCollection: async (params: { vectorSearch?: VectorSearchParams; limit?: number; offset?: number }) => {
            recorded.fetches.push(params);
            const matching = withinThreshold(params.vectorSearch);
            // `?offset=` reaches the driver as `offset`. It used to be
            // stringified into `startAfter` — a cursor *row* — which is the bug
            // fixed in "fix(rest): `?offset=` became a cursor value on every
            // non-Postgres driver". Reading `startAfter` here would page off a
            // value the route no longer sends, and every page would be page one.
            const offset = params.offset ?? 0;
            return matching.slice(offset, params.limit ? offset + params.limit : undefined);
        },
        fetchOne: async () => undefined,
        // The whole point: this driver's count sees the threshold the fetch saw.
        count: async (params: { vectorSearch?: VectorSearchParams }) => {
            recorded.counts.push(params);
            return withinThreshold(params.vectorSearch).length;
        },
        save: async () => ({}),
        delete: async () => {},
        admin: {}
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/api/data/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/api/data", new RestApiGenerator(collections, driver).generateRoutes());
    return { app, recorded };
}

async function get(url: string): Promise<{ status: number; json: any; recorded: Recorded }> {
    const { app, recorded } = harness();
    const res = await app.fetch(new Request(`http://localhost${url}`));
    return { status: res.status, json: JSON.parse(await res.text()), recorded };
}

/** `?vector_search=…&vector=…` plus an optional threshold and paging. */
function vectorUrl(extra = ""): string {
    const vector = encodeURIComponent(JSON.stringify([0.1, 0.2, 0.3]));
    return `/api/data/docs?vector_search=embedding&vector=${vector}${extra}`;
}

describe("GET /api/data/<collection> with a vector-search threshold", () => {
    it("forwards vectorSearch to the driver's count, not just its fetch", async () => {
        const res = await get(vectorUrl("&vector_threshold=0.2"));

        expect(res.status).toBe(200);
        expect(res.recorded.counts).toHaveLength(1);
        expect((res.recorded.counts[0] as { vectorSearch?: VectorSearchParams }).vectorSearch)
            .toEqual({ property: "embedding", vector: [0.1, 0.2, 0.3], distance: "cosine", threshold: 0.2 });
    });

    it("reports the size of the similarity-filtered set, not the unfiltered one", async () => {
        const res = await get(vectorUrl("&vector_threshold=0.2"));

        expect(res.json.data).toHaveLength(3);
        // 25 was the old answer: every row matching the plain filter.
        expect(res.json.meta.total).toBe(3);
        expect(res.json.meta.hasMore).toBe(false);
    });

    it("does not claim another page exists once the threshold is exhausted", async () => {
        // Under the old behaviour this page was empty and `hasMore` was still
        // true, because `0 + 0 < 25`.
        const res = await get(vectorUrl("&vector_threshold=0.2&limit=3&offset=3"));

        expect(res.json.data).toHaveLength(0);
        expect(res.json.meta.total).toBe(3);
        expect(res.json.meta.hasMore).toBe(false);
    });

    it("still pages a threshold wide enough to leave a second page", async () => {
        // 7 rows under 0.5, served 3 at a time: the first page genuinely has
        // more behind it, and `hasMore` has to keep saying so.
        const first = await get(vectorUrl("&vector_threshold=0.5&limit=3"));
        expect(first.json.data).toHaveLength(3);
        expect(first.json.meta.total).toBe(7);
        expect(first.json.meta.hasMore).toBe(true);

        const last = await get(vectorUrl("&vector_threshold=0.5&limit=3&offset=6"));
        expect(last.json.data).toHaveLength(1);
        expect(last.json.meta.total).toBe(7);
        expect(last.json.meta.hasMore).toBe(false);
    });

    /**
     * Without a `threshold` a vector search only reorders — it drops nothing —
     * so `total` is the whole matching set even though the page is capped at
     * the vector-mode default of 10. This is the case the fix must not change.
     */
    it("leaves an unthresholded vector search counting every matching row", async () => {
        const res = await get(vectorUrl());

        expect(res.json.data).toHaveLength(10);
        expect(res.json.meta.total).toBe(25);
        expect(res.json.meta.hasMore).toBe(true);
    });
});

describe("GET /api/data/<collection>/count with a vector-search threshold", () => {
    it("answers the narrowed count", async () => {
        const res = await get("/api/data/docs/count?vector_search=embedding"
            + `&vector=${encodeURIComponent(JSON.stringify([0.1, 0.2, 0.3]))}&vector_threshold=0.2`);

        expect(res.status).toBe(200);
        expect(res.json.count).toBe(3);
    });
});
