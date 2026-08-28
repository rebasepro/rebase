import { describe, it, expect, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import { fileTokenAuth, isPathMatch } from "../src/auth/middleware";
import { configureJwt, generateDownloadToken, generateAccessToken } from "../src/auth/jwt";

describe("fileTokenAuth Middleware", () => {
    let app: Hono;

    beforeEach(() => {
        configureJwt({
            secret: "test-secret-key-for-middleware-testing-12345",
            accessExpiresIn: "1h"
        });

        app = new Hono();
        app.get("/api/storage/file/*", fileTokenAuth, (c) => {
            return c.json({ success: true, user: c.get("user") });
        });
        app.get("/api/storage/metadata/*", fileTokenAuth, (c) => {
            return c.json({ success: true, user: c.get("user") });
        });
    });

    it("should allow a valid scoped download token with exact path match", async () => {
        const token = await generateDownloadToken("default/uploads/image.png");
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png?token=" + token)
        );

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.user).toEqual({ uid: "download-token", roles: ["reader"] });
    });

    it("should allow folder-prefix based scoped download token", async () => {
        // Token is scoped to "default/uploads/"
        const token = await generateDownloadToken("default/uploads/");
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/subfolder/nested.txt?token=" + token)
        );

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
    });

    /**
     * A scoped token is a grant, and `..` would walk straight out of it: the
     * prefix check is a `startsWith`, and the storage controller's own guard
     * only stops a path leaving the *bucket* — `uploads/../secret/x` resolves
     * to `secret/x`, which is still inside it.
     *
     * Two layers stop this, and these tests pin the outer one: the URL parser
     * resolves `..` before Hono routes, so the grant is checked against an
     * already-resolved path and the request 403s for the ordinary
     * wrong-prefix reason. `isPathMatch` refuses traversal as well (see below),
     * but it never gets the chance here — which is the point of testing both.
     */
    describe("a request cannot read outside the token's grant via traversal", () => {
        it("denies `..` climbing out of the token's folder", async () => {
            const token = await generateDownloadToken("default/uploads/");
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/uploads/../secret/data.txt?token=" + token)
            );

            expect(res.status).toBe(403);
        });

        it("denies `..` when the token is scoped to an exact file", async () => {
            const token = await generateDownloadToken("default/uploads/image.png");
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/uploads/image.png/../../secret/data.txt?token=" + token)
            );

            expect(res.status).toBe(403);
        });

        it("denies percent-encoded `..`", async () => {
            // `%2e` is a dot for normalization purposes per the WHATWG URL
            // spec, so this resolves exactly like the plain `..` above.
            const token = await generateDownloadToken("default/uploads/");
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/uploads/%2e%2e/secret/data.txt?token=" + token)
            );

            expect(res.status).toBe(403);
        });

        it("denies `..` presented in the Authorization header too", async () => {
            const token = await generateDownloadToken("default/uploads/");
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/uploads/../secret/data.txt", {
                    headers: { Authorization: `Bearer ${token}` }
                })
            );

            expect(res.status).toBe(403);
        });

        it("still allows a file whose name merely contains dots", async () => {
            // `..` is only a traversal as a whole segment; `..hidden` is a name.
            const token = await generateDownloadToken("default/uploads/");
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/uploads/..hidden.txt?token=" + token)
            );

            expect(res.status).toBe(200);
        });
    });

    /**
     * The inner layer, tested directly because no request can deliver a `..` to
     * it — the URL parser resolves them first. If a future runtime, adapter or
     * proxy ever stops normalizing, this is what holds.
     */
    describe("isPathMatch refuses traversal on its own", () => {
        it("refuses a traversal segment inside a granted prefix", () => {
            expect(isPathMatch("default/uploads/../secret/data.txt", "default/uploads/")).toBe(false);
        });

        it("refuses traversal even when the grant is an exact file", () => {
            expect(isPathMatch("default/uploads/image.png/../../secret/x", "default/uploads/image.png")).toBe(false);
        });

        it("matches an exact path", () => {
            expect(isPathMatch("default/uploads/image.png", "default/uploads/image.png")).toBe(true);
        });

        it("matches inside a granted folder", () => {
            expect(isPathMatch("default/uploads/a/b.txt", "default/uploads/")).toBe(true);
        });

        it("does not match a sibling folder that shares a prefix", () => {
            // `uploads-private` must not be granted by a token for `uploads`.
            expect(isPathMatch("default/uploads-private/x.txt", "default/uploads")).toBe(false);
        });

        it("allows dots that are part of a name", () => {
            expect(isPathMatch("default/uploads/..hidden.txt", "default/uploads/")).toBe(true);
        });
    });

    it("should deny access if token path does not match requested path", async () => {
        const token = await generateDownloadToken("default/secret/data.txt");
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png?token=" + token)
        );

        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.error.message).toContain("Forbidden: Scoped token path mismatch");
    });

    /**
     * A token names a path *and* a storage source, because a path alone names
     * an object in every source at once.
     *
     * The attack the source half stops: alice asks `/metadata` for a key in the
     * source whose `storageAuthorize` hook says yes, then spends the minted
     * token against `?storageId=` pointing at a source where the answer would
     * have been no — same key, different object, different owner. Nothing about
     * the path is wrong, which is exactly why a path-only grant let it through.
     */
    describe("a token is scoped to the storage source it was minted for", () => {
        const key = "default/uploads/image.png";
        const url = (storageId?: string, token?: string) =>
            `http://localhost/api/storage/file/${key}?token=${token}` +
            (storageId === undefined ? "" : `&storageId=${encodeURIComponent(storageId)}`);

        it("grants a read on the source it names", async () => {
            const token = await generateDownloadToken(key, 300, "media");
            const res = await app.fetch(new Request(url("media", token)));
            expect(res.status).toBe(200);
        });

        it("refuses the same key in another source", async () => {
            const token = await generateDownloadToken(key, 300, "media");
            const res = await app.fetch(new Request(url("backups", token)));

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.message).toContain("Forbidden: Scoped token storage mismatch");
        });

        it("refuses a named-source token used against the default source", async () => {
            // The bypass is symmetric, and dropping the parameter is the
            // cheapest way to try it.
            const token = await generateDownloadToken(key, 300, "media");
            const res = await app.fetch(new Request(url(undefined, token)));
            expect(res.status).toBe(403);
        });

        it("refuses a default-source token used against a named source", async () => {
            const token = await generateDownloadToken(key, 300);
            const res = await app.fetch(new Request(url("media", token)));
            expect(res.status).toBe(403);
        });

        it("accepts every spelling of the default source", async () => {
            // A client that sends `storageId=(default)` explicitly, or an empty
            // one, is asking for the same controller the omitted parameter
            // resolves to — so it must not 403.
            const token = await generateDownloadToken(key, 300);
            for (const spelling of [undefined, "", "(default)"]) {
                const res = await app.fetch(new Request(url(spelling, token)));
                expect([spelling, res.status]).toEqual([spelling, 200]);
            }
        });

        it("scopes a Bearer-presented token the same way", async () => {
            // Two code paths presented the same grant, and the check has to be
            // the same in both.
            const token = await generateDownloadToken(key, 300, "media");
            const res = await app.fetch(
                new Request(`http://localhost/api/storage/file/${key}?storageId=backups`, {
                    headers: { Authorization: "Bearer " + token }
                })
            );
            expect(res.status).toBe(403);
        });
    });

    it("should reject full access JWT in query parameter ?token=", async () => {
        const fullAccessJwt = await generateAccessToken("user-1", ["admin"]);
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png?token=" + fullAccessJwt)
        );

        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.error.message).toContain("Unauthorized: Invalid or unauthorized token");
    });

    it("should reject full access JWT in Authorization header for file serving routes", async () => {
        const fullAccessJwt = await generateAccessToken("user-1", ["admin"]);
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png", {
                headers: {
                    Authorization: "Bearer " + fullAccessJwt
                }
            })
        );

        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.error.message).toContain("Unauthorized: Access JWT not allowed on file routes");
    });

    it("should pass full access JWT in Authorization header for non-file (metadata) routes", async () => {
        const fullAccessJwt = await generateAccessToken("user-1", ["admin"]);
        const res = await app.fetch(
            new Request("http://localhost/api/storage/metadata/default/uploads/image.png", {
                headers: {
                    Authorization: "Bearer " + fullAccessJwt
                }
            })
        );

        // fileTokenAuth will let it pass to downstream middleware (e.g. readAuthMiddleware / requireAuth)
        // Since we don't have downstream middleware in this test app, it should return 200 and success: true
        expect(res.status).toBe(200);
    });
});
