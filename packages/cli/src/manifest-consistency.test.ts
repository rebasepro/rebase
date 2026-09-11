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
    context?: string;
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

    /**
     * The build context holds everything the Dockerfile copies out of it.
     *
     * `context` was validated and stored and read by nothing, so it could say
     * anything — and for the reference project the DEFAULT said something
     * wrong. `app/backend/Dockerfile` opens with
     *
     *     COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
     *
     * and `app/` has none of those three; they are at the monorepo root, which
     * is where `infra/cloudbuild.yaml` has always built from. Nothing noticed,
     * because the only consumer was a line of help text.
     *
     * Checked by resolving each `COPY` source against the context and looking,
     * which is the same question `docker build` asks and the one no amount of
     * reading the manifest answers. Stage copies are skipped: `--from=` names
     * an earlier stage's filesystem, not the context.
     */
    it("has a build context containing everything its Dockerfile COPYs", () => {
        if (backend?.runtime !== "custom") return;
        const dockerfile = path.join(dir, backend.dockerfile ?? "Dockerfile");
        const contextDir = path.resolve(dir, backend.context ?? ".");

        const unreachable = copySourcesOf(dockerfile)
            .filter(source => !fs.existsSync(path.resolve(contextDir, source)));

        expect({ context: backend.context ?? ".",
unreachable }).toEqual({ context: backend.context ?? ".",
unreachable: [] });
    });
});

/**
 * Paths a Dockerfile copies out of its build context.
 *
 * Deliberately small: continuations joined, flags and the destination dropped,
 * `--from=` stage copies skipped, globs skipped because only `docker build`
 * knows what they match. Anything it cannot read confidently it leaves out —
 * a parser that guesses would fail builds that work, which is the one outcome
 * worse than the gap it is closing.
 */
