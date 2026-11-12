/**
 * Typecheck every scaffold `rebase init` writes — once per preset, laid out the
 * way `applyPreset` lays it out, and the `--headless` shape the way
 * `applyHeadless` does — and hold the scaffolds to the invariants a new project
 * must start with.
 *
 * Nothing else checks these quickly. The only thing that compiled them was the
 * CMS init e2e, inside a Docker build about fifteen minutes in, which is how a
 * template carrying a stale shape stayed invisible until the last gate. A
 * template is the first code every new project runs, and the first an agent
 * reads.
 *
 * What a preset is: the blog preset is `templates/template/` itself; another
 * preset removes `BLOG_PRESET_FILES` (exported by commands/init.ts) and lays
 * `templates/presets/<name>/` over the result. The compile covers the whole
 * project — `backend/` (tables, resources, storage, functions, scripts) and
 * `frontend/src/` (App.tsx and every `customizeTable`, checked against the
 * table it customizes) — against the packages' SOURCES through tsconfig
 * `paths`. Diagnostics inside package sources are not reported here: they are
 * `pnpm typecheck`'s, and a scaffold is judged by its own files.
 *
 * The invariants:
 *   - each preset and the headless shape type-check;
 *   - no template imports `zod` directly;
 *   - every table in a template states its `rls`;
 *   - `frontend/**` imports `backend/**` as types only (`backend-type-imports.mjs`);
 *   - a headless scaffold has no React, and no admin package, anywhere in what
 *     it installs — directly or through a workspace package it depends on;
 *   - Mode B has no config workspace and no collections plugin;
 *   - a preset's App.tsx differs from the blog's only in its customizations;
 *   - scripts per shape, tsconfig resolution, declared ambient types, install
 *     allowlists, single-declared deps, the PGlite pins, `.env.example`
 *     coverage, Node floors, quoted files and getting-started paths;
 *   - the template-pins import half: a template imports only what the version
 *     `rebase init` pins exports.
 *
 * Run: pnpm run check:templates [-- --released-as <version>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

import { findValueImportsOfBackend, sourceFilesUnder } from "./backend-type-imports.mjs";
import { checkTemplatePins } from "./check-template-pins.mjs";
import { loadCliCommands } from "./docs-verify/cli-commands.mjs";
import { checkResolutionMatchesShipped, stripJsonComments } from "./template-tsconfig.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const templatesRoot = path.join(repoRoot, "packages/cli/templates");
const templateRoot = path.join(templatesRoot, "template");
const presetsRoot = path.join(templatesRoot, "presets");
const baasOverlay = path.join(templatesRoot, "overlays/baas");
const initSource = path.join(repoRoot, "packages/cli/src/commands/init.ts");
const tsc = path.join(repoRoot, "node_modules/.bin/tsc");

/** Presets offered by `rebase init`, from TemplatePreset. */
const PRESETS = ["blog", "ecommerce", "blank"];

/** The `--headless` scaffold, checked as its own variant. */
const HEADLESS = "headless";

/**
 * `BLOG_PRESET_FILES` from commands/init.ts, read from its source rather than
 * copied here: a second list is a list that drifts, and this gate would then
 * check a layout `rebase init` does not produce.
 */
function blogPresetFiles() {
    const source = fs.readFileSync(initSource, "utf8");
    const block = /export const BLOG_PRESET_FILES[^=]*=\s*\[([\s\S]*?)\]/.exec(source);
    if (!block) throw new Error("commands/init.ts no longer exports BLOG_PRESET_FILES — this gate cannot lay out a preset the way init does");
    return [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/**
 * A template never imports `zod` directly.
 *
 * `loadEnv({ extend })` merges the project's schema with the framework's, and
 * zod recognises a `.default()` by class identity — so a schema built against a
 * second copy of zod is not merged, it is rejected field by field. The symptom
 * is a raw ZodError at boot naming variables the operator never set, and it has
 * cost this project twice: a managed deploy that reported success and ran zero
 * crons, and every project ejected on 0.18.0–0.19.0, which could not boot at
 * all. Both times the schema was built with the wrong `z`.
 *
 * The exception is deliberate and narrow — a template that pins a version which
 * does not export `z` has no other option, and that is why this import existed
 * between 0.17.3 and 0.18.0. So the rule is not "never import zod", it is "never
 * import zod while the runtime exports it", which is the state that turns a
 * workaround into a defect.
 */
function checkNoDirectZodImports() {
    const problems = [];
    const runtimeExportsZ = fs
        .readFileSync(path.join(repoRoot, "packages/server/src/index.ts"), "utf8")
        .includes('export { z } from "zod"');
    if (!runtimeExportsZ) return problems;

    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/\.tsx?$/.test(entry.name)) continue;
            for (const line of fs.readFileSync(full, "utf8").split("\n")) {
                // An import statement, not a mention of one in a comment.
                if (/^\s*import\s[^\n]*from\s*["']zod["']\s*;?\s*$/.test(line)) {
                    problems.push(
                        `${path.relative(repoRoot, full)} → ${line.trim()} — @rebasepro/server exports \`z\`; ` +
                        "a schema built with another copy is rejected field by field by `loadEnv({ extend })`, " +
                        "and the server dies at boot on a raw ZodError."
                    );
                }
            }
        }
    };
    walk(path.join(repoRoot, "packages/cli/templates"));
    return problems;
}

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(src, dest);
        else fs.copyFileSync(src, dest);
    }
}

/** Lay out one preset the way `rebase init` does: the template, then the preset over it. */
function materialize(preset, into) {
    copyDir(templateRoot, into);
    if (preset === "blog") return;
    for (const file of blogPresetFiles()) fs.rmSync(path.join(into, file), { force: true });
    copyDir(path.join(presetsRoot, preset), into);
}

/**
 * Lay out the headless scaffold the way `applyHeadless` does: drop `frontend/`,
 * `backend/schema/` and the generated schema, then copy the overlay over the top.
 *
 * It is the flavour with no Docker coverage at all: `cli-init-baas-e2e.ts` boots
 * the project directly and never runs `docker compose up`, so a boot-time config
 * mistake here would only ever be found by a user.
 */
