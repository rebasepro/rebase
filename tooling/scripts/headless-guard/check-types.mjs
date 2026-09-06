/**
 * Type-level headless guard — proves the BaaS *type surface* never names React.
 *
 * The sibling check.mjs proves the backend never *executes* React. That is a
 * weaker property than it sounds: every React import in @rebasepro/types is
 * erased at build time, so check.mjs passed even while 13 shipped `.d.ts` files
 * began with `import React from "react"` and `@types/react` was declared only as
 * a devDependency. A BaaS-only install — server + a driver + client, no React —
 * therefore typechecked against declarations referencing a module it had no way
 * to resolve.
 *
 * So this guard reads what the other one cannot see: the text of the sources and
 * of the emitted declarations. A core package may not *name* a UI module, in any
 * position, including `import type`.
 *
 * It runs in two halves, because they need different things and ran in the wrong
 * place for months:
 *
 *   pnpm check:types-headless        --src: sources and manifests. No build.
 *   pnpm check:types-headless:dts    --dts: the built declarations. After a build.
 *   node …/check-types.mjs           both, which is what you want locally.
 *
 * The split is the whole point. The gate lived in the `static` job, whose steps
 * are checkout / install / helm / `ci:static` — no build — so no package's
 * `dist` ever existed there and the half the rationale above is ACTUALLY about
 * scanned nothing, while printing a byte-identical "passed" either way. The
 * `--dts` half now runs in `build-gates`, and refuses to run at all when a core
 * package has no `dist`, the way `rls:check` uses `--min-tables` to refuse a
 * vacuous run.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const onlySrc = process.argv.includes("--src");
const onlyDts = process.argv.includes("--dts");
/** No flag means both, which is the useful thing to type by hand. */
const scanSrc = !onlyDts;
const scanDts = !onlySrc;
const label = onlyDts ? "declaration" : onlySrc ? "source" : "type-level";

/**
 * Packages that make up a BaaS install and its shared code. None of these may
 * name a UI module. `codegen` and `cli` are included because a BaaS user runs
 * them (`rebase generate-sdk`, `rebase db push`) with no React installed.
 *
 * `client-postgres` is deliberately absent: it is a React hook
 * (`usePostgresClientDriver`) and declares react/react-dom as peer
 * dependencies, so it is a frontend data-source driver, not core. It imports
 * only core types, which keeps the DAG intact.
 */
const CORE_PACKAGES = [
    "types",
    "utils",
    "common",
    "client",
    "codegen",
    "server",
    "server-postgres",
    "server-mongo",
    "cli",
    "inference",
    "mcp"
];

/**
 * Module specifiers that pull in React or an admin-only package.
 *
 * Kept in sync with FORBIDDEN_PACKAGES in forbid-ui-hook.mjs — that list guards
 * the runtime graph, this one guards the type surface, and a package belongs on
 * both.
 */
const FORBIDDEN_MODULES = [
    "react",
    "react-dom",
    "react-router",
    "react-router-dom",
    "@rebasepro/ui",
    "@rebasepro/app",
    "@rebasepro/cms",
    "@rebasepro/cms-types",
    "@rebasepro/cms-common",
    "@rebasepro/studio",
    "@rebasepro/forms"
];

/**
 * Every syntax that can make a module's types depend on another module:
 * static imports and re-exports (`from "x"`), inline type imports
 * (`import("x").Foo`), and triple-slash references.
 *
 * Matching the specifier rather than the whole statement is deliberate — it
 * catches `import type React from "react"`, which is the exact form that caused
 * the original leak and which a naive /^import React/ scan misses.
 */
