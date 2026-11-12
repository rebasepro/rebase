#!/usr/bin/env node
/**
 * Code under a `frontend/` imports its `backend/` as types only — everywhere
 * this repository has both.
 *
 * Until 0.31 one collection file served the backend and the admin's Vite build,
 * and a Vite plugin rewrote what the browser received: it turned string
 * component paths into lazy imports and kept the server half of the file out of
 * the bundle. Tables now live in `backend/schema` and the panel's
 * customizations in `frontend/src/cms`, and the plugin is gone. What replaces
 * it is a rule, not a transform: `frontend/src/cms/posts.tsx` writes
 * `import type { posts } from "../../../backend/schema/posts"`, which the
 * compiler erases. A *value* import of the same file would put the table into
 * the browser bundle — and with it its hooks, the helpers they call and the
 * server modules those import — and it would build, and run, and nobody would
 * see the server code shipped to every visitor.
 *
 * What enforces the rule is the build: `rebaseBackendGuard()` from
 * `@rebasepro/app/vitePlugin` refuses any module of the frontend's graph that
 * resolves under `backend/`, in every project's own Vite build and dev server.
 * So this gate also holds every frontend here that has a Vite config to list
 * the guard — the demo, the examples and the scaffold's template are what new
 * projects copy.
 *
 * The import rule itself is `findValueImportsOfBackend` in `backend-type-imports.mjs`,
 * which `check:templates` also runs over every scaffold it materialises. This
 * gate runs it over the trees that are not scaffolds — the demo app and every
 * example — and over the template and preset sources as they sit in the
 * repository, so a violation is caught where it is written as well as where it
 * is copied to.
 *
 * Every `frontend/` directory with a sibling `backend/` under the roots below
 * is a pair. A tree that has a frontend and no backend has no line to cross.
 *
 *     pnpm check:frontend-backend-imports
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findValueImportsOfBackend, sourceFilesUnder } from "./backend-type-imports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where a `frontend/` + `backend/` pair can live. */
const ROOTS = ["app", "examples", "packages/cli/templates"];

const SKIP = new Set(["node_modules", "dist", ".git"]);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/**
 * Every `frontend/` directory under `dir` whose parent also holds a `backend/`.
 *
 * @param {string} dir absolute
 * @returns {{ frontend: string, backend: string }[]}
 */
export function frontendBackendPairs(dir) {
    const pairs = [];
    if (!fs.existsSync(dir)) return pairs;
    const walk = (current) => {
        const entries = fs.readdirSync(current, { withFileTypes: true }).filter(e => e.isDirectory() && !SKIP.has(e.name));
        const names = new Set(entries.map(e => e.name));
        if (names.has("frontend") && names.has("backend")) {
            pairs.push({ frontend: path.join(current, "frontend"), backend: path.join(current, "backend") });
        }
        for (const entry of entries) {
            if (entry.name === "frontend" || entry.name === "backend") continue;
            walk(path.join(current, entry.name));
        }
    };
    walk(dir);
    return pairs;
}

/** The Vite config files a frontend directory may have. */
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs", "vite.config.cts", "vite.config.cjs"];

/**
 * The frontend's Vite config, when it has one, and whether it calls
 * `rebaseBackendGuard(…)` imported from `@rebasepro/app/vitePlugin`.
 *
 * @param {string} frontend absolute
 * @returns {{ file: string, guarded: boolean } | undefined}
 */
export function viteConfigGuard(frontend) {
    const name = VITE_CONFIGS.find(candidate => fs.existsSync(path.join(frontend, candidate)));
    if (!name) return undefined;
    const file = path.join(frontend, name);
    const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    const imported = /import\s*\{[^}]*\brebaseBackendGuard\b[^}]*\}\s*from\s*["']@rebasepro\/app\/vitePlugin["']/.test(text);
    return { file, guarded: imported && /\brebaseBackendGuard\s*\(/.test(text) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const pairs = ROOTS.flatMap(root => frontendBackendPairs(path.join(ROOT, root)));
    // The demo's pair is the floor: without it this reads nothing and passes.
    if (!pairs.some(p => p.frontend === path.join(ROOT, "app", "frontend"))) {
        console.error(red("✗ app/frontend + app/backend not found — the gate would check nothing. Point ROOTS at where the demo moved."));
        process.exit(2);
    }

    const findings = [];
    let files = 0;
    for (const { frontend, backend } of pairs) {
        const sources = sourceFilesUnder(frontend);
        files += sources.length;
        findings.push(...findValueImportsOfBackend({ files: sources, backendDir: backend }));
    }

    const unguarded = pairs.map(({ frontend }) => viteConfigGuard(frontend)).filter(config => config && !config.guarded);
    if (unguarded.length > 0) {
        console.error(red(`\n✗ ${unguarded.length} frontend Vite config(s) without rebaseBackendGuard():\n`));
        for (const { file } of unguarded) console.error(`    ${path.relative(ROOT, file)}`);
        console.error(dim(
            "\n  Add `rebaseBackendGuard()` from \"@rebasepro/app/vitePlugin\" to its plugins. It is what refuses a value" +
            "\n  import of backend/ in the build, whatever the import's spelling; this check is only the pre-check.\n"
        ));
        process.exit(1);
    }

    if (findings.length === 0) {
        console.log(green(
            `✓ ${files} frontend file(s) in ${pairs.length} frontend/backend pair(s) import the backend as types only.`
        ));
        console.log(dim("  A pre-check: rebaseBackendGuard() in each Vite build is what enforces it, including for what a static read cannot see."));
        process.exit(0);
    }

    console.error(red(`\n✗ ${findings.length} value import(s) of a backend module from a frontend:\n`));
    for (const { file, line, specifier, form, via } of findings) {
        const through = via ? `  (through ${via.map(module => path.relative(ROOT, module)).join(" → ")})` : "";
        console.error(`    ${path.relative(ROOT, file)}:${line}  ${form} "${specifier}"${through}`);
    }
    console.error(dim(
        "\n  Write `import type { … } from \"…/backend/…\"`, or move a value both sides need out of backend/. A value import puts the backend module —" +
        "\n  its hooks and every server module they reach — into the browser bundle. `import { type x }`" +
        "\n  does not count: it still loads the module for its side effects.\n"
    ));
    process.exit(1);
}
