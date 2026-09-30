import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    assessManagedCompatibility,
    buildableApps,
    cmsMountOf,
    compareMountOrder,
    CURRENT_RUNTIME_RANGE,
    formatAppAddress,
    loadManifest,
    ManifestError,
    resolveBackendPaths,
    selectDeployApp,
    staticAppAddress,
    synthesizeManifest,
    validateManifest,
    writeManifest
} from "./manifest";

const here = path.dirname(fileURLToPath(import.meta.url));

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-manifest-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
});

function touch(relative: string): void {
    const full = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
}

function mkdir(relative: string): void {
    fs.mkdirSync(path.join(scratch, relative), { recursive: true });
}

describe("validateManifest", () => {
    it("accepts a minimal manifest", () => {
        const { manifest, issues } = validateManifest({
            rebase: "^1",
            apps: { backend: { type: "backend",
runtime: "managed" } }
        });

        expect(issues).toEqual([]);
        expect(manifest?.apps.backend.type).toBe("backend");
    });

    it("requires the rebase range", () => {
        const { issues } = validateManifest({ apps: {} });
        expect(issues.some(i => i.path === "rebase")).toBe(true);
    });

    it("names the rename when the old top-level `runtime` key is used", () => {
        // `runtime` now means who owns the backend process, so a manifest using
        // it at the top level is naming the wrong thing, not missing a field.
        const { issues } = validateManifest({
            runtime: "^1",
            apps: { backend: { type: "backend",
runtime: "managed" } }
        });

        const issue = issues.find(i => i.path === "rebase");
        expect(issue?.message).toMatch(/renamed/);
    });

    it("reports every problem at once, with a path to each", () => {
        // A config file that surfaces its mistakes one run at a time is a bad
        // config file.
        const { issues } = validateManifest({
            rebase: "^1",
            apps: {
                web: { type: "static" },
                backend: { type: "backend" }
            }
        });

        const paths = issues.map(i => i.path);
        expect(paths).toContain("apps.web.root");
        expect(paths).toContain("apps.web.output");
        expect(paths).toContain("apps.backend.runtime");
    });

    it("rejects an unknown app type", () => {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: { thing: { type: "wat" } }
        });
        expect(issues[0].path).toBe("apps.thing.type");
        expect(issues[0].message).toMatch(/backend, static/);
    });

    describe("removed app types name their replacement", () => {
        // A message that says only "must be one of: backend, static" tells a
        // reader what is wrong but not what to write instead.
        it.each([
            ["admin", /ordinary static app/],
            ["custom", /"runtime": "custom"/],
            ["mobile", /no longer declared/]
        ])("%s", (type, expected) => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { thing: { type } }
            });
            expect(issues[0].path).toBe("apps.thing.type");
            expect(issues[0].message).toMatch(expected);
        });
    });

    describe("a static app may not claim a path the backend owns", () => {
        // Mounting is longest-path-first, so an app at /api outranks the API
        // itself: every request to it is answered with that app's index.html —
        // a 200 of HTML where the caller wanted JSON, from a deployment that
        // looks perfectly healthy.
        it.each(["/api", "/api/v2", "/health", "/metrics"])("rejects %s", (appPath) => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    web: { type: "static",
root: "frontend",
output: "frontend/dist",
path: appPath }
                }
            });
            expect(issues[0].path).toBe("apps.web.path");
            expect(issues[0].message).toMatch(/the backend serves that path/);
        });

        it("complains about the trailing slash first, which is the fixable half", () => {
            // "/api/" is wrong twice over. The slash is the part the developer
            // can act on without rethinking their topology, so it is the one
            // reported — and reporting both would be two issues for one typo.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    web: { type: "static",
root: "frontend",
output: "frontend/dist",
path: "/api/" }
                }
            });
            expect(issues[0].message).toMatch(/must not end with a slash/);
        });

        it("allows a path that merely starts with the same letters", () => {
            // The router matches at segment boundaries, and a check stricter
            // than the router rejects paths that would have worked.
            const { manifest, issues } = validateManifest({
                rebase: "^1",
                apps: {
                    docs: { type: "static",
root: "docs",
output: "docs/dist",
path: "/apidocs" }
                }
            });
            expect(issues).toEqual([]);
            expect(manifest?.apps.docs).toBeDefined();
        });
    });

    it("rejects app names that would not survive being put in a URL", () => {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: { "My App": { type: "backend",
runtime: "managed" } }
        });
        expect(issues[0].message).toMatch(/lowercase/);
    });

    it("rejects reserved app names", () => {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: { api: { type: "backend",
runtime: "managed" } }
        });
        expect(issues[0].message).toMatch(/reserved/);
    });

    it("allows at most one backend per project", () => {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: {
                one: { type: "backend",
runtime: "managed" },
                two: { type: "backend",
runtime: "managed" }
            }
        });
        expect(issues.some(i => i.message.includes("at most one backend"))).toBe(true);
    });

    it("refuses paths that escape the project directory", () => {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: { web: { type: "static",
root: "../../etc",
output: "dist" } }
        });
        expect(issues.some(i => i.message.includes("inside the project"))).toBe(true);
    });

    it("refuses absolute paths", () => {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: { web: { type: "static",
root: "/etc",
output: "dist" } }
        });
        expect(issues.some(i => i.message.includes("relative"))).toBe(true);
    });

    describe("backend.runtime", () => {
        it("is required", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { backend: { type: "backend" } }
            });
            expect(issues.find(i => i.path === "apps.backend.runtime")?.message)
                .toMatch(/"managed" or "custom"/);
        });

        it("rejects a value that is neither", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { backend: { type: "backend",
runtime: "hosted" } }
            });
            expect(issues.some(i => i.path === "apps.backend.runtime")).toBe(true);
        });

        it("accepts the image fields under a custom runtime", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    backend: {
                        type: "backend",
                        runtime: "custom",
                        dockerfile: "Dockerfile",
                        context: ".",
                        port: 8080
                    }
                }
            });
            expect(issues).toEqual([]);
        });

        it("refuses the image fields under a managed runtime", () => {
            // Accepting them silently would be accepting a Dockerfile that never
            // gets built.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    backend: { type: "backend",
runtime: "managed",
dockerfile: "Dockerfile" }
                }
            });
            expect(issues.find(i => i.path === "apps.backend.dockerfile")?.message)
                .toMatch(/only applies to a custom runtime/);
        });
    });

    it("reports backend.mode as removed rather than ignoring it", () => {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: { backend: { type: "backend",
runtime: "managed",
mode: "baas" } }
        });
        expect(issues.find(i => i.path === "apps.backend.mode")?.message)
            .toMatch(/no longer a field/);
    });

    describe("static.path", () => {
        it("accepts an absolute sub-path", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static",
root: "a",
output: "a/dist",
path: "/admin" } }
            });
            expect(issues).toEqual([]);
        });

        it.each(["admin", "../admin", "/admin/.."])("rejects %s", (bad) => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static",
root: "a",
output: "a/dist",
path: bad } }
            });
            expect(issues.find(i => i.path === "apps.admin.path")?.message)
                .toMatch(/absolute path/);
        });

        it("rejects a trailing slash, so mounting has one shape to reason about", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static",
root: "a",
output: "a/dist",
path: "/admin/" } }
            });
            expect(issues.find(i => i.path === "apps.admin.path")?.message)
                .toMatch(/must not end with a slash/);
        });

        it("refuses two apps at the same path", () => {
            // The first one mounted swallows the other's URLs, and the loser
            // looks like it deployed fine.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    site: { type: "static",
root: "s",
output: "s/dist" },
                    admin: { type: "static",
root: "a",
output: "a/dist",
path: "/" }
                }
            });
            expect(issues.find(i => i.path === "apps.admin.path")?.message)
                .toMatch(/cannot serve the same path/);
        });

        it("treats an omitted path as the root when checking uniqueness", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    site: { type: "static",
root: "s",
output: "s/dist" },
                    admin: { type: "static",
root: "a",
output: "a/dist",
path: "/admin" }
                }
            });
            expect(issues).toEqual([]);
        });

        it("rejects a value that is not a string, naming both forms", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static", root: "a", output: "a/dist", path: 42 } }
            });
            expect(issues.find(i => i.path === "apps.admin.path")?.message)
                .toMatch(/absolute path like "\/admin", or a URL like "https:\/\/admin\.example\.com"/);
        });

        it("refuses an empty segment, which no router serves as written", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static", root: "a", output: "a/dist", path: "/admin//panel" } }
            });
            expect(issues.find(i => i.path === "apps.admin.path")?.message).toMatch(/no empty segment/);
        });
    });

    /**
     * A static app on a hostname of its own: `path` written as an https URL.
     *
     * The split is `parseAppAddress` in `@rebasepro/types`, shared with the
     * control plane and the runtime. What the CLI adds is the path rules on the
     * path part, the (host, path) uniqueness rule, and errors that name the
     * field and give the fix in the form the author wrote it — the one place a
     * mistake here is cheap to hear about.
     */
    describe("static.path as a URL", () => {
        function pathIssue(value: unknown): string | undefined {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static", root: "a", output: "a/dist", path: value } }
            });
            return issues.find(i => i.path === "apps.admin.path")?.message;
        }

        it("accepts a site on the project host beside an admin on its own hostname", () => {
            // The shape the feature exists for: both at "/", told apart by host.
            const { manifest, issues } = validateManifest({
                rebase: "^1",
                apps: {
                    backend: { type: "backend", runtime: "managed" },
                    web: { type: "static", root: "frontend", output: "frontend/dist", path: "/", spa: true },
                    admin: { type: "static", root: "admin", output: "admin/dist", path: "https://admin.dadaki.com", cms: "/" }
                }
            });
            expect(issues).toEqual([]);
            expect(manifest?.apps.admin).toMatchObject({ path: "https://admin.dadaki.com", cms: "/" });
        });

        it("accepts a path under the hostname", () => {
            expect(pathIssue("https://admin.example.com/cms")).toBeUndefined();
        });

        it("accepts a trailing slash on a bare hostname, which is its root", () => {
            expect(pathIssue("https://admin.example.com/")).toBeUndefined();
        });

        it("accepts a hostname that happens to be named like a reserved path", () => {
            // Reserved prefixes are paths. `api.example.com` is somebody's
            // hostname, and refusing it would be a rule the router never applies.
            expect(pathIssue("https://api.example.com")).toBeUndefined();
        });

        it.each([
            ["http://admin.example.com", /must use https.*"https:\/\/admin\.example\.com"/],
            ["ftp://admin.example.com", /must use https/],
            ["https://user:secret@admin.example.com", /must not contain credentials/],
            ["https://admin.example.com:8443", /must not name a port/],
            ["https://admin.example.com/?preview=1", /must not have a query or fragment/],
            ["https://admin.example.com/#top", /must not have a query or fragment/],
            ["https://admin.example.com?", /must not have a query or fragment/],
            ["https://localhost", /"localhost", which is not a public hostname/],
            ["https://127.0.0.1", /not a public hostname/],
            ["https://[::1]", /not a public hostname/],
            ["https://admin", /"admin", which is not a public hostname/],
            ["https://", /is not a valid URL/],
            ["admin.example.com", /looks like a hostname — write it as a URL: "https:\/\/admin\.example\.com"/],
            ["//admin.example.com", /URL without its scheme — write "https:\/\/admin\.example\.com"/]
        ])("refuses %j, saying why", (value, reason) => {
            expect(pathIssue(value)).toMatch(reason);
        });

        it.each([
            ["https://admin.example.com/cms/", /must not end with a slash — write "https:\/\/admin\.example\.com\/cms", not "https:\/\/admin\.example\.com\/cms\/"/],
            ["https://admin.example.com/../x", /plain path after the hostname.*"https:\/\/admin\.example\.com\/admin"/],
            ["https://admin.example.com//cms", /no empty segment/]
        ])("holds the path part of %j to the path rules, with the fix in URL form", (value, reason) => {
            expect(pathIssue(value)).toMatch(reason);
        });

        it.each(["https://admin.example.com/api", "https://admin.example.com/health/live", "https://admin.example.com/metrics"])(
            "refuses a reserved path under a hostname: %s",
            (value) => {
                // The API's routes are registered before any app's on every
                // hostname, so an app here never answers — or, mounted first,
                // answers the API's requests with its own index.html.
                expect(pathIssue(value)).toMatch(/the backend serves that path on every hostname, this one included/);
            }
        );

        it("refuses two apps at one hostname and path, whatever case the hostname was written in", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    admin: { type: "static", root: "a", output: "a/dist", path: "https://admin.example.com" },
                    panel: { type: "static", root: "p", output: "p/dist", path: "https://Admin.Example.com/" }
                }
            });
            expect(issues.find(i => i.path === "apps.panel.path")?.message)
                .toMatch(/cannot serve the same path — "admin" is already at "https:\/\/admin\.example\.com"/);
        });

        it.each([
            ["the same path with and without a hostname", "/", "https://admin.example.com"],
            ["one hostname at two paths", "https://admin.example.com", "https://admin.example.com/docs"],
            ["two hostnames at one path", "https://admin.example.com", "https://docs.example.com"]
        ])("allows %s", (_label, first, second) => {
            // An app with no hostname is its own value, not a wildcard: at an
            // equal path, the one naming the request's hostname wins there and
            // the other answers everywhere else.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    one: { type: "static", root: "a", output: "a/dist", path: first },
                    two: { type: "static", root: "b", output: "b/dist", path: second }
                }
            });
            expect(issues).toEqual([]);
        });
    });

    describe("staticAppAddress", () => {
        it("splits a URL into its lowercased hostname and the path part", () => {
            expect(staticAppAddress("admin", { path: "https://Admin.Example.com/cms" }))
                .toEqual({ host: "admin.example.com", path: "/cms" });
        });

        it("reads a bare hostname as its root", () => {
            expect(staticAppAddress("admin", { path: "https://admin.example.com" }))
                .toEqual({ host: "admin.example.com", path: "/" });
        });

        it("leaves a path alone, and an absent one at the root", () => {
            expect(staticAppAddress("web", { path: "/admin" })).toEqual({ path: "/admin" });
            expect(staticAppAddress("web", {})).toEqual({ path: "/" });
        });

        it("throws, naming the field, on a value validation would have refused", () => {
            // Guessing an address for it would build or mount the app somewhere
            // it was never declared.
            expect(() => staticAppAddress("admin", { path: "http://admin.example.com" }))
                .toThrow(/apps\.admin\.path must use https/);
        });

        it("prints an address the way it is declared", () => {
            expect(formatAppAddress({ path: "/admin" })).toBe("/admin");
            expect(formatAppAddress({ host: "admin.example.com", path: "/" })).toBe("https://admin.example.com");
            expect(formatAppAddress({ host: "admin.example.com", path: "/cms" })).toBe("https://admin.example.com/cms");
        });
    });

    /**
     * Where the CMS is, which nothing else in the system can observe.
     *
     * It is a React component inside the developer's own app, so its address is
     * a client-side route: not a server route, not a file in the bundle, not
     * anything a probe can distinguish from the SPA fallback. This declaration
     * is the only place it is ever written down, which is why the rules on it
     * are worth enforcing rather than trusting.
     */
    describe("static.cms", () => {
        it("accepts a route inside the app that serves it", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { web: { type: "static",
root: "a",
output: "a/dist",
path: "/",
cms: "/admin" } }
            });
            expect(issues).toEqual([]);
        });

        it("accepts an app that is entirely the CMS", () => {
            // What `rebase init` scaffolds: one frontend, at the root, and the
            // whole of it is the panel.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static",
root: "a",
output: "a/dist",
path: "/",
cms: "/" } }
            });
            expect(issues).toEqual([]);
        });

        it("accepts a CMS nested under a non-root app", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { app: { type: "static",
root: "a",
output: "a/dist",
path: "/app",
cms: "/app/admin" } }
            });
            expect(issues).toEqual([]);
        });

        it("rejects a CMS outside the app that declares it", () => {
            // Nothing serves that URL: the app's SPA fallback only answers
            // beneath its own path. The console would offer a confident link to
            // a 404, which is worse than the missing link it replaces.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { app: { type: "static",
root: "a",
output: "a/dist",
path: "/app",
cms: "/admin" } }
            });
            expect(issues.find(i => i.path === "apps.app.cms")?.message)
                .toMatch(/must be inside this app's path/);
        });

        it("does not read a sibling path as containment", () => {
            // `/adm` is not a prefix of `/admin` in any sense that matters — a
            // `startsWith` check would say it is.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { app: { type: "static",
root: "a",
output: "a/dist",
path: "/adm",
cms: "/admin" } }
            });
            expect(issues.find(i => i.path === "apps.app.cms")?.message)
                .toMatch(/must be inside this app's path/);
        });

        it("rejects a relative path with the same message `path` gets", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { web: { type: "static",
root: "a",
output: "a/dist",
cms: "admin" } }
            });
            expect(issues.find(i => i.path === "apps.web.cms")?.message)
                .toMatch(/absolute path/);
        });

        it("refuses a second CMS, naming the app that already has one", () => {
            // Everything downstream says "the project's CMS" — the console
            // button, the app row, `rebase apps list`. Two would make each of
            // them pick one arbitrarily.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: {
                    site: { type: "static",
root: "s",
output: "s/dist",
path: "/",
cms: "/admin" },
                    staff: { type: "static",
root: "t",
output: "t/dist",
path: "/staff",
cms: "/staff/admin" }
                }
            });
            expect(issues.find(i => i.path === "apps.staff.cms")?.message)
                .toMatch(/one CMS.*"site"/);
        });

        it("accepts a CMS at the root of an app on its own hostname", () => {
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static", root: "a", output: "a/dist", path: "https://admin.example.com", cms: "/" } }
            });
            expect(issues).toEqual([]);
        });

        it("measures containment against the path part of a URL", () => {
            const accepted = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static", root: "a", output: "a/dist", path: "https://admin.example.com/cms", cms: "/cms/panel" } }
            });
            expect(accepted.issues).toEqual([]);

            // Nothing on admin.example.com answers "/other" for this app — it
            // mounts at "/cms" there — so a console link to it would be a 404.
            const refused = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static", root: "a", output: "a/dist", path: "https://admin.example.com/cms", cms: "/other" } }
            });
            expect(refused.issues.find(i => i.path === "apps.admin.cms")?.message)
                .toMatch(/must be inside this app's path — it is at "https:\/\/admin\.example\.com\/cms", so it cannot serve "\/other"/);
        });

        it.each([
            ["https://admin.example.com/cms", /must be a path, not a URL.*Write "\/cms"/],
            ["//admin.example.com/cms", /must be a path, not a URL.*Write "\/cms"/],
            ["http://admin.example.com", /must be a path, not a URL/]
        ])("refuses %j, which puts a hostname where only a path goes", (cms, reason) => {
            // The app's `path` already says which hostname it answers on; a
            // second one here could only disagree with it.
            const { issues } = validateManifest({
                rebase: "^1",
                apps: { admin: { type: "static", root: "a", output: "a/dist", path: "https://admin.example.com/cms", cms } }
            });
            expect(issues.find(i => i.path === "apps.admin.cms")?.message).toMatch(reason);
        });
    });
});