function materializeHeadless(into) {
    copyDir(templateRoot, into);
    fs.rmSync(path.join(into, "frontend"), { recursive: true, force: true });
    fs.rmSync(path.join(into, "backend/schema"), { recursive: true, force: true });
    fs.rmSync(path.join(into, "backend/src/schema.generated.ts"), { force: true });
    copyDir(baasOverlay, into);
}

/** The workspace packages a scaffold's tsconfig `paths` maps to their sources. */
const SOURCE_PACKAGES = ["types", "cms-types", "common", "utils", "client", "server", "server-postgres", "cms", "app", "ui", "studio", "forms", "inference"];

const TSCONFIG = {
    compilerOptions: {
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["DOM", "DOM.Iterable", "ES2023"],
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        allowJs: true,
        strict: true,
        jsx: "react-jsx",
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        ignoreDeprecations: "6.0",
        types: ["node"],
        baseUrl: ".",
        paths: {
            // What a schema file imports: the builders, and nothing of the server.
            "@rebasepro/server/schema": [`${repoRoot}/packages/server/src/schema/index.ts`],
            ...Object.fromEntries(SOURCE_PACKAGES.map(name => [`@rebasepro/${name}`, [`${repoRoot}/packages/${name}/src`]]))
            // Third-party deps (hono, react, vite) resolve through a node_modules
            // symlink rather than `paths`: `hono/cors` is an exports-map subpath, and
            // a path mapping would point at a file that does not exist on disk.
        },
        typeRoots: [
            `${repoRoot}/node_modules/.pnpm/node_modules/@types`,
            `${repoRoot}/node_modules/@types`
        ]
    }
};

/** What each shape compiles: the whole backend, and for Mode B the whole frontend app. */
const INCLUDES = {
    cms: ["backend/**/*.ts", "frontend/src/**/*", "scripts/**/*.ts"],
    headless: ["backend/**/*.ts", "scripts/**/*.ts"]
};

/**
 * Every ambient type library a template tsconfig pins must be a declared
 * dependency of the workspace that pins it.
 *
 * A reference to a package the manifest never declares. A workspace tsconfig
 * pins `types: ["node"]` — deliberately, to stop tsc sweeping the pnpm virtual
 * store — and the old config workspace never depended on `@types/node`. Under
 * pnpm's isolated layout there was no `@types/node` reachable from it, so the
 * workspace could not compile itself:
 *
 *     config build$ tsc
 *     error TS2688: Cannot find type definition file for 'node'
 *
 * That is `pnpm -r build` failing in a project one minute after `rebase init`.
 *
 * The compile step below cannot catch it and should not try. It writes its own
 * tsconfig with `typeRoots` pointed at the repo's `node_modules`, because it is
 * checking the *project's files*, not the project's dependency graph. Those
 * synthetic typeRoots resolve `node` no matter what the template declares, which
 * is exactly why the omission survived: the only program that ever compiled
 * these files was one that had been handed the answer.
 *
 * So assert it on the manifests instead — cheap, and resolution cannot fool it.
 */
function checkPinnedTypesAreDeclared() {
    const problems = [];

    /** Which package supplies `types: ["<entry>"]`. */
    const providerOf = (entry) => {
        // `vite/client` is shipped by `vite` itself; `node` comes from `@types/node`.
        if (entry.includes("/")) return entry.startsWith("@") ? entry.split("/").slice(0, 2).join("/") : entry.split("/")[0];
        return `@types/${entry}`;
    };

    // Every flavour, as `rebase init` lays it out. The headless overlay replaces
    // some of the template's files and keeps the rest, so a workspace there pairs
    // whichever tsconfig and package.json the project actually ends up with — an
    // overlay manifest beside a template tsconfig is exactly the pair that once
    // dropped `@types/node`. Checking the template alone could not see it.
    const flavours = [
        { label: "template", roots: [templateRoot], workspaces: [".", "backend", "frontend"] },
        { label: "baas overlay", roots: [baasOverlay, templateRoot], workspaces: [".", "backend"] }
    ];
    /** The first root that ships `relative`: the overlay's copy wins over the template's. */
    const scaffolded = (roots, relative) =>
        roots.map(root => path.join(root, relative)).find(candidate => fs.existsSync(candidate));

    for (const { label, roots, workspaces } of flavours) {
        for (const workspace of workspaces) {
            const tsconfigPath = scaffolded(roots, path.join(workspace, "tsconfig.json"));
            const manifestPath = scaffolded(roots, path.join(workspace, "package.json"));
            if (!tsconfigPath || !manifestPath) continue;
            const where = (file) => `${label}: ${path.relative(repoRoot, file)}`;

            // The template tsconfigs carry explanatory comments, so this is JSONC.
            const raw = stripJsonComments(fs.readFileSync(tsconfigPath, "utf8"));
            let pinned;
            try {
                pinned = JSON.parse(raw).compilerOptions?.types;
            } catch (e) {
                problems.push(`${where(tsconfigPath)} could not be parsed after stripping comments: ${e.message}`);
                continue;
            }
            if (!Array.isArray(pinned)) continue;

            const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));

            for (const entry of pinned) {
                const provider = providerOf(entry);
                if (!declared.has(provider)) {
                    problems.push(
                        `${where(tsconfigPath)} pins types: ["${entry}"] but ${where(manifestPath)} ` +
                        `does not depend on ${provider} — under pnpm the workspace cannot compile itself ` +
                        `(TS2688)`
                    );
                }
            }
        }
    }

    return problems;
}

/**
 * `.env.example` is the file the docs call "a reference for the available
 * variables". It must actually be one.
 *
 * Two producers write into a scaffold's `.env` and neither consults this file:
 * `rebase init` (which generates secrets, a database password and the pinned
 * runtime version) and `docker-compose.yml` (which interpolates `${VAR}` at
 * `docker compose up`). Both had drifted from it — `DATABASE_PASSWORD` and
 * `REBASE_VERSION` were in the generated `.env` and in compose and nowhere
 * here, so a reader rebuilding a value from the reference landed on `changeme`
 * and `latest`, silently.
 *
 * The `.env` `init` writes is not on disk when this runs, so the keys are read
 * from `init.ts` itself — every `KEY=` it interpolates into the file, plus the
 * ones it names in a `setEnvValue` call.
 */
