/**
 * `rebase eject` — the supported route from the managed runtime to a custom one.
 *
 * The behaviour worth pinning is not "it copies files": it is that the three
 * things that have to change together — entrypoint, image, manifest — do change
 * together, and that a second run cannot quietly overwrite a server the user has
 * since edited.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejectCommand, renderPayload } from "./eject";
import { loadManifest, writeManifest } from "../manifest";
import type { RebaseProjectManifest } from "@rebasepro/types";

let scratch: string;
let cwd: string;
let exitCode: number | undefined;
let logged: string[];

/** `process.exit` unwinds the test runner, so it throws here instead. */
class Exited extends Error {}

/** This package's root, which holds `templates/`. */
const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A scaffolded project, minus the entrypoint eject is here to write.
 *
 * Everything the payload reads at build or boot time is real on disk, because
 * the assertions below are "does the emitted file point at something that
 * exists" — which only means anything against a project that has the files a
 * scaffold has.
 */
function scaffold(): void {
    fs.mkdirSync(path.join(scratch, "backend", "src"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "backend", "functions"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "frontend"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ name: "scratch" }));
    fs.writeFileSync(path.join(scratch, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(scratch, "pnpm-workspace.yaml"), "packages:\n  - backend\n");
    fs.writeFileSync(path.join(scratch, ".npmrc"), "");
    fs.writeFileSync(path.join(scratch, "config", "storage.ts"), "export const storageAuthorize = () => true;\n");
    fs.writeFileSync(path.join(scratch, "config", "collections", "users.ts"), "export default {};\n");
    fs.writeFileSync(path.join(scratch, "backend", "src", "schema.generated.ts"), "export const tables = {};\n");
}

/**
 * The same project as `rebase init --headless` leaves it.
 *
 * `applyHeadless` deletes exactly these three: there are no collections to
 * declare, so no generated schema and no users collection, and no frontend.
 */
function makeHeadless(): void {
    fs.rmSync(path.join(scratch, "config", "collections"), { recursive: true,
force: true });
    fs.rmSync(path.join(scratch, "backend", "src", "schema.generated.ts"), { force: true });
    fs.rmSync(path.join(scratch, "frontend"), { recursive: true,
force: true });
}

/** Every relative import in an emitted module that resolves to nothing. */
function unresolvedImports(modulePath: string): string[] {
    const source = fs.readFileSync(modulePath, "utf8");
    const dir = path.dirname(modulePath);
    const missing: string[] = [];
    for (const match of source.matchAll(/^\s*import\s[^"']*from\s*["'](\.[^"']+)["']/gm)) {
        const resolved = path.resolve(dir, match[1]);
        // The payload imports `.js` specifiers that are `.ts` on disk.
        const candidates = [resolved, resolved.replace(/\.js$/, ".ts"), `${resolved}.ts`];
        if (!candidates.some(candidate => fs.existsSync(candidate))) missing.push(match[1]);
    }
    return missing;
}

/**
 * Every name a package's barrel re-exports, following one level of `export *`.
 *
 * Textual rather than an `import()` of the package: importing @rebasepro/server
 * here would drag its whole module graph, and side effects, into a test about
 * a template's text.
 */
function collectExports(barrel: string, depth = 0): Set<string> {
    const names = new Set<string>();
    if (!fs.existsSync(barrel) || depth > 2) return names;
    const source = fs.readFileSync(barrel, "utf8");
    const dir = path.dirname(barrel);

    for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
        for (const part of match[1].split(",")) {
            const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "").trim();
            if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        }
    }
    for (const match of source.matchAll(/^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
        names.add(match[1]);
    }
    for (const match of source.matchAll(/export\s+\*\s+from\s*["'](\.[^"']+)["']/g)) {
        const target = path.resolve(dir, match[1].replace(/\.js$/, ""));
        for (const candidate of [`${target}.ts`, path.join(target, "index.ts")]) {
            if (fs.existsSync(candidate)) {
                for (const name of collectExports(candidate, depth + 1)) names.add(name);
                break;
            }
        }
    }
    return names;
}

/** The `COPY` instructions of a Dockerfile, per build stage. */
function copyInstructions(dockerfile: string): { stage: number; from?: string; sources: string[] }[] {
    const copies: { stage: number; from?: string; sources: string[] }[] = [];
    let stage = -1;
    for (const line of dockerfile.split("\n")) {
        const trimmed = line.trim();
        if (/^FROM\s/i.test(trimmed)) stage += 1;
        if (!/^COPY\s/i.test(trimmed)) continue;
        const tokens = trimmed.split(/\s+/).slice(1);
        const flag = tokens[0]?.startsWith("--from=") ? tokens.shift() : undefined;
        // The last token is the destination.
        copies.push({ stage,
from: flag?.slice("--from=".length),
sources: tokens.slice(0, -1) });
    }
    return copies;
}