/**
 * Unknown fields are warned about, never fatal.
 *
 * Both halves matter. A typo silently dropped is the blank-page class of bug —
 * `pathh` builds for `/`, mounts at `/`, and the only symptom is the app not
 * being where you put it. But an unknown field is also exactly what an older
 * CLI sees in a manifest written for a newer one, and failing there would make
 * every future field a breaking change.
 */
describe("unknown fields", () => {
    let warnings: string[];
    let warn: typeof console.warn;

    beforeEach(() => {
        warnings = [];
        warn = console.warn;
        console.warn = (msg?: unknown) => { warnings.push(String(msg)); };
    });
    afterEach(() => { console.warn = warn; });

    const validate = (app: Record<string, unknown>) =>
        validateManifest({ rebase: "^1",
apps: { admin: app } });

    it("names a typo and suggests the field it nearly is", () => {
        const { issues } = validate({ type: "static",
root: "a",
output: "a/dist",
pathh: "/admin" });

        expect(issues).toEqual([]); // not fatal
        expect(warnings.join(" ")).toMatch(/apps\.admin\.pathh/);
        expect(warnings.join(" ")).toMatch(/Did you mean "path"/);
    });

    it("still accepts a field from the future, saying it is ignored", () => {
        const { manifest, issues } = validate({
            type: "static",
            root: "a",
            output: "a/dist",
            edgeRegions: ["fra1"]
        });

        expect(issues).toEqual([]);
        expect(manifest?.apps.admin).toBeDefined();
        expect(warnings.join(" ")).toMatch(/older than this manifest/);
    });

    it("says nothing about a manifest that uses only known fields", () => {
        // A guard that cries wolf gets ignored, and then it is not a guard.
        validateManifest({
            rebase: "^1",
            apps: {
                backend: { type: "backend",
runtime: "custom",
dockerfile: "Dockerfile",
context: ".",
port: 8080 },
                admin: { type: "static",
root: "a",
build: "x",
output: "a/dist",
path: "/admin",
spa: true }
            }
        });

        expect(warnings).toEqual([]);
    });

    it("does not suggest a wildly different field", () => {
        validate({ type: "static",
root: "a",
output: "a/dist",
somethingElseEntirely: 1 });
        expect(warnings.join(" ")).not.toMatch(/Did you mean/);
    });

    it.each(["host", "hostname", "domain"])("answers a `%s` field with the URL form it was reaching for", (field) => {
        // "Your CLI may be older than this manifest" is false here, and sends
        // the reader off to upgrade a CLI that already does what they wanted.
        const { issues } = validate({ type: "static", root: "a", output: "a/dist", path: "/cms", [field]: "https://admin.example.com/" });

        expect(issues).toEqual([]);
        expect(warnings.join(" ")).toMatch(new RegExp(`apps\\.admin\\.${field} is not a field`));
        expect(warnings.join(" ")).toMatch(/"path": "https:\/\/admin\.example\.com\/cms"/);
        expect(warnings.join(" ")).not.toMatch(/older than this manifest/);
    });
});

