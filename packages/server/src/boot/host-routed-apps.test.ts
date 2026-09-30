/**
 * Static apps on a hostname of their own.
 *
 * A bundle entry may carry a `host`: that app then answers only for requests
 * naming it, and every app without one keeps answering on every other hostname.
 * Two apps can therefore share a path — `/` on `admin.example.com` and `/` on
 * everything else — which no path-only rule can tell apart.
 *
 * The failures this guards are the quiet kind. An admin whose `host` is dropped
 * is an admin served on the public site's domain. A site that excludes "/cms"
 * because an admin on another hostname sits there 404s its own `/cms` page. An
 * app that declines the fallback but still serves its files answers the other
 * hostname with its own `/assets/*`. None of them throws; each serves the wrong
 * bytes with a 200, or no bytes with a 404.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
import { isUnderPath, serveSPA } from "../serve-spa";
import { BundleError, compareStaticApps, loadBundle, type LoadedStaticApp } from "./bundle";
import { bootFromBundle, type BootedRuntime } from "./boot";
import { createStaticAppResolver, normalizeRequestHost, planStaticAppMounts } from "./static-routing";

const ADMIN = "admin.example.com";
const SITE = "example.com";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-host-apps-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function writeFiles(dir: string, files: Record<string, string>): string {
    for (const [relative, contents] of Object.entries(files)) {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }
    return dir;
}

function build(name: string, files: Record<string, string>): string {
    return writeFiles(path.join(scratch, name), files);
}

/** The routes boot registers before any static app, on every hostname. */
function withRuntimeRoutes(): Hono {
    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/api/things", (c) => c.json({ ok: true }));
    app.get("/.well-known/jwks.json", (c) => c.json({ keys: [] }));
    return app;
}

/**
 * Mount apps as the backend boot path does: in bundle order, through the same
 * planner, with the same exclusions.
 */
function mount(apps: LoadedStaticApp[], order: "bundle" | "as-given" = "bundle"): Hono {
    const app = withRuntimeRoutes();
    const ordered = order === "bundle" ? [...apps].sort(compareStaticApps) : apps;
    for (const { app: staticApp, siblingPaths, owns } of planStaticAppMounts(ordered)) {
        serveSPA(app, {
            frontendPath: staticApp.dir,
            basePath: staticApp.path,
            apiBasePath: "/api",
            excludePaths: ["/health", "/livez", "/metrics", "/.well-known", ...siblingPaths],
            owns,
            spa: staticApp.spa
        });
    }
    return app;
}

interface Answer {
    status: number;
    body: string;
    headers: Record<string, string>;
}

async function get(app: Hono, url: string, headers: Record<string, string> = {}): Promise<Answer> {
    const res = await app.request(`http://localhost${url}`, { headers });
    return {
        status: res.status,
        body: await res.text(),
        headers: Object.fromEntries(res.headers.entries())
    };
}

/** A request for `url` on `host`, sent the way a browser behind the proxy sends it. */
async function on(app: Hono, host: string, url: string, headers: Record<string, string> = {}): Promise<Answer> {
    return get(app, url, { host, ...headers });
}

function site(): LoadedStaticApp {
    return {
        path: "/",
        spa: true,
        dir: build("site", {
            "index.html": "SITE_INDEX",
            "assets/x.js": "SITE_ASSET",
            "assets/site-only.js": "SITE_ONLY"
        })
    };
}

function adminAtRoot(): LoadedStaticApp {
    return {
        path: "/",
        host: ADMIN,
        spa: true,
        dir: build("admin", {
            "index.html": "ADMIN_INDEX",
            "assets/x.js": "ADMIN_ASSET",
            "assets/admin-only.js": "ADMIN_ONLY"
        })
    };
}

function cmsUnderAdminHost(): LoadedStaticApp {
    return {
        path: "/cms",
        host: ADMIN,
        spa: true,
        dir: build("cms", {
            "index.html": "CMS_INDEX",
            "assets/x.js": "CMS_ASSET"
        })
    };
}

