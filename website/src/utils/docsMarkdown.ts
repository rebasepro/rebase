import fs from "node:fs";
import path from "node:path";

/**
 * The `.md` twin of a documentation page: what an agent reads instead of the
 * HTML.
 *
 * The source is MDX, which is not markdown a reader can use as-is: samples are
 * imported with `?raw` and shown with `<Code code={…} />` or
 * `<CodeSampleWithSource path="…" />`, and interactive previews are bare
 * component tags. This inlines the samples as fenced code, drops what has no
 * text form, and makes every site link absolute, because a markdown file read
 * out of context has no page to resolve `/docs/…` against.
 *
 * It replaces `llms-full.txt`, which ran every page through this same
 * transform and concatenated the result into 3 MB that no agent could read to
 * the end. One page per file is a size a reader can fetch.
 */

const SITE = "https://rebase.pro";

/**
 * The twin's path for a docs slug. The docs root is `docs`, and its twin
 * cannot be `/docs.md` from a route under `src/pages/docs/`, so it is
 * `/docs/index.md`. `website/scripts/generate_llms_txt.js` links with the same
 * rule.
 */
export function docsMarkdownPath(slug: string): string {
    return slug === "docs" ? "docs/index.md" : `${slug}.md`;
}

/** Locates a file by trying the extensions an import may leave off. */
function findFileWithExtension(basePath: string, relativePathBase: string): string {
    for (const extension of [".tsx", ".jsx", ".js", ".ts", ".mdx", ".md", ".txt", ""]) {
        const fullPath = path.join(basePath, relativePathBase + extension);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) return fullPath;
    }
    throw new Error(`File not found for base: ${relativePathBase}`);
}

/** A path starting with `/` is from the website root; anything else is relative to the page. */
function resolveFilePath(basePath: string, relativePath: string): string {
    return relativePath.startsWith("/")
        ? findFileWithExtension(path.resolve("."), relativePath.slice(1))
        : findFileWithExtension(basePath, relativePath);
}

/**
 * Applies a per-line transform to lines outside fenced code blocks, leaving
 * fenced content untouched. Return null from the transform to drop the line.
 */
function mapLinesOutsideCodeFences(text: string, transform: (line: string) => string | null): string {
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
        .filter((line): line is string => line !== null)
        .join("\n");
}

/** A sample's source as a fenced block, with its own fences escaped. */
function fence(code: string, lang: string): string {
    return `\`\`\`${lang}\n${code.replace(/```/g, "\\`\\`\\`")}\n\`\`\``;
}

/**
 * Renders one docs page as markdown.
 *
 * @param body - The page's MDX without its frontmatter.
 * @param filePath - The page's source file, for resolving its imports.
 */
export function docsPageToMarkdown(body: string, filePath: string, title: string, description?: string): string {
    const basePath = path.dirname(path.resolve(filePath));

    // An MDX import statement: `import` at the start of a line, ending in
    // `from "…"` on the same statement — never across a blank line. A pattern
    // that spanned any number of lines matched a prose line starting with
    // "import to decide …" (backend/extending.md) through to the next import
    // inside a code sample, and deleted everything between. It is also only
    // applied outside code fences: an `import` in a sample is part of the sample.
    const importPattern = /^import\s+(?:(?!\n[ \t]*\n)[\s\S])+?\s+from\s+['"](.*?)['"];?$/gm;

    // Imported variable name → the raw file it names (Vite's `?raw` import).
    const importContents: Record<string, string> = {};
    for (const match of body.matchAll(importPattern)) {
        const [statement, importPath] = match;
        if (!importPath.endsWith("?raw")) continue;
        const varName = statement.match(/import\s+([a-zA-Z0-9_]+)\s+from/)?.[1];
        if (!varName) {
            console.warn(`Could not extract variable name from import: "${statement}"`);
            continue;
        }
        try {
            importContents[varName] = fs.readFileSync(resolveFilePath(basePath, importPath.replace(/\?raw$/, "")), "utf-8");
        } catch (error) {
            console.error(`Error processing import "${statement}" in ${filePath}:`, error instanceof Error ? error.message : error);
        }
    }

    let content = body
        .split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m)
        .map((segment, i) => i % 2 === 1 ? segment : segment.replace(importPattern, ""))
        .join("");

    content = content.replace(
        /<Code\s+code=\{([a-zA-Z0-9_]+)\}(?:\s+lang=["']([^"']+)["'])?\s*\/>/g,
        (match, varName: string, lang: string = "tsx") => {
            if (varName in importContents) return fence(importContents[varName], lang);
            console.warn(`No content found for variable "${varName}" in ${filePath}. Leaving <Code> as is.`);
            return match;
        }
    );

    content = content.replace(
        /<CodeSampleWithSource\s+path=["']([^"']+)["'](?:\s+lang=["']([^"']+)["'])?\s*\/>/g,
        (match, componentPath: string, lang: string = "tsx") => {
            try {
                return fence(fs.readFileSync(resolveFilePath(basePath, componentPath), "utf-8"), lang);
            } catch (error) {
                console.error(`Error processing CodeSampleWithSource "${componentPath}" in ${filePath}:`, error instanceof Error ? error.message : error);
                return match;
            }
        }
    );

    // Self-closing component tags with no text form (`<AdminDemoCarousel … />`)
    // are dropped, and site links made absolute — only in prose: a relative
    // link inside a fence is the literal content of the file being documented.
    content = mapLinesOutsideCodeFences(content, (line) =>
        /^\s*<[A-Z][A-Za-z0-9]*(\s[^>]*)?\/>\s*$/.test(line)
            ? null
            : line.replaceAll("](/", `](${SITE}/`)
    );

    const summary = description ? `> ${description.replace(/\s+/g, " ").trim()}\n\n` : "";
    return `# ${title}\n\n${summary}${content.trim()}\n`.replace(/\n{3,}/g, "\n\n");
}