describe("synthesizeManifest", () => {
    it("infers the stock template layout", () => {
        mkdir("config/collections");
        mkdir("backend/functions");
        mkdir("frontend");

        const manifest = synthesizeManifest(scratch);

        expect(manifest.rebase).toBe(CURRENT_RUNTIME_RANGE);
        expect(manifest.apps.backend).toMatchObject({ type: "backend",
runtime: "managed" });
        expect(manifest.apps.web.type).toBe("static");
    });

    it("does NOT infer a custom runtime from a stranded entrypoint", () => {
        // Every scaffolded project used to carry `backend/src/index.ts` whether
        // or not it wanted its own server, so inferring from it landed projects
        // on the custom runtime without anyone choosing it.
        mkdir("config/collections");
        touch("backend/src/index.ts");

        const manifest = synthesizeManifest(scratch);

        expect(manifest.apps.backend).toMatchObject({ type: "backend",
runtime: "managed" });
        expect(assessManagedCompatibility(manifest).eligible).toBe(true);
    });

    it("infers a custom runtime from a Dockerfile, which does build an image", () => {
        mkdir("config/collections");
        touch("Dockerfile");

        const manifest = synthesizeManifest(scratch);

        expect(manifest.apps.backend).toMatchObject({
            type: "backend",
            runtime: "custom",
            dockerfile: "Dockerfile"
        });
        expect(assessManagedCompatibility(manifest).eligible).toBe(false);
    });

    it("still declares a backend when there is no config package", () => {
        // Collections are introspected from the live database at boot; that is
        // derived from the missing directory, not declared.
        mkdir("backend/functions");

        const manifest = synthesizeManifest(scratch);

        expect(manifest.apps.backend).toMatchObject({ type: "backend",
runtime: "managed" });
        expect(manifest.apps.backend).not.toHaveProperty("mode");
    });
});

