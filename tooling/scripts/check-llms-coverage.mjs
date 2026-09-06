/**
 * Every English documentation page is in the LLM mirrors.
 *
 * `check:generated` regenerates `llms.txt`, `llms-full.txt` and `sitemap.md`
 * and diffs them against what is committed. That catches a stale mirror and is
 * structurally blind to an incomplete one: if the generator cannot see a page,
 * it writes the same truncated file both times and the diff is empty. Ninety-nine
 * pages — the whole UI component reference — were missing from all three for as
 * long as the sidebar had listed them with `{ autogenerate: { directory } }`,
 * while `llms-full.txt` told the agent reading it that "every component in the
 * kit is catalogued under [UI components]… check there before hand-rolling".
 *
 * This is the direction the diff cannot check: the source of truth is the
 * content directory, not the generator's own previous output.
 *
 *     pnpm check:llms-coverage
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONTENT = path.join(ROOT, "website/src/content/docs/docs");
const FULL = "website/public/llms-full.txt";
const INDEX = "website/public/llms.txt";
const SITEMAP = "website/public/sitemap.md";

/**
 * Pages that are deliberately out of the mirrors.
 *
 * The changelog is 3,000 lines of release notes: it would be a third of the
 * corpus and answers no question a reader brings to `llms-full.txt`. Everything
 * else on the site is in.
 */
const EXCLUDED = new Set(["docs/CHANGELOG"]);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** Every `.md`/`.mdx` under `dir`, recursively. */
function walk(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(mdx|md)$/.test(entry.name)) out.push(full);
    }
    return out;
}

export function checkLlmsCoverage(root = ROOT) {
    const contentRoot = path.join(root, "website/src/content/docs");
    const pages = walk(path.join(root, "website/src/content/docs/docs"))
        .map(p => path.relative(contentRoot, p).split(path.sep).join("/")
            .replace(/\.(mdx|md)$/, "")
            .replace(/\/index$/, ""))
        .filter(slug => !EXCLUDED.has(slug))
        .sort();

    if (pages.length === 0) {
        throw new Error(`No documentation pages under ${CONTENT} — the guard is checking nothing.`);
    }

    /** @type {Array<{ slug: string, mirror: string }>} */
    const findings = [];
    // A page is in `llms-full.txt` by its title heading, and in the two link
    // files by its URL. Match the URL, which is the same shape in all three and
    // does not depend on the frontmatter.
    const mirrors = [
        [FULL, fs.readFileSync(path.join(root, FULL), "utf8")],
        [INDEX, fs.readFileSync(path.join(root, INDEX), "utf8")],
        [SITEMAP, fs.readFileSync(path.join(root, SITEMAP), "utf8")]
    ];
    for (const slug of pages) {
        const url = `https://rebase.pro/${slug}`;
        for (const [name, text] of mirrors) {
            // `llms-full.txt` carries the prose rather than a link per page, so
            // it is checked by the H2 the generator writes for each one.
            const present = name === FULL
                ? text.includes(`](${url}`) || hasHeadingFor(text, root, contentRoot, slug)
                : text.includes(url);
            if (!present) findings.push({ slug, mirror: name });
        }
    }

    return { findings, pages: pages.length, mirrors: mirrors.length };
}

/** `llms-full.txt` writes `## <title>` for each page it includes. */
function hasHeadingFor(text, root, contentRoot, slug) {
    for (const ext of [".mdx", ".md", "/index.mdx", "/index.md"]) {
        const file = path.join(contentRoot, slug + ext);
        if (!fs.existsSync(file)) continue;
        const title = fs.readFileSync(file, "utf8").match(/^title:\s*(.+)$/m);
        if (!title) continue;
        const heading = `## ${title[1].trim().replace(/^["']|["']$/g, "")}\n`;
        return text.includes(heading);
    }
    return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    let result;
    try {
        result = checkLlmsCoverage();
    } catch (error) {
        console.error(red(`✗ ${error.message}`));
        process.exit(2);
    }
    if (result.findings.length === 0) {
        console.log(green(`✓ All ${result.pages} English documentation pages are in the ${result.mirrors} LLM mirrors.`));
        process.exit(0);
    }
    console.error(red(`✗ ${result.findings.length} page/mirror pair(s) missing:`));
    for (const f of result.findings) console.error(`  ${red(f.slug)} ${dim("not in " + f.mirror)}`);
    console.error(
        dim("\nThe mirrors are generated from the sidebar in website/astro.config.mjs.\n"
            + "A page the sidebar does not list is a page no reader — human or model — can find,\n"
            + "and `check:generated` cannot see it, because it diffs the generator against itself.")
    );
    process.exit(1);
}
