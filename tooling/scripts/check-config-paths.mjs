#!/usr/bin/env node
/**
 * Every filesystem path a build config names points at something that exists.
 *
 * Three references to `packages/ui/index.css` shipped in this repository, and
 * that file has never existed — the stylesheet is `packages/ui/src/index.css`,
 * published as `dist/index.css`:
 *
 *   - `app/frontend/vite.config.ts` aliased `@rebasepro/ui/index.css` to it,
 *     under a comment asserting that package-name aliases do not cover
 *     subpaths. They do. Vite matches an alias against the prefix up to a `/`
 *     boundary and `entries.find()` takes the first hit, so the spread above it
 *     had already rewritten the specifier and this entry was never consulted.
 *   - `packages/ui/package.json` listed it in `files`.
 *   - and again in `sideEffects`, where bundlers match the RESOLVED path, so an
 *     entry naming the package root could not fire for a file under `dist/`.
 *
 * None of them broke anything, which is the point. A dead alias is invisible
 * until the day something reorders the list — and then it is not a wrong style,
 * it is a dev server that will not start, blamed on whatever moved. The
 * manifest pair was worse in a quieter way: `sideEffects` looked like it named
 * the stylesheet twice, so the glob beside it read as redundant, and deleting
 * the glob would have shipped an unstyled admin panel.
 *
 * The aliases are read by LOADING each config, not by matching source text, so
 * a target assembled by a helper or spread in from a function is checked like a
 * literal one. That is most of them: `app/frontend` derives fourteen aliases
 * from a directory listing, and `saas/frontend` builds each through `pkg()`.
 *
 *     pnpm check:config-paths
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Vite, borrowed from the app rather than declared at the root.
 *
 * The root manifest has no runtime dependencies and adding one for a gate would
 * put a second copy of Vite in the lockfile, free to drift from the one the
 * builds actually use — and a config loaded by a different Vite than the one
 * that will load it in anger is not evidence about anything.
 */
const require = createRequire(path.join(ROOT, "app/frontend/package.json"));
const { loadConfigFromFile } = await import(pathToFileURL(require.resolve("vite")).href);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/**
 * Directories whose contents are not this repository's source.
 *
 * `.claude/worktrees` is here for the reason it is in every other sweep: it
 * holds full checkouts of other branches, so a gate that reads it reports on
 * code nobody is about to ship and misses nothing when it does not.
 *
 * The NAME list is not the rule, though, and relying on it went wrong: a second
 * worktree location appeared at `.worktrees/`, and this gate walked straight
 * into it and reported five configs that fail to load because that checkout has
 * no `node_modules`. A fresh CI clone has neither directory, so the failure was
 * one only a developer with worktrees could see — the exact shape the skip list
 * exists to prevent. `hasOwnCheckout` below is the rule the list was
 * approximating: a directory with its own `.git` is somebody else's tree.
 */
const SKIP = new Set(["node_modules", "dist", "build", ".git", ".claude", ".astro", "coverage"]);

/**
 * Configs this repository cannot load, each for a reason that is not a defect.
 *
 * The scaffold template's plugins are dependencies of the project `rebase init`
 * writes, not of this workspace, so they are deliberately absent here;
 * `check:templates` compiles that tree with them installed. Astro's config is
 * out of reach of Vite's loader entirely — Starlight ships `.ts` inside
 * `node_modules`, which Node refuses to strip types for — so `website`'s two
 * aliases are the one gap in this sweep.
 */
const UNLOADABLE = [
    "packages/cli/templates/",
    "website/astro.config"
];

/**
 * Whether this directory is a checkout of its own — a git worktree, a submodule,
 * or a nested repository. Its contents belong to another tree's tooling and are
 * built, typechecked and shipped by that tree, not this one.
 */
function hasOwnCheckout(dir) {
    return fs.existsSync(path.join(dir, ".git"));
}

function findConfigs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (hasOwnCheckout(full)) continue;
            findConfigs(full, out);
        } else if (/^vite\.config\.[cm]?[jt]s$/.test(entry.name)) {
            const rel = path.relative(ROOT, path.join(dir, entry.name));
            if (!UNLOADABLE.some((prefix) => rel.startsWith(prefix))) out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

/** `resolve.alias` in either of the two shapes Vite accepts, plus Astro's nested `vite`. */
function aliasEntries(config) {
    const found = [];
    for (const scope of [config, config?.vite]) {
        const alias = scope?.resolve?.alias;
        if (!alias) continue;
        if (Array.isArray(alias)) {
            for (const { find, replacement } of alias) found.push([String(find), replacement]);
        } else {
            for (const [find, replacement] of Object.entries(alias)) found.push([find, replacement]);
        }
    }
    return found;
}

const failures = [];
let aliasCount = 0;
let configCount = 0;

for (const file of findConfigs(ROOT)) {
    const rel = path.relative(ROOT, file);
    let loaded;
    try {
        loaded = await loadConfigFromFile({ command: "build", mode: "production" }, file);
    } catch (err) {
        // A config this repository cannot load is a finding in its own right:
        // every one of them is loaded by a real build.
        failures.push({ rel, alias: "(whole file)", target: `failed to load — ${err.message.split("\n")[0]}` });
        continue;
    }
    if (!loaded?.config) continue;
    configCount++;

    for (const [find, replacement] of aliasEntries(loaded.config)) {
        if (typeof replacement !== "string" || !path.isAbsolute(replacement)) continue;
        aliasCount++;
        if (!fs.existsSync(replacement)) {
            failures.push({ rel, alias: find, target: path.relative(ROOT, replacement) });
        }
    }
}

if (failures.length > 0) {
    console.error(red(`✗ ${failures.length} config path(s) point at nothing:\n`));
    for (const f of failures) {
        console.error(`  ${f.rel}`);
        console.error(`    ${f.alias}  ->  ${f.target}`);
    }
    console.error(`
  An alias whose target is missing is usually dead rather than broken — an
  earlier entry claims the specifier first, so nothing resolves through it.
  Delete it. If it is genuinely needed, point it at the file that exists.
`);
    process.exit(1);
}

console.log(green(`✓ ${aliasCount} alias target(s) across ${configCount} build config(s) exist.`));
