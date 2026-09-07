import { Hono } from "hono";
import { SCHEMA_VERSION_HEADER } from "@rebasepro/types";

import { ApiError, errorHandler } from "../src/api/errors";
import { createSchemaDriftDetector } from "../src/api/schema-drift";
import type { HonoEnv } from "../src/api/types";

/**
 * The receiving half of `x-rebase-schema`.
 *
 * The header was documented as the thing that lets the platform say "this app
 * was built against an older schema" instead of failing mysteriously at the
 * first request. The sender became real when `generate-sdk` started emitting
 * `schema.meta.ts`; nothing on the server read it, so a renamed column answered
 * a generated client with a bare 400 naming a field the client's own types say
 * exists.
 *
 * The rule these assert: drift is attached as the CAUSE of an error the request
 * was going to get anyway, and never becomes a reason to refuse one.
 */

const SERVER = "v1:1111111111111111";
const STALE = "v1:0000000000000000";

function app({ serverVersion }: { serverVersion?: string } = { serverVersion: SERVER }): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    router.use("/*", createSchemaDriftDetector(() => serverVersion));
    router.get("/unknown-field", () => {
        throw ApiError.badRequest('Unknown field "authorName" on collection "posts"');
    });
    router.get("/gone", () => {
        throw ApiError.notFound("Collection \"posts\" not found");
    });
    router.get("/broken", () => {
        throw new Error("something exploded");
    });
    router.get("/fine", (c) => c.json({ ok: true }));
    return router;
}

type Envelope = {
    error: {
        code: string;
        message: string;
        cause?: { code: string; clientSchema: string; serverSchema: string; message: string };
    };
};

describe("x-rebase-schema drift", () => {
    it("names both stamps as the cause of a 400 about an unknown field", async () => {
        const response = await app().request("/unknown-field", {
            headers: { [SCHEMA_VERSION_HEADER]: STALE }
        });
        const body = await response.json() as Envelope;

        expect(response.status).toBe(400);
        // The error itself is untouched — the caller still learns which field.
        expect(body.error.message).toContain("authorName");
        expect(body.error.cause?.code).toBe("SCHEMA_DRIFT");
        expect(body.error.cause?.clientSchema).toBe(STALE);
        expect(body.error.cause?.serverSchema).toBe(SERVER);
        expect(body.error.cause?.message).toContain("regenerate");
    });

    it("names both stamps as the cause of a 404 for a collection that moved", async () => {
        const response = await app().request("/gone", {
            headers: { [SCHEMA_VERSION_HEADER]: STALE }
        });
        const body = await response.json() as Envelope;

        expect(response.status).toBe(404);
        expect(body.error.cause?.serverSchema).toBe(SERVER);
    });

    it("says nothing when the caller's stamp matches", async () => {
        const response = await app().request("/unknown-field", {
            headers: { [SCHEMA_VERSION_HEADER]: SERVER }
        });
        const body = await response.json() as Envelope;

        expect(response.status).toBe(400);
        expect(body.error.cause).toBeUndefined();
    });

    it("says nothing when the caller sends no stamp", async () => {
        const response = await app().request("/unknown-field");
        const body = await response.json() as Envelope;

        expect(body.error.cause).toBeUndefined();
    });

    it("never refuses a request that would have succeeded", async () => {
        // The whole reason this is a cause and not a middleware that rejects: an
        // SDK a schema behind is usually still compatible, and a backend that
        // ships before its frontend is the normal deploy order.
        const response = await app().request("/fine", {
            headers: { [SCHEMA_VERSION_HEADER]: STALE }
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
    });

    it("stays off a 500 — a server fault is not the caller's schema being old", async () => {
        const response = await app().request("/broken", {
            headers: { [SCHEMA_VERSION_HEADER]: STALE }
        });
        const body = await response.json() as Envelope;

        expect(response.status).toBe(500);
        expect(body.error.cause).toBeUndefined();
    });

    it("says nothing when this backend has no stamp of its own to compare", async () => {
        const response = await app({}).request("/unknown-field", {
            headers: { [SCHEMA_VERSION_HEADER]: STALE }
        });
        const body = await response.json() as Envelope;

        expect(body.error.cause).toBeUndefined();
    });

    it("resolves the server's stamp at most once", async () => {
        // Computing one walks and canonicalizes every collection, and this runs
        // on every data request.
        const resolve = jest.fn(() => SERVER);
        const router = new Hono<HonoEnv>();
        router.onError(errorHandler);
        router.use("/*", createSchemaDriftDetector(resolve));
        router.get("/x", () => { throw ApiError.badRequest("nope"); });

        for (let i = 0; i < 3; i++) {
            await router.request("/x", { headers: { [SCHEMA_VERSION_HEADER]: STALE } });
        }

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("does not resolve the server's stamp for a caller that sends no header", async () => {
        const resolve = jest.fn(() => SERVER);
        const router = new Hono<HonoEnv>();
        router.use("/*", createSchemaDriftDetector(resolve));
        router.get("/x", (c) => c.json({ ok: true }));

        await router.request("/x");

        expect(resolve).not.toHaveBeenCalled();
    });
});
