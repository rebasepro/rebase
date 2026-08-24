/**
 * Compile what `rebase eject` emits, and check the image it writes.
 *
 * `rebase eject` is the one command that hands a user server code to run. It was
 * in no CI job and no end-to-end test, and `packages/cli/templates/` sits outside
 * the CLI's tsconfig `rootDir` — so the entrypoint, the env module, the Dockerfile
 * and the compose file it writes were never compiled, built or booted by anything
 * here. Four HIGH defects shipped in that gap and were found by reading:
 *
 *   1. the headless entrypoint imported three files `--headless` deletes;
 *   2. `serveSPA` pointed two directory levels above the frontend, so an ejected
 *      stack booted, health-checked green, served `/api/*` and 404ed on `/`;
 *   3. the Dockerfile copied neither `frontend` nor `rebase.json`;
 *   4. `cronsDir` was never passed and `crons/` was never compiled, so ejecting
 *      silently stopped every scheduled job.
 *
 * The strongest gate would build the image, boot it and fetch `/`. That needs
 * `pnpm install --frozen-lockfile` against a lockfile no scaffold has yet, plus a
 * Docker build, in a job this repository runs only in the e2e lane. This is the
 * slice that runs in seconds and still names all four: it materializes a
 * scaffolded project exactly as `rebase init` lays one out, runs the REAL
 * `ejectCommand` into it, then
 *
 *   - type-checks the emitted server, once per flavour (with collections and a
 *     frontend, and headless) — which is (1), and any type drift between the
 *     payload and `@rebasepro/server`;
 *   - derives where the compiled entrypoint lands from the scaffolded backend
 *     tsconfig, and checks every `__dirname`-relative path the payload computes
 *     against it — which is (2) and (4), without hard-coding the layout the bug
 *     was in;
 *   - checks the Dockerfile against the project on disk: every `COPY` source
 *     exists, every workspace the lockfile will have an importer for is copied,
 *     every `--filter` matches a real package — which is (3);
 *   - and checks the compose file agrees with the Dockerfile and the manifest.
 *
 * Run: pnpm run check:eject
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ejectCommand } from "../packages/cli/src/commands/eject";
import { loadManifest } from "../packages/cli/src/manifest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const templateRoot = path.join(repoRoot, "packages/cli/templates/template");
const baasOverlay = path.join(repoRoot, "packages/cli/templates/overlays/baas");
const tsc = path.join(repoRoot, "node_modules/.bin/tsc");

/** The name `rebase init` would have substituted, and the workspaces named after it. */
const PROJECT_NAME = "ejected-app";

/** Extensions that carry `{{PROJECT_NAME}}` and are safe to rewrite as text. */
const TEXT = /\.(ts|tsx|json|ya?ml|md|html|css|example|mjs|js)$|^(npmrc|gitignore|\.dockerignore|\.env\.example)$/;

const problems: string[] = [];
function check(ok: boolean, message: string): void {
    if (!ok) problems.push(message);
}

function copyDir(from: string, to: string): void {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const source = path.join(from, entry.name);
        const destination = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(source, destination);
        else fs.copyFileSync(source, destination);
    }
}

function walk(dir: string, visit: (file: string) => void): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") walk(full, visit);
        } else visit(full);
    }
}

/**
 * A project as `rebase init` leaves it — including the two renames and the
 * substitution, because both matter here.
 *
 * The payload's Dockerfile copies `.npmrc`, which ships in the template as
 * `npmrc` (npm strips a file of that name from a published tarball) and is
 * renamed on the way out. A check that copied the template verbatim would report
 * a missing file that no user ever sees; one that skipped the rename would miss
 * the day the Dockerfile and `init` disagree about which name it has.
 *
 * `{{PROJECT_NAME}}` matters for the same reason: the Dockerfile builds with
 * `pnpm --filter "*-config"`, and the workspace it has to match is named after
 * the project.
 */
