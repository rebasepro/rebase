import type { APIRoute } from "astro";
import { languages, defaultLang } from "../../i18n/ui";
import { generateMarkdownForPage } from "../../utils/markdownGenerator";

/**
 * Every marketing route, from the routes themselves.
 *
 * This was a hand-kept list of sixteen slugs against thirty-one routes, so
 * `/pricing`, `/rls-check`, `/europe`, `/manifesto` and all eight `rebase-vs-*`
 * pages had no `.md` twin — the mirrors an agent reads did not include the
 * pricing page. A literal list of routes next to the routes is a list that goes
 * stale the first time somebody adds a page, and nothing about adding a page
 * makes you think of this file.
 *
 * `index` is excluded because `index.md.ts` next door serves it, and
 * `generateMarkdownForPage` gives every slug it has no bespoke section for a
 * generic mirror rather than a 404. `check_site.mjs` asserts the two sets stay
 * equal.
 */
const PAGES = Object.keys(import.meta.glob("./*.astro"))
  .map((file) => file.replace(/^\.\//, "").replace(/\.astro$/, ""))
  .filter((slug) => slug !== "index")
  .sort();

export function getStaticPaths() {
  const paths = [];
  for (const lang of Object.keys(languages)) {
    for (const page of PAGES) {
      paths.push({
        params: {
          lang: lang === defaultLang ? undefined : lang,
          page
        }
      });
    }
  }
  return paths;
}

export const GET: APIRoute = async ({ params }) => {
  const lang = params.lang || defaultLang;
  const page = params.page || "";
  const markdown = generateMarkdownForPage(page, lang);
  
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });
};
