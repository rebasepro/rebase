/**
 * A static app's `redirects` and `cleanUrls`, served.
 *
 * What a Vercel or Netlify migration relied on: `vercel.json`'s `redirects`
 * (host- and query-conditional) and `cleanUrls` (`/privacidad` serving
 * `privacidad.html`). Without them the sales site answered 404 for its clean
 * addresses, and the bare domain needed a hand-written app that redirected
 * from JavaScript.
 *
 * Three levels: the bundle loader (a bundle can come from any program, so it
 * checks what the CLI checked), `serveSPA` on its own for the file rules, and
 * a bundle booted by `bootFromBundle` with two hostnames — the bare domain
 * sent to `www`, and `www` serving clean URLs — asked over HTTP.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION, type RebaseBundleStatic } from "@rebasepro/types";
import { serveSPA, type ServeSPAConfig } from "../serve-spa";
import { BundleError, loadBundle } from "./bundle";
import { bootFromBundle } from "./boot";

const APEX = "example.com";
const WWW = "www.example.com";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-static-redirects-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function writeFiles(dir: string, files: Record<string, string>): void {
    fs.mkdirSync(dir, { recursive: true });
    for (const [relative, contents] of Object.entries(files)) {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }
}

/** A static bundle in `dir` whose `entry.static` is `apps`, each app's files under `static/<name>`. */
function writeBundle(
    dir: string,
    apps: Array<Omit<RebaseBundleStatic, "dir"> & { name: string; files: Record<string, string> }>
): void {
    for (const app of apps) writeFiles(path.join(dir, "static", app.name), app.files);
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: { range: "^1", builtAgainst: "test", contract: RUNTIME_CONTRACT_VERSION },
        schemaVersion: "",
        app: "web",
        kind: "static",
        entry: { static: apps.map(({ files: _files, ...app }) => ({ ...app, dir: `static/${app.name}` })) },
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "test", node: "22", createdAt: "2026-11-20T00:00:00Z" }
    }));
}

describe("loading a bundle's redirects and cleanUrls", () => {
    it("reads both onto the loaded app, and leaves an app without them as it was", () => {
        writeBundle(scratch, [
            {
                name: "site", path: "/", host: WWW, spa: false, cleanUrls: true,
                redirects: [{ from: "/old", to: "/new", status: 301 }],
                files: { "index.html": "SITE" }
            },
            { name: "admin", path: "/admin", spa: true, files: { "index.html": "ADMIN" } }
        ]);
        const bundle = loadBundle(scratch);
        const site = bundle.staticApps.find(app => app.host === WWW);
        const admin = bundle.staticApps.find(app => app.path === "/admin");
        expect(site?.redirects).toEqual([{ from: "/old", to: "/new", status: 301 }]);
        expect(site?.cleanUrls).toBe(true);
        expect(admin).not.toHaveProperty("redirects");
        expect(admin).not.toHaveProperty("cleanUrls");
    });

    it("leaves cleanUrls off when the bundle says false", () => {
        writeBundle(scratch, [{ name: "site", path: "/", spa: true, cleanUrls: false, files: { "index.html": "SITE" } }]);
        expect(loadBundle(scratch).staticApps[0]).not.toHaveProperty("cleanUrls");
    });

    it.each([
        ["redirects that are not a list", { redirects: { from: "/a", to: "/b" } }, /not a list/],
        ["a redirect under the API", { redirects: [{ from: "/api/old", to: "/b" }] }, /\/api/],
        ["a protocol-relative target", { redirects: [{ from: "/a", to: "//evil.example" }] }, /its to/],
        ["a redirect loop", { redirects: [{ from: "/:path*", to: "/new/:path*" }] }, /forever/],
        ["a status that is not a redirect", { redirects: [{ from: "/a", to: "/b", status: 200 }] }, /its status/],
        ["a host the app never answers on", { host: WWW, redirects: [{ from: "/a", to: "/b", host: APEX }] }, /its host/],
        ["cleanUrls that is not a boolean", { cleanUrls: "yes" }, /cleanUrls/]
    ])("refuses %s, by name, at load", (_label, over, message) => {
        writeBundle(scratch, [
            { name: "site", path: "/", spa: true, files: { "index.html": "SITE" }, ...(over as Partial<RebaseBundleStatic>) }
        ]);
        expect(() => loadBundle(scratch)).toThrow(BundleError);
        expect(() => loadBundle(scratch)).toThrow(message);
    });
});