describe("loadManifest", () => {
    it("synthesizes one when the file is absent, rather than failing", () => {
        mkdir("config/collections");
        mkdir("backend");

        const loaded = loadManifest(scratch);

        expect(loaded.source).toBe("synthesized");
        expect(loaded.manifest.apps.backend).toBeDefined();
    });

    it("reads a real file when present", () => {
        writeManifest(scratch, {
            rebase: "^1",
            apps: { backend: { type: "backend",
runtime: "managed" } }
        });

        const loaded = loadManifest(scratch);

        expect(loaded.source).toBe("file");
        expect(loaded.filePath).toBe(path.join(scratch, "rebase.json"));
    });

    it("throws on a malformed manifest instead of silently building something else", () => {
        fs.writeFileSync(path.join(scratch, "rebase.json"), "{ nope");
        expect(() => loadManifest(scratch)).toThrow(ManifestError);
    });

    it("carries the validation issues on the error", () => {
        fs.writeFileSync(
            path.join(scratch, "rebase.json"),
            JSON.stringify({ apps: { web: { type: "static" } } })
        );

        try {
            loadManifest(scratch);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ManifestError);
            expect((err as ManifestError).issues.length).toBeGreaterThan(0);
        }
    });

    it("round-trips through writeManifest", () => {
        const original = {
            rebase: "^1",
            apps: {
                backend: { type: "backend" as const,
runtime: "managed" as const },
                admin: {
                    type: "static" as const,
                    root: "frontend",
                    output: "frontend/dist",
                    path: "/admin"
                }
            }
        };
        writeManifest(scratch, original);

        expect(loadManifest(scratch).manifest.apps).toEqual(original.apps);
    });

    it("keeps a URL path as written through a rewrite", () => {
        // `rebase eject` loads the manifest and writes it back. A load that
        // stored the split pieces would have that rewrite turn
        // "https://admin.example.com" into "/" — the app silently moved off
        // its hostname, in a commit about the backend's runtime.
        const original = {
            rebase: "^1",
            apps: {
                admin: {
                    type: "static" as const,
                    root: "admin",
                    output: "admin/dist",
                    path: "https://Admin.Example.com/cms",
                    cms: "/cms"
                }
            }
        };
        fs.writeFileSync(path.join(scratch, "rebase.json"), JSON.stringify(original));

        writeManifest(scratch, loadManifest(scratch).manifest);

        expect(JSON.parse(fs.readFileSync(path.join(scratch, "rebase.json"), "utf8")).apps).toEqual(original.apps);
    });
});

