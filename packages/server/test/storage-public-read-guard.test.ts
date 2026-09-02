import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * What `storagePublicRead: true` means when it is the ONLY thing configured.
 *
 * The flag satisfies the boot guard that refuses a storage configuration with
 * no access-control model — but on its own it only relaxed the READ gate.
 * Writes, deletes and listings fell through to the global `requireAuth`, which
 * is off on precisely the public-site configuration this flag exists for. So a
 * deployment that had answered the guard correctly, in the way the guard's own
 * message suggests, was handing anonymous callers the ability to list every
 * key, overwrite any file and delete it.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { resolveStorageAccessControl } from "../src/storage/policies";

describe("storagePublicRead with no hook and no policies", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;

    /** Exactly the boot wiring: public read, auth off, nothing else declared. */
    async function mountPublicSite() {
        const authorize = resolveStorageAccessControl({ storagePublicRead: true });
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            publicRead: true,
            authorize
        }));
    }

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-public-"));
        controller = new LocalStorageController({ basePath: tempDir });
        await controller.putObject({
            file: new File([Buffer.from("the site's own image")], "logo.png", { type: "image/png" }),
            key: "assets/logo.png"
        });
        await mountPublicSite();
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("still serves reads to anyone, which is the whole point of the flag", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/file/assets/logo.png"));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("the site's own image");
    });

    it("refuses an anonymous upload", async () => {
        const form = new FormData();
        form.append("file", new File([Buffer.from("attacker")], "logo.png", { type: "image/png" }));
        form.append("key", "assets/logo.png");

        const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
            method: "POST",
            body: form
        }));

        expect(res.status).toBe(403);
        // And the original is untouched.
        const after = await app.fetch(new Request("http://localhost/api/storage/file/assets/logo.png"));
        expect(await after.text()).toBe("the site's own image");
    });

    it("refuses an anonymous delete", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/file/assets/logo.png", {
            method: "DELETE"
        }));

        expect(res.status).toBe(403);
    });

    it("refuses an anonymous listing of the whole bucket", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/list?prefix="));

        expect(res.status).toBe(403);
    });

    it("still lets an admin publish", async () => {
        const token = await generateAccessToken("ops-1", ["admin"]);
        const form = new FormData();
        form.append("file", new File([Buffer.from("new logo")], "logo.png", { type: "image/png" }));
        form.append("key", "assets/logo.png");

        const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
            method: "POST",
            body: form,
            headers: { Authorization: `Bearer ${token}` }
        }));

        expect(res.status).toBe(201);
    });

    /** The default must never override a decision someone actually made. */
    it("does not apply when a hook or policies were configured", () => {
        const hook = async () => true;
        expect(resolveStorageAccessControl({ storagePublicRead: true, storageAuthorize: hook })).toBe(hook);
        expect(resolveStorageAccessControl({ storagePublicRead: false })).toBeUndefined();
    });
});
