/**
 * E2E: a vector search over real HTTP, from the SDK to Postgres and back.
 *
 * A vector search used to travel in the URL — `?vector=[…]`, the embedding as
 * a JSON array — and the URL has a ceiling the API does not set: Node refuses
 * a request line plus headers over 16 KB with a 431, and 1,536 dimensions are
 * 33 KB of it. So `.vectorSearch()` failed for the embedding sizes people use.
 * The SDK now sends it as `POST /api/data/<collection>/query`, the same
 * listing with its parameters in the body.
 *
 * This file serves the API on a plain `createServer` — Node's own 16 KB limit,
 * which the SDK must not depend on — and checks that a 1,536-dimension search
 * comes back, that the same URL as a `GET` is refused there, and that the
 * `GET` and the `POST` answer the same thing for the same parameters on a real
 * database (the `GET` side through the runtime's 64 KB server).
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import type { CollectionConfig, DataDriver, User } from "@rebasepro/types";
import { createRebaseClient } from "@rebasepro/client";

import { startPgContainer, stopPgContainer, PGVECTOR_IMAGE, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import { createRuntimeHttpServer } from "../../../server/src/boot/http-server.js";

const DIMS = 1536;

const docs = {
    name: "Docs", slug: "docs", table: "docs",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string" },
        embedding: { name: "Embedding", type: "vector", dimensions: DIMS }
    }
} as unknown as CollectionConfig;

const USER = { uid: "vector-http-user", roles: ["admin"] } as unknown as User;

/** A deterministic unit-ish vector per row, so a failure reproduces. */
const embeddingFor = (n: number): number[] =>
    Array.from({ length: DIMS }, (_, i) => Math.sin(n * 7.13 + i * 0.37));

type Page = { data: Record<string, unknown>[]; meta: Record<string, unknown> };

