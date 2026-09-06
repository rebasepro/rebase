/**
 * A scaffold may only import what the versions `rebase init` pins actually ship.
 *
 * `init` pins every `@rebasepro/*` dependency to the CLI's own version
 * (`commands/init.ts`, "Pinning N @rebasepro package(s) to X"). That version is
 * a *published* one for most of a release cycle: `main` sits at 0.17.3 with
 * 0.17.3 already on npm, and every change merged after the tag is invisible to
 * anything a scaffold installs. So the working tree and the registry disagree,
 * and the template is the one file where that disagreement is fatal:
 *
 *     rebase init t && cd t && pnpm install && rebase dev
 *     ✗ Could not load resource declarations from config/resources.ts:
 *       The requested module '@rebasepro/types' does not provide an export named 'queue'
 *
 * That shipped. `queue` was added to `@rebasepro/types` after v0.17.3, the
 * template imported it, and nothing could see the problem: `check:templates`
 * maps every `@rebasepro` specifier through tsconfig `paths` to that package's
 * `src`, so it compiles the template against the working tree; the first-run e2e calls
 * `linkLocalPackages()`, which rewrites the pins to `link:` before installing,
 * so the pin under test is never the pin that ships; and `init`'s release probe
 * only asks whether the version *exists* on npm.
 *
 * This asks the other question, offline: does the version the template pins
 * export what the template imports?
 *
 * ## What "the pinned version" means without a network
 *
 * A git tag. If `packages/<pkg>/package.json` says 0.17.3 and `v0.17.3` exists,
 * then 0.17.3 is published and the tag is what was published — the working tree
 * is unreleased work at an already-taken version number, and the template must
 * match the tag. If there is no such tag the version is unreleased: it will
 * ship *with* this tree, so the tree itself is the baseline.
 *
 * Neither case is vacuous, and the second is why the release preflight passes
 * `--released-as`. At the point `check-release-bump.mjs` runs, the manifests
 * still say the old version — publish.yml bumps them two steps later — so
 * without the override the gate would measure the release against the release
 * it replaces and refuse the very bump that fixes the skew. With it, a release
 * is asked the question that is actually true of it: does the server this
 * release publishes read what the compose file this release publishes demands?
 *
 * That also states the remedy for the first case. A template that needs a new
 * export is not blocked forever — it is blocked until the version bumps, which
 * is the release ordering the failure is really about.
 *
 * Three sources answer "what did that tag export", in order of authority:
 *
 *   1. `contracts/<pkg>.api.txt` at the tag — a rendered surface, if one exists.
 *   2. `contracts/server.api.txt` at the tag — the multi-package baseline, whose
 *      `## @rebasepro/<name>` sections cover the runtime-provided set and the
 *      `@rebasepro/server/functions` entry point.
 *   3. The tag's own source, walked from the entry module through its
 *      re-exports. Less exact than a rendered `.d.ts`, and the only thing
 *      available for the admin-side packages, which no contract tracks.
 *
 * ## The other half: the compose contract
 *
 * A scaffold's `docker-compose.yml` pins `rebasepro/server:${REBASE_VERSION}`,
 * and `init` writes its own version there too. Every `${VAR:?…}` in that file is
 * a variable compose *refuses to start without* — so if the image at that
 * version never reads it, the operator is made to set a value that does nothing.
 * 0.17.3 shipped exactly that: the compose file requires `REBASE_ADMIN_EMAIL`
 * and `REBASE_ADMIN_PASSWORD`, the 0.17.3 image has never heard of either, and
 * `DISABLE_SELF_REGISTRATION` defaults to `true` in the same file — a self-host
 * that boots with no admin account and no way to make one.
 *
 * Same question, same answer: does the source at that tag read the variable?
 *
 *     node tooling/scripts/check-template-pins.mjs                 # both axes
 *     node tooling/scripts/check-template-pins.mjs --imports       # what check:templates runs
 *     node tooling/scripts/check-template-pins.mjs --released-as 0.18.0
 *
 * Exit codes follow `check-release-bump.mjs`: 2 means the check did not run, 1
 * means it ran and found skew.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;

/** Files a scaffold compiles or runs. Prose is checked by the docs verifier. */
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Where the templates live. `overlays/` is included: `--headless` scaffolds from
 * it, and it pins the same versions.
 */
export const TEMPLATE_ROOT = "packages/cli/templates";

/**
 * The compose file a scaffold ships, and the tree whose source has to read its
 * required variables. Not `packages/server/dist`: this runs offline against a
 * tag, where no build exists.
 */
