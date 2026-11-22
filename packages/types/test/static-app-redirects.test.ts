/**
 * A static app's `redirects` and `cleanUrls`, as the CLI and every server of a
 * static app read them.
 *
 * The validator and the matcher live in `@rebasepro/types` because three
 * parties must agree: the CLI while `rebase.json` is edited, the runtime when
 * it loads a bundle (any program could have written it), and whatever answers
 * the request. These pin what each accepts and what a request is answered with.
 */
import {
    cleanUrlFor,
    compileStaticRedirects,
    isStaticRedirectStatus,
    validateStaticRedirect,
    type RebaseStaticRedirect,
    type StaticRedirectRequest
} from "../src";

const ROOT = { path: "/" };

function answer(redirects: RebaseStaticRedirect[], request: Partial<StaticRedirectRequest> & { path: string }) {
    return compileStaticRedirects(redirects)({ host: "example.com", search: "", ...request });
}

describe("validateStaticRedirect", () => {
    it("accepts the shapes a Vercel or Netlify migration writes", () => {
        for (const redirect of [
            { from: "/old", to: "/new" },
            { from: "/blog/:slug", to: "/posts/:slug", status: 301 },
            { from: "/docs/:path*", to: "/guide/:path*" },
            { from: "/:path*", to: "https://www.example.com/:path*", host: "example.com" },
            { from: "/", to: "/demo.html", notHost: "app.example.com" },
            { from: "/", to: "/es", query: { lang: "es" }, status: 302 },
            { from: "/privacy", to: "https://legal.example.com/privacy?from=site" },
            { from: "/café", to: "/cafe" },
            { from: "/a/:x/b/:y", to: "/b/:y/a/:x" }
        ]) {
            expect({ redirect, result: validateStaticRedirect(redirect, ROOT) })
                .toEqual({ redirect, result: { ok: true, redirect } });
        }
    });

    it("keeps only the fields it knows", () => {
        expect(validateStaticRedirect({ from: "/a", to: "/b", permanent: true }, ROOT))
            .toEqual({ ok: true, redirect: { from: "/a", to: "/b" } });
    });

    it.each([
        ["not an object", "x", undefined],
        ["no from", { to: "/b" }, "from"],
        ["a relative from", { from: "old", to: "/b" }, "from"],
        ["a from without a scheme", { from: "//example.com/x", to: "/b" }, "from"],
        ["a trailing slash", { from: "/old/", to: "/b" }, "from"],
        ["an empty segment", { from: "/a//b", to: "/b" }, "from"],
        ["a dot segment", { from: "/.well-known/x", to: "/b" }, "from"],
        ["an escaped dot-dot", { from: "/a/%2e%2e", to: "/b" }, "from"],
        ["a query in from", { from: "/old?x=1", to: "/b" }, "from"],
        ["a space", { from: "/a b", to: "/b" }, "from"],
        ["a star outside a parameter", { from: "/blog/*", to: "/b" }, "from"],
        ["a colon inside a segment", { from: "/post-:id", to: "/b" }, "from"],
        ["a bad parameter name", { from: "/:1st", to: "/b" }, "from"],
        ["a rest parameter before the end", { from: "/:path*/edit", to: "/b" }, "from"],
        ["a parameter named twice", { from: "/:a/:a", to: "/b" }, "from"],
        ["the API's prefix", { from: "/api/v1/:path*", to: "/b" }, "from"],
        ["a probe's prefix", { from: "/health", to: "/b" }, "from"],
        ["no to", { from: "/a" }, "to"],
        ["a relative to", { from: "/a", to: "b" }, "to"],
        ["a protocol-relative to", { from: "/a", to: "//evil.example/x" }, "to"],
        ["a to with a backslash", { from: "/a", to: "/\\evil.example" }, "to"],
        ["a to with a space", { from: "/a", to: "/b c" }, "to"],
        ["another scheme", { from: "/a", to: "javascript:alert(1)" }, "to"],
        ["credentials in to", { from: "/a", to: "https://user:pw@example.com/" }, "to"],
        ["a parameter in to's host", { from: "/:sub", to: "https://:sub.example.com/" }, "to"],
        ["an undeclared parameter", { from: "/blog/:slug", to: "/posts/:id" }, "to"],
        ["a status that is not a redirect", { from: "/a", to: "/b", status: 200 }, "status"],
        ["a status as a string", { from: "/a", to: "/b", status: "301" }, "status"],
        ["a host with a scheme", { from: "/a", to: "/b", host: "https://example.com" }, "host"],
        ["a host with a capital", { from: "/a", to: "/b", host: "Example.com" }, "host"],
        ["a notHost with a port", { from: "/a", to: "/b", notHost: "example.com:443" }, "notHost"],
        ["a notHost that is not a string", { from: "/a", to: "/b", notHost: ["example.com"] }, "notHost"],
        ["a notHost beside a host", { from: "/a", to: "/b", host: "example.com", notHost: "www.example.com" }, "notHost"],
        ["a query that is a string", { from: "/a", to: "/b", query: "lang=es" }, "query"],
        ["a query value that is not a string", { from: "/a", to: "/b", query: { lang: true } }, "query"]
    ])("refuses %s", (_label, value, field) => {
        const result = validateStaticRedirect(value, ROOT);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.field).toBe(field);
    });

    it("names Vercel's spelling of from and to", () => {
        const source = validateStaticRedirect({ source: "/old", destination: "/new" }, ROOT);
        expect(source).toMatchObject({ ok: false, field: "from" });
        if (!source.ok) expect(source.reason).toContain('"source" is "from"');
        const destination = validateStaticRedirect({ from: "/old", destination: "/new" }, ROOT);
        expect(destination).toMatchObject({ ok: false, field: "to" });
        if (!destination.ok) expect(destination.reason).toContain('"destination" is "to"');
    });

    it("refuses a from outside the app, which another app or nothing answers", () => {
        expect(validateStaticRedirect({ from: "/blog/old", to: "/x" }, { path: "/docs" }))
            .toMatchObject({ ok: false, field: "from" });
        // Segment-aware: `/docsearch` is not under `/docs`.
        expect(validateStaticRedirect({ from: "/docsearch", to: "/x" }, { path: "/docs" }).ok).toBe(false);
        // A parameter where the app's path should be names the fix.
        const result = validateStaticRedirect({ from: "/:slug", to: "/x" }, { path: "/docs" });
        expect(result).toMatchObject({ ok: false, field: "from" });
        if (!result.ok) expect(result.reason).toContain('"/docs/:slug"');
        expect(validateStaticRedirect({ from: "/docs/:path*", to: "/x" }, { path: "/docs" }).ok).toBe(true);
    });

    it("refuses a host the app never answers on", () => {
        const app = { host: "www.example.com", path: "/" };
        expect(validateStaticRedirect({ from: "/a", to: "/b", host: "example.com" }, app))
            .toMatchObject({ ok: false, field: "host" });
        expect(validateStaticRedirect({ from: "/a", to: "/b", host: "www.example.com" }, app).ok).toBe(true);
    });

    it("refuses a notHost that is the app's only hostname, and keeps one that is not", () => {
        const app = { host: "www.example.com", path: "/" };
        expect(validateStaticRedirect({ from: "/a", to: "/b", notHost: "www.example.com" }, app))
            .toMatchObject({ ok: false, field: "notHost" });
        expect(validateStaticRedirect({ from: "/a", to: "/b", notHost: "example.com" }, app))
            .toEqual({ ok: true, redirect: { from: "/a", to: "/b", notHost: "example.com" } });
    });

    it("still finds a loop on a notHost redirect, whichever hostname it excludes", () => {
        for (const notHost of ["example.com", "app.example.com"]) {
            expect(validateStaticRedirect({ from: "/:path*", to: "/new/:path*", notHost }, ROOT))
                .toMatchObject({ ok: false, field: "to" });
        }
    });

    it.each([
        ["to itself", { from: "/a", to: "/a" }],
        ["to itself with a slash", { from: "/docs", to: "/docs/" }],
        ["everything under a prefix it matches", { from: "/:path*", to: "/new/:path*" }],
        ["a section into itself", { from: "/docs/:path*", to: "/docs/v2/:path*" }],
        ["on a hostname, to the same hostname", { from: "/:path*", to: "/www/:path*", host: "example.com" }],
        ["on a query it keeps", { from: "/", to: "/", query: { lang: "es" } }],
        ["to a query it does not condition on", { from: "/", to: "/?x=1" }]
    ])("refuses a redirect loop: %s", (_label, value) => {
        const result = validateStaticRedirect(value, ROOT);
        expect(result).toMatchObject({ ok: false, field: "to" });
        if (!result.ok) expect(result.reason).toContain("forever");
    });

    it("accepts what only looks like a loop", () => {
        // A different query in `to` no longer meets the condition.
        expect(validateStaticRedirect({ from: "/", to: "/?ref=new", query: { ref: "old" } }, ROOT).ok).toBe(true);
        // Another hostname is another site, whatever its path.
        expect(validateStaticRedirect({ from: "/:path*", to: "https://www.example.com/:path*" }, ROOT).ok).toBe(true);
        // One segment does not match two.
        expect(validateStaticRedirect({ from: "/blog/:slug", to: "/blog/posts/:slug" }, ROOT).ok).toBe(true);
    });
});

