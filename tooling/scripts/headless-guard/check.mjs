/**
 * Headless guard — proves the backend never reaches React.
 *
 * Imports every `backend/schema` module and every server package under a
 * loader hook that throws if the module graph touches a UI package. This is
 * what keeps BaaS mode honest: a stray `import { x } from "@rebasepro/cms"` in a
 * table file drags the whole React tree into the Node process — `rebase db
 * generate`, `db push` and boot all load those files — and nothing else in CI
 * would notice.
 *
 * Until 0.31 a collection file was shared by the backend and the admin's Vite
 * build, so "no UI in a collection file" was a rule this guard had to enforce
 * against code that was *meant* to carry UI (the `admin` block, lazy component
 * thunks). Tables now live in `backend/schema` and the panel's customizations in
 * `frontend/src/cms`, so the split is structural; what is left here is the
 * plain invariant: a schema module, and every server or kernel package, loads
 * with no UI package in reach. The other direction — a frontend importing a
 * backend module as a value — is `check:frontend-backend-imports`.
 *
 * Schema modules are imported directly rather than through the loader, which
 * reports per-file problems as schema errors rather than as the module that
 * pulled React in.
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
 * Every `backend/schema` directory this repository ships.
 *
 * The template and its presets are here because they are the ones that reach
 * users: `rebase init` copies the template's `backend/schema/` and then one
 * preset's over it, so a UI import in a scaffolded table file breaks the first
 * `rebase dev` of every new project rather than a build in this repo. The demo
 * app is checked for the same reason it always was — it is the shape the docs
 * point at. `examples/*` are globbed so an example that grows a backend is
 * covered the day it does.
 */
function schemaDirs() {
    const dirs = [
        path.join(repoRoot, "app", "backend", "schema"),
        path.join(repoRoot, "packages", "cli", "templates", "template", "backend", "schema")
    ];
    for (const parent of ["packages/cli/templates/presets", "examples"]) {
        const root = path.join(repoRoot, parent);
        if (!fs.existsSync(root)) continue;
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (entry.isDirectory()) dirs.push(path.join(root, entry.name, "backend", "schema"));
        }
    }
    return dirs.filter(dir => fs.existsSync(dir));
}

/** A preset's directory: its `index.ts` names tables only the template has. */
const PRESETS = path.join(repoRoot, "packages", "cli", "templates", "presets") + path.sep;

// Checked via their source entry points rather than bare specifiers: workspace
// packages aren't linked into the root node_modules, and this way the guard
// inspects src/ directly and needs no prior build.
const SERVER_PACKAGES = [
    // The kernel: the authoring types and the compiler every door shares. They
    // carry no UI at all now that the CMS view model lives in cms-types, and
    // this is what keeps it that way.
    "packages/types/src/index.ts",
    "packages/common/src/index.ts",
    // What a `backend/schema` file imports: the builders, and nothing of the
    // server. Its own test proves it loads no server module; this proves it
    // loads no UI one either.
    "packages/server/src/schema/index.ts",
    "packages/server/src/index.ts",
    "packages/server-postgres/src/index.ts",
    "packages/client/src/index.ts",
    // The review plugin's backend halves: what a schema or hook file imports
    // (`/config`) and what a function file imports (`/server`). Its root entry
    // is the admin panel's and is meant to be React.
    "packages/plugin-review/src/config/index.ts",
    "packages/plugin-review/src/server/index.ts"
];

/**
 * The modules of one schema directory, recursively.
 *
 * Every module, `index.ts` included — the index is what the backend loads, and
 * a UI import there is as fatal as one in a table file. The one exception is a
 * preset's `index.ts`: `rebase init` lays a preset over the template's
 * `backend/schema/`, and the preset's index names `./users`, which exists only
 * once it has. Its table files are imported on their own.
 */
function schemaModulesIn(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "__tests__") continue;
            files.push(...schemaModulesIn(full));
            continue;
        }
        const file = entry.name;
        if (!/\.(ts|js|mts|mjs)$/.test(file) || file.includes(".test.") || file.endsWith(".d.ts")) continue;
        if (full.startsWith(PRESETS) && /^index\.(ts|js)$/.test(file)) continue;
        files.push(full);
    }
    return files.sort();
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

console.log("Checking backend/schema modules are UI-free...");
const SCHEMA_DIRS = schemaDirs();
if (SCHEMA_DIRS.length < 2) {
    // The demo's and the template's are the floor: finding fewer means a
    // directory moved, and a guard over nothing passes.
    failures.push({ label: "backend/schema", message: `found ${SCHEMA_DIRS.length} schema director(ies); expected at least the demo's and the template's` });
}
for (const dir of SCHEMA_DIRS) {
    for (const file of schemaModulesIn(dir)) {
        await check(path.relative(repoRoot, file), pathToFileURL(file).href);
    }
}

// The other modules the runtime loads out of a backend directory beside the
// schema: `resources.ts` (databases, buckets, topics), `storage.ts`
// (`storageAuthorize`) and `hooks.ts` (global table hooks). They boot in the same
// process, so the same rule holds. The headless overlay's backend is a backend
// directory with no schema of its own.
console.log("Checking the backend modules beside the schema are UI-free...");
{
    const backends = new Set(SCHEMA_DIRS.map(dir => path.dirname(dir)));
    backends.add(path.join(repoRoot, "packages", "cli", "templates", "overlays", "baas", "backend"));
    for (const backend of [...backends].sort()) {
        for (const name of ["resources", "storage", "hooks"]) {
            for (const ext of [".ts", ".js"]) {
                const file = path.join(backend, name + ext);
                if (fs.existsSync(file)) await check(path.relative(repoRoot, file), pathToFileURL(file).href);
            }
        }
    }
}

// The reference app ships to the runtime image with nothing vendored: its
// `@rebasepro/*` dependencies are `workspace:*`, which the bundle's
// `deps.declared` filters out, so whatever its schema graph imports must be a
// package the image itself supplies. `@rebasepro/cms-types` is not one — the
// image stitches the runtime packages and nothing from the panel — and an
// import from it loaded fine in every test here and failed the self-host
// acceptance boot with "Cannot find package". A scaffold is different: it pins
// a registry version, which is declared and installed.
console.log("Checking the reference app imports only what the runtime image ships...");
{
    const src = fs.readFileSync(path.join(repoRoot, "packages/cli/src/bundle.ts"), "utf8");
    const block = /const RUNTIME_PROVIDED = new Set\(\[([\s\S]*?)\]\)/.exec(src);
    if (!block) throw new Error("could not find RUNTIME_PROVIDED in packages/cli/src/bundle.ts");
    const provided = new Set([...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
    const appSchema = path.join(repoRoot, "app", "backend", "schema");
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : walk(full);
        return /\.(ts|js|mts|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [full] : [];
    });
    for (const file of walk(appSchema)) {
        const text = fs.readFileSync(file, "utf8");
        for (const m of text.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["'](@rebasepro\/[a-z-]+)(?:\/[^"']*)?["']/gm)) {
            if (provided.has(m[1])) continue;
            const label = path.relative(repoRoot, file);
            failures.push({
                label,
                message: `imports ${m[1]}, which the runtime image does not ship (RUNTIME_PROVIDED in packages/cli/src/bundle.ts) — ` +
                    "the reference app is deployed without vendoring, so this boots here and fails the self-host acceptance boot with \"Cannot find package\". " +
                    "Use a runtime-provided package (the builders from @rebasepro/server/schema, a type from @rebasepro/types)."
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
