import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * `OPTIONS /api/storage/tus` reaches the TUS handler behind the runtime's CORS.
 *
 * A TUS client discovers the server's capabilities (`Tus-Version`,
 * `Tus-Extension`, `Tus-Max-Size`) with a plain `OPTIONS`. Hono's `cors()`
 * answers *every* `OPTIONS` itself, preflight or not, so with it mounted in
 * front — as boot mounts it — the route was dead: the client got a bare 204
 * with CORS headers and nothing about TUS, and the documented capability
 * request did not exist.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { resolveCorsOptions, type RebaseBootEnv } from "../src/boot/env";
import { runtimeCors } from "../src/boot/runtime-cors";

const FRONTEND = "http://localhost:5173";

describe("OPTIONS /api/storage/tus behind the runtime's CORS", () => {
    let root: string;
    let app: Hono<HonoEnv>;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tus-options-"));
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", runtimeCors(resolveCorsOptions({
            NODE_ENV: "development",
            FRONTEND_URL: FRONTEND
        } as unknown as RebaseBootEnv)));
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ type: "local", basePath: root }),
            requireAuth: false,
            maxFileSize: 1024
        }));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("answers the capability request with the TUS headers and the effective limit", async () => {
        const res = await app.request("http://api.example.com/api/storage/tus", {
            method: "OPTIONS",
            headers: { "Tus-Resumable": "1.0.0", Origin: FRONTEND }
        });

        expect(res.status).toBe(204);
        expect(res.headers.get("Tus-Version")).toBe("1.0.0");
        expect(res.headers.get("Tus-Extension")).toContain("creation");
        expect(res.headers.get("Tus-Max-Size")).toBe("1024");
        // Still a CORS response: a browser script on the frontend can read it.
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(FRONTEND);
    });

    it("still answers a CORS preflight itself", async () => {
        const res = await app.request("http://api.example.com/api/storage/tus", {
            method: "OPTIONS",
            headers: {
                Origin: FRONTEND,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "tus-resumable,upload-length"
            }
        });

        expect(res.status).toBe(204);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(FRONTEND);
        expect(res.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
        expect(res.headers.get("Tus-Version")).toBeNull();
    });
});