describe("normalizeRequestHost", () => {
    it.each([
        ["admin.example.com", "admin.example.com"],
        ["Admin.Example.COM", "admin.example.com"],
        ["admin.example.com:8443", "admin.example.com"],
        ["admin.example.com.", "admin.example.com"],
        ["ADMIN.example.com.:443", "admin.example.com"],
        ["admin.example.com:", "admin.example.com"]
    ])("reads %s as %s", (raw, expected) => {
        expect(normalizeRequestHost(raw)).toBe(expected);
    });

    it("leaves an IPv6 literal whole — its colons are not a port", () => {
        expect(normalizeRequestHost("[::1]:3000")).toBe("[::1]:3000");
    });
});

describe("the matching rule", () => {
    const at = (appPath: string, host?: string): LoadedStaticApp => ({
        path: appPath,
        dir: `/builds${appPath}${host ?? ""}`,
        spa: true,
        ...(host ? { host } : {})
    });

    it("gives an app with a host the requests on that host, at an equal path", () => {
        const web = at("/");
        const admin = at("/", ADMIN);
        // Either order in: the rule is not the input's order.
        for (const apps of [[web, admin], [admin, web]]) {
            const resolve = createStaticAppResolver(apps);
            expect(resolve({ host: ADMIN, path: "/x" })).toBe(admin);
            expect(resolve({ host: SITE, path: "/x" })).toBe(web);
        }
    });

    it("prefers the longest path, whichever app names a host", () => {
        // A host-less app answers on every hostname, the admin's included, and
        // a longer path is a more specific claim than a hostname is.
        const web = at("/");
        const docs = at("/docs");
        const admin = at("/", ADMIN);
        const resolve = createStaticAppResolver([web, docs, admin]);
        expect(resolve({ host: ADMIN, path: "/docs/intro" })).toBe(docs);
        expect(resolve({ host: ADMIN, path: "/other" })).toBe(admin);
        expect(resolve({ host: SITE, path: "/docs" })).toBe(docs);
    });

    it("matches paths by segment, as the fallback's exclusions do", () => {
        const web = at("/");
        const cms = at("/cms", ADMIN);
        const resolve = createStaticAppResolver([web, cms]);
        expect(resolve({ host: ADMIN, path: "/cms" })).toBe(cms);
        expect(resolve({ host: ADMIN, path: "/cms/" })).toBe(cms);
        expect(resolve({ host: ADMIN, path: "/cmsx" })).toBe(web);
    });

    it("gives a request no app claims to no app", () => {
        const resolve = createStaticAppResolver([at("/", ADMIN)]);
        expect(resolve({ host: SITE, path: "/" })).toBeUndefined();
    });

    it("matches the host however the request spelled it", () => {
        const admin = at("/", ADMIN);
        const resolve = createStaticAppResolver([at("/"), admin]);
        expect(resolve({ host: "Admin.Example.com:443", path: "/" })).toBe(admin);
        expect(resolve({ host: "admin.example.com.", path: "/" })).toBe(admin);
    });

    it("does not reach a subdomain or a parent of the app's host", () => {
        const web = at("/");
        const resolve = createStaticAppResolver([web, at("/", ADMIN)]);
        expect(resolve({ host: `x.${ADMIN}`, path: "/" })).toBe(web);
        expect(resolve({ host: SITE, path: "/" })).toBe(web);
    });
});

describe("planning the mounts", () => {
    it("keeps the path-only rule, and no guard, for a bundle that names no host", () => {
        const plan = planStaticAppMounts([
            { path: "/admin", dir: "/b/admin", spa: true },
            { path: "/", dir: "/b/site", spa: true }
        ]);
        expect(plan.map(m => [m.app.path, m.siblingPaths, m.owns])).toEqual([
            ["/admin", [], undefined],
            ["/", ["/admin"], undefined]
        ]);
    });

    it("hands every app the resolver, and no path exclusions, once any app names a host", () => {
        const plan = planStaticAppMounts([
            { path: "/cms", host: ADMIN, dir: "/b/cms", spa: true },
            { path: "/", dir: "/b/site", spa: true }
        ]);
        // "/cms" must not be excluded from the site: on its own hostname the
        // site owns it.
        expect(plan.map(m => m.siblingPaths)).toEqual([[], []]);
        expect(plan.every(m => typeof m.owns === "function")).toBe(true);
    });
});