/**
 * A rewrite must not delete what it did not write.
 *
 * `writeManifest` emitted exactly `$schema`, `rebase` and `apps`, and two
 * commands with no visible relationship to either key rewrite this file:
 * `rebase eject` (whose output announces `rebase.json … runtime: custom`) and
 * `rebase apps init --force`. So an organisation's committed
 * `"telemetry": false` — the only repository-wide privacy control the CLI
 * honours, which overrides every developer's own opt-in — was silently deleted,
 * and with it a multi-bucket project's whole `storage` topology.
 *
 * `parseManifest` dropped `telemetry` too, so the loss survived a load as well
 * as a write.
 */
describe("writeManifest preserves the whole file", () => {
    /**
     * Every data key `RebaseProjectManifest` declares, read out of the type
     * itself. A hand-listed set is exactly the mistake being fixed here: it
     * would lose the *next* key added the same way it lost these two.
     */
    function declaredManifestKeys(): string[] {
        const source = fs.readFileSync(
            path.resolve(here, "../../types/src/types/project_manifest.ts"),
            "utf8"
        );
        const body = /export interface RebaseProjectManifest \{([\s\S]*?)\n\}/.exec(source)?.[1];
        expect(body, "RebaseProjectManifest not found — did the interface move?").toBeTruthy();
        // Top-level members only: nested object literals are indented deeper.
        return [...(body as string).matchAll(/^ {4}(\$?[a-zA-Z]+)\??:/gm)].map(m => m[1]);
    }

    const full = {
        $schema: "https://rebase.pro/schemas/rebase.json",
        rebase: "^1",
        apps: {
            backend: {
                type: "backend" as const,
                runtime: "managed" as const
            }
        },
        telemetry: false
    };

    it("round-trips every key the type declares", () => {
        // Guards the fixture: a key added to the type and not tested here would
        // otherwise be lost silently, which is how these two were lost.
        expect(Object.keys(full).sort()).toEqual(declaredManifestKeys().sort());

        writeManifest(scratch, full);

        expect(loadManifest(scratch).manifest).toEqual(full);
    });

    it("keeps the telemetry opt-out a rewrite did not model", () => {
        // `rebase apps init --force` writes a *synthesized* manifest: it cannot
        // know either key, because both are authored rather than inferred.
        fs.writeFileSync(
            path.join(scratch, "rebase.json"),
            `${JSON.stringify(full, null, 4)}\n`
        );

        writeManifest(scratch, {
            rebase: "^1",
            apps: {
                backend: {
                    type: "backend",
                    runtime: "custom",
                    dockerfile: "Dockerfile",
                    port: 8080
                }
            }
        });

        const after = loadManifest(scratch).manifest;
        expect(after.telemetry).toBe(false);
        expect(after.apps.backend).toMatchObject({ runtime: "custom" });
    });

    it("carries a key it has never heard of", () => {
        fs.writeFileSync(
            path.join(scratch, "rebase.json"),
            `${JSON.stringify({
                ...full,
                someFutureKey: { kept: true }
            }, null, 4)}\n`
        );

        writeManifest(scratch, full);

        const raw = JSON.parse(fs.readFileSync(path.join(scratch, "rebase.json"), "utf8"));
        expect(raw.someFutureKey).toEqual({ kept: true });
    });

    it("rejects a telemetry value that is not a boolean, rather than ignoring it", () => {
        // `"telemetry": "false"` is the mistake that leaves sharing on while
        // looking like it is off.
        fs.writeFileSync(
            path.join(scratch, "rebase.json"),
            JSON.stringify({
                ...full,
                telemetry: "false"
            })
        );

        expect(() => loadManifest(scratch)).toThrow(ManifestError);
    });
});

