/**
 * Several static apps in one process.
 *
 * The failure this guards is quiet: mount order and sibling exclusion are two
 * separate requirements, and getting only one of them produces the *site's*
 * index.html under the admin's URL — which reads as an admin bug for a long
 * time before anyone suspects routing.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { serveSPA } from "./serve-spa";

interface MountedApp {
    path: string;
    dir: string;
    spa: boolean;
}

let scratch: string;

function writeApp(name: string, files: Record<string, string>): string {
    const dir = path.join(scratch, name);
    for (const [relative, contents] of Object.entries(files)) {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }
    return dir;
}

/**
 * Mount apps exactly as `bootFromBundle` does: longest path first, and every
 * app excluding its siblings.
 */
function mount(apps: MountedApp[]): Hono {
    const app = new Hono();

    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/api/things", (c) => c.json({ ok: true }));

    const ordered = [...apps].sort((a, b) => b.path.length - a.path.length);
    for (const staticApp of ordered) {
        const siblings = ordered
            .filter(other => other !== staticApp)
            .map(other => other.path)
            .filter(other => other !== "/");
        serveSPA(app, {
            frontendPath: staticApp.dir,
            basePath: staticApp.path,
            apiBasePath: "/api",
            excludePaths: ["/health", "/livez", "/metrics", ...siblings],
            spa: staticApp.spa
        });
    }
    return app;
}

async function get(app: Hono, url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
    const res = await app.request(`http://localhost${url}`, headers ? { headers } : undefined);
    return { status: res.status,
body: await res.text() };
}

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-serve-spa-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function twoApps(): Hono {
    return mount([
        {
            path: "/",
            spa: true,
            dir: writeApp("site", {
                "index.html": "SITE_INDEX",
                "assets/x.js": "SITE_ASSET"
            })
        },
        {
            path: "/admin",
            spa: true,
            dir: writeApp("admin", {
                "index.html": "ADMIN_INDEX",
                "assets/x.js": "ADMIN_ASSET"
            })
        }
    ]);
}

describe("serveSPA with two apps in one process", () => {
    it("serves the site at the root", async () => {
        expect((await get(twoApps(), "/")).body).toBe("SITE_INDEX");
    });

    it("serves the admin at its own path", async () => {
        expect((await get(twoApps(), "/admin")).body).toBe("ADMIN_INDEX");
    });

    it("resolves a prefixed asset inside the admin's build, not the site's", async () => {
        // The prefix is a serving concern, not a directory: /admin/assets/x.js
        // lives at <adminBuild>/assets/x.js.
        expect((await get(twoApps(), "/admin/assets/x.js")).body).toBe("ADMIN_ASSET");
    });

    it("keeps the site's assets working alongside it", async () => {
        expect((await get(twoApps(), "/assets/x.js")).body).toBe("SITE_ASSET");
    });

    it("answers a deep link under /admin with the ADMIN index, not the site's", async () => {
        // The single most important assertion here.
        expect((await get(twoApps(), "/admin/deep/link")).body).toBe("ADMIN_INDEX");
    });

    it("answers a deep link at the root with the site's index", async () => {
        expect((await get(twoApps(), "/deep/link")).body).toBe("SITE_INDEX");
    });

    it("does not swallow the API", async () => {
        const { status, body } = await get(twoApps(), "/api/things");
        expect(status).toBe(200);
        expect(body).toBe('{"ok":true}');
    });

    it("does not swallow the health probe", async () => {
        expect((await get(twoApps(), "/health")).body).toBe('{"status":"ok"}');
    });
});

