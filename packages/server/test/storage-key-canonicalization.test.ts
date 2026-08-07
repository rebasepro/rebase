import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * Keys mean one thing, everywhere.
 *
 * Storage is not under RLS, so a `storageAuthorize` hook is the entire access
 * control model — and it is only as good as the guarantee that the key it was
 * shown is the key that gets written. That guarantee did not hold:
 *
 *  - `sanitizeStorageKey` *stripped* `../` in one pass, so `....//` came out as
 *    `../`. The sanitizer manufactured the traversal it existed to remove, and
 *    the resulting string read as alice's to a prefix hook and as bob's to the
 *    filesystem.
 *  - TUS authorized `sanitize(metadata.key)` and wrote `metadata.key` — two
 *    different strings by construction, which no fix to the sanitizer alone
 *    could have reconciled.
 *
 * The existing traversal tests (`storage-local.test.ts`, `storage-routes.test.ts`)
 * cover escaping the *bucket*, which always worked. These cover escaping the
 * *prefix the hook approved* — the only boundary the authorization model has.
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
import { canonicalStorageKey, tryCanonicalStorageKey, InvalidStorageKeyError, MAX_STORAGE_KEY_LENGTH } from "../src/storage/keys";
import type { StorageAuthorizeContext } from "../src/storage/types";

describe("canonicalStorageKey", () => {
    describe("normalizes what is safe to normalize", () => {
        it.each([
            ["a/b.txt", "a/b.txt"],
            ["/a/b.txt", "a/b.txt"],
            ["///a/b.txt", "a/b.txt"],
            ["a//b.txt", "a/b.txt"],
            ["./a/b.txt", "a/b.txt"],
            ["a/./b.txt", "a/b.txt"],
            ["", ""],
            [".", ""]
        ])("%s → %s", (input, expected) => {
            expect(canonicalStorageKey(input)).toBe(expected);
        });

        it("preserves a trailing slash, which is how a folder marker is written", () => {
            expect(canonicalStorageKey("photos/2024/")).toBe("photos/2024/");
        });

        it("is idempotent — canonicalizing twice changes nothing", () => {
            for (const key of ["a//./b/", "/x/y.txt", "users/alice/....//b.txt"]) {
                const once = canonicalStorageKey(key);
                expect(canonicalStorageKey(once)).toBe(once);
            }
        });
    });

    describe("refuses a key that means something other than what it says", () => {
        it.each([
            "../secret.txt",
            "a/../b.txt",
            "users/alice/../bob/notes.txt",
            "..",
            "a/..",
            "..\\secret.txt",
            "a\\..\\b.txt"
        ])("rejects %s", (input) => {
            expect(() => canonicalStorageKey(input)).toThrow(InvalidStorageKeyError);
        });

        it("rejects a null byte", () => {
            expect(() => canonicalStorageKey("a\0b.txt")).toThrow(InvalidStorageKeyError);
        });

        it("rejects an over-long key rather than truncating it into a different object", () => {
            expect(() => canonicalStorageKey("a".repeat(MAX_STORAGE_KEY_LENGTH + 1)))
                .toThrow(InvalidStorageKeyError);
        });
    });

    describe("the regression that started this", () => {
        // The old sanitizer removed `../` in a single pass, and `....//`
        // contains one at offset 2 — so stripping it left `../` behind.
        it("does not manufacture a traversal out of ....// ", () => {
            expect(canonicalStorageKey("users/alice/....//bob/notes.txt"))
                .toBe("users/alice/..../bob/notes.txt");
        });

        it("treats .... as the ordinary directory name it is", () => {
            const key = canonicalStorageKey("users/alice/....//bob/notes.txt");
            expect(key.startsWith("users/alice/")).toBe(true);
            // And the filesystem agrees, which is the whole point.
            expect(path.resolve(path.join("/bucket", key))).toBe("/bucket/users/alice/..../bob/notes.txt");
        });

        it("is a fixed point — no input survives one pass still containing ..", () => {
            for (const attempt of ["....//x", "......///x", "..../..//x", ".....//..//x"]) {
                const result = tryCanonicalStorageKey(attempt);
                if (result !== null) {
                    expect(result.split("/").some(s => s === "..")).toBe(false);
                }
            }
        });
    });

    it("tryCanonicalStorageKey fails closed instead of throwing", () => {
        expect(tryCanonicalStorageKey("a/b.txt")).toBe("a/b.txt");
        expect(tryCanonicalStorageKey("../b.txt")).toBeNull();
    });
});