function materialize(flavour: "cms" | "baas", into: string): void {
    copyDir(templateRoot, into);

    if (flavour === "baas") {
        // Mirrors `applyHeadless` in commands/init.ts.
        fs.rmSync(path.join(into, "frontend"), { recursive: true, force: true });
        fs.rmSync(path.join(into, "config/collections"), { recursive: true, force: true });
        for (const stray of ["admin.d.ts", "frontend-assets.d.ts"]) {
            fs.rmSync(path.join(into, "config", stray), { force: true });
        }
        fs.rmSync(path.join(into, "backend/src/schema.generated.ts"), { force: true });
        copyDir(baasOverlay, into);
    } else {
        // `cleanupPresets`: the directory never ships in a scaffolded project,
        // and its `index.ts` files import siblings that only exist once a preset
        // has been copied up. The default preset is blog, already in place.
        fs.rmSync(path.join(into, "config/collections/presets"), { recursive: true, force: true });
    }

    for (const [from, to] of [["gitignore", ".gitignore"], ["npmrc", ".npmrc"]] as const) {
        const shipped = path.join(into, from);
        if (fs.existsSync(shipped)) fs.renameSync(shipped, path.join(into, to));
    }

    walk(into, file => {
        if (!TEXT.test(path.basename(file))) return;
        const before = fs.readFileSync(file, "utf8");
        // `workspace:*` becomes a published version at init time. Nothing here
        // installs, so the value is irrelevant — but leaving the protocol in
        // place would misrepresent what the project on disk looks like.
        const after = before
            .replace(/\{\{PROJECT_NAME\}\}/g, PROJECT_NAME)
            .replace(/"(@rebasepro\/[^"]+)":\s*"workspace:\*"/g, '"$1": "latest"');
        if (after !== before) fs.writeFileSync(file, after, "utf8");
    });

    // Written by `pnpm install`, which is the step this gate deliberately does
    // not run — but the Dockerfile's first `COPY` names it, and a `COPY` naming
    // a path the context does not have fails before any build line runs.
    fs.writeFileSync(path.join(into, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
}

/**
 * Make `@rebasepro/admin-types` resolvable the way a scaffolded project resolves
 * it: as a dependency found by walking up from the file.
 *
 * `config/admin.d.ts` opts in with `/// <reference types="@rebasepro/admin-types" />`,
 * and a triple-slash type reference is resolved through `typeRoots` and
 * `node_modules` — never through tsconfig `paths`. Same shim, and same reason, as
 * `tooling/scripts/check-templates.mjs`.
 */
function linkAdminTypes(into: string): void {
    const shim = path.join(into, "node_modules", "@rebasepro", "admin-types");
    fs.mkdirSync(shim, { recursive: true });
    fs.writeFileSync(
        path.join(shim, "package.json"),
        JSON.stringify({ name: "@rebasepro/admin-types", version: "0.0.0", types: "index.d.ts" }, null, 2),
        "utf8"
    );
    fs.writeFileSync(
        path.join(shim, "index.d.ts"),
        `export * from ${JSON.stringify(path.join(repoRoot, "packages/admin-types/src/index"))};\n`,
        "utf8"
    );
}

/**
 * Read a tsconfig that carries explanatory comments.
 *
 * Whole-line comments only, on purpose. A general block-comment stripper eats
 * the include globs: a recursive glob opens with a slash and two stars, which
 * is also how a block comment opens, and the next star-slash in the line closes
 * it. That stripper reported `crons/` as missing from a tsconfig listing it.
 */
function readJsonc(filePath: string): Record<string, any> {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\s*\/\/.*$/gm, ""));
}

