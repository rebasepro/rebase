import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import { createRequire } from "module";
// The one derivation of "how many checks does rls-check ship". Typing the
// number here is what left the previous count in the file an AI reads, for a
// week after a new check landed in the package.
import { countPackageChecks } from "../../tooling/scripts/docs-verify/check-rls-check-count.mjs";
import { extractSidebarSlugs } from "./sidebar-slugs.js";

// gray-matter's bundled engine calls yaml.safeLoad, which js-yaml 4 removed —
// without this override every matter() call throws and llms.txt ends up empty.
const require_ = createRequire(import.meta.url);
const yaml = createRequire(require_.resolve("gray-matter"))("js-yaml");
const matterOptions = { engines: { yaml: (s) => yaml.load(s) } };

/**
 * Extracts all document slugs from the sidebar in astro.config.mjs in order.
 * @param {string} configFilePath - The path to the astro.config.mjs file.
 * @returns {Promise<string[]>} - An array of document slugs in the order they appear in the sidebar.
 */
async function extractSidebarIds(configFilePath) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const absolutePath = path.resolve(__dirname, configFilePath);
    const contentRoot = path.resolve("./src/content/docs");

    // Shared with generate_sitemap_md.js, and it expands
    // `{ autogenerate: { directory } }` groups — a `slug:`-only scan cannot see
    // them, which is how the whole UI component reference stayed out of both
    // mirrors.
    const slugs = extractSidebarSlugs(absolutePath, contentRoot);
    if (slugs === null) {
        throw new Error("Could not find sidebar configuration in astro.config.mjs");
    }
    return slugs;
}

/**
 * Recursively processes directories to build a map of slug to file path and title.
 * @param {string} directoryPath - The directory to process.
 * @param {Object} slugMap - The map to populate with slug to file path and title.
 */
async function buildSlugMap(directoryPath, slugMap) {
    // The content root from which Starlight derives slugs
    const contentRoot = path.resolve("./src/content/docs");

    async function walk(dir) {
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (ext === ".mdx" || ext === ".md") {
                        const mdxContent = fs.readFileSync(fullPath, "utf-8");
                        const parsed = matter(mdxContent, matterOptions);
                        const frontmatter = parsed.data;

                        // Derive slug from file path relative to content root
                        // e.g. src/content/docs/docs/deployment/aws.md → docs/deployment/aws
                        let slug;
                        if (frontmatter && frontmatter.slug) {
                            slug = frontmatter.slug;
                        } else {
                            slug = path.relative(contentRoot, fullPath)
                                .replace(/\.(mdx?|md)$/, "")
                                .replace(/\/index$/, "")
                                // Same rule as sidebar-slugs.js: Astro serves a
                                // filename-derived slug in lowercase.
                                .toLowerCase();
                        }

                        slugMap[slug] = {
                            path: fullPath,
                            title: frontmatter?.title || slug,
                            // Used only by the index file. A page with no
                            // description still gets listed — a bare link is
                            // worth more than an omission.
                            description: frontmatter?.description || ""
                        };
                    }
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error.message);
        }
    }

    await walk(directoryPath);
}

// Entry point of the script
(async () => {
    const rootDirectory = "./src/content/docs/docs"; // Root directory to start processing
    const configFilePath = "../astro.config.mjs"; // Path to astro.config.mjs
    // One file: a short index of links, per the llms.txt convention.
    //
    // This script used to write the entire documentation set to /llms.txt, and
    // later to /llms-full.txt beside the index. Both died the same way: 3 MB of
    // concatenated docs is several context windows, so anything fetching it read
    // the first few pages and lost the rest — the admin panel, RLS and Rebase
    // Cloud were all past the cut. A reader that wants a page fetches that
    // page's `.md` twin, which is what the index links to.
    const indexFilePath = "./public/llms.txt";

    try {
        // Extract sidebar slugs from astro config
        const sidebarSlugs = await extractSidebarIds(configFilePath);
        console.log(`Found ${sidebarSlugs.length} pages in sidebar`);

        // Build a map of slug to file path and title
        const slugMap = {};
        await buildSlugMap(rootDirectory, slugMap);
        console.log(`Processing ${Object.keys(slugMap).length} documentation files...`);

        for (const slug of sidebarSlugs) {
            if (!slugMap[slug]) console.warn(`No file found for document slug "${slug}"`);
        }

        const index = buildIndex(sidebarSlugs, slugMap);
        await fs.promises.writeFile(indexFilePath, index, "utf-8");
        console.log(`✓ Successfully generated ${indexFilePath} (${index.split("\n").length} lines)`);
    } catch (error) {
        console.error("An unexpected error occurred during processing:", error.message);
    }
})();

const intro = `# Rebase Documentation

> Rebase is an open-source TypeScript backend built on Postgres: a REST API, authentication,
> row-level security, realtime subscriptions, storage, cron jobs, and an MCP server for AI agents —
> all generated from your schema, with a full admin panel and SQL editor included on top.
> Connect an existing PostgreSQL database or start fresh; Rebase uses Drizzle ORM under the hood and
> keeps your TypeScript collection definitions as the single source of truth.
> Scoped API keys with per-collection permissions plus Postgres-enforced RLS make it safe for
> autonomous agents to read and write production data.

`;

