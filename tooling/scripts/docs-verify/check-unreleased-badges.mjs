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

/**
 * Pages nobody can badge, because nobody writes them.
 *
 * `docs/ui/**` is generated from the components' own props by
 * `website/scripts/`, and every version-to-version guide under `upgrading/`
 * describes the release it is named after. Asking either for a hand-written
 * badge is asking for an edit that the next regeneration deletes.
 */
const EXCLUDED_PREFIXES = [
    "website/src/content/docs/docs/ui/",
    "website/src/content/docs/docs/upgrading/"
];

/**
 * What a feature name looks like. Anything else in a lead-in is prose.
 *
 * These were four narrow shapes — a `rebase …` command, an `ALL_CAPS` env var
 * with an underscore in it, `foo.bar()`, a three-word hyphenated id — and they
 * matched 14 of the 80 bullets under `## [Unreleased]`. The other 66 yielded no
 * token at all, so the gate reported "9 unreleased features", passed, and said
 * nothing about `timezone` on a cron job (documented as current, in no released
 * section) or about a `belongsTo` delete default that the docs already taught.
 * A gate whose input is empty reads exactly like a gate with nothing to say.
 *
 * Now: any backticked identifier. That is a wider net than the feature names,
 * which is the point — the filtering is done by the "absent from every released
 * section" rule below, and what that rule lets through and should not goes on
 * {@link NOT_NEW} with its reason.
 */
const SHAPES = [
    // `timezone`, `belongsTo`, `RESTRICT`, `policy.registered()`, `rls-check`,
    // `admin.browserCallbacks`, `boot/sources.ts`
    /^[A-Za-z_$][\w$]*(?:[.\-/][A-Za-z_$][\w$]*)*(?:\(\))?$/,
    // `rebase db branch switch`, `rebase db pull --database-url`
    /^rebase [a-z][a-z0-9-]*(?:[ ][A-Za-z0-9.\-]+)*$/
];

/**
 * Tokens the "absent from every released section" rule calls new and that are
 * not. Each needs a reason, and the reason has to be that the *surface* is old
 * even though this spelling of it never appeared in a release note.
 */
const NOT_NEW = new Map([
    ["rebase db branch info", "a subcommand of `rebase db branch`, released in 0.17"],
    ["rebase auth reset-password", "shipped 2026-04, before the CHANGELOG quoted it"],
    // Widening the grammar turned these from prose into tokens. Each is an old
    // surface that the release notes happened never to quote in backticks.
    ["callbacks", "the collection callbacks map, released well before 0.17"],
    ["storagePublicRead", "an `initializeRebaseBackend` option since 0.14"],
    ["zod", "the validation library the runtime has always used"],
    ["alpha", "a sample branch name in a `rebase db branch` example, not an API"],
    ["belongsTo", "the relation kind is old; what changed is its `onDelete` default, and `RESTRICT` is the token for that"],
    ["saveEntityWithCallbacks", "an internal service method, unchanged; the Unreleased note is about where it is called from"],
    ["deleteEntityWithCallbacks", "same service, same note"],
    ["loadDeclaredStorageSources", "an internal loader being deleted, not a surface anyone can write"],
    ["admin.browserCallbacks", "the admin build's own option, released in 0.16"],
    // One-word names of surfaces the product has had for releases. The wide
    // grammar turns each of them into a token, and each of them appears on
    // dozens of pages that are describing the released behaviour.
    ["admin", "the `admin` block on a collection and on a property, since 0.12"],
    ["kind", "a relation's `kind`, since relations were authored"],
    ["required", "`validation: { required }`, since 0.12"],
    ["validation", "the property `validation` block, since 0.12"],
    ["defineCollection", "the collection factory, since 0.12"]
]);

/**
 * Tokens that name two different things, with the page pattern that means the
 * unreleased one.
 *
 * `timezone` is the whole entry for a cron job's IANA zone, and it is also a
 * date property's option and a `DateTimeField` prop, both of which have shipped
 * for releases. A one-word token cannot tell them apart, and the answer is not
 * to drop it — the cron page is the one that was documenting an unreleased
 * option as current. Keep the list this short: an entry is a name the CHANGELOG
 * gave without enough context to be looked up.
 */
const SCOPED = new Map([
    ["timezone", { pattern: /\/backend\/cron-jobs\.md$|\/cli\/cron/, why: "a cron job's IANA zone; a date property's `timezone` is older" }]
]);