describe("serveSPA redirects", () => {
    function mount(config: Partial<ServeSPAConfig>, files: Record<string, string> = { "index.html": "INDEX" }): Hono {
        const dir = path.join(scratch, "site");
        writeFiles(dir, files);
        const app = new Hono();
        app.get("/api/things", c => c.json({ ok: true }));
        app.get("/health", c => c.json({ status: "ok" }));
        serveSPA(app, { frontendPath: dir, excludePaths: ["/health"], ...config });
        return app;
    }

    async function request(app: Hono, url: string, init: RequestInit = {}) {
        const res = await app.request(`http://localhost${url}`, { redirect: "manual", ...init });
        return { status: res.status, location: res.headers.get("location"), body: await res.text() };
    }

    it("answers before a file of the same path, with the status it names", async () => {
        const app = mount(
            { redirects: [{ from: "/old", to: "/new" }, { from: "/gone", to: "/", status: 301 }] },
            { "index.html": "INDEX", "old/index.html": "OLD" }
        );
        expect(await request(app, "/old")).toMatchObject({ status: 308, location: "/new" });
        expect(await request(app, "/old/")).toMatchObject({ status: 308, location: "/new" });
        expect(await request(app, "/gone")).toMatchObject({ status: 301, location: "/" });
        expect(await request(app, "/other")).toMatchObject({ status: 200, body: "INDEX" });
    });

    it("carries parameters and the query string across", async () => {
        const app = mount({ redirects: [{ from: "/blog/:slug", to: "/posts/:slug" }, { from: "/docs/:path*", to: "/guide/:path*" }] });
        expect(await request(app, "/blog/hello?utm=x")).toMatchObject({ status: 308, location: "/posts/hello?utm=x" });
        expect(await request(app, "/docs/a/b")).toMatchObject({ status: 308, location: "/guide/a/b" });
        expect(await request(app, "/caf%C3%A9")).toMatchObject({ status: 200 });
    });

    it("redirects every method, and 308 keeps it", async () => {
        const app = mount({ redirects: [{ from: "/form", to: "/contact" }] });
        expect(await request(app, "/form", { method: "POST", body: "x" })).toMatchObject({ status: 308, location: "/contact" });
    });

    it("answers a query-conditional redirect on its value only", async () => {
        const app = mount({ redirects: [{ from: "/", to: "/es", query: { lang: "es" }, status: 302 }] });
        expect(await request(app, "/?lang=es")).toMatchObject({ status: 302, location: "/es?lang=es" });
        expect(await request(app, "/?lang=en")).toMatchObject({ status: 200, body: "INDEX" });
    });

    it("answers a host-conditional redirect on that hostname only, whatever its spelling", async () => {
        const app = mount({ redirects: [{ from: "/:path*", to: `https://${WWW}/:path*`, host: APEX }] });
        expect(await request(app, "/pricing", { headers: { host: "Example.com:443" } }))
            .toMatchObject({ status: 308, location: `https://${WWW}/pricing` });
        expect(await request(app, "/pricing", { headers: { host: WWW } })).toMatchObject({ status: 200, body: "INDEX" });
    });

    it("never redirects the API or a path another handler owns", async () => {
        const app = mount({ redirects: [{ from: "/:path*", to: `https://${WWW}/:path*` }] });
        expect(await request(app, "/api/things")).toMatchObject({ status: 200 });
        expect((await request(app, "/api/unknown")).status).not.toBe(308);
        expect(await request(app, "/health")).toMatchObject({ status: 200 });
        expect(await request(app, "/x")).toMatchObject({ status: 308, location: `https://${WWW}/x` });
    });

    it("answers with no build directory at all, for an app whose only job is a redirect", async () => {
        const app = new Hono();
        serveSPA(app, {
            frontendPath: path.join(scratch, "does-not-exist"),
            redirects: [{ from: "/:path*", to: `https://${WWW}/:path*` }]
        });
        expect(await request(app, "/a/b?c=1")).toMatchObject({ status: 308, location: `https://${WWW}/a/b?c=1` });
    });

    it("refuses at mount a redirect the validator would not pass", () => {
        expect(() => mount({ redirects: [{ from: "/a b", to: "/b" }] })).toThrow(/Redirect from/);
    });
});

