/**
 * A note about how an older release behaves, left in the docs after a newer
 * one shipped.
 *
 * The website publishes from `main`, so a change is documented before it is
 * released, with a Since badge on the new behaviour and, beside it, what the
 * installed release does instead: "(on 0.24 the data API answers
 * `UNAUTHORIZED`)". The release strips the badge (`release-docs.mjs`) and
 * nothing removed the note, so every release left more of them: on
 * 2026-11-09, with 0.29.1 out, 119 English lines on 44 pages still said what
 * 0.17 to 0.25 did, and one page opened on "On 0.24 `CollectionPanel` takes
 * only a registered `path`…" before saying what the page was about.
 *
 * A note about version N is right while N is the latest release — it is what
 * a reader on the installed version sees — and wrong from the next one. So
 * this flags, in the English docs outside code, "On 0.N" and a clause opening
 * with "on 0.N" (after "(", ";", ",", "—" or "–") where 0.N is older than the
 * latest release in CHANGELOG.md. It leaves a statement about something an old
 * version made, which stays true ("a project scaffolded on 0.24", "entries
 * recorded before 0.25"), and the changelog and upgrading guides, whose job is
 * old versions. The translations follow the English page through the
 * translation-freshness check.
 *
 * When a release makes notes stale, delete them from the English page and its
 * translations, and re-stamp the translations.
 *
 * Run: node tooling/scripts/docs-verify/check-stale-version-notes.mjs
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");

const GLOBS = ["website/src/content/docs/docs/**/*.md", "website/src/content/docs/docs/**/*.mdx", "docs/*.md"];

/** Pages whose subject is old versions. */
const EXEMPT = [/\/CHANGELOG\.md$/, /\/upgrading\//];

/**
 * "On 0.24" anywhere, or "on 0.24" opening a clause. The version is captured;
 * a word right before a lowercase "on" ("scaffolded on 0.24") is not a clause
 * opener, so it does not match.
 */
const NOTE = /(?:(?:^|[^\w])On|(?:^|[(;,—–]\s*)on) 0\.(\d+)(?:\.\d+)?(?!\d)/g;

/** The latest released version's `[major, minor]`, from CHANGELOG.md's first released heading. */
export function latestRelease(root = DEFAULT_ROOT) {
    const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    const match = /^## \[(\d+)\.(\d+)\.\d+\]/m.exec(changelog);
    if (!match) throw new Error("CHANGELOG.md has no released version heading.");
    return [Number(match[1]), Number(match[2])];
}

/** A line with each inline code span replaced by a letter, so a version in code is not prose. */
function prose(line) {
    return line.replace(/`+[^`]*`+/g, "x");
}

/** The stale notes on one page's lines: each "on 0.N" whose 0.N is older than `latest`. */
export function staleNotes(lines, latest) {
    const found = [];
    let inFence = false;
    lines.forEach((line, i) => {
        if (/^\s*(?:`{3,}|~{3,})/.test(line)) { inFence = !inFence; return; }
        if (inFence) return;
        const text = prose(line);
        // A note the text wrapped ("…(on" here, "0.24) …" on the next line) is
        // read across the break; a match is this line's when it starts here.
        const next = lines[i + 1] && !/^\s*(?:`{3,}|~{3,})/.test(lines[i + 1]) ? prose(lines[i + 1]).trimStart().slice(0, 12) : "";
        for (const match of `${text} ${next}`.matchAll(NOTE)) {
            if ((match.index ?? 0) >= text.length) continue;
            const minor = Number(match[1]);
            // Every release so far is 0.x: a note's major is 0.
            if (latest[0] > 0 || minor < latest[1]) {
                const at = match.index ?? 0;
                found.push({ line: i + 1, version: `0.${minor}`, text: text.slice(Math.max(0, at - 30), at + 70).trim() });
            }
        }
    });
    return found;
}

export function checkStaleVersionNotes(root = DEFAULT_ROOT) {
    const latest = latestRelease(root);
    const files = new Set();
    for (const glob of GLOBS) {
        for (const f of globSync(glob, { cwd: root })) {
            if (!f.includes("node_modules") && !EXEMPT.some(re => re.test(`/${f}`))) files.add(f);
        }
    }
    const findings = [];
    for (const rel of [...files].sort()) {
        const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
        for (const note of staleNotes(lines, latest)) findings.push({ file: rel, ...note });
    }
    return { findings, scanned: files.size, latest: `${latest[0]}.${latest[1]}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { findings, scanned, latest } = checkStaleVersionNotes();
    if (!findings.length) {
        console.log(`✓ No note about a release older than ${latest} in ${scanned} page(s).`);
    } else {
        console.error(`✗ ${findings.length} note(s) about a release older than ${latest}:`);
        for (const f of findings) console.error(`  ${f.file}:${f.line}  …${f.text}…`);
        process.exit(1);
    }
}
