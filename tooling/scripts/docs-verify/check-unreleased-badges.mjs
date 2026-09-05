/**
 * Every unreleased feature the docs describe carries a "Since" badge.
 *
 * The website publishes from `main`. A feature merged this morning is on
 * rebase.pro this afternoon, months before the release that carries it — so a
 * reader on the installed version follows a page for `rebase status`, gets
 * "unknown command", and has no way to tell which half of the page applies to
 * them. Four of the six features this check now covers shipped their docs that
 * way, and the only signal was the CHANGELOG they were not reading.
 *
 * The two sources are the CHANGELOG's `## [Unreleased]` section and the English
 * docs, and the check is the diff between them:
 *
 *   1. A **token** is a feature name written in backticks in the bold lead-in
 *      of an `## [Unreleased]` bullet, matching one of {@link SHAPES}: a CLI
 *      command, an environment variable, a `foo.bar()` API, or a hyphenated
 *      check id.
 *   2. A token is **new** when it appears nowhere in a released section. This
 *      is what keeps the check quiet: `excludeFromApi` and `storagePublicRead`
 *      are all over the Unreleased notes, and both have existed for releases —
 *      badging them would be a lie, and having to exempt them by hand would be
 *      a list nobody maintains.
 *   3. Every English docs section that mentions a new token must carry a badge.
 *      "Section" is heading to heading, so a badge on a page's fifth heading
 *      does not vouch for its first.
 *
 * The reverse direction is checked too: a badge naming a version that is
 * already released is stale, and it is the failure mode nobody notices — the
 * feature works, so the reader is only mildly confused rather than blocked.
 *
 * The badge markup is defined once in `website/src/components/starlight/Since.astro`;
 * most docs pages are plain `.md`, which cannot import a component, so they
 * write the same span by hand.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import path from "node:path";

/** English docs only — the other locales are generated from these. */
const DOC_GLOBS = [
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx"
];

/**
 * Pages that are a record of the past rather than a description of the present.
 * The changelog and the upgrade guide talk about unreleased features by
 * definition, and are already dated by their own headings.
 */
const EXCLUDED = [
    "website/src/content/docs/docs/CHANGELOG.md",
    "website/src/content/docs/docs/upgrading.mdx"
];

/** What a feature name looks like. Anything else in a lead-in is prose. */
const SHAPES = [
    /^rebase [a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*){0,2}$/,     // rebase db branch switch
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/,                        // REBASE_ADMIN_EMAIL
    /^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*\(\)$/,          // policy.registered()
    /^[a-z]+(?:-[a-z]+){2,}$/                                 // policy-authenticated-tautology
];

/**
 * Tokens the "absent from every released section" rule calls new and that are
 * not. Each needs a reason, and the reason has to be that the *surface* is old
 * even though this spelling of it never appeared in a release note.
 */
const NOT_NEW = new Map([
    ["rebase db branch info", "a subcommand of `rebase db branch`, released in 0.17"],
    ["rebase auth reset-password", "shipped 2026-04, before the CHANGELOG quoted it"]
]);

/**
 * Features that are unreleased but whose CHANGELOG entry names them only in
 * prose, so no token can be extracted. Keep this short: an entry here is a
 * feature whose release note does not say what it is called.
 */
const EXTRA_TOKENS = new Map([
    ["REBASE_ADMIN_EMAIL", "\"A fresh deployment gave admin to whoever registered first\""],
    ["REBASE_ADMIN_PASSWORD", "same entry"],
    ["DISABLE_SELF_REGISTRATION", "same entry"]
]);