describe("two apps at /, one on its own hostname", () => {
    function apps(): Hono {
        return mount([site(), adminAtRoot()]);
    }

    it("serves each hostname its own index", async () => {
        const app = apps();
        expect((await on(app, ADMIN, "/")).body).toBe("ADMIN_INDEX");
        expect((await on(app, SITE, "/")).body).toBe("SITE_INDEX");
    });

    it("serves each hostname its own deep links", async () => {
        const app = apps();
        expect((await on(app, ADMIN, "/collections/posts")).body).toBe("ADMIN_INDEX");
        expect((await on(app, SITE, "/blog/hello")).body).toBe("SITE_INDEX");
    });

    it("serves each hostname its own assets at the same URL", async () => {
        const app = apps();
        expect((await on(app, ADMIN, "/assets/x.js")).body).toBe("ADMIN_ASSET");
        expect((await on(app, SITE, "/assets/x.js")).body).toBe("SITE_ASSET");
    });

    it("never answers one hostname with a file from the other's build", async () => {
        // The failure an app that declined only the fallback would have: the
        // site's static middleware finding its own file for the admin's URL.
        const app = apps();
        const onAdmin = await on(app, ADMIN, "/assets/site-only.js");
        expect(onAdmin.status).toBe(404);
        expect(onAdmin.body).not.toBe("SITE_ONLY");

        const onSite = await on(app, SITE, "/assets/admin-only.js");
        expect(onSite.status).toBe(404);
        expect(onSite.body).not.toBe("ADMIN_ONLY");
    });

    it("gives any other hostname the host-less app", async () => {
        const app = apps();
        expect((await on(app, "www.example.com", "/")).body).toBe("SITE_INDEX");
        expect((await on(app, "project.rebase.app", "/deep")).body).toBe("SITE_INDEX");
    });

    it("answers the admin's hostname however it is spelled", async () => {
        const app = apps();
        for (const spelling of ["ADMIN.Example.Com", "admin.example.com:8443", "admin.example.com.", "Admin.Example.com.:443"]) {
            expect((await on(app, spelling, "/")).body).toBe("ADMIN_INDEX");
            expect((await on(app, spelling, "/assets/x.js")).body).toBe("ADMIN_ASSET");
        }
    });

    it("reads the Host header, never X-Forwarded-Host", async () => {
        // Any client can write a forwarded header; the proxy in front passes the
        // real Host through. Trusting it would let a request for the site pick
        // the admin.
        const app = apps();
        expect((await on(app, SITE, "/", { "x-forwarded-host": ADMIN })).body).toBe("SITE_INDEX");
        expect((await on(app, ADMIN, "/", { "x-forwarded-host": SITE })).body).toBe("ADMIN_INDEX");
    });

    it("falls back to the URL's host for a request that carries no Host header", async () => {
        // A request built in-process has only its URL to say where it is going.
        const app = apps();
        const res = await app.request(`https://${ADMIN}/`);
        expect(await res.text()).toBe("ADMIN_INDEX");
    });

    it("sets each app's cache headers on its own hostname", async () => {
        const app = apps();
        expect((await on(app, ADMIN, "/")).headers["cache-control"]).toBe("no-cache");
        expect((await on(app, ADMIN, "/deep")).headers["cache-control"]).toBe("no-cache");
        expect((await on(app, SITE, "/")).headers["cache-control"]).toBe("no-cache");
    });

    it("refuses a dot-file on the admin's hostname, as on any other", async () => {
        const app = mount([site(), {
            ...adminAtRoot(),
            dir: writeFiles(path.join(scratch, "admin"), { ".env": "SECRET=1" })
        }]);
        const { status, body } = await on(app, ADMIN, "/.env");
        expect(status).toBe(404);
        expect(body).not.toContain("SECRET");
    });

    it("does not depend on mount order — every mount asks the same resolver", async () => {
        // A bundle handed to boot in-process is not sorted by the loader.
        const app = mount([site(), adminAtRoot()], "as-given");
        expect((await on(app, ADMIN, "/")).body).toBe("ADMIN_INDEX");
        expect((await on(app, ADMIN, "/assets/x.js")).body).toBe("ADMIN_ASSET");
        expect((await on(app, SITE, "/")).body).toBe("SITE_INDEX");
    });
});

