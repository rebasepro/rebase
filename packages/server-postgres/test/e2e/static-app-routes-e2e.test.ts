/**
 * E2E: a static app's routes and frame ancestors, served by `rebase-server`
 * booting a backend bundle against a real Postgres.
 *
 * The fixture is the shape a publishing site takes on the managed runtime: a
 * backend with a `sitemap` and a `blog` function, a site on `www.example.com`
 * that routes `/sitemap.xml` and `/blog/*` to them and lets the CMS frame it,
 * and the CMS itself on `admin.example.com`. Before routes existed, the
 * function's XML could only be served at `/api/functions/sitemap`, and
 * `/sitemap.xml` answered with the site's index.html and a 200.
 *
 * A real process for the reason `split-roles-e2e` gives: a project's functions
 * load with a native dynamic `import`, which a test runner's module sandbox
 * cannot service. So this is the command a self-hosted deployment runs.
 *
 * Requires Docker, and the packages built.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, "fixtures", "routed-site");
const DRIVER_ROOT = path.resolve(HERE, "..", "..");
const SERVER_BIN = path.resolve(DRIVER_ROOT, "..", "server", "bin", "rebase-server.js");

const SITE = "www.example.com";
const ADMIN = "admin.example.com";

let container: PgContainer;
let child: ChildProcess | undefined;
let origin = "";
let output = "";

/**
 * Give the fixture bundle the database driver a deployed bundle carries: boot
 * resolves it by walking up from the bundle directory. Linked rather than
 * committed, so `node_modules` stays gitignored.
 */
async function linkDriverIntoFixture(): Promise<void> {
    const scope = path.join(BUNDLE, "node_modules", "@rebasepro");
    const link = path.join(scope, "server-postgres");
    await fs.mkdir(scope, { recursive: true });
    await fs.rm(link, { force: true, recursive: true });
    await fs.symlink(DRIVER_ROOT, link, "dir");
}

/** Boot the bundle and resolve with the origin it listens on, from its boot line. */
function start(): Promise<string> {
    child = spawn(process.execPath, [SERVER_BIN, BUNDLE], {
        env: {
            ...process.env as Record<string, string>,
            NODE_ENV: "test",
            DATABASE_URL: container.connectionString,
            JWT_SECRET: "static-routes-e2e-secret-at-least-32-chars-long",
            REBASE_SERVICE_KEY: "static-routes-e2e-service-key-at-least-32-chars",
            PORT: "0",
            LOG_LEVEL: "info"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    const record = (chunk: Buffer) => { output += chunk.toString(); };
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for a boot line.\n${output}`)), 90_000);
        const check = () => {
            const match = output.match(/http:\/\/localhost:(\d+)/);
            if (!match) return;
            clearTimeout(timer);
            resolve(`http://127.0.0.1:${match[1]}`);
        };
        child?.stdout?.on("data", check);
        child?.stderr?.on("data", check);
        child?.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`rebase-server exited with ${code} before listening.\n${output}`));
        });
    });
}

interface Answer {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
}

/**
 * A GET on `host`, sent over a socket the way the proxy in front of the
 * runtime sends it: to the runtime's port, with the original `Host` header.
 * `node:http` rather than `fetch`, which does not let a caller choose `Host`.
 */
function get(host: string, urlPath: string): Promise<Answer> {
    const { hostname, port } = new URL(origin);
    return new Promise((resolve, reject) => {
        const request = http.request({ hostname, port, path: urlPath, method: "GET", headers: { host } }, (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => { body += chunk; });
            response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
        });
        request.on("error", reject);
        request.end();
    });
}

beforeAll(async () => {
    await linkDriverIntoFixture();
    container = await startPgContainer();
    origin = await start();
}, 180_000);

afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
            child?.once("exit", () => resolve());
            child?.kill("SIGTERM");
            setTimeout(() => child?.kill("SIGKILL"), 5_000).unref();
        });
    }
    if (container) await stopPgContainer(container.containerName);
}, 120_000);

describe("a static app's routes, on the managed runtime", () => {
    it("serves the sitemap function's XML at /sitemap.xml on the site's hostname", async () => {
        const res = await get(SITE, "/sitemap.xml");

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("application/xml; charset=utf-8");
        expect(res.body).toContain(`<loc>http://${SITE}/blog/hello</loc>`);
        // Not the file of the same name in the build, and not the index.html
        // an SPA fallback would have answered with.
        expect(res.body).not.toContain("STALE_FILE_IN_THE_BUILD");
        expect(res.body).not.toContain("SITE_INDEX");
    });

    it("hands the blog function the rest of the path under /blog", async () => {
        expect((await get(SITE, "/blog")).body).toBe("<h1>All posts</h1>");
        expect((await get(SITE, "/blog/hello")).body).toBe("<h1>hello</h1>");
    });

    it("leaves the same paths on the admin's hostname to the admin", async () => {
        expect((await get(ADMIN, "/sitemap.xml")).body).toBe("ADMIN_INDEX");
        expect((await get(ADMIN, "/blog/hello")).body).toBe("ADMIN_INDEX");
    });

    it("still serves the site's pages around its routes", async () => {
        expect((await get(SITE, "/")).body).toBe("SITE_INDEX");
        expect((await get(SITE, "/about")).body).toBe("SITE_INDEX");
    });
});

describe("a static app's frame ancestors, on the managed runtime", () => {
    it("lets the admin's origin frame the site's pages", async () => {
        const res = await get(SITE, "/");
        expect(res.headers["content-security-policy"])
            .toBe(`frame-ancestors 'self' https://${ADMIN}; object-src 'none'; base-uri 'self'`);
    });

    it("lets it frame a routed, server-rendered page too", async () => {
        const res = await get(SITE, "/blog/hello");
        expect(res.headers["content-security-policy"]).toContain(`frame-ancestors 'self' https://${ADMIN};`);
    });

    it("keeps an app that names no origin framed by its own alone", async () => {
        const res = await get(ADMIN, "/");
        expect(res.headers["content-security-policy"]).toBe("frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
    });
});
