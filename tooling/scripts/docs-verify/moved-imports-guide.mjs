#!/usr/bin/env node
/**
 * The upgrade guide's "Imports that moved" list, written from the move table.
 *
 * `tooling/scripts/headless-guard/moved-symbols.json` is the one record of
 * every export 0.31 moved to another package or removed (`{ symbol, from, to,
 * as?, instead? }`, `to: null` = removed). The codemod reads it (through
 * `packages/cli/src/codemod/collections-to-tables/moved-symbols.generated.ts`)
 * to rewrite a project's imports, so the guide must list exactly what the
 * codemod rewrites — a hand-kept list drifts the first time a slice moves one
 * more name. This writes the block between the two markers in the 0.30 → 0.31
 * guide; `--check` exits 1 when the block is not what the table says.
 *
 *   node tooling/scripts/docs-verify/moved-imports-guide.mjs           # rewrite the block
 *   node tooling/scripts/docs-verify/moved-imports-guide.mjs --check   # fail when stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TABLE = path.join(ROOT, "tooling/scripts/headless-guard/moved-symbols.json");
const GUIDE = path.join(ROOT, "website/src/content/docs/docs/upgrading/0-30-to-0-31.mdx");
const START = "{/* moved-imports:start — written by tooling/scripts/docs-verify/moved-imports-guide.mjs from moved-symbols.json; do not edit by hand */}";
const END = "{/* moved-imports:end */}";

/** @typedef {{ symbol: string, from: string, to: string | null, as?: string, instead?: string }} Move */

/** @param {string} text */
const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/**
 * The markdown block for a list of moves.
 *
 * @param {Move[]} moves
 * @returns {string}
 */
export function renderMovedImports(moves) {
    /** @type {Map<string, Move[]>} */
    const moved = new Map();
    /** @type {Move[]} */
    const removed = [];
    for (const move of moves) {
        if (move.to === null) {
            removed.push(move);
            continue;
        }
        const key = `${move.from}\u0000${move.to}`;
        if (!moved.has(key)) moved.set(key, []);
        moved.get(key).push(move);
    }
    const byName = (a, b) => a.symbol.localeCompare(b.symbol);
    const lines = [];
    const groups = [...moved.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, group] of groups) {
        const [from, to] = key.split("\u0000");
        group.sort(byName);
        lines.push(`**From \`${from}\` to \`${to}\`** (${group.length}):`);
        lines.push("");
        lines.push(group.map((m) => (m.as ? `\`${m.symbol}\` → \`${m.as}\`` : `\`${m.symbol}\``)).join(", ") + ".");
        lines.push("");
    }
    if (removed.length > 0) {
        removed.sort((a, b) => a.from.localeCompare(b.from) || byName(a, b));
        lines.push(`**Removed, with no successor in another package** (${removed.length}) — the codemod lists each import as a numbered manual step:`);
        lines.push("");
        lines.push("| Name | Was exported by | Write instead |");
        lines.push("|---|---|---|");
        for (const m of removed) lines.push(`| \`${m.symbol}\` | \`${m.from}\` | ${cell(m.instead ?? "—")} |`);
        lines.push("");
    }
    return lines.join("\n").trimEnd();
}

function main() {
    const check = process.argv.includes("--check");
    const { moves } = JSON.parse(readFileSync(TABLE, "utf8"));
    const guide = readFileSync(GUIDE, "utf8");
    const start = guide.indexOf(START);
    const end = guide.indexOf(END);
    if (start < 0 || end < start) {
        console.error(`${path.relative(ROOT, GUIDE)} has no moved-imports markers:\n  ${START}\n  ${END}`);
        process.exit(1);
    }
    const next = `${guide.slice(0, start + START.length)}\n\n${renderMovedImports(moves)}\n\n${guide.slice(end)}`;
    if (next === guide) {
        console.log(`✓ The moved-imports list in ${path.relative(ROOT, GUIDE)} matches moved-symbols.json (${moves.length} entries).`);
        return;
    }
    if (check) {
        console.error(`✗ The moved-imports list in ${path.relative(ROOT, GUIDE)} is stale: run node tooling/scripts/docs-verify/moved-imports-guide.mjs`);
        process.exit(1);
    }
    writeFileSync(GUIDE, next);
    console.log(`Wrote ${moves.length} entries into ${path.relative(ROOT, GUIDE)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