/** Relative imports of a module, resolved to the `.ts` files they name on disk. */
function localImports(modulePath: string): string[] {
    const source = fs.readFileSync(modulePath, "utf8");
    const dir = path.dirname(modulePath);
    const files: string[] = [];
    for (const match of source.matchAll(/^\s*import\s[^"']*from\s*["'](\.[^"']+)["']/gm)) {
        const resolved = path.resolve(dir, match[1]);
        // The payload imports `.js` specifiers that are `.ts` on disk.
        const candidate = [resolved, resolved.replace(/\.js$/, ".ts"), `${resolved}.ts`]
            .find(item => fs.existsSync(item) && fs.statSync(item).isFile());
        if (candidate) files.push(candidate);
    }
    return files;
}

/**
 * Where the backend's own `tsc` puts a source file — derived, not assumed.
 *
 * The ejected image runs `node dist/backend/src/index.js`, two directories
 * deeper than `src/index.ts` suggests, and every `path.resolve(__dirname, …)`
 * in the payload has to be right from *that* directory. Getting that arithmetic
 * wrong by two levels is exactly what made `serveSPA` disable itself and 404 a
 * whole site, on a stack whose health check was green — so this gate must not
 * repeat the arithmetic by hand, or it agrees with the bug.
 *
 * With no `rootDir` set (and neither scaffolded tsconfig sets one, deliberately),
 * tsc emits under the common ancestor of every non-declaration file it compiles
 * — which is the `include` set *plus* whatever those files import from inside
 * the project. That second half is not a detail: the BaaS backend's tsconfig
 * includes only `src` and `functions`, and it is the entrypoint's own
 * `../../config/storage.js` that pulls the common root up to the project root
 * and puts the output two levels down. A template that stopped importing it, or
 * grew a `rootDir`, would move the compiled entrypoint — and the assertions
 * below fail instead of the user's `/` route.
 */
function compiledDirOf(projectRoot: string, sourceDir: string): string {
    const backend = path.join(projectRoot, "backend");
    const tsconfig = readJsonc(path.join(backend, "tsconfig.json"));
    const outDir = path.resolve(backend, tsconfig.compilerOptions?.outDir ?? ".");
    if (tsconfig.compilerOptions?.rootDir) {
        const rootDir = path.resolve(backend, tsconfig.compilerOptions.rootDir);
        return path.join(outDir, path.relative(rootDir, sourceDir));
    }

    // The prefix of each include pattern before its first wildcard is that
    // pattern's root; patterns matching nothing on disk contribute nothing.
    const roots: string[] = [];
    for (const pattern of (tsconfig.include ?? []) as string[]) {
        const resolved = path.resolve(backend, pattern.split(/[*?]/)[0]);
        const base = resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
        if (!fs.existsSync(base)) continue;
        roots.push(fs.statSync(base).isDirectory() ? base : path.dirname(base));
    }
    for (const entry of ["index.ts", "env.ts"]) {
        const module = path.join(sourceDir, entry);
        if (fs.existsSync(module)) roots.push(...localImports(module).map(file => path.dirname(file)));
    }

    let common = roots[0] ?? backend;
    for (const root of roots.slice(1)) {
        const a = common.split(path.sep);
        const b = root.split(path.sep);
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        common = a.slice(0, i).join(path.sep);
    }
    return path.join(outDir, path.relative(common, sourceDir));
}

/** The `COPY` instructions of a Dockerfile, per build stage. */
function copyInstructions(dockerfile: string): { from?: string; sources: string[] }[] {
    const copies: { from?: string; sources: string[] }[] = [];
    for (const line of dockerfile.split("\n")) {
        const trimmed = line.trim();
        if (!/^COPY\s/i.test(trimmed)) continue;
        const tokens = trimmed.split(/\s+/).slice(1);
        const flag = tokens[0]?.startsWith("--from=") ? tokens.shift() : undefined;
        // The last token is the destination.
        copies.push({ from: flag?.slice("--from=".length), sources: tokens.slice(0, -1) });
    }
    return copies;
}

/** The workspace globs of a pnpm-workspace.yaml, which is flat enough to read by line. */
function workspaceGlobs(file: string): string[] {
    const globs: string[] = [];
    let inPackages = false;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
        if (inPackages) {
            const item = /^\s+-\s+"?([^"\s]+)"?\s*$/.exec(line);
            if (item) { globs.push(item[1]); continue; }
            if (line.trim() !== "") inPackages = false;
        }
    }
    return globs;
}

// ─── The checks ──────────────────────────────────────────────────────

/**
 * The Dockerfile eject writes, against the project it was written into.
 *
 * Every assertion here is "does this name something that is really there" — the
 * only kind that would have caught a `COPY` of a directory the scaffold does not
 * have, which fails with `failed to compute cache key` before a single build
 * line runs.
 */
