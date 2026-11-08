import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { docsMarkdownPath, docsPageToMarkdown } from "../../utils/docsMarkdown";

/**
 * A `.md` twin for every English documentation page: `/docs/backend/auth` →
 * `/docs/backend/auth.md`, and the docs root → `/docs/index.md`. `llms.txt`
 * links to these, so an agent reads one page as markdown instead of scraping
 * the HTML.
 *
 * English only, like `llms.txt`. Translated pages keep their HTML.
 */
export const getStaticPaths = (async () => {
    const pages = await getCollection("docs", (entry) => entry.id === "docs" || entry.id.startsWith("docs/"));
    return pages.map((entry) => ({
        params: { slug: docsMarkdownPath(entry.id).replace(/^docs\//, "").replace(/\.md$/, "") },
        props: { entry }
    }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ entry: CollectionEntry<"docs"> }> = ({ props }) => {
    const { entry } = props;
    if (!entry.filePath || entry.body === undefined) {
        throw new Error(`Docs entry "${entry.id}" has no source file to render as markdown.`);
    }
    return new Response(docsPageToMarkdown(entry.body, entry.filePath, entry.data.title, entry.data.description), {
        headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=3600"
        }
    });
};