describe("serveSPA edge cases", () => {
    it("does not fall through to a sibling's index when a sub-app has no SPA fallback", async () => {
        // With spa:false there is no catch-all under /docs, so without the
        // sibling exclusion the root app would answer with the site's HTML.
        const app = mount([
            { path: "/", spa: true, dir: writeApp("site", { "index.html": "SITE_INDEX" }) },
            { path: "/docs", spa: false, dir: writeApp("docs", { "index.html": "DOCS_INDEX" }) }
        ]);

        expect((await get(app, "/docs")).body).toBe("DOCS_INDEX");
        expect((await get(app, "/docs/missing")).body).not.toBe("SITE_INDEX");
    });

    it("normalizes a trailing slash on the base path", async () => {
        const app = new Hono();
        serveSPA(app, {
            frontendPath: writeApp("admin", { "index.html": "ADMIN_INDEX" }),
            basePath: "/admin/",
            apiBasePath: "/api"
        });

        expect((await get(app, "/admin")).body).toBe("ADMIN_INDEX");
        expect((await get(app, "/admin/deep")).body).toBe("ADMIN_INDEX");
    });

    // Exclusion is by path segment, not by string prefix. As a `startsWith`
    // these all 404'd: the root app's SPA fallback declined them and nothing
    // else claims the path. The `/api` case needs no sibling app at all, so it
    // reached single-SPA setups too.
    it.each([
        ["/administrators", "a sibling app's name"],
        ["/apidocs", "the API base path"],
        ["/health-tips", "an excluded probe path"]
    ])("serves %s — it only shares a prefix with %s", async (route) => {
        expect((await get(twoApps(), route)).body).toBe("SITE_INDEX");
    });

    it("still excludes the segment itself and everything under it", async () => {
        const app = twoApps();
        expect((await get(app, "/admin")).body).toBe("ADMIN_INDEX");
        expect((await get(app, "/admin/deep/link")).body).toBe("ADMIN_INDEX");
        expect((await get(app, "/health")).body).toBe('{"status":"ok"}');
        expect((await get(app, "/api/things")).body).toBe('{"ok":true}');
    });

    // A deploy replaces the hashed asset files, so a tab opened before it asks
    // for chunks that are gone. Answering those with index.html is a 200 of
    // HTML under a .js URL: the browser refuses it as a module and reports
    // "Failed to fetch dynamically imported module", which names the chunk and
    // reads as a broken build rather than a stale tab.
    it.each([
        ["/assets/RouterCollectionsStudioView-old-hash.js", "a chunk from a previous build"],
        ["/admin/assets/index-old-hash.js", "a chunk under a sub-app"],
        ["/assets/index-old.css", "a stylesheet"],
        ["/assets/index-old.js.map", "a sourcemap"],
        ["/fonts/inter.woff2", "a font"]
    ])("404s %s rather than serving the index — it is %s", async (missing) => {
        const { status, body } = await get(twoApps(), missing);
        expect(status).toBe(404);
        expect(body).not.toContain("INDEX");
    });

    it("404s a missing asset the browser labels, whatever its extension", async () => {
        // Sec-Fetch-Dest is the browser telling us what it will do with the
        // response. It will not render HTML as a script.
        const { status } = await get(twoApps(), "/assets/chunk-with-no-extension", { "sec-fetch-dest": "script" });
        expect(status).toBe(404);
    });

    it("still serves the app for a navigation, and for ids that look like filenames", async () => {
        const app = twoApps();
        expect((await get(app, "/c/users/ada@example.com", { "sec-fetch-dest": "document" })).body).toBe("SITE_INDEX");
        // An entity id can be any dotted string; only build extensions 404.
        expect((await get(app, "/c/posts/v1.2.3-draft")).body).toBe("SITE_INDEX");
        expect((await get(app, "/admin/c/users/ada@example.com")).body).toBe("ADMIN_INDEX");
    });

    it("keeps serving assets that do exist", async () => {
        expect((await get(twoApps(), "/assets/x.js")).body).toBe("SITE_ASSET");
    });

    it("disables itself, without throwing, when the directory is missing", async () => {
        // It warns rather than throwing — which is why a mount must be verified
        // by fetching it, never by reading the logs.
        const app = new Hono();
        app.get("*", (c) => c.text("FELL_THROUGH"));
        expect(() => serveSPA(app, {
            frontendPath: path.join(scratch, "does-not-exist"),
            basePath: "/admin"
        })).not.toThrow();

        expect((await get(app, "/admin")).body).toBe("FELL_THROUGH");
    });
});