describe("storage routes: the authorize hook and the object agree", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;
    /** Every key the hook was shown, in order. */
    let seen: string[];

    /** Verbatim the rule the BaaS overlay template ships. */
    const perUserPrefix = async (ctx: StorageAuthorizeContext) => {
        seen.push(ctx.key);
        return ctx.key.startsWith("users/alice/");
    };

    const bobsFile = () => path.join(tempDir, "default/users/bob/notes.txt");

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        seen = [];
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-keys-"));
        controller = new LocalStorageController({ basePath: tempDir });

        await controller.putObject({
            file: new File([Buffer.from("bob private data")], "notes.txt", { type: "text/plain" }),
            key: "users/bob/notes.txt"
        });
        await controller.putObject({
            file: new File([Buffer.from("alice data")], "notes.txt", { type: "text/plain" }),
            key: "users/alice/notes.txt"
        });

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            authorize: perUserPrefix
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("still serves an object the hook allows", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/file/users/alice/notes.txt"));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("alice data");
    });

    it("still refuses an object the hook denies", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/file/users/bob/notes.txt"));
        expect(res.status).toBe(403);
    });

    describe("....// cannot escape the approved prefix", () => {
        const escape = "users/alice/....//bob/notes.txt";

        it("read does not serve bob's object", async () => {
            const res = await app.fetch(new Request(`http://localhost/api/storage/file/${escape}`));

            // 404: `users/alice/..../bob/notes.txt` is a legitimate key inside
            // alice's prefix that simply holds nothing. The hook allowed it, and
            // it must — it really is hers.
            expect(res.status).toBe(404);
            expect(seen).toEqual(["users/alice/..../bob/notes.txt"]);
        });

        it("metadata does not mint a download token for bob's object", async () => {
            const res = await app.fetch(new Request(`http://localhost/api/storage/metadata/${escape}`));

            expect(res.status).toBe(404);
            expect(await res.text()).not.toContain("token");
        });

        it("upload does not overwrite bob's object", async () => {
            const form = new FormData();
            form.append("file", new File([Buffer.from("PWNED")], "notes.txt", { type: "text/plain" }));
            form.append("key", escape);

            const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
                method: "POST",
                body: form
            }));

            expect(res.status).toBe(201);
            // It landed where the hook was told it would.
            expect(await res.json()).toMatchObject({
                data: { key: "users/alice/..../bob/notes.txt" }
            });
            expect(await fs.promises.readFile(bobsFile(), "utf-8")).toBe("bob private data");
        });

        it("delete does not remove bob's object", async () => {
            const res = await app.fetch(new Request(`http://localhost/api/storage/file/${escape}`, {
                method: "DELETE"
            }));

            expect(res.status).toBe(200); // deleting nothing is not an error
            expect(await fs.promises.readFile(bobsFile(), "utf-8")).toBe("bob private data");
        });

        it("list does not enumerate outside the approved prefix", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/list?prefix=users/alice/....//")
            );

            const body = await res.json() as { data?: { items?: unknown[]; prefixes?: { name: string }[] } };
            // The canonical prefix is `users/alice/..../`, which does not exist.
            expect(body.data?.prefixes ?? []).toEqual([]);
            expect(body.data?.items ?? []).toEqual([]);
            expect(seen).toEqual(["users/alice/..../"]);
        });
    });

    describe("the download token grants the canonical key, and only that", () => {
        /** Ask `/metadata` for a key, returning the scoped token it mints. */
        const mintToken = async (key: string): Promise<string> => {
            const res = await app.fetch(new Request(`http://localhost/api/storage/metadata/${key}`));
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { token: string } };
            return body.data.token;
        };

        it("is honoured for a non-canonical URL form of the same object", async () => {
            // `/metadata` canonicalizes before signing, so the middleware that
            // checks the token has to canonicalize too — otherwise a doubled
            // slash anywhere in a client's URL would 403 a valid grant.
            const token = await mintToken("users/alice/notes.txt");

            const res = await app.fetch(
                new Request(`http://localhost/api/storage/file/users//alice/./notes.txt?token=${token}`)
            );

            expect(res.status).toBe(200);
            expect(await res.text()).toBe("alice data");
        });

        it("cannot be widened to another prefix with ....//", async () => {
            const token = await mintToken("users/alice/notes.txt");

            const res = await app.fetch(
                new Request(`http://localhost/api/storage/file/users/alice/....//bob/notes.txt?token=${token}`)
            );

            expect(res.status).toBe(403);
        });

        it("is refused outright for a key that cannot be canonicalized", async () => {
            const token = await mintToken("users/alice/notes.txt");

            const res = await app.fetch(
                new Request(`http://localhost/api/storage/file/users/alice/..%2fbob/notes.txt?token=${token}`)
            );

            expect(res.status).not.toBe(200);
        });
    });

    describe("a literal .. segment is refused, not repaired", () => {
        it("400s on read rather than silently reading a different object", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/users/alice/..%2fbob/notes.txt")
            );

            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({ error: { code: "INVALID_STORAGE_KEY" } });
            // Refused before the hook: an unanswerable key is not a policy question.
            expect(seen).toEqual([]);
        });

        it("400s on upload rather than storing at a path nobody chose", async () => {
            const form = new FormData();
            form.append("file", new File([Buffer.from("x")], "notes.txt", { type: "text/plain" }));
            form.append("key", "users/alice/../bob/notes.txt");

            const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
                method: "POST",
                body: form
            }));

            expect(res.status).toBe(400);
            expect(await fs.promises.readFile(bobsFile(), "utf-8")).toBe("bob private data");
        });

        it("400s on a list prefix", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/list?prefix=users/alice/../")
            );
            expect(res.status).toBe(400);
        });
    });
});

