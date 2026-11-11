/**
 * A static app's `routes` and `frameAncestors`.
 *
 * A route serves a custom function's response — XML, HTML, anything — at a
 * path on the static app's own address: `/sitemap.xml` on `www.example.com`
 * answered by the `sitemap` function. `frameAncestors` names the origins,
 * besides the app's own, that may frame it, so a CMS on another hostname can
 * preview the site.
 *
 * The integration suite below wires a real backend's functions group, real
 * static mounts and a bundle read from disk in the order `bootFromBundle`
 * installs them, and asks over HTTP. The failures it guards are quiet: a route
 * that is not served answers `/sitemap.xml` with the SPA's index.html and a
 * 200; one that reaches another hostname serves the site's feed on the admin;
 * an origin written into the header unchecked is a header anyone can add a
 * directive to.
 */
import { col, defineTable } from "@rebasepro/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import {
    BUNDLE_FORMAT_VERSION,
    RUNTIME_CONTRACT_VERSION,
    type BackendBootstrapper,
    type DataDriver,
    type InitializedDriver,
    type RebaseBundleStatic
} from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { installRootErrorHandler } from "../api/root-error-handler";
import { createRebaseBackend, type RebaseBackend } from "../backend/create-backend";
import { serveSPA } from "../serve-spa";
import { BundleError, loadBundle, type LoadedBundle, type LoadedStaticApp } from "./bundle";
import { bootFromBundle } from "./boot";
import { runtimeSecureHeaders, STATIC_APP_CSP, staticAppCsp } from "./security-headers";
import {
    createStaticRouteResolver,
    planStaticAppMounts,
    serveStaticAppRoutes,
    staticRoutesShadowedByApi
} from "./static-routing";

const SITE = "www.example.com";
const ADMIN = "admin.example.com";
const ADMIN_ORIGIN = `https://${ADMIN}`;

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-static-routes-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function writeFiles(dir: string, files: Record<string, string>): void {
    for (const [relative, contents] of Object.entries(files)) {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }
}

/** A bundle in `dir` whose `entry.static` is `apps`, each app's files under `static/<name>`. */
function writeBundle(
    dir: string,
    kind: "backend" | "static",
    apps: Array<Omit<RebaseBundleStatic, "dir"> & { name: string; files: Record<string, string> }>
): void {
    for (const app of apps) writeFiles(path.join(dir, "static", app.name), app.files);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: { range: "^1", builtAgainst: "test", contract: RUNTIME_CONTRACT_VERSION },
        schemaVersion: "",
        app: "web",
        kind,
        entry: {
            static: apps.map(({ files: _files, ...app }) => ({ ...app, dir: `static/${app.name}` }))
        },
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "test", node: "22", createdAt: "2026-11-11T00:00:00Z" }
    }));
}

function staticApp(over: Partial<LoadedStaticApp> = {}): LoadedStaticApp {
    return { path: "/", dir: scratch, spa: true, ...over };
}