/**
 * `### ` headings whose bullets describe a change to something that already
 * shipped.
 *
 * The "new means absent from every released section" rule is right for an
 * addition and backwards for a breaking change: `RESTRICT` is quoted in a 0.15
 * note about dropping a schema, so the rule filed the `belongsTo` delete default
 * as old and skipped the page teaching the *previous* default as current. Under
 * a Breaking heading the token being old is the whole point of the entry.
 */
const CHANGES_AN_OLD_SURFACE = new Set(["Breaking", "Changed", "Removed"]);

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
    let heading = "";
    const suppressed = new Set();
    for (const bullet of unreleased.matchAll(/^(?:### ([^\n]+))|^- \*\*(.+?)\*\*/gms)) {
        // The regex alternates between the `### ` headings and the bullets, in
        // document order, so the last heading seen is the bullet's own.
        if (bullet[1] !== undefined) { heading = bullet[1].trim(); continue; }
        const changesAnOldSurface = CHANGES_AN_OLD_SURFACE.has(heading);
        for (const [, token] of bullet[2].matchAll(/`([^`\n]+)`/g)) {
            const t = token.trim();
            if (!SHAPES.some(shape => shape.test(t))) continue;
            if (!changesAnOldSurface && released.includes(`\`${t}\``)) continue; // shipped already
            if (NOT_NEW.has(t)) { suppressed.add(t); continue; }
            tokens.add(t);
        }
    }
    for (const t of EXTRA_TOKENS.keys()) {
        if (!released.includes(`\`${t}\``)) tokens.add(t);
    }

    // A `NOT_NEW` entry nothing suppressed this run is dead weight, and a dead
    // exemption is how a real finding gets silently absorbed later. Usage
    // rather than "a released section quotes it": under a Breaking heading a
    // released quote no longer filters the token, so that test would call a
    // live exemption dead.
    for (const [t, why] of NOT_NEW) {
        if (!suppressed.has(t)) {
            findings.push({
                file: "tooling/scripts/docs-verify/check-unreleased-badges.mjs",
                line: 0,
                message:
                    `NOT_NEW exempts \`${t}\` (${why}) and nothing under ## [Unreleased] ` +
                    "produces that token any more. Delete the entry."
            });
        }
    }

    // ── 3: every section mentioning one of them carries a badge ───────────
    const versions = releasedVersions(released);
    const files = [...new Set(DOC_GLOBS.flatMap(g => globSync(g, { cwd: root })))]
        .filter(f => !EXCLUDED.includes(f))
        .filter(f => !EXCLUDED_PREFIXES.some(p => f.startsWith(p)))
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
        /** Which lines are inside a code fence, so a reference block can be read on its own. */
        const isCode = new Array(lines.length).fill(false);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (inFrontmatter) {
                if (i > 0 && line === "---") { inFrontmatter = false; sectionStart = i + 1; }
                continue;
            }
            if (/^\s*(?:`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
            if (inFence) { isCode[i] = true; continue; }
            if (/^#{1,6}\s/.test(line)) {
                if (i > sectionStart) sections.push({ start: sectionStart, end: i });
                sectionStart = i;
            }
        }
        sections.push({ start: sectionStart, end: lines.length });

        for (const { start, end } of sections) {
            const body = lines.slice(start, end).join("\n");
            const fenced = lines.slice(start, end).filter((_, i) => isCode[start + i]).join("\n");
            const badged = [...body.matchAll(BADGE)].map(m => m[1] || m[2]);

            // A badge *inside* a heading joins the heading's text, so
            // `## First User Bootstrap` becomes `#first-user-bootstrap-since-018`
            // and every link written against the old anchor 404s in silence.
            // The badge goes on the line under the heading instead.
            if (/^#{1,6}\s/.test(lines[start] || "") && BADGE.test(lines[start])) {
                BADGE.lastIndex = 0;
                findings.push({
                    file,
                    line: start + 1,
                    message:
                        "badge is inside the heading, which rewrites the heading's anchor — " +
                        "put it on the line below instead."
                });
            }
            BADGE.lastIndex = 0;

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
                const scope = SCOPED.get(token);
                if (scope && !scope.pattern.test(`/${file}`)) continue;
                const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const mentioned = token.includes("(")
                    ? body.includes(`\`${token}\``)
                    : new RegExp(`\`${escaped}\``).test(body)
                        // A reference page documents an option by putting it in
                        // an interface fence, not in backticked prose:
                        // `cron-jobs.md` names `timezone` exactly once, on the
                        // `timezone?: string;` line of `CronJobDefinition`. A
                        // token seen only there is still a section teaching it.
                        || new RegExp(`(^|[^\\w$.])${escaped}\\b`).test(fenced);
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
