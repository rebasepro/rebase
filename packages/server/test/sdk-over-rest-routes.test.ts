import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import { createRebaseClient } from "@rebasepro/client";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";

/**
 * The SDK, sent through the REST routes it talks to — not through a mocked
 * `fetch` that asserts a URL.
 *
 * A client unit test can only check that the client sends what its author
 * believed the route wanted, and a route test only that the route does what
 * its author believed clients send. When the two beliefs differ, both suites
 * pass: `upsert()` without `onConflict` had a client test asserting it POSTed
 * to `/data/posts` and a route test asserting that a POST there is a plain
 * insert, and so every online `upsert()` of an existing row was a 409.
 *
 * Here the real `createRebaseClient` is handed a `fetch` that is the real
 * `RestApiGenerator` router, over a stub driver that behaves like Postgres
 * where it matters (a plain INSERT of an existing key raises 23505).
 */

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

const orderItems = {
    slug: "order_items",
    name: "Order items",
    table: "order_items",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        sku: { name: "SKU", type: "string" }
    }
} as unknown as CollectionConfig;

/** More groups than the list default (50) a grouped aggregate is paged by. */
const GROUPS = 62;

interface Harness {
    client: ReturnType<typeof createRebaseClient>;
    saves: Record<string, unknown>[];
    batches: Record<string, unknown>[][];
}

function createHarness(
    collections: CollectionConfig[] = [posts],
    dictionary?: Record<string, string>
): Harness {
    const saves: Record<string, unknown>[] = [];
    const batches: Record<string, unknown>[][] = [];
    const existing = new Set<unknown>([1]);

    const save = async (props: Record<string, unknown>) => {
        saves.push(props);
        const values = props.values as Record<string, unknown>;
        if (!props.upsert && existing.has(values.id)) {
            // What Postgres does for a plain INSERT of a key that is taken.
            throw Object.assign(new Error("duplicate key value violates unique constraint \"posts_pkey\""), {
                code: "23505",
                statusCode: 409
            });
        }
        existing.add(values.id);
        return { id: values.id ?? 99, ...values };
    };

    const driver = {
        key: "postgres",
        initialised: true,
        save,
        async saveMany(props: Record<string, unknown>) {
            const out: Record<string, unknown>[] = [];
            for (const values of props.rows as Record<string, unknown>[]) {
                out.push(await save({ ...props, values, status: "new" }));
            }
            return out;
        },
        async batchWrite(props: { operations: Record<string, unknown>[] }) {
            batches.push(props.operations);
            return props.operations.map((operation) => ({ id: 7, ...(operation.values as object) }));
        },
        restFetchService: {
            // 62 groups, one per title, in group-key order — what the Postgres
            // driver's GROUP BY ... ORDER BY <group keys> returns, windowed by
            // the limit and offset it is handed.
            async aggregate(_slug: string, options: { limit?: number; offset?: number }) {
                const groups = Array.from({ length: GROUPS }, (_, i) => ({
                    title: `t${String(i).padStart(2, "0")}`,
                    count: 1
                }));
                const from = options.offset ?? 0;
                return groups.slice(from, options.limit === undefined ? undefined : from + options.limit);
            }
        }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1", roles: [] });
        await next();
    });
    app.route("/api/data", new RestApiGenerator(collections, driver).generateRoutes());

    const client = createRebaseClient({
        baseUrl: "http://rebase.test",
        realtime: false,
        token: "t",
        ...(dictionary ? { collections: dictionary } : {}),
        fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
            app.request(String(input).replace("http://rebase.test", ""), init)) as typeof fetch
    });
    return { client, saves, batches };
}