export const COMPOSE = "packages/cli/templates/template/docker-compose.yml";
export const SERVER_SRC = "packages/server/src";

function git(args) {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024
    });
}

/** File content at a rev, or null when the path did not exist there. */
function show(rev, file) {
    try {
        return git(["show", `${rev}:${file}`]);
    } catch {
        return null;
    }
}

function tagExists(tag) {
    try {
        git(["rev-parse", "--verify", `refs/tags/${tag}`]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Every named import of an `@rebasepro/*` specifier under `dir`.
 *
 * Default and namespace imports are collected too, as `default` and `*`: a
 * package that stops having a default export breaks them the same way. `import
 * type` and inline `type` specifiers count — a type that vanished is a compile
 * error in the scaffold, which is the failure this exists to prevent.
 */
export function templateImports(files) {
    const found = [];
    // The clause is either plain identifiers or one brace group, and may contain
    // neither a quote nor a `;` — which is what keeps a lazy match from spanning
    // an intervening statement and reading `defineConfig } from "vite"` as a
    // symbol of the next `@rebasepro` import down the file.
    const IMPORT = /(?:^|\n)[ \t]*(?:import|export)\s*((?:[^;"'{}]|\{[^}]*\})*?)\s*from\s*["'](@rebasepro\/[^"']+)["']/g;

    for (const { file, source } of files) {
        for (const match of source.matchAll(IMPORT)) {
            const clause = match[1].replace(/^type\s+/, "");
            const spec = match[2];
            const symbols = new Set();

            const braces = clause.match(/\{([\s\S]*)\}/);
            const before = (braces ? clause.slice(0, clause.indexOf("{")) : clause).trim().replace(/,$/, "").trim();
            if (before) {
                if (before.startsWith("*")) symbols.add("*");
                else symbols.add("default");
            }
            if (braces) {
                for (const raw of braces[1].split(",")) {
                    const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
                    if (name) symbols.add(name);
                }
            }
            if (symbols.size > 0) found.push({ file, spec, symbols: [...symbols] });
        }
    }
    return found;
}

/** `@rebasepro/app/vitePlugin` → { pkg: "app", subpath: "./vitePlugin" }. */
export function splitSpecifier(spec) {
    const rest = spec.slice("@rebasepro/".length);
    const slash = rest.indexOf("/");
    return slash === -1
        ? { pkg: rest, subpath: "." }
        : { pkg: rest.slice(0, slash), subpath: `.${rest.slice(slash)}` };
}

/**
 * Export names in a rendered API surface, optionally within one
 * `## @rebasepro/<name>` section.
 *
 * The format is `<kind> <Name>` or `<kind> <Name> { member, member }`, written
 * by `api-surface.mjs`. Only the name is wanted here; members are a level below
 * what an import statement can name.
 */
export function surfaceExports(text, section) {
    if (!text) return null;
    let body = text;
    if (section) {
        const start = text.indexOf(`## ${section}\n`);
        if (start === -1) return null;
        const next = text.indexOf("\n## ", start + 1);
        body = text.slice(start, next === -1 ? undefined : next);
    }
    const names = new Set();
    for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const name = trimmed.replace(/\s*\{[\s\S]*$/, "").trim().split(/\s+/).pop();
        if (name) names.add(name);
    }
    return names.size > 0 ? names : null;
}

/**
 * Export names of one TypeScript module at a rev, following relative re-exports.
 *
 * A parser, not a compiler: it reads `export` statements textually. That is
 * enough to answer "is this name exported", which is the whole question, and it
 * needs no build of a commit that may be months old.
 *
 * Anything it could NOT follow is returned alongside, and a missing symbol is
 * reported with that list rather than swallowed. An incomplete answer that
 * looks complete is the failure mode every gate in this repo has had at least
 * once.
 */
export function sourceExports(rev, entry, read = file => show(rev, file)) {
    const names = new Set();
    const unresolved = [];
    const seen = new Set();

    const resolve = (from, spec) => {
        const base = path.posix.join(path.posix.dirname(from), spec).replace(/\.js$/, "");
        for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]) {
            if (read(candidate) !== null) return candidate;
        }
        return null;
    };

    const walk = (file) => {
        if (seen.has(file) || seen.size > 400) return;
        seen.add(file);
        const source = read(file);
        if (source === null) {
            unresolved.push(file);
            return;
        }
        // Strip comments so a documented `export const foo` in a docblock — the
        // templates are full of them — is not read as a real export.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

        for (const m of code.matchAll(/(?:^|\n)\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g)) {
            names.add(m[1]);
        }
        for (const m of code.matchAll(/(?:^|\n)\s*export\s+default\b/g)) {
            void m;
            names.add("default");
        }
        for (const m of code.matchAll(/(?:^|\n)\s*export\s+(?:type\s+)?\{([\s\S]*?)\}\s*(?:from\s*["']([^"']+)["'])?/g)) {
            for (const raw of m[1].split(",")) {
                const parts = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
                const name = (parts[1] ?? parts[0]).trim();
                if (name) names.add(name);
            }
            // A re-export names its own symbols; nothing more to follow.
        }
        for (const m of code.matchAll(/(?:^|\n)\s*export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)) {
            names.add(m[1]);
        }
        for (const m of code.matchAll(/(?:^|\n)\s*export\s+\*\s+from\s*["']([^"']+)["']/g)) {
            const spec = m[1];
            if (!spec.startsWith(".")) {
                unresolved.push(`${spec} (re-exported by ${file})`);
                continue;
            }
            const target = resolve(file, spec);
            if (target) walk(target);
            else unresolved.push(`${spec} (from ${file})`);
        }
    };

    walk(entry);
    return { names, unresolved };
}

/** Candidate entry modules for a subpath, in the order a build would pick. */
export function entryCandidates(pkg, subpath) {
    const src = `packages/${pkg}/src`;
    if (subpath === ".") return [`${src}/index.ts`, `${src}/index.tsx`];
    const rest = subpath.replace(/^\.\//, "");
    return [`${src}/${rest}.ts`, `${src}/${rest}.tsx`, `${src}/${rest}/index.ts`, `${src}/${rest}/index.tsx`];
}

/**
 * What `spec` exported at `tag`, and where the answer came from.
 *
 * `source` is reported so a failure says which artifact was consulted: "not in
 * contracts/server.api.txt" and "not in the tag's source" are different claims
 * with different next steps.
 */
export function exportsAtTag(tag, spec) {
    const { pkg, subpath } = splitSpecifier(spec);
    const at = tag === null ? "the working tree" : tag;
    const read = tag === null
        ? file => {
            const abs = path.join(ROOT, file);
            return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
        }
        : file => show(tag, file);

    const dedicated = surfaceExports(read(`contracts/${pkg}.api.txt`));
    if (dedicated) return { names: dedicated, unresolved: [], source: `contracts/${pkg}.api.txt@${at}` };

    const shared = surfaceExports(read("contracts/server.api.txt"), spec);
    if (shared) return { names: shared, unresolved: [], source: `contracts/server.api.txt@${at} § ${spec}` };

    for (const entry of entryCandidates(pkg, subpath)) {
        if (read(entry) === null) continue;
        const { names, unresolved } = sourceExports(tag, entry, read);
        return { names, unresolved, source: `${entry}@${at}` };
    }
    return null;
}

/** Every `${VAR:?…}` in a compose file — the ones it refuses to start without. */
export function requiredComposeVars(text) {
    const vars = new Set();
    for (const m of (text ?? "").matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)) vars.add(m[1]);
    return [...vars].sort();
}

/** Does any file under `dir` mention `name`, at `tag` or (when null) on disk? */
function mentionedAtTag(tag, dir, name) {
    try {
        git(tag === null
            ? ["grep", "-l", "--fixed-strings", name, "--", dir]
            : ["grep", "-l", "--fixed-strings", name, tag, "--", dir]);
        return true;
    } catch {
        return false;
    }
}

function readTemplateFiles(root) {
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "dist") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (CODE.test(entry.name)) {
                files.push({ file: path.relative(ROOT, full), source: fs.readFileSync(full, "utf8") });
            }
        }
    };
    walk(path.join(ROOT, root));
    return files;
}

