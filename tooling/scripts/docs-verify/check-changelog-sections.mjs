/**
 * `## [Unreleased]` has one section per heading, in a fixed order.
 *
 * Sixteen merges each appended their own subsection instead of merging into the
 * one already there, and the section ended up with four `### Added`, three
 * `### Fixed` and two `### Documentation` across 869 lines. A reader asking
 * "what was added" had four places to look and no way to know there were four —
 * and the release script cuts this section into a version block unchanged, so
 * the shape would have shipped.
 *
 * Scoped to `## [Unreleased]` on purpose. A released block is a record of what
 * was published; two of them carry the same duplication and reordering them
 * rewrites history to fix a formatting problem nobody is reading any more. This
 * keeps the one section that is still being edited clean, which is where the
 * duplication comes from.
 *
 * Run: node tooling/scripts/docs-verify/check-changelog-sections.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");
const CHANGELOG = "CHANGELOG.md";

const GREEN = "[0;32m";
const RED = "[0;31m";
const DIM = "[2m";
const NC = "[0m";

/**
 * The order sections are written in.
 *
 * Keep a Changelog's five, plus the two this project adds. `Breaking` leads
 * because it is the only thing an upgrading reader has to act on;
 * `Documentation` trails because it is the only one that changes no behaviour.
 */
export const SECTION_ORDER = [
    "Breaking", "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security", "Documentation"
];

/**
 * @param {string} root
 * @returns {{ findings: Array<{ file: string, line: number, message: string }>, sections: string[] }}
 */
export function checkChangelogSections(root = DEFAULT_ROOT) {
    const lines = readFileSync(path.join(root, CHANGELOG), "utf8").split("\n");
    const start = lines.findIndex(l => l.startsWith("## [Unreleased]"));
    const findings = [];
    if (start === -1) return { findings, sections: [] };
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].startsWith("## [")) { end = i; break; }
    }

    /** @type {Array<{ name: string, line: number }>} */
    const headings = [];
    let inFence = false;
    for (let i = start + 1; i < end; i++) {
        if (/^\s*(?:`{3,}|~{3,})/.test(lines[i])) { inFence = !inFence; continue; }
        if (inFence) continue;
        const m = lines[i].match(/^### (.+?)\s*$/);
        if (m) headings.push({ name: m[1], line: i + 1 });
    }

    const seen = new Map();
    for (const { name, line } of headings) {
        if (seen.has(name)) {
            findings.push({
                file: CHANGELOG,
                line,
                message:
                    `a second \`### ${name}\` under ## [Unreleased] (the first is line ${seen.get(name)}) — ` +
                    "merge them. A reader looking for what changed should have one place to look, " +
                    "and the release cuts this section into a version block unchanged."
            });
            continue;
        }
        seen.set(name, line);
        if (!SECTION_ORDER.includes(name)) {
            findings.push({
                file: CHANGELOG,
                line,
                message:
                    `\`### ${name}\` is not one of the sections this changelog uses. ` +
                    `Known: ${SECTION_ORDER.join(", ")}.`
            });
        }
    }

    const written = headings.map(h => h.name).filter(n => SECTION_ORDER.includes(n));
    const canonical = [...new Set(written)].sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b));
    const asWritten = [...new Set(written)];
    if (asWritten.join("|") !== canonical.join("|")) {
        findings.push({
            file: CHANGELOG,
            line: start + 1,
            message:
                `sections are in the order ${asWritten.join(", ")}; the order is ` +
                `${canonical.join(", ")}. Breaking leads because it is the only thing an upgrading ` +
                "reader has to act on."
        });
    }

    return { findings, sections: asWritten };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { findings, sections } = checkChangelogSections();
    console.log(`${DIM}## [Unreleased]: ${sections.join(", ") || "(no sections)"}.${NC}`);
    if (findings.length === 0) {
        console.log(`${GREEN}✓ One section per heading, in order.${NC}`);
        process.exit(0);
    }
    console.error(`${RED}✗ ${findings.length} finding(s):${NC}`);
    for (const f of findings) console.error(`  ${RED}${f.file}:${f.line}${NC}\n      ${DIM}${f.message}${NC}`);
    process.exit(1);
}