describe("selectDeployApp", () => {
    const manifest = (apps: Record<string, unknown>) =>
        validateManifest({ rebase: "^1",
apps }).manifest!;

    const BACKEND = { type: "backend",
runtime: "managed" };
    const STATIC = (path: string) =>
        ({ type: "static",
root: "frontend",
output: "frontend/dist",
path });

    it("takes the backend when nothing is named", () => {
        const m = manifest({ backend: BACKEND,
web: STATIC("/") });
        expect(selectDeployApp(m).name).toBe("backend");
    });

    it("takes the only app in a repository that has no backend", () => {
        // The whole point: a repository holding just an admin panel is an
        // ordinary thing, not a repository with a missing backend.
        const m = manifest({ admin: STATIC("/admin") });
        expect(selectDeployApp(m).name).toBe("admin");
        expect(selectDeployApp(m).app.type).toBe("static");
    });

    it("takes the app that was named", () => {
        const m = manifest({ backend: BACKEND,
admin: STATIC("/admin") });
        expect(selectDeployApp(m, "admin").name).toBe("admin");
    });

    it("refuses a name this repository does not declare, and lists what it has", () => {
        // Guessing past a typo would deploy the wrong app to a live project.
        const m = manifest({ backend: BACKEND,
admin: STATIC("/admin") });
        expect(() => selectDeployApp(m, "adminn")).toThrow(/no app named "adminn"/);
        expect(() => selectDeployApp(m, "adminn")).toThrow(/backend, admin/);
    });

    it("refuses to guess between several static apps", () => {
        // Picking one would publish somebody's admin panel at their marketing
        // domain, and the failure would look like a build problem.
        const m = manifest({ web: STATIC("/"),
admin: STATIC("/admin") });
        expect(() => selectDeployApp(m)).toThrow(/no obvious one to deploy/);
        expect(() => selectDeployApp(m)).toThrow(/web, admin/);
    });

    it("says so when there is nothing to deploy at all", () => {
        expect(() => selectDeployApp({ rebase: "^1",
apps: {} })).toThrow(/no apps/);
    });
});