/** Console output without the colour codes, which are on or off by environment. */
function plain(text: string): string {
    // Built at runtime so the pattern carries no literal control character.
    return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

/** Read a tsconfig that carries comments. */
function readJsonc(filePath: string): Record<string, unknown> {
    const text = fs.readFileSync(filePath, "utf8").replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(text);
}

beforeEach(() => {
    cwd = process.cwd();
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-eject-")));
    // `findProjectRoot` looks for these.
    scaffold();

    exitCode = undefined;
    logged = [];
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        exitCode = code;
        throw new Exited(`exit ${code}`);
    }) as never);
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        logged.push(parts.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
        logged.push(parts.join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    process.chdir(scratch);
});

afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(scratch, { recursive: true,
force: true });
    vi.restoreAllMocks();
});

function manifestWith(runtime: "managed" | "custom"): void {
    const manifest: RebaseProjectManifest = {
        rebase: "^1",
        apps: {
            backend: runtime === "custom"
                ? { type: "backend",
runtime: "custom",
dockerfile: "Dockerfile",
port: 8080 }
                : { type: "backend",
runtime: "managed" },
            admin: { type: "static",
root: "frontend",
output: "frontend/dist",
path: "/" }
        }
    };
    writeManifest(scratch, manifest);
}

/** Run the command the way the CLI does: argv, with the command at index 2. */
const run = (...flags: string[]) => ejectCommand(["node", "rebase", "eject", ...flags]);

describe("rebase eject", () => {
    it("writes the entrypoint, the Dockerfile and the manifest change together", async () => {
        manifestWith("managed");

        await run();

        expect(fs.existsSync(path.join(scratch, "backend/src/index.ts"))).toBe(true);
        expect(fs.existsSync(path.join(scratch, "backend/src/env.ts"))).toBe(true);
        expect(fs.existsSync(path.join(scratch, "Dockerfile"))).toBe(true);

        const backend = loadManifest(scratch).manifest.apps.backend;
        expect(backend).toMatchObject({
            type: "backend",
            runtime: "custom",
            dockerfile: "Dockerfile",
            port: 8080
        });
    });

    it("writes a compose file that builds the image, and leaves the managed one alone", async () => {
        // Going back should stay a one-line change in rebase.json, not a
        // restore from git — so the scaffolded docker-compose.yml is untouched
        // and the ejected shape lands beside it.
        fs.writeFileSync(path.join(scratch, "docker-compose.yml"), "# managed shape\n");
        manifestWith("managed");

        await run();

        expect(fs.readFileSync(path.join(scratch, "docker-compose.yml"), "utf8")).toBe("# managed shape\n");
        const custom = fs.readFileSync(path.join(scratch, "docker-compose.custom.yml"), "utf8");
        expect(custom).toContain("build:");
        expect(custom).toContain("dockerfile: Dockerfile");
    });

    it("substitutes the project name into the payload", async () => {
        // The payload carries {{PROJECT_NAME}}; shipping that literal would put
        // a broken project name in every `docker compose ps`.
        fs.writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ name: "my-cool-app" }));
        manifestWith("managed");

        await run();

        const custom = fs.readFileSync(path.join(scratch, "docker-compose.custom.yml"), "utf8");
        expect(custom).toContain("name: my-cool-app");
        expect(custom).not.toContain("{{PROJECT_NAME}}");
    });

    it("leaves a manifest that still validates", async () => {
        // The rewrite goes through the same validator every other command uses,
        // so an eject that produced an unloadable manifest would be caught here
        // rather than on the user's next command.
        manifestWith("managed");
        await run();
        expect(() => loadManifest(scratch)).not.toThrow();
        expect(loadManifest(scratch).source).toBe("file");
    });

    it("refuses a flag nobody declared rather than ejecting anyway", async () => {
        // The old parse ran permissively and then skipped every token starting
        // with `-` when looking for the app, so a mistyped flag was dropped in
        // silence and the command went ahead and rewrote the project.
        manifestWith("managed");

        await expect(run("--dry")).rejects.toThrow(/unknown or unexpected option/);
        expect(fs.existsSync(path.join(scratch, "backend/src/index.ts"))).toBe(false);
        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "managed" });
    });

    it("names the app it was given even when a flag precedes the command", async () => {
        // `slice(2)` then `_.slice(1)` assumed `eject` was at index 2: with a
        // flag in front, the app read as the word "eject".
        manifestWith("managed");

        await ejectCommand(["node", "rebase", "--debug", "eject", "backend"]);

        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "custom" });
    });

    it("refuses to run twice", async () => {
        manifestWith("custom");

        await expect(run()).rejects.toThrow(Exited);
        expect(exitCode).toBe(1);
        // And it did not touch anything on the way out.
        expect(fs.existsSync(path.join(scratch, "backend/src/index.ts"))).toBe(false);
    });

    it("never overwrites a Dockerfile that already exists", async () => {
        // Someone's build is theirs. Clobbering it would be the one unrecoverable
        // thing this command could do.
        manifestWith("managed");
        fs.writeFileSync(path.join(scratch, "Dockerfile"), "FROM scratch # mine\n");

        await run();

        expect(fs.readFileSync(path.join(scratch, "Dockerfile"), "utf8")).toContain("# mine");
        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "custom" });
    });

    it("changes nothing under --dry-run", async () => {
        manifestWith("managed");

        await run("--dry-run");

        expect(fs.existsSync(path.join(scratch, "backend/src/index.ts"))).toBe(false);
        expect(fs.existsSync(path.join(scratch, "Dockerfile"))).toBe(false);
        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "managed" });
    });

    it("restores the backend scripts, so the image has something to start", async () => {
        manifestWith("managed");
        fs.writeFileSync(
            path.join(scratch, "backend", "package.json"),
            JSON.stringify({ name: "b",
scripts: { build: "tsc" } }, null, 4)
        );

        await run();

        const pkg = JSON.parse(fs.readFileSync(path.join(scratch, "backend", "package.json"), "utf8"));
        expect(pkg.main).toBe("src/index.ts");
        expect(pkg.scripts.start).toContain("node");
        // And it does not clobber a script that was already there.
        expect(pkg.scripts.build).toBe("tsc");
    });

    it("refuses a static app, which has no server to own", async () => {
        manifestWith("managed");

        await expect(run("admin")).rejects.toThrow(Exited);
        expect(exitCode).toBe(1);
    });

    it("refuses an app that is not declared", async () => {
        manifestWith("managed");

        await expect(run("nope")).rejects.toThrow(Exited);
        expect(exitCode).toBe(1);
    });
});

