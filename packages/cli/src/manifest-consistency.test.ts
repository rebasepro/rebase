/**
 * Every `rebase.json` in this repository must agree with the files beside it.
 *
 * These are not unit tests — nothing here calls a function. They assert that two
 * *artifacts* do not contradict each other, which is the shape almost every bug
 * in this area has taken. A function returning the wrong value gets caught by a
 * unit test; a manifest quietly disagreeing with the Dockerfile next to it does
 * not, because neither file is wrong on its own.
 *
 * What they would have caught, both of which reached a user-facing broken state:
 *
 *  - The scaffolded template declared `runtime: "managed"` while shipping a
 *    `backend/Dockerfile` whose `CMD` ran an entrypoint that had been moved
 *    behind `rebase eject`. `docker compose up` on a fresh project built an
 *    image around a file that no longer existed.
 *  - `app/`, the reference project, was labelled `managed` while owning a
 *    177-line entrypoint and a Dockerfile that `cloudbuild.yaml` builds and
 *    Cloud Run runs. Once `rebase cloud deploy` started honouring the declared
 *    runtime, that would have switched the demo from its image to a bundle.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { RESERVED_BACKEND_PREFIXES } from "@rebasepro/types";
import { buildableApps, validateManifest } from "./manifest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

/** Every committed `rebase.json`, by the directory that owns it. */
const MANIFESTS = [
    { name: "app (reference project)",
dir: path.join(repoRoot, "app") },
    { name: "init template",
dir: path.join(repoRoot, "packages/cli/templates/template") },
    { name: "headless overlay",
dir: path.join(repoRoot, "packages/cli/templates/overlays/baas") }
];

interface Backend {
    type: string;
    runtime?: string;
    dockerfile?: string;
}

function backendOf(dir: string): Backend | undefined {
    const file = path.join(dir, "rebase.json");
    if (!fs.existsSync(file)) return undefined;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.values(manifest.apps ?? {}).find(
        (app): app is Backend => (app as Backend)?.type === "backend"
    );
}

