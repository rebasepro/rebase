#!/usr/bin/env node
/**
 * A budget for the JavaScript a browser must download before the admin can
 * paint anything.
 *
 * ## Why the eager set and not the dist
 *
 * `du -s dist` is the wrong number: the admin is heavily route-split, and most
 * of what it ships — the SQL editor, the schema visualiser, the rich-text
 * editor, 76 date-fns locales — is fetched only when someone opens the thing
 * that needs it. A total-size budget punishes lazy loading, which is the fix,
 * and it would have said nothing about the defect this gate exists for.
 *
 * The number that matters is the *eager set*: the entry chunk plus every chunk
 * reachable from it by a static import, which is exactly what Vite writes into
 * `index.html` as `<script type="module">` and `<link rel="modulepreload">`.
 * That set is downloaded on the login screen, before anyone has authenticated.
 *
 * It is computed twice — once from `index.html`, once by walking the static
 * `import ... from "./chunk.js"` edges out of the entry — and the union is
 * used. Two sources because either alone can lie: a bundler that stops emitting
 * preload links would silently empty the first, and an import Rollup rewrote
 * into a form this does not match would silently shrink the second. The union
 * can only over-report, which fails loudly instead of passing quietly.
 *
 * ## What it caught
 *
 * All of it, at once, in one build of a scaffolded project:
 *
 *   * `exceljs` (940 kB) — `data_import/utils/file_to_json.ts` had a top-level
 *     `import ExcelJS from "exceljs"`, and the package barrel re-exports
 *     `./data_import`, so the `lazy()` on the import/export actions bought
 *     nothing. It came back a second time through a `manualChunks` accident:
 *     `@rollup/plugin-commonjs`'s shared `require` shim is a virtual module
 *     matching no chunk rule, Rollup parked it in `vendor-exceljs`, and the
 *     entry imported that chunk to get a ten-line helper.
 *   * `lucide-react` (822 kB) — `@rebasepro/ui` re-exported lucide's whole
 *     `icons` map, which holds a reference to every icon in the library and so
 *     cannot be tree-shaken at all.
 *   * `date-fns` (641 kB) — `import * as locales from "date-fns/locale"`, to
 *     use the one locale a deployment has configured.
 *
 * Every one of those is a two-line change away from returning, and none of them
 * breaks a test or a type check when it does.
 *
 * ## Failure modes it reports
 *
 *   1. A chunk in the eager set grew past its budget — named, with the delta.
 *   2. A chunk that was not eager became eager — the exceljs case, and the one
 *      a total-bytes budget alone would miss when something else shrank.
 *   3. The whole eager set grew past its budget, even if no single chunk did.
 *   4. It shrank a lot, which means the baseline now describes a build that no
 *      longer exists. Bank it: a stale budget is a gate that has stopped
 *      measuring anything.
 *
 * Chunk file names carry a content hash, which changes on every build. Budgets
 * are keyed on the name with the hash stripped, so an unrelated edit does not
 * churn the baseline.
 *
 *     pnpm check:bundle            # verify
 *     pnpm check:bundle --update   # bank the current measurement
 *     node scripts/check-bundle-budget.mjs --dist path/to/dist   # ad-hoc
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "scripts", "bundle-budget.json");

/** How far a chunk may grow before this fails. Covers ordinary churn. */
const HEADROOM = 0.05;
/** How far it may shrink before the baseline is considered stale. */
const STALE_BELOW = 0.15;

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const argv = process.argv.slice(2);
const update = argv.includes("--update") || argv.includes("--write");
const distFlag = argv.indexOf("--dist");
const adHocDist = distFlag >= 0 ? argv[distFlag + 1] : undefined;

const kB = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;

/**
 * Strip Vite's content hash: `rebase-admin-DTJBWfJW.js` -> `rebase-admin`.
 *
 * The hash is base64url of a fixed width, so it is matched by shape rather than
 * by a list of known chunk names — a new chunk must be keyed the same way as an
 * old one or the baseline would report it as both added and removed forever.
 */
export function chunkKey(fileName) {
    return path.basename(fileName, ".js").replace(/-[A-Za-z0-9_-]{8,10}$/, "");
}

/** Every `.js` a browser fetches before it can render the first screen. */
export function eagerChunks(distDir) {
    const htmlPath = path.join(distDir, "index.html");
    if (!fs.existsSync(htmlPath)) {
        throw new Error(`No index.html in ${distDir}. Build the app first (pnpm run build).`);
    }
    const html = fs.readFileSync(htmlPath, "utf-8");

    const found = new Set();
    const entries = [];

    // Local assets only. A <script src="https://..."> is somebody else's bytes
    // and not something this repository can hold to a budget.
    const local = (href) => href.startsWith("/") || href.startsWith("./") || !/^[a-z]+:/i.test(href);

    for (const [, href] of html.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"/g)) {
        if (local(href)) { found.add(href); entries.push(href); }
    }
    for (const [, href] of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*\bhref="([^"]+\.js)"/g)) {
        if (local(href)) found.add(href);
    }

    // Second source: walk the static import graph out of the entry scripts.
    const toFile = (href) => path.join(distDir, href.replace(/^\/+/, ""));
    const queue = [...entries];
    const walked = new Set();
    while (queue.length > 0) {
        const href = queue.shift();
        if (walked.has(href)) continue;
        walked.add(href);
        const file = toFile(href);
        if (!fs.existsSync(file)) continue;
        const code = fs.readFileSync(file, "utf-8");
        // `from "./chunk.js"` and bare `import "./chunk.js"`. Deliberately NOT
        // `import("./chunk.js")` — a dynamic import is the thing we want.
        for (const [, spec] of code.matchAll(/(?:\bfrom|^\s*import)\s*"(\.\/[^"]+\.js)"/gm)) {
            const resolved = path.posix.join(path.posix.dirname(href), spec.replace(/^\.\//, ""));
            const normalized = resolved.startsWith("/") ? resolved : `/${resolved}`;
            if (!found.has(normalized) && !found.has(resolved)) found.add(normalized);
            queue.push(normalized);
        }
    }

    const chunks = [];
    for (const href of found) {
        const file = toFile(href);
        if (!fs.existsSync(file)) continue;
        const raw = fs.readFileSync(file);
        chunks.push({
            key: chunkKey(file),
            bytes: raw.length,
            gzipBytes: zlib.gzipSync(raw, { level: 9 }).length
        });
    }
    chunks.sort((a, b) => b.bytes - a.bytes);
    return chunks;
}

