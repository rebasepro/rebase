/**
 * A static app's `routes` and `frameAncestors`, as the CLI and the runtime both
 * read them.
 *
 * Both checks live in `@rebasepro/types` because a bundle can come from any
 * program: the runtime validates a bundle's entries with the same functions
 * the CLI validated the manifest with, so these pin what each will accept.
 * `frameAncestors` ends up inside a `Content-Security-Policy` header, so a
 * value that slips through here is a header another directive can be written
 * into.
 */
import { compareStaticRoutes, matchStaticRoute, parseFrameAncestor, validateStaticRoute } from "../src";

describe("validateStaticRoute", () => {
    it("accepts an exact path and a wildcard inside the app", () => {
        expect(validateStaticRoute({ path: "/sitemap.xml", function: "sitemap" }, "/"))
            .toEqual({ ok: true, route: { path: "/sitemap.xml", function: "sitemap" } });
        expect(validateStaticRoute({ path: "/blog/*", function: "blog" }, "/"))
            .toEqual({ ok: true, route: { path: "/blog/*", function: "blog" } });
        expect(validateStaticRoute({ path: "/docs/feed.xml", function: "feed" }, "/docs").ok).toBe(true);
        expect(validateStaticRoute({ path: "/", function: "home" }, "/").ok).toBe(true);
    });

    it("keeps only the two fields it knows", () => {
        expect(validateStaticRoute({ path: "/feed.xml", function: "feed", extra: 1 }, "/"))
            .toEqual({ ok: true, route: { path: "/feed.xml", function: "feed" } });
    });

    it.each([
        ["not an object", "x", undefined],
        ["a relative path", { path: "sitemap.xml", function: "s" }, "path"],
        ["a star in the middle", { path: "/blog/*/x", function: "s" }, "path"],
        ["a partial-segment star", { path: "/blog*", function: "s" }, "path"],
        ["a trailing slash", { path: "/blog/", function: "s" }, "path"],
        ["an empty segment", { path: "/a//b", function: "s" }, "path"],
        ["dot-dot", { path: "/a/../b", function: "s" }, "path"],
        ["a dot-segment", { path: "/.well-known/jwks.json", function: "s" }, "path"],
        ["a query", { path: "/feed.xml?x=1", function: "s" }, "path"],
        ["a percent-escape", { path: "/caf%C3%A9", function: "s" }, "path"],
        ["a space", { path: "/a b", function: "s" }, "path"],
        ["the API's prefix", { path: "/api/sitemap.xml", function: "s" }, "path"],
        ["a probe's prefix", { path: "/health", function: "s" }, "path"],
        ["no function", { path: "/feed.xml" }, "function"],
        ["a function with a slash", { path: "/feed.xml", function: "a/b" }, "function"],
        ["a function starting with a dot", { path: "/feed.xml", function: ".env" }, "function"]
    ])("refuses %s", (_label, value, field) => {
        const result = validateStaticRoute(value, "/");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.field).toBe(field);
    });

    it("refuses a path outside the app, which another app or nothing answers", () => {
        const result = validateStaticRoute({ path: "/sitemap.xml", function: "s" }, "/docs");
        expect(result).toMatchObject({ ok: false, field: "path" });
        // Segment-aware: `/docsearch` is not under `/docs`.
        expect(validateStaticRoute({ path: "/docsearch", function: "s" }, "/docs").ok).toBe(false);
    });

    it("refuses a wildcard over the whole app, which would leave its build unserved", () => {
        expect(validateStaticRoute({ path: "/*", function: "s" }, "/")).toMatchObject({ ok: false, field: "path" });
        expect(validateStaticRoute({ path: "/docs/*", function: "s" }, "/docs")).toMatchObject({ ok: false, field: "path" });
        expect(validateStaticRoute({ path: "/docs/api/*", function: "s" }, "/docs").ok).toBe(true);
    });
});

describe("matchStaticRoute", () => {
    it("matches an exact route on its path alone", () => {
        const route = { path: "/sitemap.xml", function: "sitemap" };
        expect(matchStaticRoute(route, "/sitemap.xml")).toBe("");
        expect(matchStaticRoute(route, "/sitemap.xml/x")).toBeUndefined();
        expect(matchStaticRoute(route, "/Sitemap.xml")).toBeUndefined();
    });

    it("hands a wildcard's function the rest of the path", () => {
        const route = { path: "/blog/*", function: "blog" };
        expect(matchStaticRoute(route, "/blog")).toBe("");
        expect(matchStaticRoute(route, "/blog/hello")).toBe("/hello");
        expect(matchStaticRoute(route, "/blog/2026/hello")).toBe("/2026/hello");
        expect(matchStaticRoute(route, "/blog/caf%C3%A9")).toBe("/caf%C3%A9");
        expect(matchStaticRoute(route, "/blogroll")).toBeUndefined();
        expect(matchStaticRoute(route, "/")).toBeUndefined();
    });
});

describe("compareStaticRoutes", () => {
    it("puts exact paths first, then the longer wildcard before the shorter", () => {
        const routes = [
            { path: "/blog/*", function: "blog" },
            { path: "/blog/drafts/*", function: "drafts" },
            { path: "/blog/feed.xml", function: "feed" }
        ];
        expect([...routes].sort(compareStaticRoutes).map(r => r.function)).toEqual(["feed", "drafts", "blog"]);
    });
});

describe("parseFrameAncestor", () => {
    it.each([
        "https://admin.example.com",
        "https://admin.example.com:8443",
        "https://localhost:5173",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://[::1]:5173"
    ])("accepts %s", (value) => {
        expect(parseFrameAncestor(value)).toEqual({ ok: true, origin: value });
    });

    it.each([
        ["a wildcard", "https://*.example.com"],
        ["a bare star", "*"],
        ["a keyword", "'self'"],
        ["a scheme alone", "https:"],
        ["no scheme", "admin.example.com"],
        ["plain http on a public host", "http://admin.example.com"],
        ["another scheme", "ftp://admin.example.com"],
        ["a path", "https://admin.example.com/cms"],
        ["a trailing slash", "https://admin.example.com/"],
        ["a capital", "https://Admin.example.com"],
        ["the default port", "https://admin.example.com:443"],
        ["credentials", "https://user@admin.example.com"],
        ["an IP address", "https://10.0.0.1"],
        ["a single label", "https://intranet"],
        ["an empty string", ""],
        ["a number", 42]
    ])("refuses %s", (_label, value) => {
        expect(parseFrameAncestor(value).ok).toBe(false);
    });

    it("refuses anything that could add a directive to the header", () => {
        for (const value of [
            "https://admin.example.com; script-src 'unsafe-inline'",
            "https://admin.example.com;report-uri x",
            "https://admin.example.com,https://evil.example",
            "https://admin.example.com https://evil.example",
            "https://admin.example.com\r\nX-Injected: 1",
            " https://admin.example.com"
        ]) {
            expect({ value, ok: parseFrameAncestor(value).ok }).toEqual({ value, ok: false });
        }
    });

    it("names the origin to write instead of a near miss", () => {
        const result = parseFrameAncestor("https://Admin.Example.com/");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('"https://admin.example.com"');
    });
});
