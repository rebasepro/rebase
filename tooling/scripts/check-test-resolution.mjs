#!/usr/bin/env node
/**
 * check:test-resolution — every test runner resolves the workspace packages
 * its package depends on to their SOURCE, not their `dist`.
 *
 * A `@rebasepro/*` package's `exports` point at `dist`. A jest or vitest config
 * with no mapping for one therefore tests the last BUILD of it: in CI that is
 * harmless, because CI builds first, but locally and in a worktree a change to
 * `packages/types` plus a test elsewhere checks whatever was last built. The
 * CLI's three vitest configs had no mapping, and for a day the CLI e2e passed
 * locally against a `dist` from before the commit it was failing on in CI; in a
 * fresh worktree its integration suite failed outright for want of a `dist`.
 *
 * For every package, every jest and vitest config its `test*` scripts run is
 * loaded, and every `workspace:` dependency that has a `src/index.ts` must map,
 * on its bare name, to a file under that package's `src/` (or to a mock outside
 * the dependency altogether, which is a choice, not a build). A dependency with no
 * `src/index.ts` (one that ships no TypeScript entry) is not asked about.
 *
 *   pnpm check:test-resolution
 *
 * Plain JS so `test:gates` can import its functions under bare `node --test`;
 * the CLI runs under `node --import tsx` because the vitest configs it loads
 * are TypeScript.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

/**
 * The workspace dependencies that have a source entry, as `[name, srcDir]`.
 * @param {{ dependencies?: Record<string,string>, devDependencies?: Record<string,string>, peerDependencies?: Record<string,string> }} manifest
 * @param {string} packagesDir
 * @returns {[string, string][]}
 */
export function sourceDependencies(manifest, packagesDir) {
    const declared = { ...manifest.peerDependencies, ...manifest.devDependencies, ...manifest.dependencies };
    return Object.entries(declared)
        .filter(([name, range]) => name.startsWith("@rebasepro/") && String(range).startsWith("workspace:"))
        .map(([name]) => [name, path.join(packagesDir, name.slice("@rebasepro/".length), "src")])
        .filter(([, src]) => fs.existsSync(path.join(src, "index.ts")))
        .sort(([a], [b]) => a.localeCompare(b));
}

/** Which runner configs a package's `test*` scripts run. */
export function runnersOf(manifest, dir) {
    const runners = new Map();
    for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
        if (!/^test(:|$)/.test(script) || script === "test:watch") continue;
        for (const segment of command.split(/&&|\|\||;/)) {
            const tool = segment.match(/(?:^|\s)(jest|vitest)(?=\s|$)/)?.[1];
            if (!tool) continue;
            const explicit = segment.match(/(?:-c|--config)[ =](\S+)/)?.[1];
            let config = explicit ? path.join(dir, explicit) : null;
            if (!config) {
                const candidates = tool === "jest"
                    ? ["jest.config.cjs", "jest.config.js", "jest.config.mjs", "jest.config.ts"]
                    : ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts"];
                const found = candidates.map((c) => path.join(dir, c)).find((c) => fs.existsSync(c));
                // jest with no file reads `package.json`'s "jest" key (config null).
                config = found ?? null;
            }
            const key = `${tool}:${config ?? "(package.json/defaults)"}`;
            runners.set(key, { runner: tool, config, label: `${script} → ${tool} ${config ? path.relative(dir, config) : tool === "jest" ? "(package.json \"jest\")" : "(no config file)"}` });
        }
    }
    return [...runners.values()];
}

/** A jest `moduleNameMapper` as a function of the specifier. */
export function jestMapping(mapper, rootDir) {
    const entries = Object.entries(mapper ?? {});
    return (specifier) => {
        for (const [pattern, replacement] of entries) {
            const regex = new RegExp(pattern);
            if (!regex.test(specifier)) continue;
            const first = Array.isArray(replacement) ? replacement[0] : replacement;
            return path.resolve(rootDir, specifier.replace(regex, first).replace(/<rootDir>/g, rootDir));
        }
        return null;
    };
}

/** A vite `resolve.alias` (array or object form) as a function of the specifier. */
export function vitestMapping(alias, rootDir) {
    const entries = Array.isArray(alias)
        ? alias
        : Object.entries(alias ?? {}).map(([find, replacement]) => ({ find, replacement }));
    return (specifier) => {
        for (const { find, replacement } of entries) {
            if (find instanceof RegExp) {
                if (find.test(specifier)) return path.resolve(rootDir, specifier.replace(find, replacement));
            } else if (specifier === find || specifier.startsWith(`${find}/`)) {
                return path.resolve(rootDir, replacement + specifier.slice(find.length));
            }
        }
        return null;
    };
}

/**
 * The dependencies a mapping leaves on `dist`: unmapped, or mapped somewhere in
 * the dependency's own directory other than `src`. A mapping to a file outside
 * the dependency (a mock in the testing package's own tree, as studio maps
 * `@rebasepro/ui`) is a deliberate stand-in, not a build, and passes.
 */
export function unmapped(dependencies, mapping) {
    const inside = (file, dir) => file === dir || file.startsWith(`${dir}${path.sep}`);
    return dependencies
        .filter(([name, src]) => {
            const target = mapping(name);
            if (target === null) return true;
            return inside(target, path.dirname(src)) && !inside(target, src);
        })
        .map(([name]) => name);
}

async function loadVitestAlias(config) {
    const mod = await import(pathToFileURL(config).href);
    let resolved = mod.default;
    if (typeof resolved === "function") resolved = await resolved({ command: "serve", mode: "test" });
    resolved = await resolved;
    return resolved?.resolve?.alias;
}

async function main() {
    const packagesDir = path.join(ROOT, "packages");
    const failures = [];
    let checked = 0;

    for (const entry of fs.readdirSync(packagesDir).sort()) {
        const dir = path.join(packagesDir, entry);
        const manifestPath = path.join(dir, "package.json");
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const dependencies = sourceDependencies(manifest, packagesDir);
        if (dependencies.length === 0) continue;

        for (const runner of runnersOf(manifest, dir)) {
            let mapping;
            if (runner.runner === "jest") {
                const config = runner.config
                    ? require(runner.config)
                    : manifest.jest ?? {};
                mapping = jestMapping(config.moduleNameMapper, dir);
            } else {
                const alias = runner.config ? await loadVitestAlias(runner.config) : undefined;
                mapping = vitestMapping(alias, dir);
            }
            checked += 1;
            const missing = unmapped(dependencies, mapping);
            if (missing.length > 0) failures.push(`packages/${entry}: ${runner.label}\n      leaves on dist: ${missing.join(", ")}`);
        }
    }

    if (checked === 0) {
        console.error("✗ check:test-resolution found no test runner to check — the discovery is broken.");
        process.exit(1);
    }
    if (failures.length > 0) {
        console.error(`✗ ${failures.length} test runner config(s) import workspace packages from dist, not source:\n`);
        for (const failure of failures) console.error(`  · ${failure}`);
        console.error(`
  A test that imports a package through its dist tests the last build, not the
  code on disk. Map each one to its src: jest
    "^@rebasepro/([a-z0-9-]+)$": "<rootDir>/../$1/src/index.ts"
  vitest: see workspaceSourceAliases() in packages/cli/vitest.config.ts.`);
        process.exit(1);
    }
    console.log(`✓ ${checked} test runner config(s): every workspace dependency resolves to its source.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    await main();
}