describe("upsert() through the REST route", () => {
    it("replaces an existing row when no conflict target is named", async () => {
        // `UpsertOptions.onConflict`: "Defaults to the primary key". The docs:
        // "unlike `create` it does not fail when the row is already there".
        const { client, saves } = createHarness();

        const row = await client.data.collection("posts").upsert({ id: 1, title: "again" });

        expect(row).toMatchObject({ id: 1, title: "again" });
        expect(saves).toHaveLength(1);
        expect(saves[0]).toMatchObject({ upsert: true });
    });

    it("upserts on the named target", async () => {
        const { client, saves } = createHarness();

        await client.data.collection("posts").upsert({ id: 1, title: "again" }, { onConflict: ["id"] });

        expect(saves[0]).toMatchObject({ upsert: true, onConflict: ["id"] });
    });

    it("resolves to undefined with returning: false, as create does", async () => {
        const { client } = createHarness();

        const row = await client.data.collection("posts").upsert({ id: 1, title: "again" }, { returning: false });

        expect(row).toBeUndefined();
    });

    it("leaves create() a plain insert", async () => {
        // The other half of the contract: a create of a taken key still fails.
        const { client } = createHarness();

        await expect(client.data.collection("posts").create({ id: 1, title: "dup" }))
            .rejects.toMatchObject({ status: 409 });
    });
});

describe("batch() through the REST route", () => {
    // The generated `Database` keys collections by accessor (`orderItems`), and
    // `BatchOperation<DB>` types `collection` on those keys. The route resolves
    // `collection` by slug (`order_items`). So on a typed client the spelling
    // that compiled answered 400 "names the unknown collection", and the one the
    // server knows was a compile error — batch was unusable for every
    // collection whose slug is not already its accessor.

    it("sends the slug for an accessor the collections dictionary names", async () => {
        const { client, batches } = createHarness([posts, orderItems], { posts: "posts", orderItems: "order_items" });

        const result = await client.batch([
            { op: "create", collection: "orderItems", values: { sku: "A-1" } }
        ]);

        expect(result.data).toEqual([{ id: 7, sku: "A-1" }]);
        expect(batches[0][0]).toMatchObject({ op: "create", path: "order_items" });
    });

    it("still accepts the slug itself", async () => {
        const { client, batches } = createHarness([posts, orderItems], { posts: "posts", orderItems: "order_items" });

        await client.batch([{ op: "create", collection: "order_items", values: { sku: "A-2" } }]);

        expect(batches[0][0]).toMatchObject({ path: "order_items" });
    });

    it("sends the name verbatim on a client without a dictionary", async () => {
        const { client, batches } = createHarness([posts, orderItems]);

        await client.batch([{ op: "create", collection: "order_items", values: { sku: "A-3" } }]);

        expect(batches[0][0]).toMatchObject({ path: "order_items" });
    });
});

describe("aggregate() through the REST route", () => {
    // A grouped aggregate is paged like a listing: the route applies the list
    // default (50 groups) and says `hasMore`. The SDK returned `raw.data` and
    // dropped the `meta`, and had no `offset` to send — so "sum by customer"
    // over 300 customers came back with 50 and no way to know or to page, and
    // a dashboard under-reported without a sign of it.

    const byTitle = { select: [{ fn: "count" as const }], groupBy: ["title"] };

    it("says when the groups were cut off at the default", async () => {
        const { client } = createHarness();

        const rows = await client.data.collection("posts").aggregate(byTitle);

        expect(rows).toHaveLength(50);
        expect(rows.meta).toEqual({ limit: 50, offset: 0, hasMore: true });
    });

    it("pages past them with offset", async () => {
        const { client } = createHarness();

        const rows = await client.data.collection("posts").aggregate({ ...byTitle, offset: 50 });

        expect(rows.map(row => row.title)).toEqual(
            Array.from({ length: GROUPS - 50 }, (_, i) => `t${50 + i}`)
        );
        expect(rows.meta).toEqual({ limit: 50, offset: 50, hasMore: false });
    });

    it("returns every group under a limit that holds them", async () => {
        const { client } = createHarness();

        const rows = await client.data.collection("posts").aggregate({ ...byTitle, limit: 100 });

        expect(rows).toHaveLength(GROUPS);
        expect(rows.meta?.hasMore).toBe(false);
    });

    it("keeps the metadata off the rows themselves", async () => {
        // An array that grew an enumerable key would change what a spread, a
        // `JSON.stringify` or a deep equality of the result sees.
        const { client } = createHarness();

        const rows = await client.data.collection("posts").aggregate(byTitle);

        expect(Object.keys(rows)).not.toContain("meta");
        expect(JSON.parse(JSON.stringify(rows))).toHaveLength(50);
    });
});
