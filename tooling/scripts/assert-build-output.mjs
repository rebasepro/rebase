#!/usr/bin/env node
/**
 * Fail a package build that did not emit everything its package.json promises.
 *
 * `vite build && tsc --emitDeclarationOnly` is two steps against one directory,
 * so an interrupted or partly-failed build leaves dist/ with JS and no .d.ts.
 * Nothing notices: the package still resolves, and the next consumer to type
 * check it gets
 *
 *     TS7016: Could not find a declaration file for module '@rebasepro/server'.
 *             '.../dist/index.umd.js' implicitly has an 'any' type.
 *
 * which reads as a broken tsconfig in an app that never changed. `@rebasepro/app`
 * has a third step for dist/vitePlugin.js, and its absence surfaces as
 * ERR_MODULE_NOT_FOUND at dev-server startup — which looks nothing like a
 * half-built monorepo either. The tell is always "frontend fine, backend
 * broken", and nobody knows that on their first encounter.
 *
 * This runs as the last step of a build and checks the entry points the package
 * actually declares (main/module/types/bin/exports), so it stays correct as
 * those change instead of hardcoding dist/index.d.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkgDir = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8"));

/** Collect every relative file path the package points consumers at. */
function declaredEntryPoints(manifest) {
    const found = new Set();

    const add = (value) => {
        if (typeof value === "string" && value.startsWith(".") && !value.endsWith("/package.json")) {
            found.add(value);
        }
    };

    add(manifest.main);
    add(manifest.module);
    add(manifest.types);
    add(manifest.typings);

    if (typeof manifest.bin === "string") add(manifest.bin);
    else if (manifest.bin) Object.values(manifest.bin).forEach(add);

    // exports is an arbitrarily nested map of conditions to paths; every string
    // leaf is a real file a consumer can resolve.
    const walk = (node) => {
        if (typeof node === "string") return add(node);
        if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(manifest.exports);

    return [...found];
}

/**
 * Redirect directories — a `<subpath>/package.json` whose `main`/`types` point
 * back into `dist`.
 *
 * These exist because TypeScript's legacy `moduleResolution: "node"` ignores
 * the `exports` map entirely and resolves a subpath as a directory. A project
 * scaffolded by `rebase init` compiles that way, so `@rebasepro/server/functions`
 * type-checks *only* through one of these. They are inert at runtime — Node
 * honours `exports` and never looks at them — which is exactly what makes a
 * broken one invisible: the import keeps working, the types silently become
 * `any`, and the first symptom is an unrelated-looking implicit-any error in
 * somebody else's project.
 *
 * So they are checked here with the declared entry points, and for the same
 * reason.
 */
function redirectTargets(pkgDir, manifest) {
    const targets = [];
    for (const entry of manifest.files ?? []) {
        if (typeof entry !== "string" || entry === "dist" || entry === "bin") continue;
        const redirect = resolve(pkgDir, entry, "package.json");
        if (!existsSync(redirect)) continue;

        let json;
        try {
            json = JSON.parse(readFileSync(redirect, "utf8"));
        } catch {
            targets.push({ from: `${entry}/package.json`, target: "(unparseable JSON)" });
            continue;
        }

        for (const field of ["main", "module", "types", "typings"]) {
            const value = json[field];
            if (typeof value !== "string") continue;
            targets.push({
                from: `${entry}/package.json#${field}`,
                target: value,
                path: resolve(pkgDir, entry, value)
            });
        }
    }
    return targets;
}

const entries = declaredEntryPoints(pkg);
const missing = entries.filter((entry) => !existsSync(resolve(pkgDir, entry)));

if (missing.length > 0) {
    const label = `${pkg.name} is half-built`;
    console.error(`\n\x1b[31m✖ ${label}\x1b[0m — it declares ${entries.length} entry point${entries.length === 1 ? "" : "s"}, but ${missing.length} ${missing.length === 1 ? "is" : "are"} missing:\n`);
    for (const entry of missing) console.error(`    missing: ${entry}`);
    console.error(`
This is a build problem in this repo, not a problem in whatever consumed it.
A partial dist/ still resolves, so the failure lands somewhere else entirely:
a missing .d.ts surfaces as TS7016 "implicitly has an 'any' type" pointing at
the built JS, and a missing .js surfaces as ERR_MODULE_NOT_FOUND at startup.
Both look like the consumer is misconfigured. It isn't.

    Fix: re-run the build for this package (pnpm --filter ${pkg.name} build),
         or rebuild everything (pnpm build). If it fails, the real error is
         above this line.
`);
    process.exit(1);
}

const redirects = redirectTargets(pkgDir, pkg);
const brokenRedirects = redirects.filter((redirect) => !redirect.path || !existsSync(redirect.path));

if (brokenRedirects.length > 0) {
    console.error(`\n\x1b[31m✖ ${pkg.name} has a broken resolution redirect\x1b[0m:\n`);
    for (const redirect of brokenRedirects) {
        console.error(`    ${redirect.from} → ${redirect.target} (does not exist)`);
    }
    console.error(`
A redirect directory is how a subpath import type-checks under TypeScript's
legacy 'moduleResolution: "node"', which ignores the exports map. Node never
reads it, so a broken one does not fail at runtime and does not fail at import:
the module resolves and its types quietly become 'any'. The first symptom is an
implicit-any error in a consumer's own file, pointing at their code.
`);
    process.exit(1);
}

/**
 * A library this package re-exports must be external, never inlined.
 *
 * Bundling a dependency is normally fine and is what this repo does by default.
 * It stops being fine the moment the package hands consumers that library's own
 * objects: `@rebasepro/server` re-exports `z`, so inlining zod meant an app's
 * `import { z } from "zod"` and `import { z } from "@rebasepro/server"` were two
 * different sets of classes — and, under our own `^4.4.3` range, usually two
 * different versions, because we build against 4.4.3 while apps install 4.5.x.
 *
 * Anything that compares by class identity across that seam then misbehaves
 * without saying why. `.merge()` dropped every `ZodDefault`, so each field
 * carrying a `.default()` came back required; a tenant booted, reported healthy,
 * and loaded none of its functions, with nothing in the error mentioning zod.
 *
 * The rule is checked from what the build actually emitted rather than from the
 * externals list, because the externals list is the thing that gets edited.
 */
const REEXPORTED_LIBRARIES = { z: "zod" };

/**
 * The names a module's `export { ... }` statements actually publish.
 *
 * Parsed rather than grepped. The first version of this check tested the whole
 * emitted file for `\bz\s*(,|\}|as\b)`, which in a bundled file matches any
 * minifier-generated local named `z` — it failed @rebasepro/cms, which exports
 * no `z` at all, and would have failed on a letter forever.
 */
function exportedNames(source) {
    const names = new Set();
    for (const statement of source.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const clause of statement[1].split(",")) {
            const name = clause.trim();
            if (!name) continue;
            const renamed = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(name);
            names.add(renamed ? renamed[1] : name);
        }
    }
    return names;
}

