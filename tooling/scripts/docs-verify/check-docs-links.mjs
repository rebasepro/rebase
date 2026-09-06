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
 *   3. **An image that 404s.** Six `<img>` in `view-modes.md` and `relations.md`
 *      pointed at `/img/features/*.png`, a directory that has never existed —
 *      36 broken images once the locales are counted, each one a console error
 *      on a page about how good the UI looks. Nothing read image targets.
 *
 * This used to be English-only, "because the other five locales are
 * machine-translated from these, links included". They are — once. The
 * translator skips a file that already exists, so a translated page is frozen
 * at the English it was made from, and the docblock's own motivating example
 * outlived its fix in five locales: `/docs/backend/database/` was dead in
 * `de`, `es`, `fr`, `it` and `pt` for as long as this check said the tree was
 * clean. Links and images are now resolved in every locale, against the routes
 * that locale actually has.
 *
 * The outbound-link *minimum* stays English-only. It is a claim about how a
 * page is written, the translations are the same pages, and reporting the same
 * editorial finding six times is how a check gets ignored.
 */
import { readFileSync, existsSync, statSync, globSync } from "node:fs";
import path from "node:path";

const LOCALES = ["de", "es", "fr", "it", "pt"];

const DOC_GLOBS = [
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx",
    ...LOCALES.flatMap(l => [
        `website/src/content/docs/${l}/docs/**/*.md`,
        `website/src/content/docs/${l}/docs/**/*.mdx`
    ])
];

/** Static assets a page can point at. Everything under here is served at `/`. */
const PUBLIC_DIR = "website/public";

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
 * anything that is not a letter, number, mark, space or dash, collapse runs of
 * whitespace to single dashes. Inline code fences and the "Since" badge span
 * are stripped first, since both appear in headings here.
 *
 * The character class is Unicode-aware on purpose. `\w` is ASCII, so
 * "Retención de Canales" slugged to `retencin-de-canales` here while Starlight
 * emitted `id="retención-de-canales"` — a mismatch that could only appear once
 * the five translated locales were scanned, and that would have reported every
 * accented anchor in them as dead.
 */
function headingSlug(text) {
    return text
        .replace(/<[^>]*>/g, "")
        .replace(/`/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-");
}

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

        for (const m of text.matchAll(/\]\((\/(?:docs|de|es|fr|it|pt)\/[^)\s]*|\/docs[^)\s]*)\)/g)) {
            outbound++;
            links++;
            const [target, anchor] = m[1].split("#");
            const written = target.replace(/\/$/, "") || "/docs";
            const route = written.toLowerCase();
            const line = text.slice(0, m.index).split("\n").length;

            if (!routes.has(route)) {
                findings.push({
                    file, line,
                    message: `${m[1]} — no page is served at ${route}`
                });
                continue;
            }
            // Astro lowercases the slug, so `/docs/ui/components/Card` 404s on
            // the host and 301s at best. It passed every check here because
            // both sides were lowercased before comparing, and passed
            // `check_site.mjs` because macOS does not care about case.
            if (written !== route) {
                findings.push({
                    file, line,
                    message: `${m[1]} — the page is served at ${route}; this link's casing 404s`
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

        // Images. `![alt](/img/x.png)` and `<img src="/img/x.png">` are served
        // out of `website/public`, and nothing has ever resolved one.
        for (const m of [
            ...text.matchAll(/!\[[^\]]*\]\((\/[^)\s]*)\)/g),
            ...text.matchAll(/<img\b[^>]*\bsrc="(\/[^"]*)"/g)
        ]) {
            const target = m[1].split("#")[0].split("?")[0];
            const asset = path.join(root, PUBLIC_DIR, target.replace(/^\//, ""));
            if (existsSync(asset) && statSync(asset).isFile()) continue;
            findings.push({
                file,
                line: text.slice(0, m.index).split("\n").length,
                message: `${m[1]} — no file at ${PUBLIC_DIR}${target}`
            });
        }

        // The outbound minimum is a claim about English editorial, not about
        // five machine translations of it.
        if (!file.startsWith("website/src/content/docs/docs/")) continue;
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