describe("an app at /cms on its own hostname, beside a site at /", () => {
    function apps(): Hono {
        return mount([site(), cmsUnderAdminHost()]);
    }

    it("serves the CMS under /cms on its hostname", async () => {
        const app = apps();
        expect((await on(app, ADMIN, "/cms")).body).toBe("CMS_INDEX");
        expect((await on(app, ADMIN, "/cms/collections/posts")).body).toBe("CMS_INDEX");
        expect((await on(app, ADMIN, "/cms/assets/x.js")).body).toBe("CMS_ASSET");
    });

    it("serves the site everywhere else on that hostname", async () => {
        // The site names no host, so it answers on every one — the admin's
        // included — wherever no other app claims the path.
        const app = apps();
        expect((await on(app, ADMIN, "/")).body).toBe("SITE_INDEX");
        expect((await on(app, ADMIN, "/other")).body).toBe("SITE_INDEX");
        expect((await on(app, ADMIN, "/assets/x.js")).body).toBe("SITE_ASSET");
    });

    it("leaves /cms to the site on the site's own hostname", async () => {
        // Excluding "/cms" by path — the rule a bundle without hosts uses —
        // would 404 this: the CMS does not answer here, and the site would
        // have been told not to.
        const app = apps();
        const { status, body } = await on(app, SITE, "/cms/anything");
        expect(status).toBe(200);
        expect(body).toBe("SITE_INDEX");
        expect((await on(app, SITE, "/cms")).body).toBe("SITE_INDEX");
    });

    it("does not serve the CMS's files on the site's hostname", async () => {
        const { status, body } = await on(apps(), SITE, "/cms/assets/x.js");
        expect(status).toBe(404);
        expect(body).not.toBe("CMS_ASSET");
    });

    it("does not let the CMS's build refuse a request the site owns", async () => {
        // The CMS is mounted first (longer path) and refuses any path that
        // resolves outside ITS build. Asked about the site's request, it would
        // judge the site's URL against the wrong directory — here a symlink in
        // the CMS build — and 404 a file the site has.
        const outside = writeFiles(path.join(scratch, "outside"), { "file.js": "OUTSIDE" });
        const cms = cmsUnderAdminHost();
        fs.symlinkSync(outside, path.join(cms.dir, "shared"));
        const withSharedFile = { ...site(), dir: writeFiles(path.join(scratch, "site"), { "cms/shared/file.js": "SITE_SHARED" }) };

        const { status, body } = await on(mount([withSharedFile, cms]), SITE, "/cms/shared/file.js");
        expect(status).toBe(200);
        expect(body).toBe("SITE_SHARED");
    });
});

describe("the runtime's own routes on an app's hostname", () => {
    function apps(): Hono {
        return mount([site(), adminAtRoot(), cmsUnderAdminHost()]);
    }

    it("answers the API", async () => {
        const { status, body } = await on(apps(), ADMIN, "/api/things");
        expect(status).toBe(200);
        expect(body).toBe('{"ok":true}');
    });

    it("answers the health probe", async () => {
        expect((await on(apps(), ADMIN, "/health")).body).toBe('{"status":"ok"}');
    });

    it("answers /.well-known, and never with an app's index", async () => {
        const app = apps();
        expect((await on(app, ADMIN, "/.well-known/jwks.json")).body).toBe('{"keys":[]}');
        const miss = await on(app, ADMIN, "/.well-known/nothing-here");
        expect(miss.status).toBe(404);
        expect(miss.body).not.toContain("INDEX");
    });

    it("does not answer an unknown API path with an app's index", async () => {
        const { status, body } = await on(apps(), ADMIN, "/api/nothing-here");
        expect(status).toBe(404);
        expect(body).not.toContain("INDEX");
    });
});

describe("a hostname no app claims", () => {
    it("is answered by no app, not by the nearest one", async () => {
        // With only host-bearing apps at "/", there is no app for any other
        // hostname. The API still answers there; the apps do not.
        const app = mount([adminAtRoot()]);
        expect((await on(app, SITE, "/")).status).toBe(404);
        expect((await on(app, SITE, "/assets/x.js")).status).toBe(404);
        expect((await on(app, SITE, "/api/things")).body).toBe('{"ok":true}');
        expect((await on(app, ADMIN, "/")).body).toBe("ADMIN_INDEX");
    });

    it("separates two apps on two hostnames at the same path", async () => {
        const other: LoadedStaticApp = {
            path: "/",
            host: "docs.example.com",
            spa: true,
            dir: build("docs", { "index.html": "DOCS_INDEX" })
        };
        const app = mount([site(), adminAtRoot(), other]);
        expect((await on(app, ADMIN, "/x")).body).toBe("ADMIN_INDEX");
        expect((await on(app, "docs.example.com", "/x")).body).toBe("DOCS_INDEX");
        expect((await on(app, SITE, "/x")).body).toBe("SITE_INDEX");
    });
});

