import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
/**
 * A request cannot escape the frontend root through the SPA server.
 *
 * ## Why this test exists
 *
 * `serveSPA` mounts `@hono/node-server`'s `serve-static`, which has had a path
 * traversal advisory (`<2.0.5`, via an encoded backslash — `%5C` — on Windows).
 * The dependency is bumped past it, but a version bump is a fact about today: the
 * next one can regress, and the containment property is ours to assert regardless
 * of which adapter version is installed.
 *
 * It matters more from this release on. `bootFromBundle` serves a project's SPA
 * through exactly this path, and the managed runtime folds a frontend into the
 * bundle — so this is no longer an optional convenience for local development, it
 * is how a deployed site is served.
 *
 * The fixture puts a secret file *outside* the served root, which is the only way
 * to make an escape observable: a test that merely checks for a 404 cannot tell
 * "refused" from "the file happens not to exist".
 */
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { serveSPA } from "../src/serve-spa";

describe("SPA serving stays inside the frontend root", () => {
    let tempRoot: string;
    let frontendPath: string;
    let app: Hono;

    beforeAll(async () => {
        tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rebase-spa-traversal-"));
        frontendPath = path.join(tempRoot, "dist");
        await fsp.mkdir(path.join(frontendPath, "assets"), { recursive: true });

        await fsp.writeFile(path.join(frontendPath, "index.html"), "<!doctype html><title>app</title>");
        await fsp.writeFile(path.join(frontendPath, "assets", "app.js"), "console.log('app')");

        // Outside the served root. Reaching this is the failure.
        await fsp.writeFile(path.join(tempRoot, "secret.txt"), "TOP-SECRET-CONTENTS");

        app = new Hono();
        serveSPA(app, {
            frontendPath,
            apiBasePath: "/api",
            excludePaths: ["/health", "/livez", "/metrics"]
        });
    });

    afterAll(async () => {
        await fsp.rm(tempRoot, { recursive: true, force: true });
    });

    /**
     * A build directory is also a directory on a disk, and in a self-host it is
     * very often the checkout or something beside it. `serve-static` answers
     * for whatever is under the root it was given, and the only thing marking
     * `/.env` out from `/assets/app.js` is a convention it does not know about.
     */
    describe("dot-files under the build root", () => {
        beforeAll(async () => {
            await fsp.writeFile(path.join(frontendPath, ".env"), "JWT_SECRET=hunter2");
            await fsp.mkdir(path.join(frontendPath, ".git"), { recursive: true });
            await fsp.writeFile(path.join(frontendPath, ".git", "config"), "[remote]\n  url = git@github.com:acme/private.git");
        });

        it.each([
            ["/.env"],
            ["/.git/config"],
            ["/%2e%65nv"],
            ["/.git/../.env"]
        ])("refuses %s", async (requestPath) => {
            const res = await app.request(requestPath);
            const body = await res.text();
            expect(body).not.toContain("hunter2");
            expect(body).not.toContain("acme/private");
        });
    });

    /**
     * A symlink inside the build resolves wherever it points, so it is a way
     * out of the directory being served — and unlike `../`, nothing in the
     * request looks like an escape.
     */
    it("refuses a symlink that leaves the build directory", async () => {
        await fsp.symlink(path.join(tempRoot, "secret.txt"), path.join(frontendPath, "linked.txt"));

        const res = await app.request("/linked.txt");

        expect(await res.text()).not.toContain("TOP-SECRET-CONTENTS");
    });

    it("actually serves a real asset, so the containment tests are not vacuous", async () => {
        // The trap this avoids: if the static handler were not wired at all —
        // wrong root, missing directory — every traversal below would "pass"
        // while proving nothing. So assert the handler is live and returns the
        // real file contents before asserting what it refuses.
        const res = await app.request("/assets/app.js");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("console.log('app')");
    });

    /**
     * Every spelling of "go up one directory" worth trying, including the two the
     * advisory turned on: a percent-encoded backslash, and a double-encoded dot.
     */
    const escapes = [
        "/../secret.txt",
        "/..%2Fsecret.txt",
        "/%2e%2e%2fsecret.txt",
        "/%2E%2E/secret.txt",
        "/..%5Csecret.txt",
        "/%5C..%5Csecret.txt",
        "/assets/../../secret.txt",
        "/assets/..%2f..%2fsecret.txt",
        "/....//secret.txt",
        "/%252e%252e%252fsecret.txt"
    ];

    it.each(escapes)("never serves the file outside the root for %s", async (attempt) => {
        const res = await app.request(attempt);
        const body = await res.text();

        // The specific failure: the secret's contents reaching the client. A
        // traversal that returns 200 with index.html is the SPA fallback doing
        // its job on an unknown path, which is correct behaviour — so the
        // assertion is on the CONTENTS, not on the status code.
        expect(body).not.toContain("TOP-SECRET-CONTENTS");
    });

    it("still falls back to index.html for an ordinary client route", async () => {
        const res = await app.request("/some/client/route");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("<title>app</title>");
    });

    it("leaves the API and probe paths to their own handlers", async () => {
        // serveSPA claims `/*`, so an exclusion that stopped working would
        // silently shadow the API with index.html — a far louder outage than a
        // traversal, and one this guards at the same time.
        const withApi = new Hono();
        withApi.get("/api/ping", (c) => c.json({ ok: true }));
        withApi.get("/health", (c) => c.json({ status: "ok" }));
        serveSPA(withApi, {
            frontendPath,
            apiBasePath: "/api",
            excludePaths: ["/health", "/livez", "/metrics"]
        });

        expect(await (await withApi.request("/api/ping")).json()).toEqual({ ok: true });
        expect(await (await withApi.request("/health")).json()).toEqual({ status: "ok" });
    });
});