describe("isStaticRedirectStatus", () => {
    it("is the four redirect statuses and nothing else", () => {
        expect([301, 302, 307, 308].every(isStaticRedirectStatus)).toBe(true);
        expect([200, 303, 404, "308", undefined].some(isStaticRedirectStatus)).toBe(false);
    });
});

describe("compileStaticRedirects", () => {
    it("answers a literal path, with 308 unless told otherwise", () => {
        expect(answer([{ from: "/old", to: "/new" }], { path: "/old" })).toEqual({ status: 308, location: "/new" });
        expect(answer([{ from: "/old", to: "/new", status: 301 }], { path: "/old" })).toEqual({ status: 301, location: "/new" });
        expect(answer([{ from: "/old", to: "/new" }], { path: "/older" })).toBeUndefined();
        expect(answer([{ from: "/old", to: "/new" }], { path: "/old/x" })).toBeUndefined();
    });

    it("ignores a trailing slash on the request", () => {
        expect(answer([{ from: "/old", to: "/new" }], { path: "/old/" })?.location).toBe("/new");
        expect(answer([{ from: "/", to: "/es" }], { path: "/" })?.location).toBe("/es");
    });

    it("matches case-sensitively, as a URL path is", () => {
        expect(answer([{ from: "/Old", to: "/new" }], { path: "/old" })).toBeUndefined();
    });

    it("substitutes a one-segment parameter", () => {
        const redirects = [{ from: "/blog/:slug", to: "/posts/:slug.html" }];
        expect(answer(redirects, { path: "/blog/hello" })?.location).toBe("/posts/hello.html");
        expect(answer(redirects, { path: "/blog/a/b" })).toBeUndefined();
        expect(answer(redirects, { path: "/blog" })).toBeUndefined();
    });

    it("substitutes the rest of the path, and nothing for none of it", () => {
        const redirects = [{ from: "/old/:path*", to: "/new/:path*" }];
        expect(answer(redirects, { path: "/old/a/b/c" })?.location).toBe("/new/a/b/c");
        expect(answer(redirects, { path: "/old" })?.location).toBe("/new");
        expect(answer(redirects, { path: "/old/" })?.location).toBe("/new");
        expect(answer(redirects, { path: "/older" })).toBeUndefined();
        expect(answer([{ from: "/:path*", to: "https://www.example.com/:path*" }], { path: "/" })?.location)
            .toBe("https://www.example.com");
    });

    it("sends a whole hostname to another, path and query kept", () => {
        const redirects = [{ from: "/:path*", to: "https://www.example.com/:path*", host: "example.com" }];
        expect(answer(redirects, { path: "/pricing/team", search: "?ref=ad" }))
            .toEqual({ status: 308, location: "https://www.example.com/pricing/team?ref=ad" });
        expect(answer(redirects, { host: "www.example.com", path: "/pricing" })).toBeUndefined();
    });

    it("keeps the request's query string unless `to` has its own", () => {
        expect(answer([{ from: "/a", to: "/b" }], { path: "/a", search: "?x=1&y=2" })?.location).toBe("/b?x=1&y=2");
        expect(answer([{ from: "/a", to: "/b?z=3" }], { path: "/a", search: "?x=1" })?.location).toBe("/b?z=3");
        expect(answer([{ from: "/a", to: "/b#top" }], { path: "/a", search: "?x=1" })?.location).toBe("/b?x=1#top");
        expect(answer([{ from: "/a", to: "/b" }], { path: "/a", search: "?" })?.location).toBe("/b");
    });

    it("answers a query condition on exact values only", () => {
        const redirects = [{ from: "/", to: "/es", query: { lang: "es" } }];
        expect(answer(redirects, { path: "/", search: "?lang=es" })?.location).toBe("/es?lang=es");
        expect(answer(redirects, { path: "/", search: "?x=1&lang=es" })?.location).toBe("/es?x=1&lang=es");
        expect(answer(redirects, { path: "/", search: "?lang=en" })).toBeUndefined();
        expect(answer(redirects, { path: "/", search: "?lang=ES" })).toBeUndefined();
        expect(answer(redirects, { path: "/" })).toBeUndefined();
        // Decoded before comparing: the value is the parameter's, not its spelling.
        expect(answer([{ from: "/", to: "/x", query: { q: "a b" } }], { path: "/", search: "?q=a+b" })).toBeDefined();
        // "" is the parameter present with no value.
        const present = [{ from: "/", to: "/x", query: { preview: "" } }];
        expect(answer(present, { path: "/", search: "?preview" })).toBeDefined();
        expect(answer(present, { path: "/", search: "?preview=" })).toBeDefined();
        expect(answer(present, { path: "/", search: "?preview=1" })).toBeUndefined();
    });

    it("answers a host condition on that hostname only", () => {
        const redirects = [{ from: "/a", to: "/b", host: "old.example.com" }];
        expect(answer(redirects, { host: "old.example.com", path: "/a" })).toBeDefined();
        expect(answer(redirects, { host: "example.com", path: "/a" })).toBeUndefined();
    });

    it("answers a negated host condition on every hostname but that one", () => {
        const redirects = [{ from: "/", to: "/demo.html", notHost: "app.example.com", status: 307 as const }];
        expect(answer(redirects, { host: "example.com", path: "/" })).toEqual({ status: 307, location: "/demo.html" });
        expect(answer(redirects, { host: "www.example.com", path: "/" })?.location).toBe("/demo.html");
        expect(answer(redirects, { host: "app.example.com", path: "/" })).toBeUndefined();
    });

    it("ports a vercel.json pair of has and missing host conditions one to one", () => {
        // "/" is the app on app.example.com, and the demo everywhere else.
        const redirects: RebaseStaticRedirect[] = [
            { from: "/", to: "/app.html", host: "app.example.com", status: 307 },
            { from: "/", to: "/demo.html", notHost: "app.example.com", status: 307 }
        ];
        expect(answer(redirects, { host: "app.example.com", path: "/" })?.location).toBe("/app.html");
        expect(answer(redirects, { host: "example.com", path: "/", search: "?ref=x" })?.location).toBe("/demo.html?ref=x");
        expect(answer(redirects, { host: "app.example.com", path: "/other" })).toBeUndefined();
    });

    it("answers with the first redirect that matches, in declaration order", () => {
        const redirects = [
            { from: "/docs/legacy", to: "/archive" },
            { from: "/docs/:path*", to: "/guide/:path*" }
        ];
        expect(answer(redirects, { path: "/docs/legacy" })?.location).toBe("/archive");
        expect(answer(redirects, { path: "/docs/start" })?.location).toBe("/guide/start");
        expect(answer([], { path: "/docs" })).toBeUndefined();
    });

    it("matches a literal written with letters a browser escapes", () => {
        expect(answer([{ from: "/café", to: "/cafe" }], { path: "/caf%C3%A9" })?.location).toBe("/cafe");
        expect(answer([{ from: "/caf%C3%A9", to: "/cafe" }], { path: "/caf%C3%A9" })?.location).toBe("/cafe");
    });

    it("carries a parameter's escapes through unchanged, and never leaves the hostname", () => {
        const redirects = [{ from: "/go/:target", to: "/:target" }];
        // An encoded slash stays encoded: it does not become a second segment.
        expect(answer(redirects, { path: "/go/evil.example%2Fx" })?.location).toBe("/evil.example%2Fx");
        // No parameter captures an empty segment, so nothing builds `//host`.
        expect(answer([{ from: "/:path*", to: "/new/:path*" }], { path: "//evil.example" })).toBeUndefined();
    });
});

describe("cleanUrlFor", () => {
    it.each([
        ["/about.html", "/about"],
        ["/legal/terms.html", "/legal/terms"],
        ["/index.html", "/"],
        ["/docs/index.html", "/docs/"],
        ["/about", undefined],
        ["/app.js", undefined],
        ["/.html", undefined],
        ["/docs/.html", undefined]
    ])("sends %j to %j", (requestPath, expected) => {
        expect(cleanUrlFor(requestPath)).toBe(expected);
    });
});