function checkEnvExampleCoversWhatWritesIt() {
    const problems = [];
    const examplePath = path.join(templateRoot, ".env.example");
    const composePath = path.join(templateRoot, "docker-compose.yml");
    const initPath = path.join(repoRoot, "packages/cli/src/commands/init.ts");

    if (!fs.existsSync(examplePath)) return [".env.example is missing from the template"];

    const example = fs.readFileSync(examplePath, "utf8");
    const documented = new Set(
        [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1])
    );

    /** `${VAR:-default}` and `${VAR:?message}` alike — both are read there. */
    const composeVars = fs.existsSync(composePath)
        ? [...fs.readFileSync(composePath, "utf8").matchAll(/\$\{([A-Z][A-Z0-9_]*)[:}]/g)].map(m => m[1])
        : [];

    // Comments stripped first: `setEnvValue`'s own docblock says "Set
    // `KEY=value` in a .env body", and a scan that reads prose as code reports
    // a variable named KEY.
    const init = (fs.existsSync(initPath) ? fs.readFileSync(initPath, "utf8") : "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    const initVars = [
        // `envContent = setEnvValue(envContent, "KEY", …)` and the multi-line form.
        ...[...init.matchAll(/setEnvValue\(\s*envContent,\s*\n?\s*"([A-Z][A-Z0-9_]*)"/g)].map(m => m[1]),
        // Template literals and regexes that write the line directly.
        ...[...init.matchAll(/[`"']#?\\?\^?#?\\?s?\*?([A-Z][A-Z0-9_]{2,})=/g)].map(m => m[1])
    ];

    for (const [source, names] of [["docker-compose.yml", composeVars], ["init.ts", initVars]]) {
        for (const name of [...new Set(names)].sort()) {
            if (documented.has(name)) continue;
            problems.push(
                `${name} is written or read by ${source} but appears nowhere in .env.example — `
                + "a reader rebuilding that value from the reference gets the fallback, silently"
            );
        }
    }
    return problems;
}

/**
 * Packages pnpm builds that npm deliberately does not, and why.
 *
 * The two lists are NOT meant to match. Under npm these two arrive as platform
 * `optionalDependencies` carrying a prebuilt binary, so the blocked
 * `postinstall` is a fallback nothing reaches — verified on npm 12, where
 * `esbuild --version` answers anyway. Allowing a script that is not needed is a
 * grant with no benefit, so npm's list is the shorter one on purpose;
 * `init.test.ts` pins it exactly for the same reason.
 *
 * What was missing is the other direction, which is where a real break hides: a
 * package added to pnpm's list and forgotten in npm's installs *without* its
 * binary, exits 0, and fails later at the command that needed it —
 * `@ariga/atlas` did exactly that, and `db:push` failed on a binary nobody had
 * been told was skipped.
 */
const NPM_NEEDS_NO_SCRIPT = new Map([
    ["esbuild", "npm resolves the platform package, whose binary needs no postinstall"],
    ["sharp", "same: prebuilt binaries arrive as platform optionalDependencies"]
]);

/**
 * Every package pnpm may build is either allowed under npm too, or listed above
 * with the reason it does not need to be.
 *
 * Both managers refuse a dependency's lifecycle scripts unless the project
 * allowlists them, in each one's own dialect, and a scaffold is free to be
 * installed with either. The failure is silent on whichever manager gets
 * forgotten, and is only ever noticed by somebody who already has a broken
 * project.
 */
function checkInstallAllowlistsAgree() {
    const problems = [];

    for (const [label, root] of [["template", templateRoot], ["baas overlay", baasOverlay]]) {
        const manifestPath = path.join(root, "package.json");
        if (!fs.existsSync(manifestPath)) continue;
        const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

        const pnpmList = [...(pkg.pnpm?.onlyBuiltDependencies ?? [])].sort();
        const npmList = Object.keys(pkg.allowScripts ?? {}).sort();

        for (const name of pnpmList) {
            if (npmList.includes(name) || NPM_NEEDS_NO_SCRIPT.has(name)) continue;
            problems.push(
                `${label}: pnpm.onlyBuiltDependencies allows ${name} to run its install script and `
                + "allowScripts does not, so `npm install` blocks it and exits 0. Add it to "
                + "allowScripts, or to NPM_NEEDS_NO_SCRIPT in this file with the reason npm does "
                + "not need it."
            );
        }
        for (const name of npmList) {
            if (pnpmList.includes(name)) continue;
            problems.push(
                `${label}: allowScripts allows ${name} to run its install script, `
                + "but pnpm.onlyBuiltDependencies does not — `pnpm install` blocks it"
            );
        }
    }
    return problems;
}

/**
 * The PGlite stack a scaffold installs must be pinned exactly.
 *
 * These three packages peer-depend on each other at exact versions —
 * `pglite-pgvector@0.0.7` wants `pglite@0.5.6`, not `^0.5.6` — so a caret range
 * here is not flexibility, it is a guarantee of an unmet peer the first time any
 * of them publishes. `@rebasepro/cli@0.17.3` shipped `^0.5.6` / `^0.0.7` /
 * `^0.2.9`, and every `pnpm install` in a fresh project then printed two unmet
 * peers before the reader had run anything. Nothing breaks; it is simply the
 * first thing a new user sees.
 *
 * A range is the whole failure, so a range is what this refuses. Nothing here
 * can check that the pinned set actually satisfies itself — that needs a
 * resolve, and this gate runs offline — but a set that did when it was pinned
 * cannot drift while the pins are exact.
 */
function checkPgliteStackIsPinned() {
    const manifestPath = path.join(repoRoot, "packages/cli/package.json");
    if (!fs.existsSync(manifestPath)) return [];
    const optional = JSON.parse(fs.readFileSync(manifestPath, "utf8")).optionalDependencies ?? {};

    return Object.entries(optional)
        .filter(([name]) => name.startsWith("@electric-sql/pglite"))
        .filter(([, range]) => !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(range))
        .map(([name, range]) => (
            `packages/cli/package.json pins ${name} as "${range}" — these packages peer-depend on `
            + "each other at exact versions, so a range guarantees an unmet peer on the first "
            + "`pnpm install` of a scaffold after any of them publishes"
        ));
}

/**
 * The three manifests a bundle reads must not declare one name twice.
 *
 * `collectDeclaredDependencies` reads root → backend and lets the last
 * one win, so exactly one of two disagreeing ranges reaches `deps.declared` and
 * the managed runtime installs it. The stock scaffold shipped that
 * disagreement — `dotenv ^16.0.0` at the root, `^17.4.2` in `backend/` — so
 * every bundle built from a default project asked the runtime for dotenv 16
 * while the backend had been compiled against 17.
 *
 * `rebase build` refuses on a *disjoint* pair, because refusing on a merely
 * different one would break projects that have a reason. A template has no such
 * reason: it is the file every new project starts from, and two ranges for one
 * name in it are a mistake whether or not they overlap. So this is the stricter
 * rule, and it is stricter on purpose.
 */
function checkScaffoldDeclaresEachDepOnce() {
    const problems = [];
    // The manifests `collectDeclaredDependencies` reads, in its order.
    const MANIFESTS = ["package.json", "backend/package.json"];

    for (const [label, root] of [["template", templateRoot], ["baas overlay", baasOverlay]]) {
        const seen = new Map();
        for (const relative of MANIFESTS) {
            const manifestPath = path.join(root, relative);
            if (!fs.existsSync(manifestPath)) continue;
            let deps;
            try {
                deps = JSON.parse(fs.readFileSync(manifestPath, "utf8")).dependencies ?? {};
            } catch {
                continue; // another check reports an unparseable manifest
            }
            for (const [name, range] of Object.entries(deps)) {
                // `workspace:*` is how every template names an in-repo package;
                // it never reaches the bundle and is identical everywhere.
                if (typeof range !== "string" || range.startsWith("workspace:")) continue;
                const first = seen.get(name);
                if (!first) {
                    seen.set(name, { range, file: relative });
                    continue;
                }
                if (first.range === range) continue;
                problems.push(
                    `${label}: ${name} is declared as "${first.range}" in ${first.file} and `
                    + `"${range}" in ${relative}. A bundle carries one of the two — declare it `
                    + "once, in the workspace that uses it."
                );
            }
        }
    }

    return problems;
}

/**
 * Every script a scaffold ships can succeed on the tree it is scaffolded into.
 *
 * The headless overlay shipped `"generate:sdk": "rebase generate-sdk"`, and a
 * headless project has no `backend/schema` by design — its API is
 * introspected from the live database at boot. So the script could never
 * succeed, in 0.17.3 and on main, on the documented headless path. `rebase
 * doctor` was the same shape. Nothing noticed, because a `package.json` script
 * is not code and no gate read them.
 *
 * Two questions, neither of which needs the scripts to be run:
 *
 *   1. Every `rebase <command>` a script names is a command this CLI has. This
 *      is the same class as the failure above, one layer up: a script naming
 *      something that is not there.
 *   2. Every script is declared here with what it needs before it can succeed,
 *      and every declaration is used by some scaffold. A script nobody wrote a
 *      precondition for is a script nobody asked "can this work here?" about,
 *      which is exactly how the two above shipped.
 *
 * The preconditions are deliberately coarse. What matters is that adding a
 * script forces somebody to answer the question, and that a `"succeeds on a
 * fresh scaffold"` claim is written down where the next reader can check it.
 */
const SCAFFOLD_SCRIPTS = new Map([
    ["dev", "succeeds on a fresh scaffold — the documented first command"],
    ["build", "succeeds on a fresh scaffold"],
    ["start", "needs a build"],
    ["db:generate", "needs tables declared in backend/schema"],
    ["db:push", "needs tables declared in backend/schema, and a database"],
    ["db:migrate", "needs a database"],
    ["schema:generate", "needs tables declared in backend/schema"],
    ["schema:introspect", "needs a database"],
    ["generate:sdk", "succeeds on a fresh scaffold — says what to run first when there are no tables"],
    ["skills:install", "succeeds on a fresh scaffold"],
    ["example", "needs a running server"],
    ["deploy", "needs a linked cloud project"]
]);

/** Scripts a headless scaffold must not ship: it has no `backend/schema`. */
const NEEDS_TABLES = new Set(["db:generate", "db:push", "schema:generate"]);

function checkScaffoldedScriptsCanSucceed() {
    const problems = [];
    const { top, sub } = loadCliCommands(repoRoot);
    const seen = new Set();

    const variants = [
        ["templates/template", path.join(templateRoot, "package.json"), false],
        ["templates/overlays/baas", path.join(baasOverlay, "package.json"), true]
    ];

    for (const [label, manifest, headless] of variants) {
        let scripts;
        try {
            scripts = JSON.parse(fs.readFileSync(manifest, "utf8")).scripts ?? {};
        } catch (err) {
            problems.push(`${label}/package.json is not readable JSON: ${err.message}`);
            continue;
        }
        for (const [name, command] of Object.entries(scripts)) {
            seen.add(name);
            if (!SCAFFOLD_SCRIPTS.has(name)) {
                problems.push(
                    `${label} ships "${name}": ${command} — add it to SCAFFOLD_SCRIPTS with what it `
                    + "needs before it can succeed, or delete it. A script nobody wrote a precondition "
                    + "for is one nobody asked whether it can work here."
                );
                continue;
            }
            if (headless && NEEDS_TABLES.has(name)) {
                problems.push(
                    `${label} ships "${name}", which ${SCAFFOLD_SCRIPTS.get(name)} — and a headless `
                    + "scaffold has no backend/schema."
                );
            }
            // `rebase db push --schema-dir …` → command `db`, subcommand `push`.
            const invocation = /(?:^|&&\s*|\|\|\s*)rebase\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/.exec(command);
            if (!invocation) continue;
            const [, cmd, subcommand] = invocation;
            if (!top.has(cmd)) {
                problems.push(`${label}'s "${name}" runs \`rebase ${cmd}\`, which this CLI has no command for.`);
                continue;
            }
            const known = sub.get(cmd);
            if (subcommand && known && !known.has(subcommand)) {
                problems.push(`${label}'s "${name}" runs \`rebase ${cmd} ${subcommand}\`, which is not a subcommand of \`rebase ${cmd}\`.`);
            }
        }
    }

    for (const name of SCAFFOLD_SCRIPTS.keys()) {
        if (!seen.has(name)) {
            problems.push(`SCAFFOLD_SCRIPTS declares "${name}" and no scaffold ships it any more — delete the entry.`);
        }
    }
    if (seen.size === 0) problems.push("Read no scripts out of the templates — the guard is checking nothing.");
    return problems;
}

/**
 * Packages that put React, or the admin panel, into an install.
 *
 * A headless project is a server and nothing else: one of these in its install
 * means a React tree in a deployment that renders nothing, and — through
 * `@rebasepro/cms-types` — the admin vocabulary in a project that has no admin.
 */
const ADMIN_PACKAGES = new Set([
    "react", "react-dom", "react-router", "@types/react", "@types/react-dom",
    "@rebasepro/app", "@rebasepro/cms", "@rebasepro/cms-types", "@rebasepro/ui",
    "@rebasepro/studio", "@rebasepro/forms", "@rebasepro/plugin-ai", "@rebasepro/plugin-insights"
]);

/** `@rebasepro/<name>` → its workspace manifest, for every package under packages/. */
function workspaceManifests() {
    const byName = new Map();
    for (const dir of fs.readdirSync(path.join(repoRoot, "packages"))) {
        const manifest = path.join(repoRoot, "packages", dir, "package.json");
        if (!fs.existsSync(manifest)) continue;
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (pkg.name) byName.set(pkg.name, pkg);
    }
    return byName;
}

/**
 * A headless scaffold installs no React and no admin package.
 *
 * Read from what `pnpm install` is handed: the scaffold's own manifests, and —
 * because a dependency's dependencies install too — the closure through every
 * workspace package it names (dependencies, and peers that are not optional,
 * which a package manager installs as well). Third-party packages are not
 * walked: their trees are not in this repository, and none of the server's
 * declares React.
 *
 * The files are scanned too: an import of an admin package in a backend file
 * compiles here (the pnpm store has it) and fails in the project.
 */
function checkHeadlessInstallsNoReact(dir) {
    const problems = [];
    const workspace = workspaceManifests();
    const manifests = ["package.json", "backend/package.json"]
        .map(relative => path.join(dir, relative))
        .filter(file => fs.existsSync(file));
    if (fs.existsSync(path.join(dir, "frontend"))) problems.push("the headless scaffold has a frontend/ directory");

    const seen = new Set();
    const pending = [];
    for (const manifest of manifests) {
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
        for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
            pending.push({ name, via: [path.relative(dir, manifest)] });
        }
    }
    while (pending.length > 0) {
        const { name, via } = pending.shift();
        if (ADMIN_PACKAGES.has(name)) {
            problems.push(`the headless scaffold installs ${name} (${[...via, name].join(" → ")})`);
            continue;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        const pkg = workspace.get(name);
        if (!pkg) continue;
        const optionalPeers = new Set(Object.entries(pkg.peerDependenciesMeta ?? {}).filter(([, meta]) => meta?.optional).map(([peer]) => peer));
        const next = [
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.peerDependencies ?? {}).filter(peer => !optionalPeers.has(peer))
        ];
        for (const dep of next) pending.push({ name: dep, via: [...via, name] });
    }

    for (const file of sourceFilesUnder(dir)) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
            const spec = match[1].startsWith("@") ? match[1].split("/").slice(0, 2).join("/") : match[1].split("/")[0];
            if (ADMIN_PACKAGES.has(spec)) problems.push(`${path.relative(dir, file)} imports ${match[1]}`);
        }
    }
    return problems;
}

/**
 * `frontend/**` imports `backend/**` as types only, in every preset as it lands.
 * See `backend-type-imports.mjs`, which is the rule (exported for a repo-wide gate).
 */
function checkFrontendTypeImports(dir) {
    return findValueImportsOfBackend({
        files: sourceFilesUnder(path.join(dir, "frontend")),
        backendDir: path.join(dir, "backend")
    }).map(f => `${path.relative(dir, f.file)}:${f.line} — ${f.form} of "${f.specifier}" loads backend code into the browser bundle. Write \`import type\`.`);
}

/**
 * Every table in a template states its `rls`.
 *
 * `defineTable` requires the key and boot refuses a table without one, so this
 * is the cheap, offline version of a guarantee the compile already makes — kept
 * because a template is where an agent copies a table from, and a template
 * table without a posture is one copied a hundred times.
 */
function checkTablesStateRls(dir) {
    const problems = [];
    const schemaDir = path.join(dir, "backend", "schema");
    for (const file of sourceFilesUnder(schemaDir)) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        let tables = 0;
        const visit = (node) => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
                && ["defineTable", "defineAuthTable"].includes(node.expression.text)) {
                tables++;
                const config = node.arguments[1];
                const name = node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : "?";
                const hasRls = config && ts.isObjectLiteralExpression(config)
                    && config.properties.some(p => p.name && ts.isIdentifier(p.name) && p.name.text === "rls");
                if (!hasRls) problems.push(`${path.relative(dir, file)}: ${node.expression.text}("${name}") states no rls — write the rules, "admin-only" or "inherit"`);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        if (tables === 0 && path.basename(file) !== "index.ts") problems.push(`${path.relative(dir, file)} declares no table`);
    }
    return problems;
}

/**
 * Mode B is two workspaces: no `config/`, no `cms.d.ts`, no collections plugin
 * and no virtual module. Each was there only to share collection files between
 * Node and Vite, and a scaffold that grows one back teaches the old layout.
 */
function checkNoLegacyLayout(dir) {
    const problems = [];
    for (const stray of ["config", "frontend/src/virtual.d.ts", "config/cms.d.ts", "config/frontend-assets.d.ts"]) {
        if (fs.existsSync(path.join(dir, stray))) problems.push(`the scaffold has ${stray}`);
    }
    for (const file of sourceFilesUnder(dir)) {
        const text = fs.readFileSync(file, "utf8");
        for (const legacy of ["rebaseCollectionsPlugin", "virtual:rebase-collections", "defineCollection", "@rebasepro/cms-types"]) {
            if (text.includes(legacy)) problems.push(`${path.relative(dir, file)} mentions ${legacy}`);
        }
    }
    return problems;
}

/**
 * A preset's `frontend/src/App.tsx` is the blog's with its own customizations:
 * the `./cms/` imports and the `tableCustomizations` list may differ, nothing
 * else. Three copies of the entry point are three chances to drift; this makes
 * a change to one a change to all.
 */
function checkPresetAppsMatchBlog() {
    const problems = [];
    const strip = text => text.split("\n")
        .filter(line => !/^import \{ \w+Cms \} from "\.\/cms\/[\w-]+";$/.test(line))
        .map(line => line.replace(/tableCustomizations=\{\[[^\]]*\]\}/, "tableCustomizations={[…]}"))
        .join("\n");
    const blog = strip(fs.readFileSync(path.join(templateRoot, "frontend/src/App.tsx"), "utf8"));
    for (const preset of PRESETS.filter(p => p !== "blog")) {
        const file = path.join(presetsRoot, preset, "frontend/src/App.tsx");
        if (!fs.existsSync(file)) {
            problems.push(`templates/presets/${preset}/frontend/src/App.tsx is missing`);
            continue;
        }
        if (strip(fs.readFileSync(file, "utf8")) !== blog) {
            problems.push(`templates/presets/${preset}/frontend/src/App.tsx differs from the blog's beyond its ./cms imports and tableCustomizations — make the change in all three`);
        }
    }
    return problems;
}