describe("loading a bundle's routes and frame ancestors", () => {
    it("reads both onto the loaded app, and leaves an app without them as it was", () => {
        writeBundle(scratch, "static", [
            {
                name: "site", path: "/", host: SITE, spa: true,
                routes: [{ path: "/sitemap.xml", function: "sitemap" }],
                frameAncestors: [ADMIN_ORIGIN],
                files: { "index.html": "SITE" }
            },
            { name: "admin", path: "/", host: ADMIN, spa: true, files: { "index.html": "ADMIN" } }
        ]);
        const bundle = loadBundle(scratch);
        const site = bundle.staticApps.find(app => app.host === SITE);
        const admin = bundle.staticApps.find(app => app.host === ADMIN);
        expect(site?.routes).toEqual([{ path: "/sitemap.xml", function: "sitemap" }]);
        expect(site?.frameAncestors).toEqual([ADMIN_ORIGIN]);
        expect(admin).not.toHaveProperty("routes");
        expect(admin).not.toHaveProperty("frameAncestors");
    });

    it.each([
        ["an origin that adds a directive", { frameAncestors: ["https://a.example.com; script-src *"] }, /frameAncestors/],
        ["a wildcard origin", { frameAncestors: ["https://*.example.com"] }, /wildcards/],
        ["frameAncestors that is not a list", { frameAncestors: ADMIN_ORIGIN }, /not a list/],
        ["a route under the API", { routes: [{ path: "/api/sitemap.xml", function: "sitemap" }] }, /\/api/],
        ["a route outside the app", { path: "/docs", routes: [{ path: "/sitemap.xml", function: "sitemap" }] }, /inside this app's path/],
        ["a route to no function", { routes: [{ path: "/sitemap.xml" }] }, /custom function/],
        ["routes that are not a list", { routes: { path: "/sitemap.xml", function: "sitemap" } }, /not a list/]
    ])("refuses %s, by name, at load", (_label, over, message) => {
        writeBundle(scratch, "static", [
            { name: "site", path: "/", spa: true, files: { "index.html": "SITE" }, ...(over as Partial<RebaseBundleStatic>) }
        ]);
        expect(() => loadBundle(scratch)).toThrow(BundleError);
        expect(() => loadBundle(scratch)).toThrow(message);
    });
});

describe("createStaticRouteResolver", () => {
    it("installs nothing for a bundle that declares no route", () => {
        expect(createStaticRouteResolver([staticApp()], "/api")).toBeUndefined();
        expect(createStaticRouteResolver([staticApp({ routes: [] })], "/api")).toBeUndefined();
    });

    it("maps a route to the function's own URL, with what its wildcard matched", () => {
        const resolve = createStaticRouteResolver([staticApp({
            routes: [{ path: "/sitemap.xml", function: "sitemap" }, { path: "/blog/*", function: "blog" }]
        })], "/api")!;
        expect(resolve({ host: SITE, path: "/sitemap.xml" })?.functionPath).toBe("/api/functions/sitemap");
        expect(resolve({ host: SITE, path: "/blog" })?.functionPath).toBe("/api/functions/blog");
        expect(resolve({ host: SITE, path: "/blog/hello" })?.functionPath).toBe("/api/functions/blog/hello");
        expect(resolve({ host: SITE, path: "/blogroll" })).toBeUndefined();
        expect(resolve({ host: SITE, path: "/" })).toBeUndefined();
    });

    it("lets the most specific route win, whatever order they are declared in", () => {
        const resolve = createStaticRouteResolver([staticApp({
            routes: [
                { path: "/blog/*", function: "blog" },
                { path: "/blog/drafts/*", function: "drafts" },
                { path: "/blog/feed.xml", function: "feed" }
            ]
        })], "/api")!;
        expect(resolve({ host: SITE, path: "/blog/feed.xml" })?.route.function).toBe("feed");
        expect(resolve({ host: SITE, path: "/blog/drafts/x" })?.route.function).toBe("drafts");
        expect(resolve({ host: SITE, path: "/blog/x" })?.route.function).toBe("blog");
    });

    it("applies a route only where its app answers the request", () => {
        const site = staticApp({ host: SITE, routes: [{ path: "/sitemap.xml", function: "sitemap" }] });
        const admin = staticApp({ host: ADMIN });
        const anywhere = staticApp({ path: "/docs", routes: [{ path: "/docs/feed.xml", function: "feed" }] });
        const resolve = createStaticRouteResolver([site, admin, anywhere], "/api")!;
        expect(resolve({ host: SITE, path: "/sitemap.xml" })?.app).toBe(site);
        // Port, case and a trailing dot are the same hostname.
        expect(resolve({ host: "WWW.Example.com.:443", path: "/sitemap.xml" })?.app).toBe(site);
        expect(resolve({ host: ADMIN, path: "/sitemap.xml" })).toBeUndefined();
        expect(resolve({ host: "other.example.com", path: "/sitemap.xml" })).toBeUndefined();
        // An app on every hostname routes on every hostname.
        expect(resolve({ host: ADMIN, path: "/docs/feed.xml" })?.app).toBe(anywhere);
    });

    it("never routes a path under the API's base path, wherever the API is", () => {
        const app = staticApp({ routes: [{ path: "/v2/*", function: "v2" }] });
        const resolve = createStaticRouteResolver([app], "/v2")!;
        // The function's own URL would otherwise match the route that made it.
        expect(resolve({ host: SITE, path: "/v2/functions/v2" })).toBeUndefined();
        expect(staticRoutesShadowedByApi([app], "/v2")).toEqual([{ app, route: app.routes![0] }]);
        expect(staticRoutesShadowedByApi([app], "/api")).toEqual([]);
    });
});

describe("staticAppCsp", () => {
    it("is frame-ancestors 'self' when no origin is named", () => {
        expect(STATIC_APP_CSP).toBe("frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
        expect(staticAppCsp([])).toBe(STATIC_APP_CSP);
    });

    it("adds each named origin after 'self', once", () => {
        expect(staticAppCsp([ADMIN_ORIGIN, "http://localhost:5173", ADMIN_ORIGIN]))
            .toBe(`frame-ancestors 'self' ${ADMIN_ORIGIN} http://localhost:5173; object-src 'none'; base-uri 'self'`);
    });

    it("throws on anything that is not exactly one origin", () => {
        expect(() => staticAppCsp(["https://a.example.com; script-src *"])).toThrow(/frameAncestors/);
        expect(() => staticAppCsp(["*"])).toThrow(/frameAncestors/);
    });
});

describe("serveSPA with frameAncestors", () => {
    function mounted(frameAncestors?: string[]): Hono {
        writeFiles(scratch, { "index.html": "INDEX", "assets/app.js": "JS" });
        const app = new Hono();
        serveSPA(app, { frontendPath: scratch, ...(frameAncestors ? { frameAncestors } : {}) });
        return app;
    }

    it("sends the named origins in frame-ancestors, on files and on the fallback", async () => {
        const app = mounted([ADMIN_ORIGIN]);
        for (const url of ["/", "/assets/app.js", "/posts/hello"]) {
            const res = await app.request(`http://localhost${url}`);
            expect({ url, csp: res.headers.get("content-security-policy") })
                .toEqual({ url, csp: staticAppCsp([ADMIN_ORIGIN]) });
        }
    });

    it("keeps frame-ancestors 'self' without them", async () => {
        const res = await mounted().request("http://localhost/");
        expect(res.headers.get("content-security-policy")).toBe(STATIC_APP_CSP);
    });

    it("refuses a bad origin when the app is mounted, not on the first request", () => {
        writeFiles(scratch, { "index.html": "INDEX" });
        expect(() => serveSPA(new Hono(), { frontendPath: scratch, frameAncestors: ["https://a.example.com/x"] }))
            .toThrow(/frameAncestors/);
    });
});

/** A driver no request in this file reaches: the only routes asked are functions and files. */
function bootstrapper(): BackendBootstrapper {
    const driver: DataDriver & { withAuth: () => Promise<DataDriver> } = {
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        checkUniqueField: async () => true,
        withAuth: async () => driver,
        admin: { executeSql: async () => [] }
    };
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, tables: [], internals: {} };
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    };
}

