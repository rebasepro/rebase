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

/**
 * Every directory of collection files this repository ships.
 *
 * The template is here because it is the one nobody was checking, and it is the
 * one that reaches users: `rebase init` copies it verbatim, so a UI import in a
 * scaffolded collection file breaks the first `rebase dev` of every new project
 * rather than a build in this repo. The example app is checked for the same
 * reason it always was — it is the shape the docs point at.
 */
const COLLECTION_DIRS = [
    path.join(repoRoot, "app", "config", "collections"),
    path.join(repoRoot, "packages", "cli", "templates", "template", "config", "collections")
];

// Checked via their source entry points rather than bare specifiers: workspace
// packages aren't linked into the root node_modules, and this way the guard
// inspects src/ directly and needs no prior build.
const SERVER_PACKAGES = [
    "packages/server/src/index.ts",
    "packages/server-postgres/src/index.ts",
    "packages/server-mongo/src/index.ts",
    "packages/client/src/index.ts",
    // Not a server package — the type surface a collection file imports
    // `defineCollection` from. It is checked here rather than banned by name,
    // because banning it by name refused the way this project documents
    // authoring a collection while proving nothing about React. If a value
    // import of React ever lands in its graph, this line fails that day.
    "packages/cms-types/src/index.ts"
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

// The reference app ships to the runtime image with nothing vendored: its
// `@rebasepro/*` dependencies are `workspace:*`, which the bundle's
// `deps.declared` filters out, so whatever its config graph imports must be a
// package the image itself supplies. `@rebasepro/cms-types` is not one — the
// image stitches the runtime packages and nothing from the panel — and a
// `defineCollection` import from it loaded fine in every test here and
// failed the self-host acceptance boot with "Cannot find package". A scaffold
// is different: it pins a registry version, which is declared and installed.
console.log("Checking the reference app imports only what the runtime image ships...");
{
    const src = fs.readFileSync(path.join(repoRoot, "packages/cli/src/bundle.ts"), "utf8");
    const block = /const RUNTIME_PROVIDED = new Set\(\[([\s\S]*?)\]\)/.exec(src);
    if (!block) throw new Error("could not find RUNTIME_PROVIDED in packages/cli/src/bundle.ts");
    const provided = new Set([...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
    const appConfig = path.join(repoRoot, "app", "config");
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : walk(full);
        return /\.(ts|js|mts|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [full] : [];
    });
    for (const file of walk(appConfig)) {
        const text = fs.readFileSync(file, "utf8");
        for (const m of text.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["'](@rebasepro\/[a-z-]+)(?:\/[^"']*)?["']/gm)) {
            if (provided.has(m[1])) continue;
            const label = path.relative(repoRoot, file);
            failures.push({
                label,
                message: `imports ${m[1]}, which the runtime image does not ship (RUNTIME_PROVIDED in packages/cli/src/bundle.ts) — ` +
                    "the reference app is deployed without vendoring, so this boots here and fails the self-host acceptance boot with \"Cannot find package\". " +
                    "Use a runtime-provided package (an annotation from @rebasepro/types, or defineCollection from @rebasepro/common)."
            });
            console.log(`  ERR  ${label}`);
        }
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
