/**
 * A static app at "/" publishes the files in its build's `.well-known/`.
 *
 * Android App Links and iOS Universal Links are verified by fetching
 * `https://<host>/.well-known/assetlinks.json` and
 * `https://<host>/.well-known/apple-app-site-association` from the origin, and
 * nothing in a Rebase deployment could answer them: every dot path was refused
 * and `/.well-known` was excluded from the apps. Without that file an Android
 * phone opens a scanned link in the browser instead of the installed app.
 *
 * What must still hold around the exception:
 * - the backend's own documents (JWKS, OAuth/MCP metadata) answer unchanged,
 *   and a build cannot publish one of their names even where the backend's
 *   route is not mounted;
 * - a `.well-known` file the build does not have is a 404, never index.html;
 * - every other dot path stays refused, encoded or not, and a symlink cannot
 *   lead out of the build;
 * - only the app at "/" answers, and with hosts, the app owning the hostname.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { createJwksRoutes } from "./auth/jwks-routes";
import { createMcpWellKnownRoutes } from "./mcp/mcp-routes";
import { serveSPA, wellKnownFileName } from "./serve-spa";

const ASSET_LINKS = JSON.stringify([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: "com.example.app", sha256_cert_fingerprints: ["AA:BB"] }
}]);
const AASA = JSON.stringify({ applinks: { details: [{ appIDs: ["TEAM.com.example.app"], components: [{ "/": "/*" }] }] } });

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-well-known-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function build(name: string, files: Record<string, string>): string {
    const dir = path.join(scratch, name);
    for (const [relative, contents] of Object.entries(files)) {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }
    return dir;
}

const siteFiles = {
    "index.html": "<!doctype html><title>INDEX</title>",
    ".well-known/assetlinks.json": ASSET_LINKS,
    ".well-known/apple-app-site-association": AASA,
    ".well-known/security.txt": "Contact: mailto:security@example.com\n",
    ".well-known/nested/thing.json": '{"nested":true}',
    ".well-known/jwks.json": '{"keys":[{"kid":"FORGED"}]}',
    ".well-known/oauth-authorization-server": '{"issuer":"https://evil.example"}',
    ".well-known/.secret": "DOT-SECRET",
    ".env": "JWT_SECRET=hunter2",
    ".git/config": "[remote]\n  url = git@github.com:acme/private.git"
};

/**
 * The routes the backend registers before any static app, as `boot.ts` does:
 * the JWKS and the MCP discovery documents at the root.
 */
function withBackendRoutes(): Hono {
    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.route("/.well-known", createJwksRoutes());
    app.route("/", createMcpWellKnownRoutes({
        publicUrl: "https://api.example.com",
        mcpPath: "/mcp",
        oauthBasePath: "/api/oauth",
        getDriver: () => undefined,
        getTables: () => [],
        serverInfo: { name: "test", version: "0.0.0" }
    }));
    return app;
}

const EXCLUDES = ["/health", "/livez", "/metrics", "/.well-known"];

function siteApp(files: Record<string, string> = siteFiles, base: Hono = withBackendRoutes()): Hono {
    serveSPA(base, { frontendPath: build("site", files), apiBasePath: "/api", excludePaths: EXCLUDES });
    return base;
}

