/**
 * A narrowed credential's storage scopes, checked where every storage route
 * has resolved the source it addresses — `storage:<operation>` on that source,
 * or unqualified. A person's own session is untouched: storage policies decide
 * for them.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";

describe("storage scopes", () => {
    let tempDir: string;
    let controller: LocalStorageController;

    function mount(scopes: string[] | null) {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("user", { uid: "api-key:k1", roles: ["service"] });
            if (scopes) c.set("scopes", scopes);
            await next();
        });
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
        return app;
    }

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-scopes-"));
        controller = new LocalStorageController({ basePath: tempDir });
        await controller.putObject({
            file: new File([Buffer.from("hello")], "a.txt", { type: "text/plain" }),
            key: "docs/a.txt"
        });
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    const get = (app: Hono<HonoEnv>, url: string, method = "GET") =>
        app.fetch(new Request(`http://localhost/api/storage${url}`, { method }));

    it("lets a person through to the storage policies", async () => {
        expect((await get(mount(null), "/file/docs/a.txt")).status).toBe(200);
    });

    it("reads with storage:read on the source, or unqualified", async () => {
        expect((await get(mount(["storage:read:(default)"]), "/file/docs/a.txt")).status).toBe(200);
        expect((await get(mount(["storage:read"]), "/file/docs/a.txt")).status).toBe(200);
    });

    it("refuses a grant for another source, naming the scope", async () => {
        const res = await get(mount(["storage:read:media"]), "/file/docs/a.txt");
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; details: { requiredScope: string } } };
        expect(body.error.code).toBe("SCOPE_MISSING");
        expect(body.error.details.requiredScope).toBe("storage:read:(default)");
    });

    it("treats a listing as a read", async () => {
        expect((await get(mount(["storage:read"]), "/list?prefix=docs")).status).toBe(200);
        expect((await get(mount(["data:read"]), "/list?prefix=docs")).status).toBe(403);
    });

    it("needs storage:delete to delete, whatever else it holds", async () => {
        expect((await get(mount(["storage:read", "storage:write"]), "/file/docs/a.txt", "DELETE")).status).toBe(403);
        expect((await get(mount(["storage:delete"]), "/file/docs/a.txt", "DELETE")).status).toBe(200);
    });
});
