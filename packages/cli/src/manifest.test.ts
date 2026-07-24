import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    assessManagedCompatibility,
    buildableApps,
    CURRENT_RUNTIME_RANGE,
    findBackendApp,
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
    fs.rmSync(scratch, { recursive: true, force: true });
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
            runtime: "^1",
            apps: { backend: { type: "backend" } }
        });

        expect(issues).toEqual([]);
        expect(manifest?.apps.backend.type).toBe("backend");
    });

    it("requires a runtime range", () => {
        const { issues } = validateManifest({ apps: {} });
        expect(issues.some(i => i.path === "runtime")).toBe(true);
    });

    it("reports every problem at once, with a path to each", () => {
        // A config file that surfaces its mistakes one run at a time is a bad
        // config file.
        const { issues } = validateManifest({
            runtime: "^1",
            apps: {
                web: { type: "static" },
                phone: { type: "mobile", platform: "windows" }
            }
        });

        const paths = issues.map(i => i.path);
        expect(paths).toContain("apps.web.root");
        expect(paths).toContain("apps.web.output");
        expect(paths).toContain("apps.phone.platform");
    });

    it("rejects an unknown app type", () => {
        const { issues } = validateManifest({
            runtime: "^1",
            apps: { thing: { type: "wat" } }
        });
        expect(issues[0].path).toBe("apps.thing.type");
    });

    it("rejects app names that would not survive being put in a URL", () => {
        const { issues } = validateManifest({
            runtime: "^1",
            apps: { "My App": { type: "backend" } }
        });
        expect(issues[0].message).toMatch(/lowercase/);
    });

    it("rejects reserved app names", () => {
        const { issues } = validateManifest({
            runtime: "^1",
            apps: { api: { type: "backend" } }
        });
        expect(issues[0].message).toMatch(/reserved/);
    });

    it("allows at most one backend per project", () => {
        const { issues } = validateManifest({
            runtime: "^1",
            apps: { one: { type: "backend" }, two: { type: "backend" } }
        });
        expect(issues.some(i => i.message.includes("at most one backend"))).toBe(true);
    });

    it("refuses paths that escape the project directory", () => {
        const { issues } = validateManifest({
            runtime: "^1",
            apps: { web: { type: "static", root: "../../etc", output: "dist" } }
        });
        expect(issues.some(i => i.message.includes("inside the project"))).toBe(true);
    });

    it("refuses absolute paths", () => {
        const { issues } = validateManifest({
            runtime: "^1",
            apps: { web: { type: "static", root: "/etc", output: "dist" } }
        });
        expect(issues.some(i => i.message.includes("relative"))).toBe(true);
    });

    it("requires build inputs only for a bundled admin panel", () => {
        expect(validateManifest({
            runtime: "^1",
            apps: { admin: { type: "admin" } }
        }).issues).toEqual([]);

        const bundled = validateManifest({
            runtime: "^1",
            apps: { admin: { type: "admin", mode: "bundled" } }
        });
        expect(bundled.issues.map(i => i.path)).toContain("apps.admin.root");
    });
});

describe("synthesizeManifest", () => {
    it("infers the stock template layout", () => {
        mkdir("config/collections");
        mkdir("backend/functions");
        mkdir("frontend");

        const manifest = synthesizeManifest(scratch);

        expect(manifest.runtime).toBe(CURRENT_RUNTIME_RANGE);
        expect(manifest.apps.backend.type).toBe("backend");
        expect(manifest.apps.web.type).toBe("static");
    });

    it("classifies an ejected backend as custom rather than pretending otherwise", () => {
        // A project with its own entrypoint keeps deploying exactly as it does
        // today — calling it a backend app would promise a runtime it does not use.
        mkdir("config/collections");
        touch("backend/src/index.ts");

        const manifest = synthesizeManifest(scratch);

        expect(manifest.apps.backend.type).toBe("custom");
        expect(assessManagedCompatibility(manifest).eligible).toBe(false);
    });

    it("marks a project with no config package as baas mode", () => {
        mkdir("backend/functions");

        const manifest = synthesizeManifest(scratch);

        expect(manifest.apps.backend).toMatchObject({ type: "backend", mode: "baas" });
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
        writeManifest(scratch, { runtime: "^1", apps: { backend: { type: "backend" } } });

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
            runtime: "^1",
            apps: { backend: { type: "backend" as const }, web: { type: "mobile" as const, platform: "ios" as const } }
        };
        writeManifest(scratch, original);

        expect(loadManifest(scratch).manifest.apps).toEqual(original.apps);
    });
});

describe("buildableApps", () => {
    it("builds the backend before anything that might consume its SDK", () => {
        const order = buildableApps({
            runtime: "^1",
            apps: {
                web: { type: "static", root: "frontend", output: "frontend/dist" },
                backend: { type: "backend" },
                admin: { type: "admin" }
            }
        }).map(a => a.name);

        expect(order).toEqual(["backend", "admin", "web"]);
    });

    it("omits mobile apps, which are registered rather than built", () => {
        const names = buildableApps({
            runtime: "^1",
            apps: { phone: { type: "mobile", platform: "ios" }, backend: { type: "backend" } }
        }).map(a => a.name);

        expect(names).toEqual(["backend"]);
    });
});

describe("assessManagedCompatibility", () => {
    it("accepts a plain backend project", () => {
        const result = assessManagedCompatibility({
            runtime: "^1",
            apps: { backend: { type: "backend" }, web: { type: "static", root: "f", output: "f/dist" } }
        });

        expect(result.eligible).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it("explains itself when a custom container is present", () => {
        const result = assessManagedCompatibility({
            runtime: "^1",
            apps: { backend: { type: "custom", dockerfile: "Dockerfile" } }
        });

        expect(result.eligible).toBe(false);
        expect(result.reasons.join(" ")).toMatch(/custom container/);
    });

    it("says so when this repository declares no backend at all", () => {
        // A frontend-only repository is a normal thing in a multi-repo project;
        // it simply is not the repository that selects the runtime.
        const result = assessManagedCompatibility({
            runtime: "^1",
            apps: { web: { type: "static", root: "f", output: "f/dist" } }
        });

        expect(result.eligible).toBe(false);
        expect(result.reasons.join(" ")).toMatch(/No backend app/);
    });
});

describe("resolveBackendPaths", () => {
    it("fills in the conventional locations", () => {
        expect(resolveBackendPaths({ type: "backend" })).toEqual({
            config: "config",
            functions: "backend/functions",
            crons: "backend/crons",
            schema: "backend/src/schema.generated.ts",
            usersCollection: "collections/users",
            mode: "cms"
        });
    });

    it("respects what the manifest states", () => {
        expect(resolveBackendPaths({
            type: "backend",
            config: "shared",
            functions: "api/fns",
            mode: "baas"
        })).toMatchObject({
            config: "shared",
            functions: "api/fns",
            mode: "baas"
        });
    });
});
