import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { createRequireAuth, requireAdmin } from "../auth/middleware";

/**
 * How often `/api/docs` builds the OpenAPI document.
 *
 * It generated and serialized the whole spec on every request: 39 ms of CPU
 * and a 10.8 MB string at 200 collections, on a route that is public whenever
 * Swagger is on. The spec is a function of what the route was mounted with —
 * the served collections, the base path, whether auth is required — and of
 * nothing about the caller, so it is built once per mount.
 */
const mockGenerated = { count: 0 };
jest.mock("../api/openapi-generator", () => {
    const actual = jest.requireActual<typeof import("../api/openapi-generator")>("../api/openapi-generator");
    return {
        ...actual,
        generateOpenApiSpec: (...args: Parameters<typeof actual.generateOpenApiSpec>) => {
            mockGenerated.count++;
            return actual.generateOpenApiSpec(...args);
        }
    };
});

import { mountOpenApiDocs } from "./docs";

const posts = [{ name: "posts", slug: "posts", properties: { title: { type: "string" } } } as unknown as CollectionConfig];
const tags = [{ name: "tags", slug: "tags", properties: { label: { type: "string" } } } as unknown as CollectionConfig];

async function mounted(collections: CollectionConfig[]): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await mountOpenApiDocs(app, "/api", true, collections, false, [createRequireAuth({}), requireAdmin]);
    return app;
}

beforeEach(() => {
    mockGenerated.count = 0;
});

describe("the OpenAPI document /api/docs serves", () => {
    it("is generated once, however many times it is asked for", async () => {
        const app = await mounted(posts);

        const first = await app.request("/api/docs");
        const second = await app.request("/api/docs");

        expect(mockGenerated.count).toBe(1);
        expect(first.status).toBe(200);
        expect(first.headers.get("content-type")).toMatch(/^application\/json/);
        const document = await first.json() as { openapi?: string; paths?: Record<string, unknown> };
        expect(document.openapi).toBeDefined();
        expect(Object.keys(document.paths ?? {}).some(path => path.includes("posts"))).toBe(true);
        expect(await second.json()).toEqual(document);
    });

    it("is each mount's own: another server's collections get their own document", async () => {
        const postsApp = await mounted(posts);
        const tagsApp = await mounted(tags);

        const postsPaths = Object.keys((await (await postsApp.request("/api/docs")).json() as { paths: Record<string, unknown> }).paths);
        const tagsPaths = Object.keys((await (await tagsApp.request("/api/docs")).json() as { paths: Record<string, unknown> }).paths);

        expect(postsPaths.some(path => path.includes("tags"))).toBe(false);
        expect(tagsPaths.some(path => path.includes("tags"))).toBe(true);
        expect(mockGenerated.count).toBe(2);
    });
});