describe("cmsMountOf", () => {
    it("finds the app that mounts the CMS and where", () => {
        const mount = cmsMountOf({
            rebase: "^1",
            apps: {
                backend: { type: "backend", runtime: "managed" },
                web: { type: "static", root: "f", output: "f/dist", path: "/", cms: "/admin" }
            }
        });
        expect(mount).toMatchObject({ appName: "web", path: "/admin" });
        expect(mount).not.toHaveProperty("host");
    });

    it("keeps the CMS a path, and says which hostname it is on", () => {
        // A caller holding a local or project URL must not append the app's
        // `path` to it — that is how `http://localhost:5173https://…` happens.
        const mount = cmsMountOf({
            rebase: "^1",
            apps: {
                web: { type: "static", root: "frontend", output: "frontend/dist", path: "/" },
                admin: { type: "static", root: "admin", output: "admin/dist", path: "https://Admin.Dadaki.com", cms: "/" }
            }
        });
        expect(mount).toMatchObject({ appName: "admin", path: "/", host: "admin.dadaki.com" });
    });

    it("is undefined when no app declares one", () => {
        // Not "the CMS is at /" — the project has not said, and every caller
        // renders not-knowing as nothing rather than as a guess.
        expect(cmsMountOf({
            rebase: "^1",
            apps: { web: { type: "static", root: "f", output: "f/dist", path: "/" } }
        })).toBeUndefined();
    });
});