/**
 * The promise the feature makes to every bundle already deployed: one that names
 * no hostname is served exactly as before hostnames existed.
 *
 * Checked by difference rather than by example. `mountAsBefore` is the mount
 * loop as it stood — longest path first, every app excluding the paths of the
 * apps nested beneath it — frozen here, and every request below must get the
 * same status, headers and body from it as from the real loader and planner.
 * The apps and requests are chosen for the corner where the host-aware
 * resolver WOULD answer differently, so a change that routed these bundles
 * through it fails here rather than in someone's production.
 */
describe("a bundle that names no hostname", () => {
    function writeBundle(): string {
        const dir = path.join(scratch, "bundle");
        writeFiles(dir, {
            // Files under a sibling's prefix, in the root app's build.
            "static/site/index.html": "SITE_INDEX",
            "static/site/assets/x.js": "SITE_ASSET",
            "static/site/admin/only-in-site-build.js": "SITE_FILE_UNDER_ADMIN",
            "static/site/docs/only-in-site-build.js": "SITE_FILE_UNDER_DOCS",
            "static/site/.env": "SECRET=1",
            "static/admin/index.html": "ADMIN_INDEX",
            "static/admin/assets/x.js": "ADMIN_ASSET",
            // An app nested inside another's path.
            "static/beta/index.html": "BETA_INDEX",
            "static/beta/assets/x.js": "BETA_ASSET",
            // A static site with a real file per route and no fallback.
            "static/docs/index.html": "DOCS_INDEX",
            "static/docs/page.html": "DOCS_PAGE"
        });
        // Deliberately not in mount order: ordering is the loader's job.
        writeFiles(dir, {
            "manifest.json": JSON.stringify({
                bundleFormat: BUNDLE_FORMAT_VERSION,
                runtime: { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION },
                schemaVersion: "",
                app: "web",
                kind: "static",
                entry: {
                    static: [
                        { path: "/", dir: "static/site", spa: true },
                        { path: "/docs", dir: "static/docs", spa: false },
                        { path: "/admin", dir: "static/admin", spa: true },
                        { path: "/admin/beta", dir: "static/beta", spa: true }
                    ]
                },
                hooks: { native: false },
                deps: { declared: {} },
                build: { cli: "test", node: "22", createdAt: "2026-09-30T00:00:00Z" }
            })
        });
        return dir;
    }

    /** The mount loop as it stood before apps could name a hostname. */
    function mountAsBefore(bundleDir: string): Hono {
        const app = withRuntimeRoutes();
        const apps: LoadedStaticApp[] = [
            { path: "/", dir: path.join(bundleDir, "static/site"), spa: true },
            { path: "/docs", dir: path.join(bundleDir, "static/docs"), spa: false },
            { path: "/admin", dir: path.join(bundleDir, "static/admin"), spa: true },
            { path: "/admin/beta", dir: path.join(bundleDir, "static/beta"), spa: true }
        ].sort((a, b) => b.path.length - a.path.length);
        for (const staticApp of apps) {
            const siblings = apps
                .filter(other => other !== staticApp)
                .map(other => other.path)
                .filter(other => other !== staticApp.path && isUnderPath(other, staticApp.path));
            serveSPA(app, {
                frontendPath: staticApp.dir,
                basePath: staticApp.path,
                apiBasePath: "/api",
                excludePaths: ["/health", "/livez", "/metrics", "/.well-known", ...siblings],
                spa: staticApp.spa
            });
        }
        return app;
    }

    const urls = [
        "/", "/deep/link", "/assets/x.js", "/assets/missing-A1b2C3d4.js",
        "/admin", "/admin/", "/admin/deep", "/admin/assets/x.js", "/admin/only-in-site-build.js",
        "/admin/beta", "/admin/beta/deep", "/admin/beta/assets/x.js",
        "/docs", "/docs/page.html", "/docs/missing", "/docs/only-in-site-build.js",
        "/administrators", "/apidocs", "/health-tips",
        "/api/things", "/api/missing", "/health", "/.well-known/jwks.json", "/.well-known/other",
        "/.env", "/admin/.env", "/%2e%2e/%2e%2e/etc/passwd"
    ];
    const variants: Array<Record<string, string>> = [
        {},
        { host: ADMIN },
        { host: SITE, "sec-fetch-dest": "script" },
        { host: SITE, "accept-encoding": "gzip" }
    ];

    it("loads in the order it always did, with no host on any app", () => {
        const bundle = loadBundle(writeBundle());
        expect(bundle.staticApps.map(a => a.path)).toEqual(["/admin/beta", "/admin", "/docs", "/"]);
        expect(bundle.staticApps.every(a => !("host" in a))).toBe(true);
    });

    it("answers every request exactly as the path-only mount did", async () => {
        const dir = writeBundle();
        const before = mountAsBefore(dir);
        const now = mount(loadBundle(dir).staticApps, "as-given");

        for (const url of urls) {
            for (const sent of variants) {
                const expected = await get(before, url, sent);
                const actual = await get(now, url, sent);
                // The request rides along so a failure names it.
                expect({ url, sent, ...actual }).toEqual({ url, sent, ...expected });
            }
        }
    });

    it("includes the corner the resolver would change, so the comparison means something", async () => {
        // What the path-only rule answers where the resolver would not. If
        // this changes, the difference above has stopped testing the rule it
        // claims to.
        const before = mountAsBefore(writeBundle());

        // "/docs" has no fallback, so the root app's static middleware finds
        // its own file there. The resolver gives the request to "/docs".
        const underDocs = await get(before, "/docs/only-in-site-build.js");
        expect([underDocs.status, underDocs.body]).toEqual([200, "SITE_FILE_UNDER_DOCS"]);

        // An app nested in another's path is NOT a corner any more: the two
        // rules agree since each app stopped excluding the app it sits in.
        expect((await get(before, "/admin/beta/deep")).body).toBe("BETA_INDEX");
    });
});