function violationsIn(source) {
    const hits = [];
    const patterns = [
        // import … from "x" / export … from "x" / import "x"
        /(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g,
        // import("x") — inline type imports and dynamic imports
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        // /// <reference types="x" />
        /<reference\s+types\s*=\s*["']([^"']+)["']/g
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const specifier = match[1];
            const forbidden = FORBIDDEN_MODULES.find(
                (mod) => specifier === mod || specifier.startsWith(`${mod}/`)
            );
            if (forbidden) {
                const line = source.slice(0, match.index).split("\n").length;
                hits.push({ line, specifier, forbidden });
            }
        }
    }
    // One specifier can match several patterns; report each site once.
    const seen = new Set();
    return hits.filter((hit) => {
        const key = `${hit.line}:${hit.specifier}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Source files that ship type information, and the declarations built from them. */
function filesToCheck(packageDir) {
    const out = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Tests are not part of the published type surface.
                if (entry.name === "test" || entry.name === "__tests__") continue;
                walk(full);
                continue;
            }
            const isSource = /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
            const isDeclaration = entry.name.endsWith(".d.ts");
            if (isSource || isDeclaration) out.push(full);
        }
    };
    if (scanSrc) walk(path.join(packageDir, "src"));
    // dist is what a published consumer actually resolves, and the only thing
    // the rationale at the top is about. Its absence is a refusal, not a pass —
    // see the `unbuilt` check below.
    if (scanDts) walk(path.join(packageDir, "dist"));
    return out;
}

/**
 * React types must not be a *declared* dependency of a core package either.
 * `@types/react` as a devDependency is what let this rot unnoticed: it satisfies
 * the monorepo's own typecheck while being absent for every real consumer.
 */
function manifestViolations(packageDir) {
    const manifestPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(manifestPath)) return [];
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    const banned = [
        "react",
        "react-dom",
        "@types/react",
        "@types/react-dom",
        "@vitejs/plugin-react",
        "@rebasepro/ui",
        "@rebasepro/app",
        "@rebasepro/cms",
        "@rebasepro/cms-types",
        "@rebasepro/cms-common",
        "@rebasepro/studio",
        "@rebasepro/forms"
    ];
    const out = [];
    for (const field of fields) {
        for (const dep of Object.keys(manifest[field] ?? {})) {
            if (banned.includes(dep)) out.push({ field, dep });
        }
    }
    return out;
}

// A declaration scan over packages that were never built finds nothing and
// reports success in exactly the same words as a real pass. That is how this
// gate spent its life in a job with no build step: `rm -rf packages/*/dist` and
// `pnpm check:types-headless` printed the identical green line. Refuse instead,
// naming the packages, before scanning anything.
if (scanDts) {
    const unbuilt = CORE_PACKAGES.filter((pkg) => {
        const packageDir = path.join(repoRoot, "packages", pkg);
        return fs.existsSync(packageDir) && !fs.existsSync(path.join(packageDir, "dist"));
    });
    if (unbuilt.length > 0) {
        console.error(
            `\nNo dist: ${unbuilt.map((pkg) => `@rebasepro/${pkg}`).join(", ")}.\n\n` +
            "This half of the guard reads BUILT declarations — the thirteen shipped .d.ts\n" +
            "files that began with `import React` are the reason it exists — so without a\n" +
            "build it would scan nothing and pass. Run `pnpm run build` first; it runs in\n" +
            "CI's `build-gates` job, after the build, for the same reason."
        );
        process.exit(1);
    }
}

let fileFailures = 0;
let manifestFailures = 0;
const report = [];

for (const pkg of CORE_PACKAGES) {
    const packageDir = path.join(repoRoot, "packages", pkg);
    if (!fs.existsSync(packageDir)) continue;

    const badFiles = [];
    for (const file of filesToCheck(packageDir)) {
        const hits = violationsIn(fs.readFileSync(file, "utf8"));
        if (hits.length > 0) {
            badFiles.push({ file: path.relative(repoRoot, file), hits });
            fileFailures += hits.length;
        }
    }

    // Manifests are a source-side fact: `@types/react` as a devDependency is
    // what let the rot go unnoticed, and reading it needs no build.
    const badDeps = scanSrc ? manifestViolations(packageDir) : [];
    manifestFailures += badDeps.length;

    if (badFiles.length === 0 && badDeps.length === 0) {
        console.log(`  ok   @rebasepro/${pkg}`);
    } else {
        console.log(`  FAIL @rebasepro/${pkg}`);
        report.push({ pkg, badFiles, badDeps });
    }
}

if (report.length > 0) {
    console.error("\nType-level headless violations:\n");
    for (const { pkg, badFiles, badDeps } of report) {
        console.error(`@rebasepro/${pkg}`);
        for (const { dep, field } of badDeps) {
            console.error(`  package.json ${field}: ${dep}`);
        }
        for (const { file, hits } of badFiles) {
            for (const { line, specifier } of hits) {
                console.error(`  ${file}:${line} — imports "${specifier}"`);
            }
        }
        console.error("");
    }
    console.error(
        `${fileFailures} file reference(s) and ${manifestFailures} manifest entry(ies) in ` +
            `${report.length} package(s).\n\n` +
            "A core package must not name React or an admin package, even in a type position.\n" +
            "React-flavoured types belong in @rebasepro/cms-types.\n" +
            "See MODULAR-ARCHITECTURE.md."
    );
    process.exit(1);
}

console.log(
    `\nType-level headless guard passed (${label} scan) — no UI module named in any core ` +
    `type surface.`
);