/** The parsed file, so a test can look at more than the backend app. */
function manifestOf(dir: string): Record<string, unknown> | undefined {
    const file = path.join(dir, "rebase.json");
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe.each(MANIFESTS)("$name", ({ dir }) => {
    const backend = backendOf(dir);
    const has = (relative: string): boolean => fs.existsSync(path.join(dir, relative));

    // The gap every other test in this file was built around: they read these
    // manifests and compared them to their neighbours, but nothing ever put one
    // through the validator the CLI uses. So a manifest could ship declaring a
    // path the router reserves, or a field validation rejects, and the first
    // person to find out would be a developer running `rebase build` on a
    // freshly scaffolded project.
    it("passes the validator the CLI runs on it", () => {
        const raw = manifestOf(dir);
        expect(raw).toBeDefined();
        const { manifest, issues } = validateManifest(raw);
        expect(issues).toEqual([]);
        expect(manifest).toBeDefined();
    });

    it("declares only paths that exist for the apps it ships", () => {
        // `output` is a build artifact and legitimately absent from a checkout.
        // `root` is the source directory, and a manifest naming one that is not
        // there produces a build command run against nothing.
        const raw = manifestOf(dir);
        const { manifest } = validateManifest(raw);
        if (!manifest) return;

        const missing: string[] = [];
        for (const { name, app } of buildableApps(manifest)) {
            if (app.type !== "static") continue;
            if (!has(app.root)) missing.push(`apps.${name}.root → ${app.root}`);
        }
        expect(missing).toEqual([]);
    });

    // The failure this prevents has no error message: an app built with Vite's
    // default `base: "/"` and served under a prefix loads index.html and 404s
    // every asset. `rebase build` asserts the emitted HTML honours
    // REBASE_APP_BASE, but only for someone who runs it — a shipped config that
    // ignores the variable is a blank page waiting for the first project that
    // moves its app off the root.
    it("builds every static app for the path it is served at", () => {
        const raw = manifestOf(dir);
        const { manifest } = validateManifest(raw);
        if (!manifest) return;

        const ignored: string[] = [];
        for (const { name, app } of buildableApps(manifest)) {
            if (app.type !== "static") continue;
            const config = path.join(dir, app.root, "vite.config.ts");
            if (!fs.existsSync(config)) continue;
            // Comments stripped first. Both shipped configs EXPLAIN the variable
            // in a comment above the line that reads it, so a plain substring
            // search stays green when the code underneath stops using it — a
            // guard that passes on the exact mutation it exists to catch.
            const code = fs.readFileSync(config, "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/\/\/.*$/gm, "");
            if (!code.includes("REBASE_APP_BASE")) {
                ignored.push(`apps.${name} → ${path.relative(repoRoot, config)}`);
            }
        }
        expect(ignored).toEqual([]);
    });

    it("declares a runtime at all", () => {
        // Undefined would mean the manifest predates the field, which validation
        // rejects — so finding one here means something wrote it that way.
        expect(backend?.runtime === "managed" || backend?.runtime === "custom").toBe(true);
    });

    it("does not claim `managed` while carrying an entrypoint the runtime never loads", () => {
        if (backend?.runtime !== "managed") return;
        expect(has("backend/src/index.ts")).toBe(false);
    });

    it("does not claim `managed` while shipping an image build", () => {
        // An image is what a `custom` runtime produces. Under `managed` it is
        // built by nothing and deployed by nothing, and it is exactly what makes
        // the project's own `docker compose up` disagree with its manifest.
        if (backend?.runtime !== "managed") return;
        for (const candidate of ["Dockerfile", "backend/Dockerfile", "frontend/Dockerfile"]) {
            expect({ candidate,
present: has(candidate) }).toEqual({ candidate,
present: false });
        }
    });

    it("points `dockerfile` at a file that exists, when it claims `custom`", () => {
        if (backend?.runtime !== "custom") return;
        expect(has(backend.dockerfile ?? "Dockerfile")).toBe(true);
    });
});

/**
 * A scaffolded project's own files must reference things that exist.
 *
 * `main` is the specific field that broke: `backend/package.json` declared
 * `"main": "src/index.ts"` and `"start": "node dist/backend/src/index.js"` after
 * the entrypoint had been moved to the eject payload. Nothing read `main`, so
 * nothing failed — until the Dockerfile's `CMD ["pnpm", "start"]` ran in a
 * container, fifteen minutes into a build.
 */
describe("the scaffolded project references only files it contains", () => {
    const template = path.join(repoRoot, "packages/cli/templates/template");

    const packageJsons = (root: string): string[] => {
        const found: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name === "dist") continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name === "package.json") found.push(full);
            }
        };
        walk(root);
        return found;
    };

    it("has no `main` pointing at a SOURCE file that is not there", () => {
        // Build outputs are exempt: a package that compiles legitimately points
        // `main` at `dist/index.js`, which a template does not ship. What must
        // exist is anything checked in — and `main: "src/index.ts"` outliving
        // the file it names is precisely the break this guards.
        const isBuildOutput = (p: string): boolean => /^(\.\/)?(dist|build|lib|out)\//.test(p);
        const broken: string[] = [];
        for (const file of packageJsons(template)) {
            const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
            if (typeof pkg.main !== "string" || isBuildOutput(pkg.main)) continue;
            if (!fs.existsSync(path.join(path.dirname(file), pkg.main))) {
                broken.push(`${path.relative(repoRoot, file)} → main: "${pkg.main}"`);
            }
        }
        expect(broken).toEqual([]);
    });

    it("builds only Dockerfiles that exist, in its compose file", () => {
        const compose = path.join(template, "docker-compose.yml");
        if (!fs.existsSync(compose)) return;
        const source = fs.readFileSync(compose, "utf8");

        const missing: string[] = [];
        for (const match of source.matchAll(/^\s*dockerfile:\s*(\S+)\s*$/gm)) {
            if (!fs.existsSync(path.join(template, match[1]))) missing.push(match[1]);
        }
        expect(missing).toEqual([]);
    });

    it("mounts a bundle directory that `rebase build` actually produces", () => {
        // The managed compose mounts ./dist-bundle at /bundle. If DEFAULT_BUNDLE_DIR
        // ever changes, the mount silently becomes an empty directory and the
        // runtime boots with no bundle — which reads as a corrupt image.
        const compose = path.join(template, "docker-compose.yml");
        if (!fs.existsSync(compose)) return;
        const source = fs.readFileSync(compose, "utf8");
        if (!source.includes(":/bundle")) return;
        expect(source).toContain("./dist-bundle:/bundle");
    });
});