/**
 * Every file path a getting-started page names exists in the scaffold.
 *
 * Quickstart's prerequisites read "Node.js 22.22+, the version in `.nvmrc`" for
 * two releases. There is no `.nvmrc`: `ls -a packages/cli/templates/template |
 * grep nvmrc` is empty, and the version floor lives in `package.json`'s
 * `engines`. It is the first line of the first page, and nothing could have
 * caught it — the snippet verifier compiles TypeScript, and a path in prose is
 * neither a snippet nor an identifier.
 *
 * All six locales, because a translation names the same paths.
 *
 * A path is a backticked token with a file extension and at least one `/`. A
 * bare `App.tsx` is a filename in a sentence rather than a location, and
 * flagging every one of those would make this noisy enough to switch off.
 */
function checkGettingStartedPathsExist() {
    const docsRoot = path.join(repoRoot, "website/src/content/docs");
    const pages = [];
    for (const locale of ["docs", "de", "es", "fr", "it", "pt"]) {
        const dir = locale === "docs"
            ? path.join(docsRoot, "docs/getting-started")
            : path.join(docsRoot, locale, "docs/getting-started");
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            if (/\.mdx?$/.test(name)) pages.push(path.join(dir, name));
        }
    }

    /**
     * Paths that are correct and are not in the template.
     *
     * Two kinds: files `rebase init` or `rebase dev` *writes* at runtime, and
     * files that exist only after `rebase eject` — which the pages name in
     * order to say the scaffold has none.
     */
    const NOT_SHIPPED = new Map([
        ["backend/src/schema.generated.ts", "`rebase init` writes the chosen preset's copy from packages/cli/templates/generated-schemas/"],
        ["backend/src/index.ts", "only after `rebase eject`; the pages name it to say a scaffold has none"],
        ["backend/src/env.ts", "only after `rebase eject`, where the project owns its own env schema"],
        ["backend/hooks.ts", "optional: the project creates it for global table hooks, and the pages say so"]
    ]);

    const EXT = /\.(ts|tsx|json|md|mdx|mjs|cjs|js|yml|yaml|example|toml)$/;
    /** The template ships these without their leading dot; `rebase init` renames them. */
    const ALIAS = { ".gitignore": "gitignore", ".npmrc": "npmrc" };

    const problems = [];
    let checked = 0;
    for (const page of pages) {
        const rel = path.relative(repoRoot, page);
        const lines = fs.readFileSync(page, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            for (const m of lines[i].matchAll(/`([^`\n]+)`/g)) {
                const token = m[1].trim();
                if (!/^\.?[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.*-]+)+\/?$/.test(token)) continue;
                if (!EXT.test(token)) continue;
                checked++;
                if (NOT_SHIPPED.has(token)) continue;
                const candidate = ALIAS[token] || token.replace(/\/$/, "");
                const found = [templateRoot, baasOverlay, ...PRESETS.filter(p => p !== "blog").map(p => path.join(presetsRoot, p)), repoRoot]
                    .some(base => fs.existsSync(path.join(base, candidate)));
                if (found) continue;
                problems.push(
                    `${rel}:${i + 1} names \`${token}\`, which is in neither ` +
                    "packages/cli/templates/template, templates/presets, templates/overlays/baas, " +
                    "nor the repository. Fix the page, ship the file, or add it to NOT_SHIPPED " +
                    "with the reason it is correct."
                );
            }
        }
    }

    // A NOT_SHIPPED entry nothing names any more is dead weight.
    const named = new Set();
    for (const page of pages) {
        const text = fs.readFileSync(page, "utf8");
        for (const key of NOT_SHIPPED.keys()) if (text.includes(`\`${key}\``)) named.add(key);
    }
    for (const [key, why] of NOT_SHIPPED) {
        if (!named.has(key)) {
            problems.push(`NOT_SHIPPED exempts \`${key}\` (${why}) and no getting-started page names it — delete the entry.`);
        }
    }

    if (checked === 0) problems.push("Read no paths out of the getting-started pages — the guard is checking nothing.");
    return problems;
}

