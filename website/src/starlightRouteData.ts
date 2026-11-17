import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { getCollection } from "astro:content";

/**
 * A docs page with no translation still gets a route in every locale: Starlight
 * renders the English entry under `/de/docs/…` with `lang="de"`, a canonical
 * pointing at itself, and hreflang links naming it the German page. That was
 * 100 pages per locale — 500 English copies Search Console filed under "not
 * indexed", crawled at the expense of the pages worth indexing.
 *
 * A fallback route now names the English page as canonical and asks not to be
 * indexed, which also keeps it out of the sitemap (see `astro.config.mjs`). And
 * no page offers a fallback as a language alternate: hreflang may only point at
 * an indexable page that really is in that language.
 */

/**
 * Whether real translations of the docs are offered to search engines.
 *
 * Off since 2026-11-17. Search Console showed Google indexing 101 of
 * rebase.pro's ~1,200 sitemap URLs and the count falling (153 on 11/08), with
 * 894 more "Discovered - currently not indexed" that it would not even fetch.
 * 715 of those URLs were translations of the 252 English docs pages. On a
 * domain with no reputation yet, every URL competes for the same small crawl
 * and trust allowance, and five copies of each page spent it on the copies.
 *
 * So every translated docs page is `noindex, follow`, which also takes it out
 * of the sitemap (see `astro.config.mjs`), and no docs page offers a language
 * alternate, because hreflang may only point at an indexable page. The pages
 * stay built and linked from the language picker for readers. Flip this back
 * once the English docs are indexed.
 */
const TRANSLATIONS_INDEXED = false;

let docIds: Promise<Set<string>> | undefined;

/** Every docs entry id, which is also the path it is served at. */
function translatedPaths(): Promise<Set<string>> {
    docIds ??= getCollection("docs").then(entries => new Set(entries.map(entry => entry.id)));
    return docIds;
}

export const onRequest = defineRouteMiddleware(async (context) => {
    const route = context.locals.starlightRoute;
    const existing = await translatedPaths();

    const isAlternate = (attrs: Record<string, unknown> | undefined) =>
        attrs?.rel === "alternate" && typeof attrs.hreflang === "string" && typeof attrs.href === "string";

    if (route.isFallback) {
        const english = route.head.find(({ attrs }) => isAlternate(attrs) && attrs?.hreflang === "x-default")?.attrs?.href;
        route.head = route.head
            .filter(({ attrs }) => !isAlternate(attrs))
            .map(entry => {
                if (english === undefined) return entry;
                if (entry.tag === "link" && entry.attrs?.rel === "canonical") return { ...entry, attrs: { ...entry.attrs, href: english } };
                if (entry.tag === "meta" && entry.attrs?.property === "og:url") return { ...entry, attrs: { ...entry.attrs, content: english } };
                return entry;
            });
        route.head.push({ tag: "meta", attrs: { name: "robots", content: "noindex, follow" } });
        return;
    }

    if (!TRANSLATIONS_INDEXED && route.locale !== undefined) {
        route.head = route.head.filter(({ attrs }) => !isAlternate(attrs));
        route.head.push({ tag: "meta", attrs: { name: "robots", content: "noindex, follow" } });
        return;
    }

    route.head = route.head.filter(({ attrs }) => {
        if (!isAlternate(attrs)) return true;
        if (!TRANSLATIONS_INDEXED) return false;
        const path = new URL(String(attrs?.href)).pathname.replace(/^\/|\/$/g, "");
        return existing.has(path);
    });
});
