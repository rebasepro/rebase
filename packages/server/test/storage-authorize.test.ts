import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * Per-object authorization on storage routes.
 *
 * Storage authenticated but did not authorize: `requireAuth` and `publicRead`
 * are global switches, so any signed-in user could read any key they could
 * name. These tests pin the hook that closes that — including on `/metadata`,
 * which mints the path-scoped download token `/file/*` trusts, and was
 * therefore the actual hole rather than the file route itself.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import type { StorageAuthorizeContext } from "../src/storage/types";

describe("storage per-object authorization", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;
    let calls: StorageAuthorizeContext[];

    /** Only the owner named in the key's first segment may touch it. */
    const ownerOnly = async (ctx: StorageAuthorizeContext) => {
        calls.push(ctx);
        return ctx.key.split("/")[0] === "alice";
    };

    async function mount(
        authorize?: (ctx: StorageAuthorizeContext) => Promise<boolean>,
        authorizeData?: () => unknown
    ) {
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            authorize,
            authorizeData: authorizeData as never
        }));
    }

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        calls = [];
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-authz-"));
        controller = new LocalStorageController({ basePath: tempDir });

        for (const owner of ["alice", "bob"]) {
            await controller.putObject({
                file: new File([Buffer.from(`${owner} secret`)], "notes.txt", { type: "text/plain" }),
                key: `${owner}/notes.txt`
            });
        }

        await mount(ownerOnly);
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    describe("reads", () => {
        it("serves an object the hook allows", async () => {
            const res = await app.fetch(new Request("http://localhost/api/storage/file/alice/notes.txt"));

            expect(res.status).toBe(200);
            expect(await res.text()).toBe("alice secret");
        });

        it("refuses an object the hook denies", async () => {
            const res = await app.fetch(new Request("http://localhost/api/storage/file/bob/notes.txt"));

            expect(res.status).toBe(403);
        });

        it("refuses to mint a download token for someone else's object", async () => {
            // The reported gap: getSignedUrl would mint a scoped token for any
            // authenticated caller for any path, so rejecting full-access JWTs
            // on the file route bought nothing.
            const res = await app.fetch(new Request("http://localhost/api/storage/metadata/default/bob/notes.txt"));

            expect(res.status).toBe(403);
        });

        it("still mints a token for an object the caller owns", async () => {
            const res = await app.fetch(new Request("http://localhost/api/storage/metadata/default/alice/notes.txt"));

            expect(res.status).toBe(200);
            const body = await res.json() as { data: { token?: string } };
            expect(body.data.token).toBeDefined();
        });

        it("passes the key with the bucket prefix stripped", async () => {
            await app.fetch(new Request("http://localhost/api/storage/metadata/default/alice/notes.txt"));

            expect(calls.at(-1)).toMatchObject({
                key: "alice/notes.txt",
                bucket: "default",
                operation: "read"
            });
        });
    });

    describe("the two principals the hook is not asked about", () => {
        /**
         * The hook is deliberately NOT re-run for a `?token=` request or a
         * declared-public object, and nothing tested either: disabling the
         * bypass entirely left all 57 storage tests green while breaking every
         * `<img>` a client renders.
         *
         * The two halves were each covered and their seam was not.
         * `file-token-auth.test.ts` proves `fileTokenAuth` resolves a token to
         * the synthetic `download-token` principal, and the tests above prove
         * the hook gates `/metadata`. Neither exercises what happens when the
         * two meet — which is the only place the bypass lives.
         */
        it("serves a token-bearing request the hook would otherwise deny", async () => {
            // Minted through the real route, so it only exists because the hook
            // approved alice's object first.
            const metaRes = await app.fetch(
                new Request("http://localhost/api/storage/metadata/default/alice/notes.txt")
            );
            expect(metaRes.status).toBe(200);
            const { data } = await metaRes.json() as { data: { token?: string } };
            expect(data.token).toBeDefined();

            // A hook that refuses everyone. Asking it about `download-token`
            // would deny — that principal owns nothing and answers no ownership
            // question. The token is the authorization here.
            await mount(async () => false);

            const res = await app.fetch(new Request(
                `http://localhost/api/storage/file/default/alice/notes.txt?token=${data.token}`
            ));

            expect(res.status).toBe(200);
            expect(await res.text()).toBe("alice secret");
        });

        it("serves a declared-public object past a hook that denies everyone", async () => {
            // The other half of the same bypass, and it was equally uncovered:
            // dropping `|| user?.userId === "public"` left all 115 storage tests
            // green. A `public/` object is public by declaration — the hook is
            // not consulted, exactly as for a token, and a permanent token-less
            // URL is the point of the prefix.
            await controller.putObject({
                file: new File([Buffer.from("open to all")], "logo.txt", { type: "text/plain" }),
                key: "public/logo.txt"
            });
            await mount(async () => false);

            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/public/logo.txt")
            );

            expect(res.status).toBe(200);
            expect(await res.text()).toBe("open to all");
        });

        it("does not extend that to a private object merely nested under a public-looking folder", async () => {
            // `reports/public/q3` is not public — the prefix is anchored, not a
            // substring — so the hook still decides, and here it refuses.
            await controller.putObject({
                file: new File([Buffer.from("confidential")], "q3.txt", { type: "text/plain" }),
                key: "reports/public/q3.txt"
            });
            await mount(async () => false);

            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/reports/public/q3.txt")
            );

            expect(res.status).not.toBe(200);
        });

        /**
         * The token's whole safety rests on it expiring. If presenting one at
         * `/metadata` mints another, it never does: the hook is not re-run for
         * the `download-token` principal — it owns nothing and answers no
         * ownership question — so the loop closes and 300 seconds becomes
         * forever. For a key ending in `/`, what renews is a whole folder.
         */
        it("does not let a download token mint another one", async () => {
            const metaRes = await app.fetch(
                new Request("http://localhost/api/storage/metadata/default/alice/notes.txt")
            );
            const { data } = await metaRes.json() as { data: { token?: string } };
            expect(data.token).toBeDefined();

            const renewed = await app.fetch(new Request(
                `http://localhost/api/storage/metadata/default/alice/notes.txt?token=${data.token}`
            ));

            expect(renewed.status).toBe(403);
            const body = await renewed.json() as { data?: { token?: string } };
            expect(body.data?.token).toBeUndefined();
        });

        it("does not let a token stand in for the hook on another path", async () => {
            // The bypass is only safe because the token is path-scoped. If it
            // were not, one legitimately minted token would be a skeleton key
            // past the hook for the whole bucket.
            const metaRes = await app.fetch(
                new Request("http://localhost/api/storage/metadata/default/alice/notes.txt")
            );
            const { data } = await metaRes.json() as { data: { token?: string } };

            const res = await app.fetch(new Request(
                `http://localhost/api/storage/file/default/bob/notes.txt?token=${data.token}`
            ));

            expect(res.status).not.toBe(200);
        });
    });

    describe("writes", () => {
        it("refuses an upload into someone else's prefix", async () => {
            const form = new FormData();
            form.append("file", new File(["intruder"], "x.txt", { type: "text/plain" }));
            form.append("key", "bob/x.txt");

            const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
                method: "POST",
                body: form
            }));

            expect(res.status).toBe(403);
            // And nothing was written.
            expect(await controller.getObject("bob/x.txt")).toBeNull();
        });

        it("allows an upload into the caller's own prefix", async () => {
            const form = new FormData();
            form.append("file", new File(["mine"], "y.txt", { type: "text/plain" }));
            form.append("key", "alice/y.txt");

            const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
                method: "POST",
                body: form
            }));

            expect(res.status).toBe(201);
            expect(await controller.getObject("alice/y.txt")).not.toBeNull();
        });

        it("refuses a delete the hook denies, and does not delete", async () => {
            const res = await app.fetch(new Request("http://localhost/api/storage/file/bob/notes.txt", {
                method: "DELETE"
            }));

            expect(res.status).toBe(403);
            expect(await controller.getObject("bob/notes.txt")).not.toBeNull();
            expect(calls.at(-1)).toMatchObject({ operation: "delete", key: "bob/notes.txt" });
        });
    });

    describe("listing", () => {
        it("refuses to list a prefix the hook denies", async () => {
            // Listing is how you discover keys nobody told you about, so an
            // ungated list would hand back what read control is withholding.
            const res = await app.fetch(new Request("http://localhost/api/storage/list?prefix=bob"));

            expect(res.status).toBe(403);
            expect(calls.at(-1)).toMatchObject({ operation: "list", key: "bob" });
        });

        it("allows a prefix the hook permits", async () => {
            const res = await app.fetch(new Request("http://localhost/api/storage/list?prefix=alice"));

            expect(res.status).toBe(200);
        });
    });

    describe("fail-closed behaviour", () => {
        it("denies when the hook throws", async () => {
            // An ownership lookup that fails (DB down, row missing) must not
            // fall open.
            await mount(async () => { throw new Error("lookup failed"); });

            const res = await app.fetch(new Request("http://localhost/api/storage/file/alice/notes.txt"));

            expect(res.status).toBe(403);
        });
    });

    describe("without a hook", () => {
        it("keeps the previous behaviour", async () => {
            // Opt-in: existing single-tenant apps are unaffected.
            await mount(undefined);

            const res = await app.fetch(new Request("http://localhost/api/storage/file/bob/notes.txt"));

            expect(res.status).toBe(200);
        });
    });

    describe("the hook can look up ownership", () => {
        /**
         * Prefix arithmetic on the key is not an access-control model — ownership
         * lives in a row. And the hook cannot fetch that row itself: a project
         * declares it from its config package, which depends on
         * `@rebasepro/types` alone and cannot resolve `@rebasepro/server` at
         * runtime. So the trusted reader is handed in, and this pins that it
         * arrives and works.
         */
        it("hands the hook a trusted reader it can query", async () => {
            const seen: unknown[] = [];
            // A membership table, as a real project would consult.
            const members = [{ teamId: "t1", userId: "alice" }];
            const data = {
                collection: () => ({
                    find: async (q?: Record<string, unknown>) => {
                        seen.push(q);
                        return { data: members as Record<string, unknown>[] };
                    },
                    findById: async () => null
                })
            };

            let received: unknown;
            await mount(async ctx => {
                received = ctx.data;
                const rows = await ctx.data!.collection("team_members").find({ where: { userId: ["==", "alice"] } });
                return rows.data.length > 0;
            }, () => data);

            const res = await app.request("/api/storage/file/alice/notes.txt");
            expect(res.status).toBe(200);
            expect(received).toBeDefined();
            expect(seen.length).toBe(1);
        });

        it("leaves `data` undefined when the host supplies none", async () => {
            // Backwards compatible: an older embedder that never passes a reader
            // still gets a working hook, it simply cannot do lookups.
            let received: unknown = "unset";
            await mount(async ctx => {
                received = ctx.data;
                return true;
            });

            await app.request("/api/storage/file/alice/notes.txt");
            expect(received).toBeUndefined();
        });
    });
});
