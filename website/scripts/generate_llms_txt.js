import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import { createRequire } from "module";

// gray-matter's bundled engine calls yaml.safeLoad, which js-yaml 4 removed —
// without this override every matter() call throws and llms.txt ends up empty.
const require_ = createRequire(import.meta.url);
const yaml = createRequire(require_.resolve("gray-matter"))("js-yaml");
const matterOptions = { engines: { yaml: (s) => yaml.load(s) } };

/**
 * Attempts to locate a file by trying multiple possible extensions.
 * @param {string} basePath - The base directory path.
 * @param {string} relativePathBase - The relative path without extension.
 * @returns {string} - The resolved file path with extension.
 * @throws Will throw an error if no matching file is found.
 */
function findFileWithExtension(basePath, relativePathBase) {
    const possibleExtensions = [".tsx", ".jsx", ".js", ".ts", ".mdx", ".md", ".txt", ""];

    for (const extension of possibleExtensions) {
        const fullPath = path.join(basePath, relativePathBase + extension);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            return fullPath;
        }
    }
    throw new Error(`File not found for base: ${relativePathBase}`);
}

/**
 * Resolves a file path that's used in imports or references.
 * @param {string} basePath - The base directory path.
 * @param {string} relativePath - The relative path from the base.
 * @returns {string} - The resolved file path.
 */
function resolveFilePath(basePath, relativePath) {
    // Handle paths that start with / (absolute from project root)
    if (relativePath.startsWith("/")) {
        return findFileWithExtension(path.resolve("."), relativePath.slice(1));
    }
    // Handle relative paths
    return findFileWithExtension(basePath, relativePath);
}

/**
 * Applies a per-line transform to lines outside fenced code blocks, leaving
 * fenced content untouched. Return null from the transform to drop the line.
 * @param {string} text - The markdown text to process.
 * @param {(line: string) => string | null} transform - The per-line transform.
 * @returns {string} - The transformed text.
 */
