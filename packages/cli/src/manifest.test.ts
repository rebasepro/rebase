import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    assessManagedCompatibility,
    buildableApps,
    CURRENT_RUNTIME_RANGE,
    loadManifest,
    ManifestError,
    resolveBackendPaths,
    synthesizeManifest,
    validateManifest,
    writeManifest
} from "./manifest";

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
