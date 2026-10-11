#!/usr/bin/env node
/**
 * First-party clients call an admin surface by its canonical path, never by
 * the legacy alias the server keeps for older callers.
 *
 * The server mounts each admin surface that moved under `/api/admin` twice,
 * through `mountWithLegacyAlias`: the canonical path, and the old one, which
 * answers with `Deprecation` headers and is removed at the next major. The
 * shipped panel kept calling three of the old ones — the collection editor
 * `/api/schema-editor`, the Logs Explorer `/api/logs`, the client SDK's cron
 * API `/api/cron` — so every page load drew deprecation headers, and removing
 * the aliases as documented would have broken the panel that shipped with them.
 *
 * The legacy paths are read from the server's `legacy:` entries, so a surface
 * moved later is covered without editing this script. A source string calls
 * one when the path follows an interpolation (`${apiBase}/logs?…`) or is a
 * whole literal (`"/cron"`) that is not the tail of a concatenation.
 *
 *     pnpm check:legacy-api-paths
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The packages whose code runs as a client of the server: the panel and the SDK. */
const CLIENT_PACKAGES = ["app", "cms", "studio", "client", "common", "ui", "cms-types", "types"];

const SOURCE = /\.(ts|tsx|mts|js|jsx)$/;
const TEST = /(\.test\.|\.spec\.|\/test\/|\/__tests__\/|\/__mocks__\/)/;

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (SOURCE.test(entry.name)) out.push(full);
    }
    return out;
}

/** Every `legacy: \`${basePath}/<path>\`` the server mounts, as `/<path>`. */
function legacyPaths() {
    const found = new Set();
    for (const file of walk(path.join(ROOT, "packages/server/src"))) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(/legacy:\s*`\$\{basePath\}(\/[A-Za-z0-9/_-]+)`/g)) {
            found.add(match[1]);
        }
    }
    return [...found];
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const legacy = legacyPaths();
if (legacy.length === 0) {
    console.error("✗ legacy API paths: found no `legacy:` entry in packages/server/src — the pattern this gate reads has changed.");
    process.exit(1);
}

const problems = [];
for (const pkg of CLIENT_PACKAGES) {
    for (const file of walk(path.join(ROOT, "packages", pkg, "src"))) {
        const relative = path.relative(ROOT, file);
        if (TEST.test(relative)) continue;
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
            for (const legacyPath of legacy) {
                const p = escape(legacyPath);
                const afterInterpolation = new RegExp(`\\}${p}(?=[/?\`"'])`);
                const wholeLiteral = new RegExp(`(?<!\\+\\s*)(["'\`])${p}\\1`);
                if (afterInterpolation.test(line) || wholeLiteral.test(line)) {
                    problems.push(`${relative}:${index + 1}: calls the legacy alias ${legacyPath} — use /admin${legacyPath}\n    ${trimmed}`);
                }
            }
        });
    }
}

if (problems.length > 0) {
    console.error(`✗ legacy API paths: ${problems.length} first-party call(s) to a deprecated alias:\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}
console.log(`✓ legacy API paths: no first-party call to ${legacy.join(", ")}.`);