describe("serveSPA cleanUrls", () => {
    const FILES = {
        "index.html": "INDEX",
        "privacidad.html": "PRIVACY",
        "legal/terms.html": "TERMS",
        "docs/index.html": "DOCS",
        "about.html": "ABOUT_FILE",
        "about/index.html": "ABOUT_DIR",
        "assets/app.js": "JS"
    };

    function mount(config: Partial<ServeSPAConfig> = {}, basePath = "/"): Hono {
        const dir = path.join(scratch, "site");
        writeFiles(dir, FILES);
        const app = new Hono();
        app.get("/api/things", c => c.json({ ok: true }));
        serveSPA(app, { frontendPath: dir, basePath, cleanUrls: true, ...config });
        return app;
    }

    async function request(app: Hono, url: string, headers: Record<string, string> = {}) {
        const res = await app.request(`http://localhost${url}`, { redirect: "manual", headers });
        return { status: res.status, location: res.headers.get("location"), body: await res.text(), headers: res.headers };
    }

    it("serves x.html at /x, nested too, as an HTML document that is revalidated", async () => {
        const app = mount();
        const page = await request(app, "/privacidad");
        expect(page).toMatchObject({ status: 200, body: "PRIVACY" });
        expect(page.headers.get("content-type")).toMatch(/text\/html/);
        expect(page.headers.get("cache-control")).toBe("no-cache");
        expect(page.headers.get("etag")).toMatch(/^W\//);
        expect(page.headers.get("content-security-policy")).toContain("frame-ancestors");
        expect(await request(app, "/legal/terms")).toMatchObject({ status: 200, body: "TERMS" });
    });

    it("answers a conditional request for a clean URL with a 304", async () => {
        const app = mount();
        const etag = (await request(app, "/privacidad")).headers.get("etag") ?? "";
        expect((await request(app, "/privacidad", { "if-none-match": etag })).status).toBe(304);
    });

    it("sends /x.html to /x, keeping the query, and index.html to its directory", async () => {
        const app = mount();
        expect(await request(app, "/privacidad.html?ref=footer")).toMatchObject({ status: 308, location: "/privacidad?ref=footer" });
        expect(await request(app, "/legal/terms.html")).toMatchObject({ status: 308, location: "/legal/terms" });
        expect(await request(app, "/docs/index.html")).toMatchObject({ status: 308, location: "/docs/" });
        expect(await request(app, "/index.html")).toMatchObject({ status: 308, location: "/" });
        expect(await request(app, "/docs/")).toMatchObject({ status: 200, body: "DOCS" });
    });

    it("serves a file or directory of the exact name first", async () => {
        const app = mount();
        expect(await request(app, "/about")).toMatchObject({ status: 200, body: "ABOUT_DIR" });
        expect(await request(app, "/assets/app.js")).toMatchObject({ status: 200, body: "JS" });
    });

    it("sends nobody to an address that would not serve the file", async () => {
        const app = mount({ spa: false });
        expect((await request(app, "/missing.html")).status).toBe(404);
        expect((await request(app, "/missing")).status).toBe(404);
        expect((await request(app, "/privacidad/")).status).toBe(404);
    });

    it("still gives the SPA fallback what no page claims", async () => {
        const app = mount({ spa: true });
        expect(await request(app, "/dashboard/settings")).toMatchObject({ status: 200, body: "INDEX" });
    });

    it("does nothing of the sort without the option", async () => {
        const app = mount({ cleanUrls: false, spa: false });
        expect((await request(app, "/privacidad")).status).toBe(404);
        expect(await request(app, "/privacidad.html")).toMatchObject({ status: 200, body: "PRIVACY" });
    });

    it("works the same for an app at a path", async () => {
        const app = mount({ spa: false }, "/site");
        expect(await request(app, "/site/privacidad")).toMatchObject({ status: 200, body: "PRIVACY" });
        expect(await request(app, "/site/privacidad.html")).toMatchObject({ status: 308, location: "/site/privacidad" });
        expect(await request(app, "/site/docs/index.html")).toMatchObject({ status: 308, location: "/site/docs/" });
    });

    it("stays off the API", async () => {
        const app = mount();
        expect(await request(app, "/api/things")).toMatchObject({ status: 200 });
    });

    it("does not follow a page that is a symlink out of the build", async () => {
        const outside = path.join(scratch, "secret.html");
        fs.writeFileSync(outside, "SECRET");
        const app = mount({ spa: false });
        fs.symlinkSync(outside, path.join(scratch, "site", "leak.html"));
        const leaked = await request(app, "/leak");
        expect(leaked.body).not.toContain("SECRET");
        expect(leaked.status).toBe(404);
    });
});

describe("a booted bundle: the bare domain sent to www, and www on clean URLs", () => {
    let booted: Awaited<ReturnType<typeof bootFromBundle>> | undefined;
    let bundleScratch: string;

    beforeAll(async () => {
        bundleScratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-static-redirects-boot-"));
        writeBundle(bundleScratch, [
            {
                // The minimal redirect-only app: a directory, and nothing in it a request reaches.
                name: "apex", path: "/", host: APEX, spa: false,
                redirects: [{ from: "/:path*", to: `https://${WWW}/:path*` }],
                files: { "index.html": "never served" }
            },
            {
                name: "www", path: "/", host: WWW, spa: false, cleanUrls: true,
                redirects: [{ from: "/privacy", to: "/privacidad", status: 301 }],
                files: { "index.html": "HOME", "privacidad.html": "PRIVACY" }
            }
        ]);
        booted = await bootFromBundle({ bundleDir: bundleScratch, listen: false, handleSignals: false });
    });

    afterAll(async () => {
        await booted?.shutdown().catch(() => {});
        fs.rmSync(bundleScratch, { recursive: true, force: true });
    });

    async function fetchOn(host: string, url: string) {
        const res = await booted!.app.fetch(new Request(`http://localhost${url}`, { headers: { host }, redirect: "manual" }));
        return { status: res.status, location: res.headers.get("location"), body: await res.text() };
    }

    it("sends every path of the bare domain to the same path on www", async () => {
        expect(await fetchOn(APEX, "/")).toMatchObject({ status: 308, location: `https://${WWW}` });
        expect(await fetchOn(APEX, "/privacidad?x=1")).toMatchObject({ status: 308, location: `https://${WWW}/privacidad?x=1` });
    });

    it("serves www's clean URLs and its own redirects", async () => {
        expect(await fetchOn(WWW, "/privacidad")).toMatchObject({ status: 200, body: "PRIVACY" });
        expect(await fetchOn(WWW, "/privacidad.html")).toMatchObject({ status: 308, location: "/privacidad" });
        expect(await fetchOn(WWW, "/privacy")).toMatchObject({ status: 301, location: "/privacidad" });
        expect(await fetchOn(WWW, "/")).toMatchObject({ status: 200, body: "HOME" });
    });

    it("keeps the probes on every hostname", async () => {
        expect((await fetchOn(APEX, "/livez")).status).toBe(200);
        expect((await fetchOn(APEX, "/health")).status).toBe(200);
    });
});