describe("compareMountOrder", () => {
    it("mounts the longest path first, and at an equal path the app with a hostname first", () => {
        // The runtime's matching rule, as a sort: on admin.example.com the app
        // naming it wins at "/", and the app on every hostname answers the rest.
        const order = [
            { path: "/" },
            { host: "admin.example.com", path: "/" },
            { path: "/docs" },
            { host: "admin.example.com", path: "/cms/panel" }
        ].sort(compareMountOrder);
        expect(order).toEqual([
            { host: "admin.example.com", path: "/cms/panel" },
            { path: "/docs" },
            { host: "admin.example.com", path: "/" },
            { path: "/" }
        ]);
    });
});

describe("buildableApps", () => {
    it("builds the backend before anything that might consume its SDK", () => {
        const order = buildableApps({
            rebase: "^1",
            apps: {
                site: { type: "static",
root: "site",
output: "site/dist" },
                backend: { type: "backend",
runtime: "managed" },
                admin: { type: "static",
root: "admin",
output: "admin/dist",
path: "/admin" }
            }
        }).map(a => a.name);

        expect(order[0]).toBe("backend");
        expect(order.slice(1).sort()).toEqual(["admin", "site"]);
    });
});

describe("assessManagedCompatibility", () => {
    it("accepts a backend that declares the managed runtime", () => {
        const result = assessManagedCompatibility({
            rebase: "^1",
            apps: {
                backend: { type: "backend",
runtime: "managed" },
                web: { type: "static",
root: "f",
output: "f/dist" }
            }
        });

        expect(result.eligible).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it("reads the declared value rather than deducing one", () => {
        const result = assessManagedCompatibility({
            rebase: "^1",
            apps: { backend: { type: "backend",
runtime: "custom",
dockerfile: "Dockerfile" } }
        });

        expect(result.eligible).toBe(false);
        expect(result.reasons.join(" ")).toMatch(/declares runtime: "custom"/);
    });

    it("says so when this repository declares no backend at all", () => {
        // A frontend-only repository is a normal thing in a multi-repo project;
        // it simply is not the repository that selects the runtime.
        const result = assessManagedCompatibility({
            rebase: "^1",
            apps: { web: { type: "static",
root: "f",
output: "f/dist" } }
        });

        expect(result.eligible).toBe(false);
        expect(result.reasons.join(" ")).toMatch(/No backend app/);
    });
});

describe("resolveBackendPaths", () => {
    it("fills in the conventional locations", () => {
        expect(resolveBackendPaths({ type: "backend",
runtime: "managed" }, scratch)).toEqual({
            config: "config",
            functions: "backend/functions",
            crons: "backend/crons",
            schema: "backend/src/schema.generated.ts",
            usersCollection: "collections/users",
            hasConfig: false,
            hasCollections: false
        });
    });

    it("respects what the manifest states", () => {
        expect(resolveBackendPaths({
            type: "backend",
            runtime: "managed",
            config: "shared",
            functions: "api/fns"
        }, scratch)).toMatchObject({
            config: "shared",
            functions: "api/fns"
        });
    });

    it("derives hasCollections from the collections directory actually existing", () => {
        // This replaces `mode: "cms" | "baas"`. Where collections come from was
        // never an independent choice.
        mkdir("config/collections");
        const resolved = resolveBackendPaths({ type: "backend",
runtime: "managed" }, scratch);
        expect(resolved.hasCollections).toBe(true);
        expect(resolved.hasConfig).toBe(true);
    });

    it("keeps hasConfig true for a headless project that still ships a config package", () => {
        // A headless project has no collections but does have `storageAuthorize`,
        // and storage is not under row-level security — so the package has to be
        // compiled into the bundle even though nothing is declared in it.
        mkdir("config");
        const resolved = resolveBackendPaths({ type: "backend",
runtime: "managed" }, scratch);
        expect(resolved.hasConfig).toBe(true);
        expect(resolved.hasCollections).toBe(false);
    });
});
