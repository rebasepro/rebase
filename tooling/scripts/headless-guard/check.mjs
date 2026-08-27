/**
 * Headless guard — proves the backend never reaches React.
 *
 * Imports every collection file and every server package under a loader hook
 * that throws if the module graph touches a UI package. This is what keeps BaaS
 * mode honest: a stray `import { x } from "@rebasepro/cms"` in a collection
 * file drags the whole React tree into the Node process, and nothing else in CI
 * would notice.
 *
 * Collection files are imported directly rather than through
 * loadCollectionsFromDirectory, which logs and swallows per-file errors.
 *
 * Imports that TypeScript elides because they are unused do not trip the guard.
 * That matches runtime: backends execute this same TS through tsx, so an unused
 * import never loads its module there either.
 *
 * Run: pnpm run check:headless
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

import { register as registerTsx } from "tsx/esm/api";

const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..", "..");

// TypeScript support first; the guard is registered last so it sees bare
// specifiers before the TS loader rewrites them.
registerTsx();
register(pathToFileURL(path.join(here, "forbid-ui-hook.mjs")));

const COLLECTION_DIRS = [path.join(repoRoot, "app", "config", "collections")];

// Checked via their source entry points rather than bare specifiers: workspace
// packages aren't linked into the root node_modules, and this way the guard
// inspects src/ directly and needs no prior build.
const SERVER_PACKAGES = [
    "packages/server/src/index.ts",
    "packages/server-postgres/src/index.ts",
    "packages/server-mongo/src/index.ts",
    "packages/client/src/index.ts"
];

/** Mirrors the filter in packages/server/src/collections/loader.ts. */
function collectionFilesIn(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs
        .readdirSync(directory)
        .filter(
            (file) =>
                (file.endsWith(".ts") || file.endsWith(".js")) &&
                !file.includes(".test.") &&
                !file.endsWith(".d.ts") &&
                file !== "index.ts" &&
                file !== "index.js"
        )
        .map((file) => path.join(directory, file));
}

const failures = [];

async function check(label, importable) {
    try {
        await import(importable);
        console.log(`  ok   ${label}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("[headless-guard]")) {
            failures.push({ label, message });
            console.log(`  FAIL ${label}`);
        } else {
            // Not a guard violation — a genuine load error (missing build,
            // syntax error). Surface it rather than passing silently.
            failures.push({ label, message: `unexpected load error: ${message}` });
            console.log(`  ERR  ${label}`);
        }
    }
}

console.log("Checking collection files are backend-safe...");
for (const dir of COLLECTION_DIRS) {
    for (const file of collectionFilesIn(dir)) {
        await check(path.relative(repoRoot, file), pathToFileURL(file).href);
    }
}

console.log("Checking server packages are UI-free...");
for (const pkg of SERVER_PACKAGES) {
    const entry = path.join(repoRoot, pkg);
    if (!fs.existsSync(entry)) {
        failures.push({ label: pkg, message: `source entry not found at ${entry}` });
        console.log(`  ERR  ${pkg}`);
        continue;
    }
    await check(pkg, pathToFileURL(entry).href);
}

if (failures.length > 0) {
    console.error(`\n${failures.length} headless violation(s):\n`);
    for (const { label, message } of failures) {
        console.error(`• ${label}\n  ${message}\n`);
    }
    process.exit(1);
}

console.log("\nHeadless guard passed — no UI code in any backend module graph.");
