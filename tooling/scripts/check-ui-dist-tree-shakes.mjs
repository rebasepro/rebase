#!/usr/bin/env node
/**
 * That the published `@rebasepro/ui` tree-shakes: an app importing one helper
 * from it gets that helper, not the kit.
 *
 * It did not. The kit was built to a single `dist/index.es.js`, and inside one
 * module a bundler may only drop statements it can prove pure. The kit's top
 * level is about a hundred un-annotated `React.memo(...)` / `forwardRef(...)`
 * calls plus a few module-scope objects, none provably pure, so all of it
 * stayed: `import { cls } from "@rebasepro/ui"` cost 925 kB minified (277 kB
 * gzipped), the same as `import { Button }`. `sideEffects` in package.json
 * could not help — it lets a bundler skip whole modules, and there was one.
 *
 * The build now emits one file per source module (`preserveModules` in
 * packages/ui/vite.config.ts). This bundles a few one-import probes against
 * the built `dist` the way a consumer's Vite would — minified, React external,
 * the package's own `sideEffects` in force — and fails if any comes out over
 * budget. The budget is loose on purpose: the failure it exists for is an
 * order of magnitude, not a few kB.
 *
 * It also checks that the entry is still a React Server Components client
 * boundary. The single file inherited `"use client"` from any module that had
 * it, so every export was a client reference; per-module files carry only
 * their own, and `src/index.ts` says it for the whole kit.
 *
 *     node ../../tooling/scripts/check-ui-dist-tree-shakes.mjs     # from packages/ui, after `vite build`
 *     node tooling/scripts/check-ui-dist-tree-shakes.mjs --dist <dir>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI = path.join(ROOT, "packages", "ui");

const argv = process.argv.slice(2);
const distFlag = argv.indexOf("--dist");
const DIST = distFlag >= 0 ? path.resolve(argv[distFlag + 1]) : path.join(UI, "dist");
const ENTRY = path.join(DIST, "index.es.js");

/** Minified bytes one named import may cost. `cls` is ~27 kB, `Button` ~31 kB; the whole kit is ~900. */
const BUDGET = 60 * 1024;
const PROBES = ["cls", "Button", "Typography"];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const kB = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

if (!fs.existsSync(ENTRY)) {
    console.error(red(`✖ ${path.relative(ROOT, ENTRY)} does not exist. Build packages/ui first.`));
    process.exit(1);
}

const failures = [];

const head = fs.readFileSync(ENTRY, "utf8").trimStart();
if (!/^["']use client["'];?/.test(head)) {
    failures.push(`${path.relative(ROOT, ENTRY)} does not start with "use client". The published kit has always been ` +
        `one client boundary for React Server Components; keep the directive at the top of packages/ui/src/index.ts.`);
}

// The Vite this package builds with, so the probe tree-shakes the way its consumers' builds do.
const requireFromUi = createRequire(path.join(UI, "package.json"));
const vite = await import(pathToFileURL(requireFromUi.resolve("vite")).href);

const PROBE_ID = "rebase-ui-tree-shake-probe";

async function bundledBytes(name) {
    const result = await vite.build({
        configFile: false,
        logLevel: "silent",
        root: DIST,
        cacheDir: path.join(os.tmpdir(), "rebase-ui-tree-shake-probe"),
        plugins: [{
            name: PROBE_ID,
            resolveId: (id) => (id === PROBE_ID ? `\0${PROBE_ID}` : null),
            load: (id) => (id === `\0${PROBE_ID}`
                ? `import { ${name} } from ${JSON.stringify(ENTRY)};\n// A side effect, so an app build (which drops entry exports) keeps the import.\nglobalThis.__rebaseUiProbe = ${name};\n`
                : null)
        }],
        build: {
            write: false,
            minify: true,
            target: "es2022",
            modulePreload: false,
            reportCompressedSize: false,
            rollupOptions: {
                input: PROBE_ID,
                external: [/^react($|\/)/, /^react-dom($|\/)/]
            }
        }
    });
    const chunks = (Array.isArray(result) ? result : [result])
        .flatMap((r) => r.output)
        .filter((o) => o.type === "chunk");
    const byName = new Map(chunks.map((c) => [c.fileName, c]));
    // The entry and what it imports statically; a lazy chunk is not this import's cost.
    const seen = new Set();
    const queue = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
    let bytes = 0;
    while (queue.length > 0) {
        const fileName = queue.shift();
        if (seen.has(fileName)) continue;
        seen.add(fileName);
        const chunk = byName.get(fileName);
        if (!chunk) continue;
        bytes += Buffer.byteLength(chunk.code);
        queue.push(...chunk.imports);
    }
    return bytes;
}

for (const name of PROBES) {
    const bytes = await bundledBytes(name);
    const line = `import { ${name} } from "@rebasepro/ui" → ${kB(bytes)} (budget ${kB(BUDGET)})`;
    if (bytes > BUDGET) {
        failures.push(`${line}. The dist no longer tree-shakes: check that packages/ui/vite.config.ts still ` +
            `builds with \`preserveModules\`, and that package.json \`sideEffects\` lists only the CSS.`);
    } else {
        console.log(green(`✓ ${line}`));
    }
}

if (failures.length > 0) {
    console.error(red(`\n✖ @rebasepro/ui dist\n`));
    for (const failure of failures) console.error(`   ${red("·")} ${failure}\n`);
    process.exit(1);
}
