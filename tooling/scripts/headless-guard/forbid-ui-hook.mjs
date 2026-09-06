/**
 * Module customization hook that fails the process if a backend module graph
 * reaches a UI package.
 *
 * Registered by tooling/scripts/headless-guard/check.mjs. The checks run in both
 * `resolve` (catching the bare specifier, e.g. "react") and `load` (catching the
 * resolved URL, e.g. .../node_modules/react/index.js) so the guard holds no
 * matter where this hook lands in the chain relative to the TypeScript loader.
 *
 * Workspace @rebasepro/* specifiers are redirected to each package's source
 * entry, mirroring the aliases the vite configs use. That keeps the guard
 * build-independent (dist/ need not exist) and checks the graph as written.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Bare specifiers a backend must never import — matched exactly or as a subpath.
 *
 * `@rebasepro/cms-types` is deliberately NOT on this list, and it used to be.
 * That package is the type surface, not the panel: its build output has no React
 * import in it at all, and `defineCollection` — the builder every scaffolded
 * collection file imports, in the template and in 35 documentation snippets —
 * lives there. Banning it by name made the guard refuse the way this project
 * documents authoring a collection, which is how the example app ended up on the
 * `const x: PostgresCollectionConfig` annotation the docs warn against.
 *
 * So the ban is on the evidence rather than the name: React itself is forbidden,
 * and `check.mjs` loads this package's own entry point as a checked module, so a
 * value import of React landing in its graph fails the guard the same day.
 */
const FORBIDDEN_PACKAGES = [
    "react",
    "react-dom",
    "react-router",
    "react-router-dom",
    "@rebasepro/cms",
    "@rebasepro/cms-common",
    "@rebasepro/ui",
    "@rebasepro/app",
    "@rebasepro/studio",
    "@rebasepro/forms"
];

/** Resolved-URL fragments identifying the same packages once on disk. */
const FORBIDDEN_PATHS = [
    "/node_modules/react/",
    "/node_modules/react-dom/",
    "/node_modules/react-router/",
    "/node_modules/react-router-dom/",
    "/packages/cms/",
    "/packages/admin-common/",
    "/packages/ui/",
    "/packages/app/",
    "/packages/studio/",
    "/packages/forms/"
];

/** package name -> source entry file, built by scanning packages/ * /package.json. */
const sourceEntries = new Map();
{
    const packagesDir = path.resolve(import.meta.dirname, "..", "..", "..", "packages");
    for (const dir of fs.readdirSync(packagesDir)) {
        const manifestPath = path.join(packagesDir, dir, "package.json");
        if (!fs.existsSync(manifestPath)) continue;
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (!manifest.name) continue;
            const entry = path.join(packagesDir, dir, manifest.source ?? "src/index.ts");
            if (fs.existsSync(entry)) sourceEntries.set(manifest.name, entry);
        } catch {
            // Unreadable manifest — leave it unaliased and let Node resolve it.
        }
    }
}

function matchPackage(specifier) {
    return FORBIDDEN_PACKAGES.find(
        (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`)
    );
}

function matchPath(url) {
    return FORBIDDEN_PATHS.find((fragment) => url.includes(fragment));
}

function fail(what, importer) {
    const from = importer ? `\n  imported by: ${importer}` : "";
    throw new Error(
        `[headless-guard] Backend module graph reached UI code: ${what}${from}\n` +
            "  Backends and collection files must not import React or any @rebasepro UI package.\n" +
            "  Reference custom components by string path (Field: \"./MyField\") instead of importing them;\n" +
            "  see MODULAR-ARCHITECTURE.md — \"The collection-file import rule\"."
    );
}

export async function resolve(specifier, context, nextResolve) {
    const hit = matchPackage(specifier);
    if (hit) fail(hit, context.parentURL);

    // Redirect workspace packages to their source entry (bare specifier only;
    // subpaths keep their normal resolution).
    const aliased = sourceEntries.get(specifier);
    if (aliased) {
        return { url: pathToFileURL(aliased).href, format: "module", shortCircuit: true };
    }

    const resolved = await nextResolve(specifier, context);
    // The specifier may be relative or aliased; re-check what it actually resolved to.
    if (resolved?.url?.startsWith("file:")) {
        const pathHit = matchPath(resolved.url);
        if (pathHit) fail(`${specifier} -> ${resolved.url}`, context.parentURL);
    }
    return resolved;
}

export async function load(url, context, nextLoad) {
    const pathHit = matchPath(url);
    if (pathHit) fail(url, undefined);
    return nextLoad(url, context);
}
