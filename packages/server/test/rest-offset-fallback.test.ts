/**
 * `?offset=` on the driver-agnostic list path.
 *
 * Two code paths serve `GET /api/data/<collection>`: `restFetchService` when
 * the driver has one (Postgres), and `fetchRawCollection` for everything else —
 * mongo, firebase, anything a developer registers. The first passed `offset`
 * straight through. The second stringified it into `startAfter`, which is a
 * cursor *row*, not a row count, so the driver was handed `"20"` where it
 * expected a keyset value and the offset it does understand never arrived.
 *
 * What the caller sees: page one, every time — with a `meta` block reporting
 * the offset they asked for and a `hasMore` computed from it. Paging forward
 * returns the same rows and says there are more.
 *
 * The same mistake was fixed on the client, where `offset` was stringified into
 * `startAfter` before being sent. This is the server half of it.
 */
import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { CollectionConfig } from "../../types/src/types/collections";

const collections = [
    { slug: "posts", name: "Posts", singularName: "Post", properties: {} }
] as unknown as CollectionConfig[];

const ROWS = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Post ${i + 1}` }));

/** A driver with no `restFetchService`, which is what puts the route on the fallback. */
function harness(): { app: Hono; fetches: Record<string, any>[] } {
    const fetches: Record<string, any>[] = [];
    const driver = {
        key: "mongodb",
        initialised: true,
        fetchCollection: async (params: Record<string, any>) => {
            fetches.push(params);
            const offset = params.offset ?? 0;
            return ROWS.slice(offset, offset + (params.limit ?? ROWS.length));
        },
        fetchOne: async () => undefined,
        count: async () => ROWS.length,
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
    return { app, fetches };
}

async function get(url: string) {
    const { app, fetches } = harness();
    const res = await app.request(url);
    return { status: res.status, json: await res.json(), fetches };
}

describe("REST list pagination on the non-Postgres path", () => {

    it("passes the offset to the driver as an offset", async () => {
        const { fetches } = await get("/api/data/posts?offset=20&limit=10");

        expect(fetches[0].offset).toBe(20);
        // Not smuggled into the cursor parameter, where it means a row.
        expect(fetches[0].startAfter).toBeUndefined();
    });

    it("serves a different page than page one", async () => {
        const first = await get("/api/data/posts?offset=0&limit=10");
        const second = await get("/api/data/posts?offset=10&limit=10");

        expect(first.json.data.map((r: any) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(second.json.data.map((r: any) => r.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    });

    it("reports a window the rows actually came from", async () => {
        const { json } = await get("/api/data/posts?offset=20&limit=10");

        expect(json.meta).toMatchObject({ total: 25, limit: 10, offset: 20, hasMore: false });
        expect(json.data).toHaveLength(5);
    });

    it("omits the offset entirely when none was asked for", async () => {
        const { fetches } = await get("/api/data/posts?limit=10");

        expect(fetches[0].offset).toBeUndefined();
        expect(fetches[0].startAfter).toBeUndefined();
    });

    it("forwards searchExplain, which only the Postgres path used to get", async () => {
        const { fetches } = await get("/api/data/posts?searchString=hello&searchExplain=true");

        expect(fetches[0].searchString).toBe("hello");
        expect(fetches[0].searchExplain).toBe(true);
    });
});