describe("loading a bundle whose apps name hostnames", () => {
    const runtime = { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION };

    function writeBundle(entries: Array<Record<string, unknown>>, dirs: string[]): string {
        const dir = fs.mkdtempSync(path.join(scratch, "bundle-"));
        writeFiles(dir, Object.fromEntries(dirs.map(d => [`${d}/index.html`, d])));
        writeFiles(dir, {
            "manifest.json": JSON.stringify({
                bundleFormat: BUNDLE_FORMAT_VERSION,
                runtime,
                schemaVersion: "",
                app: "web",
                kind: "static",
                entry: { static: entries },
                hooks: { native: false },
                deps: { declared: {} }
            })
        });
        return dir;
    }

    it("carries each app's host", () => {
        const dir = writeBundle([
            { path: "/", dir: "static/web", spa: true, name: "web" },
            { path: "/", dir: "static/admin", spa: true, name: "admin", host: ADMIN }
        ], ["static/web", "static/admin"]);

        const apps = loadBundle(dir).staticApps;
        expect(apps).toStrictEqual([
            { path: "/", host: ADMIN, dir: path.join(dir, "static/admin"), spa: true },
            { path: "/", dir: path.join(dir, "static/web"), spa: true }
        ]);
    });

    it("orders longest path first, and a host before none at an equal path", () => {
        const dir = writeBundle([
            { path: "/", dir: "static/web", spa: true },
            { path: "/", dir: "static/admin", spa: true, host: ADMIN },
            { path: "/docs", dir: "static/docs", spa: true },
            { path: "/cms", dir: "static/cms", spa: true, host: ADMIN },
            { path: "/blog", dir: "static/blog", spa: true }
        ], ["static/web", "static/admin", "static/docs", "static/cms", "static/blog"]);

        expect(loadBundle(dir).staticApps.map(a => `${a.host ?? "*"}${a.path}`))
            .toEqual(["*/docs", "*/blog", `${ADMIN}/cms`, `${ADMIN}/`, "*/"]);
    });

    it.each([
        ["an uppercase hostname", "Admin.Example.com"],
        ["a URL", "https://admin.example.com"],
        ["a hostname with a port", "admin.example.com:8443"],
        ["an IP address", "10.0.0.1"],
        ["localhost", "localhost"],
        ["a single label", "admin"],
        ["an empty string", ""],
        ["a number", 42],
        ["null", null]
    ])("refuses to boot on %s, naming the app", (_label, host) => {
        const dir = writeBundle([
            { path: "/", dir: "static/web", spa: true, name: "web" },
            { path: "/", dir: "static/admin", spa: true, name: "admin", host }
        ], ["static/web", "static/admin"]);

        // Dropping the host would serve the admin on every hostname — the
        // site's included — so this is a boot error, not a warning.
        expect(() => loadBundle(dir)).toThrow(BundleError);
        expect(() => loadBundle(dir)).toThrow(/Static app "admin" \(at \/\)/);
    });

    it("names the app by its directory when the bundle predates names", () => {
        const dir = writeBundle([
            { path: "/", dir: "static/admin", spa: true, host: "https://admin.example.com" }
        ], ["static/admin"]);
        expect(() => loadBundle(dir)).toThrow(/Static app "admin"/);
    });

    it("refuses a bad host even on an app whose build is missing", () => {
        // Otherwise the missing directory's warning is all anyone sees, and the
        // next build that includes it fails for a reason nobody was told.
        const dir = writeBundle([
            { path: "/", dir: "static/web", spa: true },
            { path: "/", dir: "static/gone", spa: true, name: "admin", host: "Admin.Example.com" }
        ], ["static/web"]);
        expect(() => loadBundle(dir)).toThrow(BundleError);
    });
});

