#!/usr/bin/env node
/**
 * Fit a release's notes under GitHub's limit on a release body.
 *
 * GitHub refuses a release whose body is over 125,000 characters, and the
 * stable job creates the release last, after npm, the tag, the image and the
 * chart. So 0.25.0, whose CHANGELOG section ran to 174,000 characters, was
 * published everywhere and then failed on `body is too long`, with no GitHub
 * release at all.
 *
 * Notes under the limit are left exactly as they are. Notes over it keep whole
 * `### ` sections, the ones a reader has to act on first (Breaking, Security,
 * Deprecated, then Added and Changed, Fixed, Documentation), as many as fit,
 * and end by naming what was left out and linking the CHANGELOG at the tag,
 * where every section is in full.
 *
 * Run: node tooling/scripts/fit-release-notes.mjs <notes-file> <version> [changelog]
 * The notes file is rewritten in place.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Under GitHub's 125,000, with room for the link lines. */
export const RELEASE_BODY_LIMIT = 120_000;

/** The order sections are kept in when not all of them fit. */
export const SECTION_PRIORITY = ["Breaking", "Security", "Deprecated", "Added", "Changed", "Removed", "Fixed", "Documentation"];

const REPOSITORY_URL = "https://github.com/rebasepro/rebase";

/** GitHub's anchor for a Markdown heading: `## [0.25.0] - 2026-10-14` → `0250---2026-10-14`. */
export function headingAnchor(heading) {
    return heading
        .replace(/^#+\s*/, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .replace(/ /g, "-");
}

/**
 * @param {string} notes the version's section, without its `## ` heading
 * @param {{ version: string, changelogUrl: string, limit?: number }} options
 * @returns {string} the notes, unchanged when they fit
 */
export function fitReleaseNotes(notes, { version, changelogUrl, limit = RELEASE_BODY_LIMIT }) {
    if (notes.length <= limit) return notes;

    const firstSection = notes.search(/^### /m);
    const preamble = firstSection > 0 ? notes.slice(0, firstSection).trim() : "";
    const sections = (firstSection === -1 ? "" : notes.slice(firstSection))
        .split(/\n(?=### )/)
        .map(text => ({ title: text.split("\n", 1)[0].replace(/^###\s*/, "").trim(), text: text.trim() }))
        .filter(section => section.title.length > 0);

    const rank = title => {
        const at = SECTION_PRIORITY.indexOf(title);
        return at === -1 ? SECTION_PRIORITY.length : at;
    };
    const byPriority = [...sections].sort((a, b) => rank(a.title) - rank(b.title));

    const header = `The full notes for v${version} are in the [CHANGELOG](${changelogUrl}).`;
    const kept = [];
    const left = [];
    let used = header.length + (preamble ? preamble.length + 2 : 0) + 600;
    for (const section of byPriority) {
        if (left.length === 0 && used + section.text.length + 2 <= limit) {
            kept.push(section);
            used += section.text.length + 2;
        } else {
            left.push(section);
        }
    }

    const entries = section => (section.text.match(/^- /gm) ?? []).length;
    const footer = left.length === 0 ? "" :
        "### Not shown here\n\n" +
        left.map(section => `- ${section.title}: ${entries(section)} entr${entries(section) === 1 ? "y" : "ies"}`).join("\n") +
        `\n\nThey did not fit in a GitHub release; they are in the [CHANGELOG](${changelogUrl}).`;

    return [header, preamble, ...kept.map(section => section.text), footer].filter(Boolean).join("\n\n") + "\n";
}

/** The CHANGELOG URL at this version's tag, anchored at its heading when it is found. */
export function changelogUrlFor(version, changelogText) {
    const heading = changelogText.split("\n").find(line =>
        line.startsWith("## ") && (line.includes(`[${version}]`) || new RegExp(`^## ${version.replace(/\./g, "\\.")}(?:[ \\t-]|$)`).test(line)));
    const base = `${REPOSITORY_URL}/blob/v${version}/CHANGELOG.md`;
    return heading ? `${base}#${headingAnchor(heading)}` : base;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [notesFile, version, changelog = "CHANGELOG.md"] = process.argv.slice(2);
    if (!notesFile || !version) {
        console.error("Usage: fit-release-notes.mjs <notes-file> <version> [changelog]");
        process.exit(1);
    }
    const notes = readFileSync(notesFile, "utf8");
    const fitted = fitReleaseNotes(notes, { version, changelogUrl: changelogUrlFor(version, readFileSync(changelog, "utf8")) });
    if (fitted !== notes) {
        writeFileSync(notesFile, fitted);
        console.log(`📝 Release notes were ${notes.length} characters; trimmed to ${fitted.length} with a link to the CHANGELOG.`);
    }
}
