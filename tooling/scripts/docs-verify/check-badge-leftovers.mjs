/**
 * Punctuation a removed badge left behind, in every locale.
 *
 * A release strips the Since badges that name it (`release-docs.mjs`), and a
 * badge set off by punctuation used to leave its punctuation: 0.25.0's cut
 * wrote "at every door that takes a session (; on 0.24 the data API …)" on
 * errors.md and five other pages, in all six locales, and every gate passed —
 * nothing reads prose for a parenthesis that opens on a separator.
 *
 * Flags, outside code: a parenthesis opened by `;`, `,` or `:`, and one closed
 * right after a `;` or `,`. Neither is a shape anyone writes on purpose.
 *
 * Run: node tooling/scripts/docs-verify/check-badge-leftovers.mjs
 */

import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");

const GLOBS = ["website/src/content/docs/**/*.md", "website/src/content/docs/**/*.mdx", "docs/*.md"];

/** The shapes a removed badge leaves: `(; `, `(, `, `(: ` and `, )` / `; )`. */
const LEFTOVER = /\((?:[;,:])\s|[;,]\s*\)/;

/**
 * A line with each inline code span replaced by a letter, so `fn(a, )` in code
 * is not prose and "(`a`, `b`)" reads as "(x, x)", not "( , )".
 */
function prose(line) {
    return line.replace(/`+[^`]*`+/g, "x");
}

export function checkBadgeLeftovers(root = DEFAULT_ROOT) {
    const findings = [];
    const files = new Set();
    for (const glob of GLOBS) {
        for (const f of globSync(glob, { cwd: root })) {
            if (!f.includes("node_modules") && !/\/CHANGELOG\.md$/.test(f)) files.add(f);
        }
    }
    for (const rel of [...files].sort()) {
        const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
        let inFence = false;
        lines.forEach((line, i) => {
            if (/^\s*(?:`{3,}|~{3,})/.test(line)) { inFence = !inFence; return; }
            if (inFence) return;
            const text = prose(line);
            const at = text.search(LEFTOVER);
            if (at !== -1) {
                findings.push({ file: rel, line: i + 1, text: text.slice(Math.max(0, at - 40), at + 40).trim() });
            }
        });
    }
    return { findings, scanned: files.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { findings, scanned } = checkBadgeLeftovers();
    if (!findings.length) {
        console.log(`✓ No badge leftovers in ${scanned} page(s).`);
    } else {
        console.error(`✗ ${findings.length} parenthesis(es) opened or closed on a separator:`);
        for (const f of findings) console.error(`  ${f.file}:${f.line}  …${f.text}…`);
        process.exit(1);
    }
}