/** The functions the site routes to. Each reports what it was asked, so a test can see the request arrive. */
function siteFunctions(): Record<string, Hono<HonoEnv>> {
    const sitemap = new Hono<HonoEnv>();
    sitemap.get("/", (c) => {
        const origin = new URL(c.req.url).origin;
        return c.body(
            `<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>${origin}/blog/hello</loc></url></urlset>`,
            200,
            { "Content-Type": "application/xml; charset=utf-8" }
        );
    });

    const blog = new Hono<HonoEnv>();
    blog.get("/", (c) => c.html("<h1>All posts</h1>"));
    blog.get("/:slug", (c) => c.html(`<h1>${c.req.param("slug")}</h1><p>${c.req.query("preview") ?? ""}</p>`));
    blog.post("/:slug/comments", async (c) => c.json({ slug: c.req.param("slug"), received: await c.req.json() }, 201));

    const framed = new Hono<HonoEnv>();
    framed.get("/", (c) => c.html("<p>own policy</p>", 200, { "Content-Security-Policy": "frame-ancestors 'none'" }));

    return { sitemap, blog, framed };
}

describe("a static app's routes, served end to end", () => {
    let bundleDir: string;
    let backend: RebaseBackend;
    let app: Hono<HonoEnv>;

    beforeAll(async () => {
        bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-static-routes-e2e-"));
        writeBundle(bundleDir, "backend", [
            {
                name: "site", path: "/", host: SITE, spa: true,
                routes: [
                    { path: "/sitemap.xml", function: "sitemap" },
                    { path: "/blog/*", function: "blog" },
                    { path: "/framed", function: "framed" },
                    { path: "/missing", function: "nope" }
                ],
                frameAncestors: [ADMIN_ORIGIN],
                files: { "index.html": "SITE_INDEX", "sitemap.xml": "STALE_FILE_IN_THE_BUILD", "assets/app.js": "SITE_JS" }
            },
            { name: "admin", path: "/", host: ADMIN, spa: true, files: { "index.html": "ADMIN_INDEX" } }
        ]);
        const bundle: LoadedBundle = loadBundle(bundleDir);

        backend = await createRebaseBackend({
            // A backend declares at least one table when its driver cannot introspect.
            tables: [defineTable("posts", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" })],
            bootstrappers: [bootstrapper()],
            auth: { jwtSecret: "static-routes-test-jwt-secret-0123456789", serviceKey: "static-routes-test-service-key-0123456789" },
            functions: siteFunctions(),
            // As boot passes it: CORS is not what this file is about.
            corsHandled: true,
            cronPersistence: false,
            provision: false
        });

        // The order `bootFromBundle` installs them in.
        app = new Hono<HonoEnv>();
        installRootErrorHandler(app);
        const routes = createStaticRouteResolver(bundle.staticApps, "/api");
        if (routes) app.use("/*", serveStaticAppRoutes(app, routes));
        app.use("/*", runtimeSecureHeaders({ hstsIncludeSubDomains: false }));
        backend.mount(app, { basePath: "/api" });
        for (const { app: mount, siblingPaths, owns } of planStaticAppMounts(bundle.staticApps)) {
            serveSPA(app, {
                frontendPath: mount.dir,
                basePath: mount.path,
                apiBasePath: "/api",
                excludePaths: ["/health", "/livez", "/metrics", "/.well-known", ...siblingPaths],
                owns,
                spa: mount.spa,
                frameAncestors: mount.frameAncestors
            });
        }
    });

    afterAll(async () => {
        await backend?.shutdown(0).catch(() => {});
        fs.rmSync(bundleDir, { recursive: true, force: true });
    });

    /** A request on `host`, with the URL `@hono/node-server` builds from its `Host` header. */
    async function on(host: string, url: string, init: RequestInit = {}): Promise<Response> {
        return app.fetch(new Request(`http://${host}${url}`, { ...init, headers: { host, ...(init.headers ?? {}) } }));
    }

    it("serves the function's XML at /sitemap.xml on the site's hostname", async () => {
        const res = await on(SITE, "/sitemap.xml");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
        // The function saw the site's own origin, which is what a sitemap's
        // absolute URLs are built from.
        expect(await res.text()).toBe(
            '<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>http://www.example.com/blog/hello</loc></url></urlset>'
        );
    });

    it("wins over a file of the same path in the build", async () => {
        expect(await (await on(SITE, "/sitemap.xml")).text()).not.toContain("STALE_FILE_IN_THE_BUILD");
    });

    it("leaves the same path on another app's hostname to that app", async () => {
        const res = await on(ADMIN, "/sitemap.xml");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ADMIN_INDEX");
    });

    it("hands a wildcard's function the rest of the path, and the query", async () => {
        expect(await (await on(SITE, "/blog")).text()).toBe("<h1>All posts</h1>");
        expect(await (await on(SITE, "/blog/hello?preview=draft-7")).text()).toBe("<h1>hello</h1><p>draft-7</p>");
    });

    it("passes the method and the body through", async () => {
        const res = await on(SITE, "/blog/hello/comments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: "first" })
        });
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ slug: "hello", received: { text: "first" } });
    });

    it("serves the app's own files and pages around its routes", async () => {
        expect(await (await on(SITE, "/")).text()).toBe("SITE_INDEX");
        expect(await (await on(SITE, "/about")).text()).toBe("SITE_INDEX");
        expect(await (await on(SITE, "/assets/app.js")).text()).toBe("SITE_JS");
    });

    it("answers the function's URL as it always has", async () => {
        const res = await on(SITE, "/api/functions/sitemap");
        expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    });

    it("gives a routed response the app's frame policy, unless it sends its own", async () => {
        expect((await on(SITE, "/blog/hello")).headers.get("content-security-policy"))
            .toBe(staticAppCsp([ADMIN_ORIGIN]));
        expect((await on(SITE, "/framed")).headers.get("content-security-policy"))
            .toBe("frame-ancestors 'none'");
    });

    it("lets the named origin frame the app's own pages", async () => {
        const csp = (await on(SITE, "/")).headers.get("content-security-policy") ?? "";
        expect(csp).toContain(`frame-ancestors 'self' ${ADMIN_ORIGIN};`);
        // And no other app's.
        expect((await on(ADMIN, "/")).headers.get("content-security-policy")).toBe(STATIC_APP_CSP);
    });

    it("answers a route to a function that is not served with the functions group's own 404", async () => {
        const res = await on(SITE, "/missing");
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ error: { code: "FUNCTION_NOT_FOUND" } });
    });
});

describe("a static bundle, booted", () => {
    it("serves frame-ancestors with the origins its app names", async () => {
        writeBundle(scratch, "static", [
            { name: "site", path: "/", spa: true, frameAncestors: [ADMIN_ORIGIN], files: { "index.html": "SITE" } }
        ]);
        const booted = await bootFromBundle({ bundleDir: scratch, listen: false, handleSignals: false });
        try {
            const res = await booted.app.fetch(new Request("http://localhost/"));
            expect(await res.text()).toBe("SITE");
            expect(res.headers.get("content-security-policy")).toBe(staticAppCsp([ADMIN_ORIGIN]));
        } finally {
            await booted.shutdown().catch(() => {});
        }
    });

    it("refuses an app with routes, which a process without functions cannot serve", async () => {
        writeBundle(scratch, "static", [
            { name: "site", path: "/", spa: true, routes: [{ path: "/sitemap.xml", function: "sitemap" }], files: { "index.html": "SITE" } }
        ]);
        await expect(bootFromBundle({ bundleDir: scratch, listen: false, handleSignals: false }))
            .rejects.toThrow(/no functions to serve them/);
    });
});