describe("an app at / serves its build's .well-known files", () => {
    it("serves assetlinks.json as JSON, with no redirect", async () => {
        const res = await siteApp().request("http://localhost/.well-known/assetlinks.json");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/json");
        expect(res.headers.get("location")).toBeNull();
        expect(await res.text()).toBe(ASSET_LINKS);
    });

    it("serves the extensionless apple-app-site-association as JSON", async () => {
        const res = await siteApp().request("http://localhost/.well-known/apple-app-site-association");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/json");
        expect(JSON.parse(await res.text())).toEqual(JSON.parse(AASA));
    });

    it("serves other files with their own type, nested ones included", async () => {
        const app = siteApp();
        const txt = await app.request("http://localhost/.well-known/security.txt");
        expect(txt.status).toBe(200);
        expect(txt.headers.get("content-type")).toMatch(/^text\/plain/);
        const nested = await app.request("http://localhost/.well-known/nested/thing.json");
        expect(nested.status).toBe(200);
        expect(await nested.text()).toBe('{"nested":true}');
    });

    it("revalidates, and answers a matching ETag with a 304", async () => {
        const app = siteApp();
        const first = await app.request("http://localhost/.well-known/assetlinks.json");
        expect(first.headers.get("cache-control")).toBe("no-cache");
        const etag = first.headers.get("etag");
        expect(etag).toBeTruthy();
        const again = await app.request("http://localhost/.well-known/assetlinks.json", {
            headers: { "if-none-match": etag as string }
        });
        expect(again.status).toBe(304);
    });

    it("answers a file the build does not have with a 404, not index.html", async () => {
        const app = siteApp();
        for (const url of ["/.well-known/missing.json", "/.well-known/", "/.well-known", "/.well-known/nested"]) {
            const res = await app.request(`http://localhost${url}`);
            expect([url, res.status]).toEqual([url, 404]);
            expect(await res.text()).not.toContain("INDEX");
        }
    });

    it("answers only GET and HEAD", async () => {
        const app = siteApp();
        const head = await app.request("http://localhost/.well-known/assetlinks.json", { method: "HEAD" });
        expect(head.status).toBe(200);
        const post = await app.request("http://localhost/.well-known/assetlinks.json", { method: "POST" });
        expect(post.status).toBe(404);
    });
});

describe("the backend's .well-known documents win", () => {
    it("leaves the JWKS and the OAuth/MCP documents unchanged", async () => {
        const bare = withBackendRoutes();
        const withSite = siteApp();
        for (const url of [
            "/.well-known/jwks.json",
            "/.well-known/oauth-authorization-server",
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp"
        ]) {
            const expected = await bare.request(`http://localhost${url}`);
            const actual = await withSite.request(`http://localhost${url}`);
            expect([url, actual.status]).toEqual([url, expected.status]);
            expect(actual.headers.get("content-type")).toBe(expected.headers.get("content-type"));
            const body = await actual.text();
            expect(body).toBe(await expected.text());
            expect(body).not.toContain("FORGED");
            expect(body).not.toContain("evil.example");
        }
    });

    it("never serves a backend name from the build, even where the backend did not mount it", async () => {
        // No backend routes at all: HMAC tokens publish no JWKS, and a split
        // deployment mounts `auth`/`mcp` in another process.
        const app = siteApp(siteFiles, new Hono());
        for (const url of [
            "/.well-known/jwks.json",
            "/.well-known/oauth-authorization-server",
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/openid-configuration",
            "/.well-known/acme-challenge/token"
        ]) {
            const res = await app.request(`http://localhost${url}`);
            expect([url, res.status]).toEqual([url, 404]);
            const body = await res.text();
            expect(body).not.toContain("FORGED");
            expect(body).not.toContain("evil.example");
        }
    });
});

describe("every other dot path stays refused", () => {
    it.each([
        "/.env",
        "/.git/config",
        "/%2e%65nv",
        "/%2Egit/config",
        "/.well-known/.secret",
        "/.well-known/%2esecret",
        "/.well-known/../.env",
        "/.well-known/%2e%2e/.env",
        "/.well-known/%2e%2e%2f.env",
        "/.well-known/..%2f.git%2fconfig",
        "/.well-known/nested%5c..%5c..%5c.env",
        "/%2ewell-known/../.env"
    ])("refuses %s", async (url) => {
        const res = await siteApp().request(`http://localhost${url}`);
        expect(res.status).not.toBe(200);
        const body = await res.text();
        expect(body).not.toContain("hunter2");
        expect(body).not.toContain("acme/private");
        expect(body).not.toContain("DOT-SECRET");
        expect(body).not.toContain("INDEX");
    });

    it("refuses a .well-known file that is a symlink out of the build", async () => {
        const outside = path.join(scratch, "outside.json");
        fs.writeFileSync(outside, '{"secret":"OUTSIDE"}');
        const files = { "index.html": "<!doctype html><title>INDEX</title>" };
        const dir = build("linked", files);
        fs.mkdirSync(path.join(dir, ".well-known"));
        fs.symlinkSync(outside, path.join(dir, ".well-known", "assetlinks.json"));
        const app = withBackendRoutes();
        serveSPA(app, { frontendPath: dir, apiBasePath: "/api", excludePaths: EXCLUDES });
        const res = await app.request("http://localhost/.well-known/assetlinks.json");
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("OUTSIDE");
    });

    it("judges paths with wellKnownFileName", () => {
        expect(wellKnownFileName("/.well-known/assetlinks.json")).toBe("assetlinks.json");
        expect(wellKnownFileName("/.well-known/a/b.json")).toBe("a/b.json");
        expect(wellKnownFileName("/.well-known/a%20b.json")).toBe("a b.json");
        for (const refused of [
            "/.well-known", "/.well-known/", "/.well-known//x", "/.well-known/x/",
            "/.well-known/.x", "/.well-known/a/../x", "/.well-known/a\\x", "/.well-known/%E0%A4%A",
            "/.well-known/jwks.json", "/.well-known/acme-challenge/t", "/env/.well-known/x", "/x"
        ]) {
            expect([refused, wellKnownFileName(refused)]).toEqual([refused, null]);
        }
    });
});