const BADGE = /<span[^>]*class="since-badge"[^>]*data-since="([^"]+)"|<Since\s[^>]*v=["']([^"']+)["']/g;

/** `## [Unreleased]` body, and everything below it. */
function splitChangelog(text) {
    const start = text.indexOf("## [Unreleased]");
    if (start === -1) return null;
    const next = text.indexOf("\n## [", start + 1);
    return next === -1
        ? { unreleased: text.slice(start), released: "" }
        : { unreleased: text.slice(start, next), released: text.slice(next) };
}

/** The released versions, newest first — used to date a badge. */
function releasedVersions(released) {
    return [...released.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m => m[1]);
}

export function checkUnreleasedBadges(root) {
    const findings = [];
    const changelogPath = path.join(root, "CHANGELOG.md");
    if (!existsSync(changelogPath)) return { findings, tokens: [], scanned: 0 };

    const split = splitChangelog(readFileSync(changelogPath, "utf8"));
    if (!split) return { findings, tokens: [], scanned: 0 };
    const { unreleased, released } = split;

    // ── 1 + 2: the tokens that are new ────────────────────────────────────
    const tokens = new Set();
    for (const bullet of unreleased.matchAll(/^- \*\*(.+?)\*\*/gms)) {
        for (const [, token] of bullet[1].matchAll(/`([^`\n]+)`/g)) {
            const t = token.trim();
            if (!SHAPES.some(shape => shape.test(t))) continue;
            if (released.includes(`\`${t}\``)) continue; // shipped already
            if (NOT_NEW.has(t)) continue;
            tokens.add(t);
        }
    }
    for (const t of EXTRA_TOKENS.keys()) {
        if (!released.includes(`\`${t}\``)) tokens.add(t);
    }

    // A `NOT_NEW` entry that the released notes now quote is dead weight, and a
    // dead exemption is how a real finding gets silently absorbed later.
    for (const [t, why] of NOT_NEW) {
        if (released.includes(`\`${t}\``)) {
            findings.push({
                file: "tooling/scripts/docs-verify/check-unreleased-badges.mjs",
                line: 0,
                message: `NOT_NEW no longer needs \`${t}\` (${why}) — a released section quotes it now. Delete the entry.`
            });
        }
    }

    // ── 3: every section mentioning one of them carries a badge ───────────
    const versions = releasedVersions(released);
    const files = [...new Set(DOC_GLOBS.flatMap(g => globSync(g, { cwd: root })))]
        .filter(f => !EXCLUDED.includes(f))
        .sort();

    for (const file of files) {
        const lines = readFileSync(path.join(root, file), "utf8").split("\n");

        // Section boundaries: every heading starts one. Frontmatter and fenced
        // code are skipped so a `#` in a shell comment does not split a page.
        /** @type {Array<{ start: number, end: number }>} */
        const sections = [];
        let sectionStart = 0;
        let inFence = false;
        let inFrontmatter = lines[0] === "---";
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (inFrontmatter) {
                if (i > 0 && line === "---") { inFrontmatter = false; sectionStart = i + 1; }
                continue;
            }
            if (/^\s*(?:`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
            if (inFence) continue;
            if (/^#{1,6}\s/.test(line)) {
                if (i > sectionStart) sections.push({ start: sectionStart, end: i });
                sectionStart = i;
            }
        }
        sections.push({ start: sectionStart, end: lines.length });

        for (const { start, end } of sections) {
            const body = lines.slice(start, end).join("\n");
            const badged = [...body.matchAll(BADGE)].map(m => m[1] || m[2]);

            for (const version of badged) {
                // A badge for something already out is worse than none: the
                // reader trusts it and skips a feature they have.
                if (versions.some(v => v === version || v.startsWith(`${version}.`))) {
                    findings.push({
                        file,
                        line: start + 1,
                        message: `badge says "Since ${version}", which is already released — drop it.`
                    });
                }
            }
            if (badged.length) continue;

            for (const token of tokens) {
                const quoted = token.includes("(")
                    ? `\`${token}\``
                    : new RegExp(`\`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``);
                const mentioned = typeof quoted === "string"
                    ? body.includes(quoted)
                    : quoted.test(body);
                if (!mentioned) continue;
                const heading = lines[start]?.trim().replace(/^#+\s*/, "") || "(page intro)";
                findings.push({
                    file,
                    line: start + 1,
                    message:
                        `"${heading}" describes \`${token}\`, which is only in ## [Unreleased] — ` +
                        `add <span class="since-badge" data-since="0.18">Since 0.18</span> to the section.`
                });
                break; // one finding per section is enough to act on
            }
        }
    }

    return { findings, tokens: [...tokens].sort(), scanned: files.length };
}