function checkDockerfile(projectRoot: string, flavour: "cms" | "baas"): void {
    const label = `[${flavour}] Dockerfile`;
    const dockerfile = fs.readFileSync(path.join(projectRoot, "Dockerfile"), "utf8");
    check(!dockerfile.includes("{{"), `${label}: an unrendered template marker survived`);

    const copies = copyInstructions(dockerfile);
    const builder = copies.filter(copy => !copy.from).flatMap(copy => copy.sources);
    const runtime = copies.filter(copy => copy.from).flatMap(copy => copy.sources);

    for (const source of builder) {
        if (source === "." || source === "./") continue;
        check(
            fs.existsSync(path.join(projectRoot, source)),
            `${label}: COPY ${source} — the scaffolded project has no such path, so the build fails at cache key`
        );
    }

    // `pnpm install --frozen-lockfile` compares the lockfile's importers against
    // the workspaces it can see. A workspace declared but not copied is a
    // lockfile mismatch, which is a failed build; a workspace copied but not
    // installed is a module that resolves nowhere at boot.
    for (const glob of workspaceGlobs(path.join(projectRoot, "pnpm-workspace.yaml"))) {
        check(
            builder.includes(glob),
            `${label}: pnpm-workspace.yaml declares the "${glob}" workspace, which no builder-stage COPY brings into the image`
        );
    }

    // Read by the entrypoint's first statement, for the storage topology.
    // "Absent" and "declared nothing" are indistinguishable by design, so an
    // image without it boots believing nothing was declared and every upload
    // lands in the wrong bucket or 501s.
    check(builder.includes("rebase.json"), `${label}: rebase.json is not copied into the builder stage`);
    check(
        runtime.some(source => source.endsWith("/rebase.json")),
        `${label}: rebase.json is not carried into the runtime stage`
    );

    if (flavour === "cms") {
        check(builder.includes("frontend"), `${label}: the frontend workspace is not copied, so the image cannot build the site it serves`);
        check(
            runtime.some(source => source.endsWith("/frontend/dist")),
            `${label}: the built site never reaches the runtime stage, so serveSPA answers 404 on /`
        );
    } else {
        check(
            !copies.flatMap(copy => copy.sources).some(source => source.includes("frontend")),
            `${label}: a headless project has no frontend workspace, and copying one fails the build`
        );
    }

    // `pnpm --filter "*-config" run build` is a glob over package NAMES. A
    // template rename makes it match nothing, and pnpm treats "no package
    // matched" as success — so the image builds green with nothing compiled.
    const names = new Map<string, Record<string, string>>();
    for (const glob of workspaceGlobs(path.join(projectRoot, "pnpm-workspace.yaml"))) {
        const manifest = path.join(projectRoot, glob, "package.json");
        if (!fs.existsSync(manifest)) continue;
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
        names.set(parsed.name, parsed.scripts ?? {});
    }
    for (const match of dockerfile.matchAll(/^\s*RUN .*pnpm --filter "([^"]+)" run (\S+)/gm)) {
        const [, pattern, script] = match;
        const expression = new RegExp(`^${pattern.split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
        const matched = [...names].filter(([name]) => expression.test(name));
        check(
            matched.length > 0,
            `${label}: pnpm --filter "${pattern}" matches no workspace in this project — pnpm exits 0 and nothing is built`
        );
        for (const [name, scripts] of matched) {
            check(
                Boolean(scripts[script]),
                `${label}: pnpm --filter "${pattern}" run ${script} matches ${name}, which declares no "${script}" script`
            );
        }
    }
}

/** The compose file, against the Dockerfile and the manifest eject just rewrote. */
function checkCompose(projectRoot: string, flavour: "cms" | "baas"): void {
    const label = `[${flavour}] docker-compose.custom.yml`;
    const compose = fs.readFileSync(path.join(projectRoot, "docker-compose.custom.yml"), "utf8");
    const dockerfile = fs.readFileSync(path.join(projectRoot, "Dockerfile"), "utf8");

    check(!compose.includes("{{"), `${label}: an unrendered template marker survived`);
    check(
        new RegExp(`^name: ${PROJECT_NAME}$`, "m").test(compose),
        `${label}: the compose project name was not substituted from package.json`
    );

    const backend = loadManifest(projectRoot).manifest.apps.backend;
    const declared = backend.type === "backend" ? backend.dockerfile : undefined;
    check(
        declared !== undefined && new RegExp(`dockerfile:\\s*${declared}\\b`).test(compose),
        `${label}: it does not build the Dockerfile rebase.json names (${declared ?? "none"})`
    );
    check(/context:\s*\.\s*$/m.test(compose), `${label}: the build context is not the project root, which is what the Dockerfile's COPYs assume`);

    // One port, named in three places. A compose file publishing a container
    // port the image never listens on is a stack that comes up and refuses every
    // connection, and an orchestrator's health check on the wrong port is a
    // restart loop.
    const exposed = /^\s*EXPOSE\s+(\d+)/m.exec(dockerfile)?.[1];
    check(exposed !== undefined, `[${flavour}] Dockerfile: no EXPOSE, so nothing declares the port the image listens on`);
    if (exposed) {
        check(
            new RegExp(`:${exposed}"`).test(compose),
            `${label}: it publishes no port mapping onto the ${exposed} the Dockerfile EXPOSEs`
        );
        check(
            new RegExp(`PORT:\\s*"${exposed}"`).test(compose),
            `${label}: PORT does not match the Dockerfile's EXPOSE ${exposed}, so the server listens where nothing is published`
        );
        check(
            new RegExp(`localhost:${exposed}/health`).test(dockerfile),
            `[${flavour}] Dockerfile: HEALTHCHECK does not probe the EXPOSEd port ${exposed}`
        );
    }

    if (flavour === "baas") {
        check(
            !/serves the built frontend|frontend\/dist/.test(compose),
            `${label}: it claims to serve a frontend this project does not have`
        );
    }
}

/**
 * Every path the entrypoint computes from `__dirname`, checked against where the
 * file actually runs from — in dev (source) and in the image (compiled).
 */
function checkEmittedPaths(projectRoot: string, flavour: "cms" | "baas"): void {
    const label = `[${flavour}] backend/src/index.ts`;
    const sourceDir = path.join(projectRoot, "backend", "src");
    const compiledDir = compiledDirOf(projectRoot, sourceDir);
    const source = fs.readFileSync(path.join(sourceDir, "index.ts"), "utf8");

    check(!source.includes("{{"), `${label}: an unrendered template marker survived`);

    // What `npm start` in the image calls. `restoreBackendScripts` writes it, and
    // it names a path only the compiled layout produces.
    const scripts = JSON.parse(fs.readFileSync(path.join(projectRoot, "backend", "package.json"), "utf8")).scripts ?? {};
    const started = /node\s+(\S+)/.exec(scripts.start ?? "")?.[1];
    check(
        started !== undefined && path.resolve(projectRoot, "backend", started) === path.join(compiledDir, "index.js"),
        `${label}: backend's "start" script runs ${started ?? "nothing"}, but tsc puts the entrypoint at `
        + `${path.relative(path.join(projectRoot, "backend"), path.join(compiledDir, "index.js"))}`
    );

    // `serveSPA` only warns on a wrong path and disables itself — a stack that
    // boots, health-checks green, serves /api/* perfectly and 404s on `/`.
    // `path.join` as well as `path.resolve`: the shipped bug used `join`, and a
    // gate that only recognised the fixed spelling would report "no serveSPA
    // call" for a call that is right there, pointing two levels too high.
    const spa = /serveSPA\(app, \{ frontendPath: path\.(?:resolve|join)\(__dirname, "([^"]+)"\)/.exec(source);
    if (flavour === "cms") {
        check(spa !== null, `${label}: no serveSPA call, so a project with a frontend serves nothing at /`);
        if (spa) {
            check(
                path.resolve(compiledDir, spa[1]) === path.join(projectRoot, "frontend", "dist"),
                `${label}: serveSPA resolves to ${path.resolve(compiledDir, spa[1])} from the compiled layout, not ${path.join(projectRoot, "frontend", "dist")}`
            );
        }
    } else {
        check(spa === null, `${label}: a headless project has no frontend, so serveSPA has nothing to serve`);
    }

    // The managed runtime passes `cronsDir`; the payload did not, so ejecting
    // silently stopped every scheduled job — nightly backups included — with no
    // message at boot. Sibling-relative, so it is right from both layouts.
    const crons = /const cronsDir = path\.resolve\(__dirname, "([^"]+)"\)/.exec(source);
    check(crons !== null, `${label}: no cronsDir is computed, so an ejected server runs no scheduled jobs`);
    check(/cronsDir:\s*[^,]*\bcronsDir\b/.test(source), `${label}: cronsDir is computed but never passed to initializeRebaseBackend`);
    if (crons) {
        check(
            path.resolve(sourceDir, crons[1]) === path.join(projectRoot, "backend", "crons"),
            `${label}: cronsDir does not point at backend/crons when run from source`
        );
        check(
            path.resolve(compiledDir, crons[1]) === path.join(compiledDir, "..", "crons"),
            `${label}: cronsDir does not point at the compiled crons when run from the image`
        );
    }
    // Which only exist if the project's own build compiles that directory. An
    // ejected project builds with the scaffolded tsconfig, not the generated one
    // `rebase build` writes.
    const include = readJsonc(path.join(projectRoot, "backend", "tsconfig.json")).include ?? [];
    check(
        (include as string[]).includes("crons/**/*"),
        `[${flavour}] backend/tsconfig.json: crons/ is not compiled, so cronsDir points at an empty directory in the image`
    );
}

/** The whole reason this file exists: compile the emitted server. */
function typecheck(projectRoot: string, flavour: "cms" | "baas"): void {
    const include = flavour === "cms"
        // The frontend is a separate program with its own Vite types; what
        // ejecting produces is the server, and this is everything it compiles.
        ? ["backend/**/*.ts", "config/**/*.ts", "config/**/*.tsx"]
        : ["backend/**/*.ts", "config/**/*.ts"];

    fs.writeFileSync(
        path.join(projectRoot, "tsconfig.eject-check.json"),
        `${JSON.stringify({
            "//": "Generated by tooling/scripts/check-eject.mts. See tooling/scripts/eject-check/tsconfig.base.json.",
            extends: path.join(repoRoot, "tooling/scripts/eject-check/tsconfig.base.json"),
            include
        }, null, 4)}\n`,
        "utf8"
    );

    // Real resolution for third-party specifiers, exports maps included.
    fs.symlinkSync(path.join(repoRoot, "node_modules/.pnpm/node_modules"), path.join(projectRoot, "node_modules"), "dir");

    try {
        execFileSync(tsc, ["-p", path.join(projectRoot, "tsconfig.eject-check.json")], {
            stdio: "pipe",
            encoding: "utf8"
        });
        console.log(`  ok   [${flavour}] the emitted server compiles`);
    } catch (error: any) {
        problems.push(`[${flavour}] the emitted server does not compile:\n${(error.stdout || error.stderr || error.message).trim()}`);
        console.log(`  FAIL [${flavour}] the emitted server compiles`);
    }
}

// ─── Run ─────────────────────────────────────────────────────────────

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-eject-check-"));
linkAdminTypes(workRoot);
const cwd = process.cwd();

try {
    for (const flavour of ["cms", "baas"] as const) {
        const projectRoot = path.join(workRoot, flavour);
        materialize(flavour, projectRoot);

        // The real command, not a re-implementation of it: which branch of the
        // payload lands is decided by `resolveBackendPaths` reading the project,
        // and that decision is the one the headless entrypoint got wrong.
        process.chdir(projectRoot);
        await ejectCommand(["node", "rebase", "eject"]);
        process.chdir(cwd);

        checkEmittedPaths(projectRoot, flavour);
        checkDockerfile(projectRoot, flavour);
        checkCompose(projectRoot, flavour);
        typecheck(projectRoot, flavour);
    }
} finally {
    process.chdir(cwd);
}

if (problems.length > 0) {
    console.error("");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("");
    console.error(`${problems.length} problem(s) in what \`rebase eject\` emits.`);
    console.error(`Left in place for inspection: ${workRoot}`);
    process.exit(1);
}

fs.rmSync(workRoot, { recursive: true, force: true });
console.log("  ok   what `rebase eject` emits compiles, and its image names only files that exist");