function copySourcesOf(dockerfile: string): string[] {
    const text = fs.readFileSync(dockerfile, "utf8").replace(/\\\r?\n/g, " ");
    const sources: string[] = [];

    for (const line of text.split("\n")) {
        const instruction = line.trim();
        if (!/^(COPY|ADD)\s/i.test(instruction)) continue;

        const tokens = instruction.split(/\s+/).slice(1);
        if (tokens.some(token => /^--from=/i.test(token))) continue;

        const operands = tokens.filter(token => !token.startsWith("--"));
        // Last operand is the destination inside the image.
        for (const source of operands.slice(0, -1)) {
            if (/[*?[\]]/.test(source)) continue;
            sources.push(source);
        }
    }
    return sources;
}

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
     * Property names declared on one interface in `project_manifest.ts`.
     *
     * Read from source rather than imported: the interface is erased at runtime,
     * so there is nothing to reflect over. Scoped to that one interface's body —
     * the file declares a dozen others — and matches only single-indented
     * members, so nested object literals cannot leak in.
     */
    function typeKeys(interfaceName: string): string[] {
        const source = fs.readFileSync(typePath, "utf8");
        const start = source.indexOf(`export interface ${interfaceName} {`);
        expect(start).toBeGreaterThan(-1);
        const body = source.slice(start, source.indexOf("\n}", start));
        // `[\w$]` rather than `\w`: the first member is `$schema`, and a `\w`
        // class silently drops it — which is a false pass, not a false failure.
        return [...body.matchAll(/^ {4}([\w$]+)\??:/gm)].map(m => m[1]).sort();
    }

    /** Property names on the root schema, or on one of its `$defs`. */
    function schemaKeys(def?: string): string[] {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        const node = def ? schema.$defs?.[def] : schema;
        expect(node?.properties).toBeDefined();
        return Object.keys(node.properties).sort();
    }

    it("declares the same top-level keys on both sides", () => {
        expect(schemaKeys()).toEqual(typeKeys("RebaseProjectManifest"));
    });

    /**
     * The app definitions, which is where the keys people actually write live.
     *
     * Only the top level was compared here, and every field of a `rebase.json`
     * that is not `rebase`, `apps` or `telemetry` sits one level down — so the
     * parity claim covered three keys and left the other sixteen unguarded. A
     * field added to `RebaseStaticAppConfig` and to the CLI validator but not to
     * the schema is invisible to the check above, ships green, and turns every
     * editor red on a file the CLI accepts. `$defs` is closed for the same
     * reason the root is, so an omission there is a rejection, not a gap.
     */
    it.each([
        ["backendApp", "RebaseBackendAppConfig"],
        ["staticApp", "RebaseStaticAppConfig"]
    ])("declares the same keys on %s as on %s", (def, interfaceName) => {
        expect(schemaKeys(def)).toEqual(typeKeys(interfaceName));
    });

    it.each(["backendApp", "staticApp"])("keeps %s closed", (def) => {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        expect(schema.$defs?.[def]?.additionalProperties).toBe(false);
    });

    /**
     * An app entry is chosen by its `type`, not by trying both shapes.
     *
     * `apps.*` was `oneOf: [backendApp, staticApp]`. JSON Schema's `oneOf` has
     * no discriminator, so when neither branch matched — which is what ANY
     * mistake in a static app looks like, the branches being closed — an editor
     * had seven errors to choose from and picked the backend branch's:
     *
     *     Value should be one of: "backend"
     *
     * on a `"type": "static"` app, naming a key the file does not contain. One
     * typo'd property produced it. Dispatching on `type` through `if`/`then`
     * reduces the same typo to `Property pth is not allowed`, on the property.
     *
     * Asserted rather than left to review because the failure is not visible
     * from this repository at all: every gate here reads the schema with a
     * parser that does not care, and the only place the difference shows up is
     * somebody else's editor.
     */
    it("picks an app's shape by its `type` rather than trying both", () => {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        const entry = schema.properties?.apps?.additionalProperties;
        expect(entry?.oneOf).toBeUndefined();
        expect(entry?.required).toEqual(["type"]);
        const dispatched = (entry?.allOf ?? []).map((branch: {
            if?: { properties?: { type?: { const?: string } } };
            then?: { $ref?: string };
        }) => [branch.if?.properties?.type?.const, branch.then?.$ref]);
        expect(dispatched).toEqual([
            ["backend", "#/$defs/backendApp"],
            ["static", "#/$defs/staticApp"]
        ]);
    });

    /**
     * And the set it dispatches over is the type's, not a copy that drifted.
     *
     * `RebaseAppType` has been edited twice — `admin` and `custom` were removed
     * — and a schema still offering a departed type completes it in an editor,
     * then rejects the file it just helped write.
     */
    it("offers exactly the app types the union declares", () => {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        const source = fs.readFileSync(typePath, "utf8");
        const union = source.match(/export type RebaseAppType =([^;]+);/)?.[1] ?? "";
        const declared = [...union.matchAll(/"([^"]+)"/g)].map(m => m[1]).sort();
        expect(declared.length).toBeGreaterThan(0);
        expect([...(schema.properties?.apps?.additionalProperties?.properties?.type?.enum ?? [])].sort())
            .toEqual(declared);
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
 * The two path rules agree on actual paths, not just in intent.
 *
 * `checkRelativePath` normalizes and refuses anything landing outside the
 * project; the schema does it with a regex. They disagreed on the shortest case
 * there is: the pattern was `^(?!/)(?!\.\./).*`, which refuses `"../"` and
 * accepts a bare `".."` — so an editor blessed `"config": ".."` and the CLI
 * then rejected it. Agreement asserted by running the same strings through
 * both, because two hand-written rules for one question drift silently and the
 * only proof is the verdicts.
 *
 * `context` is deliberately not on this list: it is the one field allowed to
 * escape, and it has its own `$def`. That exception is covered above.
 */
describe("rebase.json — the path rules agree", () => {
    const schemaPath = path.join(repoRoot, "website/public/schemas/rebase.json");

    /** Paths the editor and the CLI must judge identically. */
    const SAMPLES = ["config", "./config", "backend/functions", "..foo", "..", "../", "../..", "a/b/../c"];

    function schemaAccepts(value: string): boolean {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        return new RegExp(schema.$defs.relativePath.pattern).test(value)
            && value.length >= (schema.$defs.relativePath.minLength ?? 0);
    }

    function cliAccepts(value: string): boolean {
        const { issues } = validateManifest({
            rebase: "^1",
            apps: { backend: { type: "backend", runtime: "managed", config: value } }
        });
        return !issues.some(issue => issue.path === "apps.backend.config");
    }

    it.each(SAMPLES)("judges %j the same way on both sides", (value) => {
        expect({ value,
schema: schemaAccepts(value) }).toEqual({ value,
schema: cliAccepts(value) });
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