describe("vector search over HTTP (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    /** Node's default header limit — what an SDK request must not depend on. */
    let plainServer: Server;
    /** The runtime's own server, whose 64 KB lets the GET side of the parity through. */
    let runtimeServer: Server;
    let plainOrigin: string;
    let runtimeOrigin: string;
    const originalNodeEnv = process.env.NODE_ENV;

    const listen = async (server: Server): Promise<string> => {
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer({ image: PGVECTOR_IMAGE });
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        // The framework withholds CREATE EXTENSION from generated DDL.
        await admin.query("CREATE EXTENSION IF NOT EXISTS vector");

        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app: new Hono() as never,
            server: createServer(),
            collections: [docs],
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString })
        } as never);

        const values: string[] = [];
        for (let n = 1; n <= 300; n++) {
            values.push(`('Doc ${n}', '${n % 3 === 0 ? "draft" : "published"}', '[${embeddingFor(n).join(",")}]')`);
        }
        await admin.query(`INSERT INTO docs (title, status, embedding) VALUES ${values.join(",")}; ANALYZE docs;`);

        const driver = backend.driver as DataDriver & { withAuth(user: User): Promise<DataDriver> };
        const app = new Hono();
        app.onError(errorHandler as never);
        app.use("/api/data/*", async (c, next) => {
            c.set("user" as never, USER as never);
            c.set("driver" as never, await driver.withAuth(USER) as never);
            await next();
        });
        app.route("/api/data", new RestApiGenerator([docs], driver).generateRoutes() as never);

        plainServer = createServer(getRequestListener(app.fetch));
        runtimeServer = createRuntimeHttpServer(getRequestListener(app.fetch));
        plainOrigin = await listen(plainServer);
        runtimeOrigin = await listen(runtimeServer);
    }, 240_000);

    afterAll(async () => {
        await new Promise(resolve => plainServer?.close(resolve));
        await new Promise(resolve => runtimeServer?.close(resolve));
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    const sdk = () => createRebaseClient({ baseUrl: plainOrigin, token: "unused-by-this-app" });

    it("answers a 1,536-dimension search from the SDK, nearest first", async () => {
        const result = await sdk().data.collection("docs").find({
            vectorSearch: { property: "embedding", vector: embeddingFor(42) },
            limit: 5
        });
        expect(result.data).toHaveLength(5);
        expect(result.data[0].title).toBe("Doc 42");
        const distances = result.data.map(row => Number(row._distance));
        expect(distances[0]).toBeCloseTo(0, 6);
        expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    });

    it("where the same search in the URL is refused by the server before any route sees it", async () => {
        const query = `vector_search=embedding&vector=${encodeURIComponent(JSON.stringify(embeddingFor(42)))}&limit=5`;
        expect(query.length).toBeGreaterThan(16 * 1024);
        const res = await fetch(`${plainOrigin}/api/data/docs?${query}`);
        expect(res.status).toBe(431);
    });

    it("thresholded, it reports no total, and `hasMore` from one row past the page", async () => {
        const docsClient = sdk().data.collection("docs");
        const all = await docsClient.find({ vectorSearch: { property: "embedding", vector: embeddingFor(7) }, limit: 30 });
        const distances = all.data.map(row => Number(row._distance));
        // Exactly 12 rows inside the threshold.
        const threshold = (distances[11] + distances[12]) / 2;

        const first = await docsClient.find({
            vectorSearch: { property: "embedding", vector: embeddingFor(7), threshold },
            limit: 10
        });
        expect(first.data.map(row => row.id)).toEqual(all.data.slice(0, 10).map(row => row.id));
        expect(first.meta).not.toHaveProperty("total");
        expect(first.meta.hasMore).toBe(true);

        const second = await docsClient.find({
            vectorSearch: { property: "embedding", vector: embeddingFor(7), threshold },
            limit: 10,
            offset: 10
        });
        expect(second.data.map(row => row.id)).toEqual(all.data.slice(10, 12).map(row => row.id));
        expect(second.meta.hasMore).toBe(false);
    });

    it("counts a thresholded 1,536-dimension search from the SDK, which the same count in the URL cannot", async () => {
        const docsClient = sdk().data.collection("docs");
        const all = await docsClient.find({ vectorSearch: { property: "embedding", vector: embeddingFor(7) }, limit: 30 });
        const distances = all.data.map(row => Number(row._distance));
        const threshold = (distances[11] + distances[12]) / 2;

        // `POST …/count`: the embedding in the body, as `find()` sends it.
        expect(await docsClient.count({ vectorSearch: { property: "embedding", vector: embeddingFor(7), threshold } })).toBe(12);

        // `GET …/count` with the same parameters is refused before any route sees it.
        const query = `vector_search=embedding&vector=${encodeURIComponent(JSON.stringify(embeddingFor(7)))}`
            + `&vector_threshold=${threshold}`;
        expect((await fetch(`${plainOrigin}/api/data/docs/count?${query}`)).status).toBe(431);
        // Through the runtime's own server the GET fits, and counts the same.
        expect(await (await fetch(`${runtimeOrigin}/api/data/docs/count?${query}`)).json()).toEqual({ count: 12 });
    });

    describe("GET and POST …/query answer the same, on a real database", () => {
        const bigVector = JSON.stringify(embeddingFor(99));
        const CASES: [string, Record<string, string>][] = [
            ["a plain listing", { limit: "7", orderBy: "title:desc" }],
            ["filters, one repeated", { status: "eq.published", id: "gte.10", limit: "5", count: "none" }],
            ["a vector search", { vector_search: "embedding", vector: bigVector, limit: "6" }],
            ["a vector search with a filter and an offset",
                { vector_search: "embedding", vector: bigVector, where: "{\"status\":[\"==\",\"draft\"]}", offset: "3", limit: "4" }],
            ["a vector search with a threshold",
                { vector_search: "embedding", vector: bigVector, vector_threshold: "0.9", limit: "8" }],
            ["a refusal", { vector_search: "embedding", vector: "[1,2,3]" }]
        ];

        it.each(CASES)("%s", async (_name, params) => {
            const get = await fetch(`${runtimeOrigin}/api/data/docs?${new URLSearchParams(params)}`);
            const post = await fetch(`${plainOrigin}/api/data/docs/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params)
            });
            const getBody = await get.json() as Page & { error?: Record<string, unknown> };
            const postBody = await post.json() as Page & { error?: Record<string, unknown> };
            delete getBody.error?.requestId;
            delete postBody.error?.requestId;
            expect(post.status).toBe(get.status);
            expect(postBody).toEqual(getBody);
        });
    });
});