/**
 * The published JSON Schema and the TypeScript type describe the same file.
 *
 * `rebase.json` has two contracts and they are maintained by hand in two places:
 * `RebaseProjectManifest` in `@rebasepro/types`, which decides what compiles,
 * and `website/public/schemas/rebase.json`, which decides what a developer's
 * editor accepts. Nothing connected them, and they drifted — the schema declared
 * `additionalProperties: false` while omitting `telemetry`, the repository-wide
 * usage-sharing opt-out. That key is implemented, surfaced in `rebase telemetry`
 * output, and unit-tested; a project that used it got
 * `Property telemetry is not allowed` in VS Code. Neither artifact was wrong on
 * its own, which is exactly why no other test caught it.
 *
 * Key parity is asserted rather than the full shape: types and JSON Schema
 * cannot express the same things, so demanding more would mean encoding
 * translation rules that themselves drift. A key appearing on one side and not
 * the other is the failure that actually happened.
 */
describe("rebase.json — the schema and the type agree", () => {
    const schemaPath = path.join(repoRoot, "website/public/schemas/rebase.json");
    const typePath = path.join(repoRoot, "packages/types/src/types/project_manifest.ts");

    /**
     * Top-level property names declared on `RebaseProjectManifest`.
     *
     * Read from source rather than imported: the interface is erased at runtime,
     * so there is nothing to reflect over. Scoped to that one interface's body —
     * the file declares a dozen others — and matches only single-indented
     * members, so nested object literals cannot leak in.
     */
    function typeKeys(): string[] {
        const source = fs.readFileSync(typePath, "utf8");
        const start = source.indexOf("export interface RebaseProjectManifest {");
        expect(start).toBeGreaterThan(-1);
        const body = source.slice(start, source.indexOf("\n}", start));
        // `[\w$]` rather than `\w`: the first member is `$schema`, and a `\w`
        // class silently drops it — which is a false pass, not a false failure.
        return [...body.matchAll(/^ {4}([\w$]+)\??:/gm)].map(m => m[1]).sort();
    }

    function schemaKeys(): string[] {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        return Object.keys(schema.properties).sort();
    }

    it("declares the same top-level keys on both sides", () => {
        expect(schemaKeys()).toEqual(typeKeys());
    });

    it("still refuses unknown keys", () => {
        // The parity check above is only meaningful while the schema is closed.
        // If `additionalProperties` were relaxed to silence a drift, a missing
        // key would stop being an editor error and this suite would be guarding
        // nothing.
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        expect(schema.additionalProperties).toBe(false);
    });
});

/**
 * The reserved-path rule is enforced in three places and must be the same rule.
 *
 * `RESERVED_BACKEND_PREFIXES` in `@rebasepro/types` is what the CLI validates
 * against and what the router orders its mounts by. The published JSON Schema is
 * what a developer's editor checks — a separate artifact, maintained by hand,
 * and the one that decides whether `"path": "/api"` shows up as a red squiggle
 * or as a deploy that answers the API with an index.html.
 *
 * Neither is wrong on its own when they drift, which is the whole reason this
 * file exists.
 */
describe("rebase.json — the reserved paths agree", () => {
    const schemaPath = path.join(repoRoot, "website/public/schemas/rebase.json");

    function schemaReservedPattern(): string {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        return schema.$defs?.staticApp?.properties?.path?.not?.pattern ?? "";
    }

    it("refuses in the schema exactly what the type reserves", () => {
        const names = RESERVED_BACKEND_PREFIXES.map(p => p.slice(1)).join("|");
        expect(schemaReservedPattern()).toBe(`^/(${names})(/|$)`);
    });

    it("rejects a reserved path and accepts a lookalike, by that pattern", () => {
        // Asserting the pattern's BEHAVIOUR, not just its text: a regex that
        // matches the expected string and the wrong set of paths would pass the
        // check above and still let `/api` through an editor.
        const re = new RegExp(schemaReservedPattern());
        for (const reserved of RESERVED_BACKEND_PREFIXES) {
            expect({ path: reserved,
rejected: re.test(reserved) }).toEqual({ path: reserved,
rejected: true });
            expect(re.test(`${reserved}/v2`)).toBe(true);
        }
        for (const allowed of ["/", "/admin", "/apidocs", "/healthy-living", "/metricsss"]) {
            expect({ path: allowed,
rejected: re.test(allowed) }).toEqual({ path: allowed,
rejected: false });
        }
    });
});