function mapLinesOutsideCodeFences(text, transform) {
    let inFence = false;
    return text
        .split("\n")
        .map((line) => {
            if (/^\s*(```|~~~)/.test(line)) {
                inFence = !inFence;
                return line;
            }
            return inFence ? line : transform(line);
        })
        .filter((line) => line !== null)
        .join("\n");
}

/**
 * Processes the MDX file by resolving Code and CodeSampleWithSource components,
 * removing import statements, and stripping out interactive samples from the output.
 * @param {string} mdxFilePath - The file path to the MDX file.
 * @returns {string} - The transformed MDX content.
 */
async function resolveCodeBlocks(mdxFilePath) {
    const mdxContent = fs.readFileSync(mdxFilePath, "utf-8");
    const mdxBasePath = path.dirname(mdxFilePath);

    // Parse frontmatter
    const parsed = matter(mdxContent, matterOptions);
    const frontmatter = parsed.data;
    const content = parsed.content;

    // Regex to match ALL import statements
    const importPattern = /^import\s+[\s\S]+?\s+from\s+['"](.*?)['"];?$/gm;

    // Object to map imported variables to their file contents
    const importContents = {};

    // Process import statements that use ?raw suffix (Vite's raw import)
    let importMatch;
    while ((importMatch = importPattern.exec(content)) !== null) {
        const importStatement = importMatch[0];
        const importPath = importMatch[1];
        const isRawImport = importPath.endsWith("?raw");

        if (isRawImport) {
            // Remove the ?raw suffix to get the relative file path
            const relativeFilePathBase = importPath.replace(/\?raw$/, "");

            try {
                const resolvedPath = resolveFilePath(mdxBasePath, relativeFilePathBase);
                const fileContent = fs.readFileSync(resolvedPath, "utf-8");

                // Extract the variable name from the import statement
                const varNameMatch = importStatement.match(/import\s+([a-zA-Z0-9_]+)\s+from/);
                if (varNameMatch && varNameMatch[1]) {
                    const varName = varNameMatch[1];
                    importContents[varName] = fileContent;
                } else {
                    console.warn(`Could not extract variable name from import: "${importStatement}"`);
                }
            } catch (error) {
                console.error(`Error processing import "${importStatement}":`, error.message);
            }
        }
    }

    // Remove all import statements from the content
    let contentWithoutImports = content.replace(importPattern, "");

    // Replace <Code code={variableName} lang="..." /> with fenced code blocks
    const codeComponentPattern = /<Code\s+code=\{([a-zA-Z0-9_]+)\}(?:\s+lang=["']([^"']+)["'])?\s*\/>/g;
    contentWithoutImports = contentWithoutImports.replace(codeComponentPattern, (match, varName, lang = "tsx") => {
        if (importContents[varName]) {
            // Escape backticks in the code to prevent breaking the fenced code block
            const escapedCode = importContents[varName].replace(/```/g, "\\`\\`\\`");
            return `\`\`\`${lang}\n${escapedCode}\n\`\`\``;
        } else {
            console.warn(`No content found for variable "${varName}". Leaving <Code> as is.`);
            return match;
        }
    });

    // Handle <CodeSampleWithSource path="..." /> by reading the source file directly
    const codeSamplePattern = /<CodeSampleWithSource\s+path=["']([^"']+)["'](?:\s+lang=["']([^"']+)["'])?\s*\/>/g;
    contentWithoutImports = contentWithoutImports.replace(codeSamplePattern, (match, componentPath, lang = "tsx") => {
        try {
            // CodeSampleWithSource uses paths like "/src/content/docs/samples/..."
            const resolvedPath = resolveFilePath(mdxBasePath, componentPath);
            const fileContent = fs.readFileSync(resolvedPath, "utf-8");
            const escapedCode = fileContent.replace(/```/g, "\\`\\`\\`");
            return `\`\`\`${lang}\n${escapedCode}\n\`\`\``;
        } catch (error) {
            console.error(`Error processing CodeSampleWithSource with path "${componentPath}":`, error.message);
            return match;
        }
    });

    // Drop self-closing component tags that have no text representation
    // (e.g. <AdminDemoCarousel ... /> or <FieldWidgetPreview ... />), but
    // leave JSX inside fenced code samples alone
    const unhandledComponentPattern = /^\s*<[A-Z][A-Za-z0-9]*(\s[^>]*)?\/>\s*$/;
    contentWithoutImports = mapLinesOutsideCodeFences(contentWithoutImports, (line) =>
        unhandledComponentPattern.test(line) ? null : line
    );

    // Remove multiple new lines for cleaner output
    const finalResolvedContent = contentWithoutImports.replace(/\n{3,}/g, "\n\n");
    return finalResolvedContent;
}

/**
 * Extracts all document slugs from the sidebar in astro.config.mjs in order.
 * @param {string} configFilePath - The path to the astro.config.mjs file.
 * @returns {Promise<string[]>} - An array of document slugs in the order they appear in the sidebar.
 */
async function extractSidebarIds(configFilePath) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const absolutePath = path.resolve(__dirname, configFilePath);

    // Read the config file as text instead of importing it
    const configContent = fs.readFileSync(absolutePath, "utf-8");

    // Extract the sidebar array from the config content
    // Find the sidebar configuration using regex
    const sidebarMatch = configContent.match(/sidebar:\s*\[([\s\S]*?)\],?\s*components:/);

    if (!sidebarMatch) {
        throw new Error("Could not find sidebar configuration in astro.config.mjs");
    }

    const sidebarContent = sidebarMatch[1];
    const slugs = [];

    // Extract all slug values using regex
    const slugPattern = /slug:\s*["']([^"']+)["']/g;
    let match;
    while ((match = slugPattern.exec(sidebarContent)) !== null) {
        slugs.push(match[1]);
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
                                .replace(/\/index$/, "");
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
    // Two files, per the llms.txt convention, and the split is not cosmetic.
    //
    // This script used to write the entire documentation set — some 18,000
    // lines — to /llms.txt. Anything fetching that URL truncates long before
    // the end, so every page after the first few was invisible to exactly the
    // readers the file exists for: the admin panel, RLS, and Rebase Cloud were
    // all past the cut. The convention answers this directly — /llms.txt is a
    // short index of links, /llms-full.txt is the corpus — and we were
    // publishing the corpus under the index's name.
    const indexFilePath = "./public/llms.txt";
    const outputFilePath = "./public/llms-full.txt";

    try {
        // Extract sidebar slugs from astro config
        const sidebarSlugs = await extractSidebarIds(configFilePath);
        console.log(`Found ${sidebarSlugs.length} pages in sidebar`);

        // Build a map of slug to file path and title
        const slugMap = {};
        await buildSlugMap(rootDirectory, slugMap);
        console.log(`Processing ${Object.keys(slugMap).length} documentation files...`);

        // Clear the output files if they already exist
        for (const stale of [outputFilePath, indexFilePath]) {
            if (fs.existsSync(stale)) fs.unlinkSync(stale);
        }

        let result = "";
        let processedCount = 0;
        // Iterate over sidebar slugs and append content in order
        for (const slug of sidebarSlugs) {
            const entry = slugMap[slug];
            if (entry) {
                const {
                    path: mdxFilePath,
                    title
                } = entry;
                try {
                    const resolvedMdx = await resolveCodeBlocks(mdxFilePath);
                    // Prepend the title in H1 format
                    const contentToAppend = `# ${title}\n${resolvedMdx}\n`;
                    // Append the resolved content to the output file
                    result += contentToAppend;
                    processedCount++;
                } catch (error) {
                    console.error(`Error resolving MDX code blocks in ${mdxFilePath}:`, error.message);
                }
            } else {
                console.warn(`No file found for document slug "${slug}"`);
            }
        }

        // Convert H1 to H2 and so on, but leave # comments in code blocks alone
        result = mapLinesOutsideCodeFences(result, (line) => line.replaceAll("# ", "## "));
        result = intro + result; // Add the intro to the beginning
        // Replace relative links with absolute ones — but only in prose. A
        // relative link inside a code fence is usually the literal content of a
        // file being documented (the scaffolded `CLAUDE.md` points at
        // `./ai-instructions.md`), and rewriting it to a rebase.pro URL would
        // misreport what that file actually says.
        result = mapLinesOutsideCodeFences(result, (line) =>
            line
                .replaceAll("](./", "](https://rebase.pro/docs/")
                .replaceAll("](../", "](https://rebase.pro/docs/"));

        await fs.promises.appendFile(outputFilePath, result, "utf-8");
        console.log(`✓ Successfully generated ${outputFilePath} with ${processedCount} pages`);

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
const PRODUCT_PAGES = [
    ["Rebase", "https://rebase.pro/", "What Rebase is: a Postgres backend with an admin panel generated from the same schema."],
    ["Backend", "https://rebase.pro/backend", "The backend on its own — REST API, auth, RLS, realtime, storage, functions, cron."],
    ["Admin panel (Studio)", "https://rebase.pro/studio", "The admin UI your non-technical teammates use, generated from the collections."],
    ["Pricing", "https://rebase.pro/pricing", "Open source and self-hosted, plus Rebase Cloud (private beta), priced per resource rather than per seat."],
    ["Security", "https://rebase.pro/security", "Row-level security compiled from code to real Postgres policies, and how it is enforced."],
    ["For agencies", "https://rebase.pro/agencies", "Shipping a client-ready admin panel from the backend you were going to build anyway."],
    ["CLI", "https://rebase.pro/cli", "`npm i -g @rebasepro/cli` — scaffold, run, migrate and deploy a project."],
    ["Compare", "https://rebase.pro/compare", "Side-by-side against the alternatives, including where a competitor is the better call."]
];

/** Comparison pages, listed separately because they answer a distinct question. */
const COMPARISON_PAGES = [
    ["Rebase vs Supabase", "https://rebase.pro/rebase-vs-supabase"],
    ["Rebase vs Firebase", "https://rebase.pro/rebase-vs-firebase"],
    ["Rebase vs Directus", "https://rebase.pro/rebase-vs-directus"],
    ["Rebase vs Strapi", "https://rebase.pro/rebase-vs-strapi"],
    ["Rebase vs Payload", "https://rebase.pro/rebase-vs-payload"],
    ["Rebase vs Retool", "https://rebase.pro/rebase-vs-retool"],
    ["Rebase vs Hasura", "https://rebase.pro/rebase-vs-hasura"],
    ["Rebase vs Django", "https://rebase.pro/rebase-vs-django"]
];

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
        lines.push(link(entry.title, `https://rebase.pro/${slug}`, entry.description));
    }
    lines.push("");

    lines.push("## Optional");
    lines.push("");
    lines.push(link(
        "llms-full.txt",
        "https://rebase.pro/llms-full.txt",
        "Every documentation page above, concatenated. Large — fetch a single page from the list instead unless you need the whole corpus."
    ));
    lines.push(link(
        "sitemap.md",
        "https://rebase.pro/sitemap.md",
        "Every page on the site, as markdown."
    ));
    lines.push("");

    return lines.join("\n");
}