/**
 * `pinnedTagFor` and `read` are parameters so the gate's own tests can describe
 * a skew without needing a repository shaped like one.
 */
export function checkTemplatePins({
    axes = ["imports", "compose"],
    releasedAs = null,
    templateRoot = TEMPLATE_ROOT,
    files = readTemplateFiles(templateRoot),
    versionOf = pkg => {
        const manifest = path.join(ROOT, "packages", pkg, "package.json");
        return fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")).version : null;
    },
    isPublished = version => tagExists(`v${version}`),
    exportsAt = exportsAtTag,
    composeText = fs.existsSync(path.join(ROOT, COMPOSE)) ? fs.readFileSync(path.join(ROOT, COMPOSE), "utf8") : null,
    readsEnvAt = (tag, name) => mentionedAtTag(tag, SERVER_SRC, name)
} = {}) {
    const problems = [];
    const notes = [];
    let checked = 0;

    /**
     * The rev a package's pinned version is, or null for "this tree".
     *
     * `releasedAs` wins over the manifest because the manifests have not been
     * bumped yet when the release preflight runs — see the header.
     */
    const baselineFor = pkg => {
        const version = releasedAs ?? versionOf(pkg);
        if (!version) return { version: null, tag: null };
        return { version, tag: isPublished(version) ? `v${version}` : null };
    };
    const where = tag => tag ?? "this tree (the version is unreleased, so it ships with it)";

    if (axes.includes("imports")) {
        const bySpec = new Map();
        for (const use of templateImports(files)) {
            if (!bySpec.has(use.spec)) bySpec.set(use.spec, []);
            bySpec.get(use.spec).push(use);
        }

        for (const [spec, uses] of [...bySpec].sort()) {
            const { pkg } = splitSpecifier(spec);
            const { version, tag } = baselineFor(pkg);
            if (!version) {
                problems.push(`${spec} is imported by the templates but packages/${pkg}/package.json does not exist — `
                    + "the pin `rebase init` writes would name a package this repository does not build.");
                continue;
            }
            const surface = exportsAt(tag, spec);
            if (!surface) {
                problems.push(`${spec} pins ${version}, but nothing at ${where(tag)} says what it exports — no `
                    + `contracts/${pkg}.api.txt, no section in contracts/server.api.txt, and no source entry `
                    + `under packages/${pkg}/src. A template import that cannot be checked is one that ships unchecked.`);
                continue;
            }
            checked++;

            for (const { file, symbols } of uses) {
                for (const symbol of symbols) {
                    if (surface.names.has(symbol)) continue;
                    const trail = surface.unresolved.length
                        ? `\n      (the walk could not follow: ${surface.unresolved.slice(0, 3).join(", ")})`
                        : "";
                    problems.push(
                        `${file} imports { ${symbol} } from "${spec}", which ${version} does not export.\n`
                        + `      \`rebase init\` pins ${spec}@${version}, so this is what a scaffold installs — and\n`
                        + `      the import fails at boot, not at build. Either stop using ${symbol} in the template,\n`
                        + "      or bump the version so the pin names a release that has it.\n"
                        + `      Checked against ${surface.source}.${trail}`
                    );
                }
            }
        }
    }

    // ── The compose contract ─────────────────────────────────────
    //
    // Same rule one layer down: the file pins an image tag and then refuses to
    // start without variables that image may never read.
    if (axes.includes("compose")) {
        if (composeText === null) {
            problems.push(`${COMPOSE} does not exist — the compose half of this gate checked nothing.`);
        } else {
            const { version, tag } = baselineFor("server");
            for (const name of requiredComposeVars(composeText)) {
                if (readsEnvAt(tag, name)) continue;
                problems.push(
                    `${COMPOSE} refuses to start without ${name}, and rebasepro/server:${version} never reads it.\n`
                    + `      \`rebase init\` writes REBASE_VERSION=${version}, so that is the image a scaffold runs.\n`
                    + `      ${name} appears nowhere under ${SERVER_SRC} at ${where(tag)}: the operator is made to set\n`
                    + "      a value the container ignores. Drop the requirement, or bump the version so the image has it."
                );
            }
        }
    }

    for (const note of notes) console.log(`  · ${note}`);

    if (problems.length === 0) {
        if (axes.includes("imports")) {
            console.log(green(`  ok   template imports resolve against the versions \`rebase init\` pins (${checked} specifier(s))`));
        }
        if (axes.includes("compose")) {
            console.log(green("  ok   the scaffold's compose file requires only variables its pinned image reads"));
        }
        return 0;
    }

    console.error(red(`\n✗ ${problems.length} pin skew(s) — a scaffold built from this tree cannot boot:\n`));
    for (const p of problems) console.error(red(`  ✗ ${p}\n`));
    return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const wanted = ["imports", "compose"].filter(a => args.includes(`--${a}`));
    const releasedIndex = args.indexOf("--released-as");
    process.exit(checkTemplatePins({
        axes: wanted.length ? wanted : ["imports", "compose"],
        releasedAs: releasedIndex === -1 ? null : args[releasedIndex + 1] ?? null
    }));
}
