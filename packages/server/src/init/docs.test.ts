import { Hono } from "hono";
import { mountOpenApiDocs } from "./docs";
import type { CollectionConfig } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";

/**
 * Whether the OpenAPI spec is REACHABLE — not whether it is published.
 *
 * `resolveEnableSwagger` returns false in production whenever
 * REBASE_ENABLE_SWAGGER is unset, which is every managed tenant. The mount then
 * returned early and `/api/docs` did not exist, so Rebase Cloud's console — whose
 * API Explorer fetches exactly that path — answered 404 for every project on the
 * platform, permanently. Nothing distinguished that from a project with no API.
 */
const collections = [
    { name: "posts", path: "posts", properties: {} } as unknown as CollectionConfig
];

function app(enableSwagger: boolean | undefined) {
    const a = new Hono<HonoEnv>();
    return mountOpenApiDocs(a, "/api", enableSwagger, collections, false).then(() => a);
}

describe("mountOpenApiDocs", () => {
    it("publishes the spec when swagger is on", async () => {
        const a = await app(true);
        const res = await a.request("/api/docs");
        expect(res.status).toBe(200);
        expect((await res.json() as { openapi?: string }).openapi).toBeDefined();
    });

    it("still ROUTES the spec in production, rather than 404ing", async () => {
        // The bug, stated as a property: `false` means "do not publish this",
        // not "do not have it". A 404 here is indistinguishable, to the caller,
        // from a project that has no API at all.
        const a = await app(false);
        const res = await a.request("/api/docs");
        expect(res.status).not.toBe(404);
    });

    it("refuses the unauthenticated caller when swagger is off", async () => {
        const a = await app(false);
        const res = await a.request("/api/docs");
        expect([401, 403]).toContain(res.status);
    });

    it("answers both paths with NO_COLLECTIONS when there are none to document", async () => {
        // A spec of zero paths is not useful and a Try-It button next to
        // nothing is worse than an absent tab — so still a 404. But a *bare*
        // 404 is indistinguishable from a wrong URL or a dead server, and the
        // generated headless README points every new project at `/api/swagger`.
        // Same code and remedy `/api/data` gives, so the two cannot drift.
        const a = new Hono<HonoEnv>();
        await mountOpenApiDocs(a, "/api", true, [], false);

        for (const path of ["/api/docs", "/api/swagger"]) {
            const res = await a.request(path);
            expect(res.status).toBe(404);
            const body = await res.json() as { error?: { code?: string; message?: string } };
            expect(body.error?.code).toBe("NO_COLLECTIONS");
            expect(body.error?.message).toContain("db push");
        }
    });

    it("never serves the Swagger UI in production", async () => {
        // The asymmetry is deliberate: the spec is data, the UI loads scripts
        // from a CDN. Only the spec is reachable with a token.
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
            const a = await app(true);
            expect((await a.request("/api/swagger")).status).toBe(404);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });
});
