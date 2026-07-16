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

console.log(`✓ ${pkg.name}: ${entries.length} declared entry point${entries.length === 1 ? "" : "s"} present`);