function measure(distDir) {
    const chunks = eagerChunks(distDir);
    const byKey = {};
    for (const chunk of chunks) {
        // Two eager chunks sharing a key would be a bundler change, not a
        // normal state; summing keeps the total honest either way.
        byKey[chunk.key] = (byKey[chunk.key] ?? 0) + chunk.bytes;
    }
    return {
        chunks: byKey,
        totalBytes: chunks.reduce((sum, c) => sum + c.bytes, 0),
        totalGzipBytes: chunks.reduce((sum, c) => sum + c.gzipBytes, 0)
    };
}

function report(target, measured, budget) {
    const failures = [];
    const notes = [];

    const budgetFor = (bytes) => Math.round(bytes * (1 + HEADROOM));

    for (const [key, bytes] of Object.entries(measured.chunks)) {
        const baseline = budget.chunks[key];
        if (baseline === undefined) {
            failures.push(
                `${bold(key)} is eagerly loaded and was not before (${kB(bytes)}).\n` +
                `      A chunk joins this set the moment one module in it is statically reachable —\n` +
                `      check for a new top-level import, or a manualChunks name that welded a lazy\n` +
                `      library to a static one. If it belongs here, bank it: pnpm check:bundle --update`
            );
            continue;
        }
        if (bytes > budgetFor(baseline)) {
            const growth = ((bytes / baseline - 1) * 100).toFixed(1);
            failures.push(
                `${bold(key)} grew to ${kB(bytes)}, budget ${kB(budgetFor(baseline))} ` +
                `(baseline ${kB(baseline)}, +${growth}%).`
            );
        } else if (bytes < baseline * (1 - STALE_BELOW)) {
            notes.push(`${key} shrank to ${kB(bytes)} from ${kB(baseline)}.`);
        }
    }

    for (const key of Object.keys(budget.chunks)) {
        if (!(key in measured.chunks)) {
            notes.push(`${key} is no longer eagerly loaded.`);
        }
    }

    if (measured.totalBytes > budgetFor(budget.totalBytes)) {
        failures.push(
            `the eager set totals ${kB(measured.totalBytes)}, budget ${kB(budgetFor(budget.totalBytes))} ` +
            `(baseline ${kB(budget.totalBytes)}).`
        );
    }
    if (measured.totalGzipBytes > budgetFor(budget.totalGzipBytes)) {
        failures.push(
            `the eager set totals ${kB(measured.totalGzipBytes)} gzipped, ` +
            `budget ${kB(budgetFor(budget.totalGzipBytes))} (baseline ${kB(budget.totalGzipBytes)}).`
        );
    }

    if (notes.length > 0 && failures.length === 0) {
        failures.push(
            `the eager set is smaller than the budget describes, so the budget has stopped measuring\n` +
            `      anything. Bank it — ${dim("pnpm check:bundle --update")} — and keep the win:\n` +
            notes.map(n => `        · ${n}`).join("\n")
        );
    }

    if (failures.length > 0) {
        console.error(red(`\n✖ ${target}: eager JavaScript budget\n`));
        for (const failure of failures) console.error(`   ${red("·")} ${failure}\n`);
        return false;
    }

    console.log(green(`✓ ${target}: ${kB(measured.totalBytes)} eager JS ` +
        `(${kB(measured.totalGzipBytes)} gzipped) across ${Object.keys(measured.chunks).length} chunks`));
    return true;
}

// ── run ───────────────────────────────────────────────────────────────────────

if (adHocDist) {
    const measured = measure(path.resolve(ROOT, adHocDist));
    console.log(JSON.stringify(measured, null, 4));
    process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf-8"));
const targets = Object.keys(baseline.targets);

if (update) {
    for (const target of targets) {
        const dist = path.join(ROOT, target);
        if (!fs.existsSync(dist)) {
            console.error(red(`✖ ${target} is not built. Run pnpm run build first.`));
            process.exit(1);
        }
        baseline.targets[target] = measure(dist);
        const t = baseline.targets[target];
        console.log(green(`banked ${target}: ${kB(t.totalBytes)} eager JS (${kB(t.totalGzipBytes)} gzipped)`));
    }
    fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 4)}\n`);
    process.exit(0);
}

let ok = true;
for (const target of targets) {
    const dist = path.join(ROOT, target);
    if (!fs.existsSync(dist)) {
        console.error(red(`✖ ${target} is not built — this gate runs after the build. Run pnpm run build.`));
        ok = false;
        continue;
    }
    ok = report(target, measure(dist), baseline.targets[target]) && ok;
}

if (!ok) {
    console.error(yellow(
        "\n  The eager set is everything a browser downloads before the login screen paints.\n" +
        "  If the growth is deliberate, bank it with `pnpm check:bundle --update` and say so in\n" +
        "  the commit. If it is not, the usual causes are a top-level import of something that\n" +
        "  should be `await import(...)`, a barrel re-export that reaches one, or a manualChunks\n" +
        "  entry naming a chunk that mixes static and lazy modules.\n"
    ));
    process.exit(1);
}
