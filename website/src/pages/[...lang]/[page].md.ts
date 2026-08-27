import type { APIRoute } from "astro";
import { languages, defaultLang } from "../../i18n/ui";
import { generateMarkdownForPage } from "../../utils/markdownGenerator";

const PAGES = [
  "compare",
  "cli",
  "sdk",
  "security",
  "ai",
  "about",
  "developers",
  "product",
  "contact",
  "agencies",
  "startups",
  "studio",
  "ui",
  "backend",
  "cms"
];

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
