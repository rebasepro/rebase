/**
 * The documentation link graph: nothing dead, nothing stranded.
 *
 * Two failures, and neither one has ever been checked by anything:
 *
 *   1. **A `/docs/…` link that resolves to nothing.** Starlight builds a 404
 *      page rather than failing the build, so a link to a page that was renamed
 *      or never existed ships and stays. `backend/mongodb.md` sent readers who
 *      need row-level security to `/docs/backend/database/`, which has never
 *      existed; `quickstart.md` pointed `--headless` at `#just-the-api-headless`,
 *      an anchor on no page in the site.
 *
 *   2. **A page with no outbound links at all.** Eighteen pages had none — the
 *      platform deployment guides, split processes, branching, custom server,
 *      live schema editing, multiple sources, search, the three frontend
 *      extension pages, the blog recipe, the upgrade guide and the compatibility
 *      policy. Each is reachable from the sidebar and leads nowhere, so a reader
 *      who arrives from a search engine has the sidebar or the back button. That
 *      is the shape of documentation nobody reads twice.
 *
 * English only. The other five locales are machine-translated from these, links
 * included, and a locale-relative check would report the same finding six times.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const DOC_GLOBS = [
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx"
];

/**
 * Generated trees, exempt from the outbound-link rule only.
 *
 * `docs/ui/**` is written by `tooling/design-sync/gen-ui-docs.mjs` from the
 * component sources: 99 API reference pages that its own index links to and
 * that link nowhere by design. Demanding a "Related" footer on each would mean
 * demanding it from the generator, which is a different argument. Their links
 * are still resolved — a generated dead link is still dead.
 */
const NO_OUTBOUND_RULE = [
    /^website\/src\/content\/docs\/docs\/ui\//,
    // Mirrored from the repository root by website/scripts/copy_repo_docs.js.
    // It is a record, appended at the top, and its links are whatever each
    // entry happened to need.
    /^website\/src\/content\/docs\/docs\/CHANGELOG\.md$/
];

/** How many outbound docs links a page needs. Two: one is a dead end with a step. */
const MIN_OUTBOUND = 2;

/**
 * Astro lowercases content-collection slugs, so `ui/components/Alert.mdx` is
 * served at `/docs/ui/components/alert`. Route comparison is lowercase
 * throughout or every link into the generated UI reference reads as dead.
 */
function routeOf(file) {
    return (
        "/" +
        file
            .replace("website/src/content/docs/", "")
            .replace(/\.mdx?$/, "")
            .replace(/\/index$/, "")
    ).toLowerCase();
}

/**
 * Close enough to github-slugger for headings this site writes: lowercase, drop
 * anything that is not a word character, space or dash, collapse runs of
 * whitespace to single dashes. Inline code fences and the "Since" badge span
 * are stripped first, since both appear in headings here.
 */
function headingSlug(text) {
    return text
        .replace(/<[^>]*>/g, "")
        .replace(/`/g, "")
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
}

/**
 * How long an English documentation page may be.
 *
 * Not a style rule. A page this size has stopped being one thing: `sdk/querying`
 * reached 957 lines holding CRUD, batch writes, the query builder, pagination,
 * aggregates, JSON filtering, two kinds of search and two kinds of relation
 * read — and the parts drifted from each other, because nobody reviewing a
 * change to one of them reads the other eight. Splitting at a `##` seam is
 * cheap; the split is what was skipped twice before this became a number.
 *
 * The changelog is the one exemption: it is a mirror of the release record,
 * generated on every build, and there is nothing to split it into.
 */
const MAX_LINES = 600;
const LENGTH_EXEMPT = [/\/CHANGELOG\.md$/];

export function checkDocsLinks(root) {
    const files = [...new Set(DOC_GLOBS.flatMap(g => globSync(g, { cwd: root })))].sort();

    const routes = new Set(files.map(routeOf));
    /** @type {Map<string, Set<string>>} */
    const headings = new Map();
    for (const file of files) {
        const text = readFileSync(path.join(root, file), "utf8");
        headings.set(
            routeOf(file),
            new Set([...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(m => headingSlug(m[1])))
        );
    }

    const findings = [];
    let links = 0;

    for (const file of files) {
        const raw = readFileSync(path.join(root, file), "utf8");
        // Fenced code is a sample, not a link graph: a `[x](/docs/y)` inside one
        // is being shown, not followed.
        const text = raw.replace(/^(\s*)(`{3,}|~{3,})[\s\S]*?\n\1\2\s*$/gm, "");
        let outbound = 0;

        for (const m of text.matchAll(/\]\((\/docs[^)\s]*)\)/g)) {
            outbound++;
            links++;
            const [target, anchor] = m[1].split("#");
            const route = (target.replace(/\/$/, "") || "/docs").toLowerCase();
            const line = text.slice(0, m.index).split("\n").length;

            if (!routes.has(route)) {
                findings.push({
                    file, line,
                    message: `${m[1]} — no page is served at ${route}`
                });
                continue;
            }
            if (anchor && !headings.get(route)?.has(anchor.toLowerCase())) {
                findings.push({
                    file, line,
                    message: `${m[1]} — ${route} has no heading "#${anchor}"`
                });
            }
        }

        const lineCount = raw.split("\n").length;
        if (lineCount > MAX_LINES && !LENGTH_EXEMPT.some(re => re.test(file))) {
            findings.push({
                file, line: 1,
                message:
                    `${lineCount} lines, budget ${MAX_LINES} — split it at a \`##\` seam into a ` +
                    "sibling page named after the heading, and add the sidebar entry. A page this " +
                    "long has stopped being one thing, and its parts drift from each other."
            });
        }

        if (NO_OUTBOUND_RULE.some(re => re.test(file))) continue;
        if (outbound < MIN_OUTBOUND) {
            findings.push({
                file, line: 1,
                message:
                    `${outbound} outbound docs link(s) — a reader who lands here from a search ` +
                    `engine has nowhere to go. Name at least ${MIN_OUTBOUND} pages they need next.`
            });
        }
    }

    return { findings, scanned: files.length, links };
}