/**
 * What the payload has to be true *of the project it lands in*.
 *
 * These assert on the emitted files rather than on strings the test wrote:
 * every import resolves, every `COPY` names something that exists, and every
 * path computed from `__dirname` lands where the compiled layout actually puts
 * the thing it names. That is the layer the eject payload was never checked at
 * — nothing in this repository compiles, builds or boots it.
 */
describe("the ejected payload", () => {
    /** Where the compiled entrypoint runs from: `backend/dist/backend/src`. */
    const COMPILED_DIR = "/app/backend/dist/backend/src";
    /** Where it runs from under `tsx`, straight from source. */
    const SOURCE_DIR = "/app/backend/src";

    it("emits no unrendered template markers", async () => {
        manifestWith("managed");

        await run();

        for (const file of ["backend/src/index.ts", "backend/src/env.ts", "Dockerfile", "docker-compose.custom.yml"]) {
            expect(fs.readFileSync(path.join(scratch, file), "utf8")).not.toContain("{{");
        }
    });

    it("emits an entrypoint whose every relative import exists in the project", async () => {
        manifestWith("managed");

        await run();

        expect(unresolvedImports(path.join(scratch, "backend/src/index.ts"))).toEqual([]);
    });

    it("emits a headless entrypoint that does not import the files --headless deleted", async () => {
        // `rebase init --headless` removes config/collections, the generated
        // schema and the frontend; the BaaS backend tsconfig then tells the user
        // their entrypoint "lives behind `rebase eject`". Ejecting used to hand
        // them two TS2307s and, past tsc, an ERR_MODULE_NOT_FOUND at boot.
        makeHeadless();
        manifestWith("managed");

        await run();

        const entrypoint = path.join(scratch, "backend/src/index.ts");
        expect(unresolvedImports(entrypoint)).toEqual([]);
        const source = fs.readFileSync(entrypoint, "utf8");
        // Collections come from the live database instead, which is what the
        // managed runtime does for the same project.
        expect(source).not.toMatch(/collectionsDir:/);
        expect(source).not.toMatch(/\bserveSPA\b/);
        // And the compose file must not claim the image serves a site it has no
        // sources for.
        const compose = fs.readFileSync(path.join(scratch, "docker-compose.custom.yml"), "utf8");
        expect(compose).not.toContain("serves the built frontend");
    });

    it("points serveSPA at the frontend directory the compiled layout actually has", async () => {
        // `serveSPA` warns and disables itself on a wrong path, so this was a
        // stack that booted, health-checked green, served /api/* perfectly and
        // 404ed on `/`.
        manifestWith("managed");

        await run();

        const source = fs.readFileSync(path.join(scratch, "backend/src/index.ts"), "utf8");
        const call = /serveSPA\(app, \{ frontendPath: path\.resolve\(__dirname, "([^"]+)"\)/.exec(source);
        expect(call).not.toBeNull();
        expect(path.resolve(COMPILED_DIR, call![1])).toBe("/app/frontend/dist");
    });

    it("imports only symbols the runtime packages actually export", async () => {
        // Nothing type-checks this template: it carries `{{…}}` markers and
        // resolves `../../config/*` against a project that does not exist here.
        // So a symbol renamed or removed in @rebasepro/server reaches a user as
        // a TS2305 in the file they were just handed. This is the check the
        // compiler cannot run.
        manifestWith("managed");

        await run();

        const source = fs.readFileSync(path.join(scratch, "backend/src/index.ts"), "utf8");
        const barrels: Record<string, string> = {
            "@rebasepro/server": path.join(cliRoot, "..", "server", "src", "index.ts"),
            "@rebasepro/types": path.join(cliRoot, "..", "types", "src", "index.ts")
        };

        for (const [pkg, barrel] of Object.entries(barrels)) {
            const block = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${pkg}["']`).exec(source);
            if (!block) continue;
            const named = block[1]
                .split(",")
                .map(part => part.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
                .filter(Boolean)
                // The payload's own comment markers are stripped before this,
                // but a `// {{#frontend}}` line inside the block leaves text.
                .filter(name => /^[A-Za-z_$][\w$]*$/.test(name));
            expect(named.length).toBeGreaterThan(0);

            // Resolved by name against the package's own public surface, which
            // is an explicit barrel of named re-exports.
            const surface = collectExports(barrel);
            for (const name of named) {
                expect({ pkg, name, exported: surface.has(name) })
                    .toEqual({ pkg, name, exported: true });
            }
        }
    });

    it("opens one connection per declared database, not one per project", async () => {
        // It used to be `createPostgresDatabaseConnection(env.DATABASE_URL)` and
        // nothing else, so a project declaring `database("analytics")` ejected
        // into a backend that ignored it: collections routed there fell back to
        // the default driver and their rows landed in the wrong database, behind
        // a server that health-checked green.
        manifestWith("managed");

        await run();

        const source = fs.readFileSync(path.join(scratch, "backend/src/index.ts"), "utf8");
        expect(source).toMatch(/resolveDataSources\(\s*process\.env,\s*dataSources\s*\)/);
        expect(source).toMatch(/bootstrappers:\s*drivers\.map/);
        // And every pool closes, not just the first.
        expect(source).toMatch(/drivers\.map\(driver => driver\.connection\.pool\?\.end\(\)\)/);
    });

    it("passes a cronsDir, and the scaffolded tsconfig compiles what it points at", async () => {
        // The managed runtime passes `cronsDir`; the payload did not, so
        // ejecting silently stopped every scheduled job — nightly backups
        // included — with no message at boot.
        manifestWith("managed");

        await run();

        const source = fs.readFileSync(path.join(scratch, "backend/src/index.ts"), "utf8");
        const declared = /const cronsDir = path\.resolve\(__dirname, "([^"]+)"\)/.exec(source);
        expect(declared).not.toBeNull();
        expect(source).toMatch(/cronsDir:\s*[^,]*\bcronsDir\b/);
        // Correct from both layouts, exactly like the sibling `functionsDir`.
        expect(path.resolve(SOURCE_DIR, declared![1])).toBe("/app/backend/crons");
        expect(path.resolve(COMPILED_DIR, declared![1])).toBe("/app/backend/dist/backend/crons");

        // Which only exists if the project's own build compiles that directory:
        // `rebase build` uses a generated tsconfig, but an ejected project
        // builds with the scaffolded one.
        for (const flavour of ["template/backend", "overlays/baas/backend"]) {
            const tsconfig = readJsonc(path.join(cliRoot, "templates", flavour, "tsconfig.json"));
            expect(tsconfig.include).toContain("crons/**/*");
        }
    });

    it("builds an image containing everything the entrypoint reads at boot", async () => {
        manifestWith("managed");

        await run();

        const copies = copyInstructions(fs.readFileSync(path.join(scratch, "Dockerfile"), "utf8"));
        const builder = copies.filter(copy => !copy.from);
        const runtime = copies.filter(copy => copy.from);

        // Nothing is copied that the project does not have: a missing path is
        // "failed to compute cache key", before any build line runs.
        for (const copy of builder) {
            for (const source of copy.sources) {
                expect({ source,
exists: fs.existsSync(path.join(scratch, source)) }).toEqual({ source,
exists: true });
            }
        }

        const builderSources = builder.flatMap(copy => copy.sources);
        // The entrypoint's first statement reads rebase.json for the storage
        // topology. Absent and "declared nothing" are indistinguishable by
        // design, so the image has to carry it.
        expect(builderSources).toContain("rebase.json");
        // And it serves the frontend itself, which means building it here.
        expect(builderSources).toContain("frontend");

        const runtimeSources = runtime.flatMap(copy => copy.sources);
        expect(runtimeSources).toContain("/app/rebase.json");
        expect(runtimeSources).toContain("/app/frontend/dist");
    });

    it("builds a headless image without the frontend the project does not have", async () => {
        makeHeadless();
        manifestWith("managed");

        await run();

        const copies = copyInstructions(fs.readFileSync(path.join(scratch, "Dockerfile"), "utf8"));
        for (const copy of copies.filter(item => !item.from)) {
            for (const source of copy.sources) {
                expect({ source,
exists: fs.existsSync(path.join(scratch, source)) }).toEqual({ source,
exists: true });
            }
        }
        expect(copies.flatMap(copy => copy.sources)).toContain("rebase.json");
        expect(copies.flatMap(copy => copy.sources).join(" ")).not.toContain("frontend");
    });
});

describe("renderPayload", () => {
    const shape = { collections: false,
frontend: true };

    it("keeps the branch that applies and removes both markers", () => {
        const rendered = renderPayload(
            [
                "keep me",
                "// {{#collections}}",
                "declared",
                "// {{/collections}}",
                "// {{^collections}}",
                "introspected",
                "// {{/collections}}",
                "# {{#frontend}}",
                "COPY frontend ./frontend",
                "# {{/frontend}}"
            ].join("\n"),
            shape,
            "app"
        );

        expect(rendered.split("\n")).toEqual(["keep me", "introspected", "COPY frontend ./frontend"]);
    });

    it("refuses a block name that is not a shape flag", () => {
        // A typo in a template would otherwise silently delete the block it
        // meant to keep.
        expect(() => renderPayload("// {{#collektions}}\nx\n// {{/collektions}}", shape, "app"))
            .toThrow(/unknown block/);
    });

    it("refuses an unterminated block", () => {
        expect(() => renderPayload("// {{#frontend}}\nx\n", shape, "app")).toThrow(/never closed/);
    });
});

describe("an entrypoint that is already there", () => {
    const entrypoint = () => path.join(scratch, "backend", "src", "index.ts");

    it("refuses to replace it, and writes nothing at all", async () => {
        // `runtime: "custom"` means "already ejected", not "nobody wrote a
        // server here" — and `rebase dev` runs backend/src/index.ts by file
        // existence, so this file is very often the server someone is editing.
        // The CLI's own managed-project warning used to point people straight
        // at the command that destroyed it.
        manifestWith("managed");
        fs.writeFileSync(entrypoint(), "// mine\n");

        await expect(run()).rejects.toThrow(Exited);

        expect(exitCode).toBe(1);
        expect(fs.readFileSync(entrypoint(), "utf8")).toBe("// mine\n");
        expect(fs.existsSync(path.join(scratch, "Dockerfile"))).toBe(false);
        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "managed" });
    });

    it("replaces it under --force, keeping the old contents as .bak", async () => {
        manifestWith("managed");
        fs.writeFileSync(entrypoint(), "// mine\n");

        await run("--force");

        expect(fs.readFileSync(`${entrypoint()}.bak`, "utf8")).toBe("// mine\n");
        expect(fs.readFileSync(entrypoint(), "utf8")).toContain("initializeRebaseBackend");
        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "custom" });
    });

    it("calls an overwrite an overwrite in --dry-run", async () => {
        manifestWith("managed");
        fs.writeFileSync(entrypoint(), "// mine\n");

        await run("--dry-run", "--force");

        const report = plain(logged.join("\n"));
        expect(report).toMatch(/overwrite\s+backend\/src\/index\.ts/);
        expect(report).toContain("backend/src/index.ts.bak");
        expect(fs.readFileSync(entrypoint(), "utf8")).toBe("// mine\n");
    });
});