const mainEntry = [pkg.module, pkg.main, pkg.exports?.["."]?.import, pkg.exports?.["."]?.default]
    .find(entry => typeof entry === "string" && entry.endsWith(".js"));

if (mainEntry && existsSync(resolve(pkgDir, mainEntry))) {
    const emitted = readFileSync(resolve(pkgDir, mainEntry), "utf8");
    const exported = exportedNames(emitted);
    const inlined = [];

    for (const [binding, library] of Object.entries(REEXPORTED_LIBRARIES)) {
        if (!exported.has(binding)) continue;
        if (!emitted.includes(`from "${library}"`)) inlined.push(library);
    }

    if (inlined.length > 0) {
        console.error(`\n\x1b[31m✖ ${pkg.name} inlines a library it re-exports\x1b[0m: ${inlined.join(", ")}\n`);
        console.error(`Add ${inlined.map(l => `"${l}"`).join(", ")} to the externals list in vite.config.ts.

Consumers get this package's copy from its own exports and their copy from
node_modules. Two copies of a validation library do not throw — they disagree
quietly, and the failure surfaces somewhere that never mentions the library.
`);
        process.exit(1);
    }
}

const suffix = redirects.length > 0
    ? `, ${redirects.length} redirect target${redirects.length === 1 ? "" : "s"} resolved`
    : "";
console.log(`✓ ${pkg.name}: ${entries.length} declared entry point${entries.length === 1 ? "" : "s"} present${suffix}`);