let failed = 0;
const gettingStartedPathProblems = checkGettingStartedPathsExist();
if (gettingStartedPathProblems.length > 0) {
    failed++;
    console.log("  FAIL getting-started pages name files the scaffold ships");
    for (const p of gettingStartedPathProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   getting-started pages name files the scaffold ships");
}

const zodImportProblems = checkNoDirectZodImports();
if (zodImportProblems.length > 0) {
    failed++;
    console.log("  FAIL no template builds a schema with its own copy of zod");
    for (const p of zodImportProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   no template builds a schema with its own copy of zod");
}

// ── The pin, not the working tree ────────────────────────────────────────────
//
// Everything below this line compiles the templates against `packages/*/src`
// through tsconfig `paths` — the working tree, which is not what a scaffold
// installs. `rebase init` pins the CLI's own version from the registry, and for
// most of a release cycle that version is one already published, so the tree and
// the pin disagree. That is how a template importing `queue` from
// `@rebasepro/types@0.17.3` — which has no such export — compiled green here and
// failed at `rebase dev` in every fresh project.
//
// So ask the other question first, and stop here if the answer is no: a
// typecheck against the working tree has nothing useful to say about a template
// that cannot resolve its own imports. The compose half belongs to the release
// gate — see check-template-pins.mjs — and is not run here.
//
// `--released-as <version>` measures against the version a release is about to
// publish instead of the one the manifests still name — the same override, for
// the same reason, as `check-template-pins.mjs --released-as` in the release
// preflight: a branch carrying the API a template now imports is measured
// against the release that will ship them together, not the one it replaces.
const releasedAsIndex = process.argv.indexOf("--released-as");
const releasedAs = releasedAsIndex === -1 ? null : process.argv[releasedAsIndex + 1] ?? null;
if (releasedAsIndex !== -1 && !releasedAs) {
    console.error("--released-as needs a version, e.g. --released-as 0.31.0");
    process.exit(2);
}
if (checkTemplatePins({ axes: ["imports"], releasedAs }) !== 0) process.exit(1);

const envProblems = checkEnvExampleCoversWhatWritesIt();
if (envProblems.length > 0) {
    failed++;
    console.log("  FAIL .env.example documents every key written into .env");
    for (const p of envProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   .env.example documents every key written into .env");
}

const allowlistProblems = checkInstallAllowlistsAgree();
if (allowlistProblems.length > 0) {
    failed++;
    console.log("  FAIL every package pnpm may build is allowed under npm, or excused");
    for (const p of allowlistProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   every package pnpm may build is allowed under npm, or excused");
}

const duplicateDepProblems = checkScaffoldDeclaresEachDepOnce();
if (duplicateDepProblems.length > 0) {
    failed++;
    console.log("  FAIL no dependency is declared twice at different ranges in a scaffold");
    for (const p of duplicateDepProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   no dependency is declared twice at different ranges in a scaffold");
}

const pgliteProblems = checkPgliteStackIsPinned();
if (pgliteProblems.length > 0) {
    failed++;
    console.log("  FAIL the PGlite stack a scaffold installs is pinned exactly");
    for (const p of pgliteProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   the PGlite stack a scaffold installs is pinned exactly");
}

const presetAppProblems = checkPresetAppsMatchBlog();
if (presetAppProblems.length > 0) {
    failed++;
    console.log("  FAIL each preset's App.tsx is the blog's, with its own customizations");
    for (const p of presetAppProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   each preset's App.tsx is the blog's, with its own customizations");
}

const scriptProblems = checkScaffoldedScriptsCanSucceed();
if (scriptProblems.length > 0) {
    failed++;
    console.log("  FAIL every scaffolded script can succeed on the tree it is scaffolded into");
    for (const p of scriptProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   every scaffolded script can succeed on the tree it is scaffolded into");
}

// The compile below is not the compile the user gets — see
// template-tsconfig.mjs for why the shipped tsconfigs are compared to it.
const resolutionProblems = checkResolutionMatchesShipped({
    expected: TSCONFIG.compilerOptions.moduleResolution,
    tsconfigs: [
        ...["backend", "frontend"].map(workspace => path.join(templateRoot, workspace, "tsconfig.json")),
        path.join(baasOverlay, "backend", "tsconfig.json")
    ],
    repoRoot
});
if (resolutionProblems.length > 0) {
    failed++;
    console.log("  FAIL shipped tsconfigs resolve the way this gate compiles");
    for (const p of resolutionProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   shipped tsconfigs resolve the way this gate compiles");
}

const pinnedTypeProblems = checkPinnedTypesAreDeclared();
if (pinnedTypeProblems.length > 0) {
    failed++;
    console.log("  FAIL pinned ambient types are declared dependencies");
    for (const p of pinnedTypeProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   pinned ambient types are declared dependencies");
}

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-template-check-"));

/** Run one named check over a materialized scaffold, printing ok / FAIL. */
function report(label, problems) {
    if (problems.length > 0) {
        failed++;
        console.log(`  FAIL ${label}`);
        for (const p of problems) console.error(`    ${p}`);
    } else {
        console.log(`  ok   ${label}`);
    }
}

/** Where a materialized file came from, so a diagnostic names the file to edit. */
function sourceOf(preset, relative) {
    const candidates = preset === HEADLESS
        ? [path.join(baasOverlay, relative), path.join(templateRoot, relative)]
        : preset === "blog"
            ? [path.join(templateRoot, relative)]
            : [path.join(presetsRoot, preset, relative), path.join(templateRoot, relative)];
    const found = candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[candidates.length - 1];
    return path.relative(repoRoot, found);
}

try {
    for (const preset of [...PRESETS, HEADLESS]) {
        const dir = path.join(workRoot, preset);
        if (preset === HEADLESS) materializeHeadless(dir);
        else materialize(preset, dir);

        if (preset === HEADLESS) {
            report(`${preset}: installs no React and no admin package`, checkHeadlessInstallsNoReact(dir));
        } else {
            report(`${preset}: frontend imports backend as types only`, checkFrontendTypeImports(dir));
            report(`${preset}: every table states its rls`, checkTablesStateRls(dir));
            report(`${preset}: no config workspace, no collections plugin`, checkNoLegacyLayout(dir));
        }

        // Real resolution for third-party specifiers, exports maps included.
        fs.symlinkSync(
            path.join(repoRoot, "node_modules/.pnpm/node_modules"),
            path.join(dir, "node_modules"),
            "dir"
        );
        fs.writeFileSync(
            path.join(dir, "tsconfig.check.json"),
            JSON.stringify({ ...TSCONFIG, include: INCLUDES[preset === HEADLESS ? "headless" : "cms"] }, null, 4)
        );

        // cwd is the materialized dir so tsc prints paths relative to it
        // (`backend/schema/posts.ts`), which map back onto the template file. A
        // diagnostic in a package's own source prints as `../…` and is not this
        // gate's to report.
        let output = "";
        try {
            execFileSync(tsc, ["-p", "tsconfig.check.json"], { cwd: dir, stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        } catch (error) {
            output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
        }
        const lines = output.split("\n");
        const own = [];
        for (let k = 0; k < lines.length; k++) {
            const m = /^([^\s(][^(]*)\((\d+),(\d+)\): error/.exec(lines[k]);
            if (!m || m[1].startsWith("..") || path.isAbsolute(m[1])) continue;
            own.push(`${sourceOf(preset, m[1])}${lines[k].slice(m[1].length)}`);
            for (let n = k + 1; n < lines.length && /^\s/.test(lines[n]); n++) own.push(lines[n]);
        }
        if (output && own.length === 0 && !/error TS/.test(output)) own.push(output.trim());
        report(`${preset} type-checks`, own);
    }
} finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
}

if (failed > 0) {
    // Counted separately: this file checks manifests and a reference file as
    // well as compiling, and reporting a `.env.example` gap as "does not
    // compile" sends the reader to look for a type error that is not there.
    console.error(
        `\n${failed} FAIL(s) above. These are the files every new project starts from, ` +
            `so this fails the build.\n` +
            `If a preset did not compile: a table's columns, relations and rls belong in ` +
            `backend/schema; labels, icons, enum colours and custom fields in frontend/src/cms ` +
            `(customizeTable).`
    );
    process.exit(1);
}

/*
 * A scaffold may not promise a Node it cannot run on.
 *
 * The template said `>=18.0.0` while its own frontend depends on
 * `@rebasepro/app`, whose engines are `>=22.22.0` — so the very first
 * `pnpm install` broke the promise the `package.json` had just made, and the
 * README and Quickstart repeated the wrong number to everyone who read them.
 * Three floors were in play at once (18 in the scaffold, 20 in the driver
 * packages, 22.22 in the repo and the admin packages) and nothing compared them.
 *
 * The rule is not "one number" — a headless project genuinely runs on 20 while a
 * CMS one needs 22.22. It is that each scaffold's declared floor must be at
 * least the highest floor among the workspace packages it names.
 */
function parseFloor(range) {
    const m = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range ?? "");
    return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}
const cmpFloor = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const fmtFloor = (f) => `>=${f[0]}.${f[1]}.${f[2]}`;

const workspaceEngines = new Map();
for (const dir of fs.readdirSync(path.join(repoRoot, "packages"))) {
    const manifest = path.join(repoRoot, "packages", dir, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const floor = parseFloor(pkg.engines?.node);
    if (pkg.name && floor) workspaceEngines.set(pkg.name, floor);
}

const engineFindings = [];
for (const [label, root] of [["template", templateRoot], ["baas overlay", baasOverlay]]) {
    const manifests = fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(root, e.name, "package.json"))
        .concat(path.join(root, "package.json"))
        .filter((p) => fs.existsSync(p));

    const declared = parseFloor(
        JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).engines?.node);
    if (!declared) {
        engineFindings.push(`${label}: root package.json declares no \`engines.node\``);
        continue;
    }

    let required = [0, 0, 0];
    let requiredBy = "(nothing)";
    for (const manifest of manifests) {
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
        for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
            const floor = workspaceEngines.get(dep);
            if (floor && cmpFloor(floor, required) > 0) {
                required = floor;
                requiredBy = dep;
            }
        }
    }

    if (cmpFloor(declared, required) < 0) {
        engineFindings.push(
            `${label}: declares node ${fmtFloor(declared)} but depends on ${requiredBy}, `
            + `which requires ${fmtFloor(required)}.\n      `
            + `The first \`pnpm install\` in a scaffolded project would break the promise `
            + `its own package.json just made.`
        );
    }
}

if (engineFindings.length > 0) {
    console.error("\nNode floor findings:\n");
    for (const f of engineFindings) console.error(`  ✗ ${f}`);
    console.error("");
    process.exit(1);
}

// ── Docs that quote a template file must quote the file ──────────────────────
//
// Project Structure is page three, and its `App.tsx` block is the first entry
// point a newcomer reads: the scaffold's own, which creates its client once at
// module scope and hands it, with the auth controller, to `<Rebase>`. A block
// that paraphrased the file drifted into one that exists nowhere (no default
// export, controllers such as `useBuildNavigationStateController` that no
// package exports). A newcomer who meets that concludes the scaffold is broken;
// an agent writes an entry point the scaffold ignores.
//
// So the block is not "kept in step" — it IS the file, and this says so.
const QUOTED_FILES = [
    {
        doc: "website/src/content/docs/docs/getting-started/project-structure.md",
        fence: '```typescript title="frontend/src/App.tsx"',
        file: "packages/cli/templates/template/frontend/src/App.tsx"
    }
];

const quoteFindings = [];
for (const { doc, fence, file } of QUOTED_FILES) {
    const docPath = path.join(repoRoot, doc);
    const filePath = path.join(repoRoot, file);
    if (!fs.existsSync(docPath) || !fs.existsSync(filePath)) {
        quoteFindings.push(`${doc} or ${file} is missing`);
        continue;
    }

    const text = fs.readFileSync(docPath, "utf8");
    const start = text.indexOf(`${fence}\n`);
    if (start === -1) {
        quoteFindings.push(`${doc} has no block fenced \`${fence}\``);
        continue;
    }

    const bodyStart = start + fence.length + 1;
    const end = text.indexOf("\n```", bodyStart);
    const quoted = text.slice(bodyStart, end === -1 ? undefined : end).trimEnd();
    const actual = fs.readFileSync(filePath, "utf8").trimEnd();

    if (quoted !== actual) {
        quoteFindings.push(
            `${doc} quotes ${file}, but the two differ. `
            + "Paste the file into the block — the doc is not a paraphrase of it."
        );
    }
}

if (quoteFindings.length > 0) {
    console.error("\nQuoted-file findings:\n");
    for (const f of quoteFindings) console.error(`  ✗ ${f}`);
    console.error("");
    process.exit(1);
}

console.log(`\nAll ${PRESETS.length} init presets compile, and the headless backend.`);
console.log("Each scaffold's Node floor covers the packages it depends on.");
console.log(`${QUOTED_FILES.length} documented template file(s) match the template.`);
