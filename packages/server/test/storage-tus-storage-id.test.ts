import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * TUS writes to the storage source it authorized.
 *
 * The key axis of this was fixed once already: `create` resolves the key,
 * authorizes it, stores it, and `finalize` reads only the stored field. The
 * axis beside it was left as it was — the route asked the hook about
 * `c.req.query("storageId")` while `finalize` wrote to
 * `upload.metadata.storageId` from the `Upload-Metadata` header. Two sources
 * for one decision, so a request could name the source it is allowed to write
 * to in the URL and the source it wants in the header.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import type { StorageAuthorizeContext } from "../src/storage/types";

describe("TUS authorizes the storage source it writes to", () => {
    let app: Hono<HonoEnv>;
    let defaultDir: string;
    let assetsDir: string;
    /** Every storage source the hook was asked about, in order. */
    let seen: (string | undefined)[];

    /** Base64 the way the `Upload-Metadata` header carries values. */
    const meta = (pairs: Record<string, string>): string =>
        Object.entries(pairs)
            .map(([k, v]) => `${k} ${Buffer.from(v, "utf-8").toString("base64")}`)
            .join(",");

    /** Create a TUS upload and push its whole body in one PATCH. */
    const upload = async (url: string, metadata: Record<string, string>, body: string) => {
        const create = await app.fetch(new Request(url, {
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

    const exists = (p: string) => fs.promises.access(p).then(() => true).catch(() => false);

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        seen = [];
        defaultDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-tus-default-"));
        assetsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-tus-assets-"));

        const registry = DefaultStorageRegistry.create({
            "(default)": new LocalStorageController({ basePath: defaultDir }),
            assets: new LocalStorageController({ basePath: assetsDir })
        });

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            registry,
            requireAuth: false,
            // The shape the audit describes: a deployment whose second source
            // is narrower than its first.
            authorize: async (ctx: StorageAuthorizeContext) => {
                seen.push(ctx.storageId);
                return ctx.storageId === undefined || ctx.storageId === "(default)";
            }
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(defaultDir, { recursive: true, force: true });
        await fs.promises.rm(assetsDir, { recursive: true, force: true });
    });

    it("shows the hook the source named in the header, not the one in the query", async () => {
        const { create } = await upload(
            "http://localhost/api/storage/tus",
            { key: "logo.png", storageId: "assets" },
            "PWNED"
        );

        expect(seen).toEqual(["assets"]);
        expect(create.status).toBe(403);
        expect(await exists(path.join(assetsDir, "default", "logo.png"))).toBe(false);
    });

    it("does not let a permissive ?storageId buy a write to the source in the header", async () => {
        // The approval was obtained for "(default)" and the bytes were destined
        // for "assets".
        const { create } = await upload(
            "http://localhost/api/storage/tus?storageId=(default)",
            { key: "logo.png", storageId: "assets" },
            "PWNED"
        );

        expect(seen).toEqual(["assets"]);
        expect(create.status).toBe(403);
        expect(await exists(path.join(assetsDir, "default", "logo.png"))).toBe(false);
    });

    /**
     * TUS resolves the source twice — once in `create`, to tell the hook where
     * the bytes are going, and once in `finalize`, to write them. An unknown id
     * used to fall back to the default source at the second resolution, so the
     * hook approved a write to `unconfigured` and the object landed in
     * `(default)`. Same shape as the key mismatch this suite was written for.
     *
     * Refused in `create`, before a temp file exists: the alternative is
     * accepting the whole upload and failing at the end, which is both a worse
     * experience and a way to fill the disk.
     */
    it("refuses an unknown storage source before accepting any bytes", async () => {
        const { create } = await upload(
            "http://localhost/api/storage/tus",
            { key: "logo.png", storageId: "unconfigured" },
            "hello"
        );

        expect(create.status).toBe(400);
        const body = await create.json() as { error: { code: string } };
        expect(body.error.code).toBe("UNKNOWN_STORAGE_SOURCE");

        // Neither authorized nor written anywhere.
        expect(seen).toEqual([]);
        expect(await exists(path.join(defaultDir, "default", "logo.png"))).toBe(false);
    });

    it("still writes an allowed upload to the default source", async () => {
        const { create, patch } = await upload(
            "http://localhost/api/storage/tus",
            { key: "logo.png" },
            "hello"
        );

        expect(create.status).toBe(201);
        expect(patch!.status).toBe(204);
        expect(seen).toEqual([undefined]);
        expect(await fs.promises.readFile(path.join(defaultDir, "default", "logo.png"), "utf-8")).toBe("hello");
    });

    it("still routes to the source in the header when the hook allows it", async () => {
        // Same header-named source, an allow-everything hook: the destination
        // itself must not have changed.
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            registry: DefaultStorageRegistry.create({
                "(default)": new LocalStorageController({ basePath: defaultDir }),
                assets: new LocalStorageController({ basePath: assetsDir })
            }),
            requireAuth: false,
            authorize: async (ctx: StorageAuthorizeContext) => {
                seen.push(ctx.storageId);
                return true;
            }
        }));

        const { patch } = await upload(
            "http://localhost/api/storage/tus",
            { key: "logo.png", storageId: "assets" },
            "hello"
        );

        expect(patch!.status).toBe(204);
        expect(await fs.promises.readFile(path.join(assetsDir, "default", "logo.png"), "utf-8")).toBe("hello");
    });
});