describe("TUS writes the key it authorized", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;
    let seen: string[];

    /** Base64 the way the `Upload-Metadata` header carries values. */
    const meta = (pairs: Record<string, string>): string =>
        Object.entries(pairs)
            .map(([k, v]) => `${k} ${Buffer.from(v, "utf-8").toString("base64")}`)
            .join(",");

    const mount = (authorize?: (ctx: StorageAuthorizeContext) => Promise<boolean>) => {
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            authorize
        }));
    };

    /** Create a TUS upload and push its whole body in one PATCH. */
    const upload = async (metadata: Record<string, string>, body: string) => {
        const create = await app.fetch(new Request("http://localhost/api/storage/tus", {
            method: "POST",
            headers: {
                "Upload-Length": String(Buffer.byteLength(body)),
                "Upload-Metadata": meta(metadata)
            }
        }));
        if (create.status !== 201) return { create, patch: undefined };

        const id = create.headers.get("Location")!.split("/").pop()!;
        const patch = await app.fetch(new Request(`http://localhost/api/storage/tus/${id}`, {
            method: "PATCH",
            headers: { "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
            body: Buffer.from(body)
        }));
        return { create, patch };
    };

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        seen = [];
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-tus-keys-"));
        controller = new LocalStorageController({ basePath: tempDir });
        await controller.putObject({
            file: new File([Buffer.from("bob private data")], "notes.txt", { type: "text/plain" }),
            key: "users/bob/notes.txt"
        });
        mount(async (ctx) => {
            seen.push(ctx.key);
            return ctx.key.startsWith("users/alice/");
        });
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("stores an allowed upload at exactly the authorized key", async () => {
        const { patch } = await upload({ key: "users/alice/report.txt" }, "hello");

        expect(patch!.status).toBe(204);
        expect(seen).toEqual(["users/alice/report.txt"]);
        const written = await fs.promises.readFile(
            path.join(tempDir, "default/users/alice/report.txt"), "utf-8"
        );
        expect(written).toBe("hello");
    });

    it("refuses a key the hook denies", async () => {
        const { create } = await upload({ key: "users/bob/notes.txt" }, "PWNED");

        expect(create.status).toBe(403);
        expect(await fs.promises.readFile(
            path.join(tempDir, "default/users/bob/notes.txt"), "utf-8"
        )).toBe("bob private data");
    });

    it("does not write outside the authorized prefix via ....//", async () => {
        const { patch } = await upload({ key: "users/alice/....//bob/notes.txt" }, "PWNED");

        expect(patch!.status).toBe(204);
        // The hook saw the canonical key, and that is where the bytes went.
        expect(seen).toEqual(["users/alice/..../bob/notes.txt"]);
        expect(await fs.promises.readFile(
            path.join(tempDir, "default/users/bob/notes.txt"), "utf-8"
        )).toBe("bob private data");
        expect(await fs.promises.readFile(
            path.join(tempDir, "default/users/alice/..../bob/notes.txt"), "utf-8"
        )).toBe("PWNED");
    });

    it("400s a key with a real .. segment at creation, leaving nothing to resume", async () => {
        const { create } = await upload({ key: "users/alice/../bob/notes.txt" }, "PWNED");

        expect(create.status).toBe(400);
        expect(seen).toEqual([]);
        expect(await fs.promises.readFile(
            path.join(tempDir, "default/users/bob/notes.txt"), "utf-8"
        )).toBe("bob private data");
    });

    it("authorizes the `filename` fallback, not just `key`", async () => {
        const { create } = await upload({ filename: "users/bob/notes.txt" }, "PWNED");

        expect(create.status).toBe(403);
        expect(seen).toEqual(["users/bob/notes.txt"]);
    });

    it("shows the hook the generated id when the upload names no key at all", async () => {
        const { create } = await upload({}, "x");

        // Previously the hook was asked about "" while `finalize` wrote to the
        // upload id — the two disagreed even in the benign case.
        expect(create.status).toBe(403);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    });
});