/**
 * The whole chain from a bundle on disk: manifest → loader → planner → mount →
 * response, with no database, the way `boot-static.test.ts` checks the
 * path-only case.
 */
describe("booting a static bundle with an app on its own hostname", () => {
    let booted: BootedRuntime | undefined;
    let bundleScratch: string;

    beforeAll(async () => {
        bundleScratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-boot-host-"));
        const dir = writeFiles(path.join(bundleScratch, "dist-bundle"), {
            "static/web/index.html": "SITE_INDEX",
            "static/web/assets/app.js": "SITE_ASSET",
            "static/admin/index.html": "ADMIN_INDEX",
            "static/admin/assets/app.js": "ADMIN_ASSET",
            "static/cms/index.html": "CMS_INDEX",
            "manifest.json": JSON.stringify({
                bundleFormat: BUNDLE_FORMAT_VERSION,
                runtime: { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION },
                schemaVersion: "",
                app: "web",
                kind: "static",
                entry: {
                    static: [
                        { path: "/", dir: "static/web", spa: true, name: "web" },
                        { path: "/", dir: "static/admin", spa: true, name: "admin", host: ADMIN },
                        { path: "/cms", dir: "static/cms", spa: true, name: "cms", host: "cms.example.com" }
                    ]
                },
                hooks: { native: false },
                deps: { declared: {} },
                build: { cli: "test", node: "22", createdAt: "2026-09-30T00:00:00Z" }
            })
        });
        booted = await bootFromBundle({ bundleDir: dir, listen: false, handleSignals: false });
    });

    afterAll(async () => {
        await booted?.shutdown().catch(() => {});
        fs.rmSync(bundleScratch, { recursive: true, force: true });
    });

    async function fetchOn(host: string, url: string): Promise<{ status: number; body: string }> {
        const res = await booted!.app.fetch(new Request(`http://localhost${url}`, { headers: { host } }));
        return { status: res.status, body: await res.text() };
    }

    it("serves each hostname its own app at /", async () => {
        expect((await fetchOn(ADMIN, "/")).body).toBe("ADMIN_INDEX");
        expect((await fetchOn(ADMIN, "/assets/app.js")).body).toBe("ADMIN_ASSET");
        expect((await fetchOn(SITE, "/")).body).toBe("SITE_INDEX");
        expect((await fetchOn(SITE, "/assets/app.js")).body).toBe("SITE_ASSET");
    });

    it("serves a host app under its path, and the site beside it", async () => {
        expect((await fetchOn("cms.example.com", "/cms/posts")).body).toBe("CMS_INDEX");
        expect((await fetchOn("cms.example.com", "/elsewhere")).body).toBe("SITE_INDEX");
        expect((await fetchOn(SITE, "/cms/posts")).body).toBe("SITE_INDEX");
    });

    it("keeps the probes on every hostname", async () => {
        expect((await fetchOn(ADMIN, "/livez")).status).toBe(200);
        expect(JSON.parse((await fetchOn(ADMIN, "/health")).body).status).toBe("ok");
        expect(JSON.parse((await fetchOn(ADMIN, "/api/health")).body).status).toBe("ok");
    });
});