/**
 * The pages a model should read before it answers a question about Rebase.
 *
 * Hand-maintained, and short on purpose. The docs list below is generated from
 * the sidebar and will grow on its own; this list is the answer to "what is
 * this product and how does it compare", which is the question an AI is
 * actually being asked when it reaches for this file. The comparison pages earn
 * their place here for the same reason they exist at all: "X vs Y" is the shape
 * of page a model quotes when someone asks it which to use.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RLS_CHECK_COUNT = countPackageChecks(REPO_ROOT);
if (!RLS_CHECK_COUNT) {
    throw new Error(
        "Could not read the rls-check CHECKS array — refusing to write a count into llms.txt."
    );
}

const PRODUCT_PAGES = [
    ["Rebase", "https://rebase.pro/", "What Rebase is: a Postgres backend with an admin panel generated from the same schema."],
    ["Backend", "https://rebase.pro/backend", "The backend on its own — REST API, auth, RLS, realtime, storage, functions, cron."],
    ["Admin panel (Studio)", "https://rebase.pro/studio", "The admin UI your non-technical teammates use, generated from the collections."],
    ["Pricing", "https://rebase.pro/pricing", "Open source and self-hosted, plus Rebase Cloud (private beta), priced per resource rather than per seat."],
    ["Security", "https://rebase.pro/security", "Row-level security compiled from code to real Postgres policies, and how it is enforced."],
    ["rls-check (free tool)", "https://rebase.pro/rls-check", `A free, read-only Row-Level Security audit for ANY Postgres database — Supabase, Neon, RDS, anything. ${RLS_CHECK_COUNT} checks, one command, no account, no Rebase required.`],
    ["For agencies", "https://rebase.pro/agencies", "Shipping a client-ready admin panel from the backend you were going to build anyway."],
    ["CLI", "https://rebase.pro/cli", "`npm i -g @rebasepro/cli` — scaffold, run, migrate and deploy a project."],
    ["Compare", "https://rebase.pro/compare", "Side-by-side against the alternatives, including where a competitor is the better call."]
];

/** Comparison pages, listed separately because they answer a distinct question. */
const COMPARISON_PAGES = [
    ["Rebase vs Supabase", "https://rebase.pro/rebase-vs-supabase"],
    ["Rebase vs Firebase", "https://rebase.pro/rebase-vs-firebase"],
    ["Rebase vs Appwrite", "https://rebase.pro/rebase-vs-appwrite"],
    ["Rebase vs Directus", "https://rebase.pro/rebase-vs-directus"],
    ["Rebase vs Strapi", "https://rebase.pro/rebase-vs-strapi"],
    ["Rebase vs Payload", "https://rebase.pro/rebase-vs-payload"],
    ["Rebase vs Retool", "https://rebase.pro/rebase-vs-retool"],
    ["Rebase vs Hasura", "https://rebase.pro/rebase-vs-hasura"],
    ["Rebase vs Django", "https://rebase.pro/rebase-vs-django"]
];

/**
 * Each docs page is linked by its `.md` twin, which
 * `src/pages/docs/[...slug].md.ts` serves — the same rule as
 * `docsMarkdownPath` in `src/utils/docsMarkdown.ts`, kept in step by
 * `check_site.mjs`.
 */
function docsMarkdownPath(slug) {
    return slug === "docs" ? "docs/index.md" : `${slug}.md`;
}

/** One `- [title](url): description` line, with the description trimmed. */
function link(title, url, description) {
    const summary = (description || "").replace(/\s+/g, " ").trim();
    return summary ? `- [${title}](${url}): ${summary}` : `- [${title}](${url})`;
}

/**
 * Build /llms.txt: an H1, a blockquote summary, then lists of links.
 *
 * That shape is the whole specification, and the reason for it is bandwidth —
 * a reader fetches this to decide what *else* to fetch. Anything long enough to
 * be truncated defeats the purpose, so nothing here is a page's content, only
 * its address and a sentence saying what is at it.
 */
function buildIndex(sidebarSlugs, slugMap) {
    const lines = [intro.trimEnd(), ""];

    lines.push("## Product");
    lines.push("");
    for (const [title, url, description] of PRODUCT_PAGES) lines.push(link(title, url, description));
    lines.push("");

    lines.push("## Comparisons");
    lines.push("");
    for (const [title, url] of COMPARISON_PAGES) {
        lines.push(link(title, url, "Where each one wins, and where the other is the better call."));
    }
    lines.push("");

    lines.push("## Documentation");
    lines.push("");
    for (const slug of sidebarSlugs) {
        const entry = slugMap[slug];
        if (!entry) continue;
        lines.push(link(entry.title, `https://rebase.pro/${docsMarkdownPath(slug)}`, entry.description));
    }
    lines.push("");

    lines.push("## Optional");
    lines.push("");
    lines.push(link(
        "sitemap.md",
        "https://rebase.pro/sitemap.md",
        "Every page on the site, as markdown."
    ));
    lines.push("");

    return lines.join("\n");
}