describe("which app answers", () => {
    it("an app under a prefix publishes nothing from .well-known", async () => {
        const app = withBackendRoutes();
        serveSPA(app, {
            frontendPath: build("admin", siteFiles),
            basePath: "/admin",
            apiBasePath: "/api",
            excludePaths: EXCLUDES
        });
        // `/admin/.well-known` is not a URL anything fetches: still a dot path.
        const nested = await app.request("http://localhost/admin/.well-known/assetlinks.json");
        expect(nested.status).toBe(404);
        expect(await nested.text()).not.toContain("delegate_permission");
        // And the origin's is not the prefixed app's to answer.
        const root = await app.request("http://localhost/.well-known/assetlinks.json");
        expect(root.status).toBe(404);
    });

    it("an app at / still serves its own beside a sibling under a prefix", async () => {
        const app = withBackendRoutes();
        serveSPA(app, {
            frontendPath: build("admin", { "index.html": "ADMIN", ".well-known/assetlinks.json": "[\"ADMIN\"]" }),
            basePath: "/admin",
            apiBasePath: "/api",
            excludePaths: EXCLUDES
        });
        serveSPA(app, {
            frontendPath: build("site", siteFiles),
            apiBasePath: "/api",
            excludePaths: [...EXCLUDES, "/admin"]
        });
        const res = await app.request("http://localhost/.well-known/assetlinks.json");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(ASSET_LINKS);
    });

    it("with host-scoped apps at /, each hostname gets its own app's file", async () => {
        const app = withBackendRoutes();
        const hostOf = (host: string) => host.replace(/:\d+$/, "").toLowerCase();
        serveSPA(app, {
            frontendPath: build("admin", { "index.html": "ADMIN", ".well-known/assetlinks.json": "[\"ADMIN\"]" }),
            apiBasePath: "/api",
            excludePaths: EXCLUDES,
            owns: ({ host }) => hostOf(host) === "admin.example.com"
        });
        serveSPA(app, {
            frontendPath: build("site", siteFiles),
            apiBasePath: "/api",
            excludePaths: EXCLUDES,
            owns: ({ host }) => hostOf(host) !== "admin.example.com"
        });
        const admin = await app.request("http://localhost/.well-known/assetlinks.json", { headers: { host: "admin.example.com" } });
        expect(await admin.text()).toBe("[\"ADMIN\"]");
        const site = await app.request("http://localhost/.well-known/assetlinks.json", { headers: { host: "example.com" } });
        expect(await site.text()).toBe(ASSET_LINKS);
        // A file only one hostname's build has is a 404 on the other, not a fallthrough.
        const aasa = await app.request("http://localhost/.well-known/apple-app-site-association", { headers: { host: "admin.example.com" } });
        expect(aasa.status).toBe(404);
        // The backend's documents answer on every hostname.
        const jwks = await app.request("http://localhost/.well-known/jwks.json", { headers: { host: "admin.example.com" } });
        expect(jwks.status).toBe(200);
        expect(await jwks.text()).not.toContain("FORGED");
    });
});
