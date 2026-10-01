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

interface Harness {
    client: ReturnType<typeof createRebaseClient>;
    saves: Record<string, unknown>[];
}

function createHarness(collections: CollectionConfig[] = [posts]): Harness {
    const saves: Record<string, unknown>[] = [];
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
        fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
            app.request(String(input).replace("http://rebase.test", ""), init)) as typeof fetch
    });
    return { client, saves };
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
