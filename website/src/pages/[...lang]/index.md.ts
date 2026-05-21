import type { APIRoute } from "astro";
import { languages, defaultLang } from "../../i18n/ui";
import { generateMarkdownForPage } from "../../utils/markdownGenerator";

export function getStaticPaths() {
  return Object.keys(languages).map((lang) => ({
    params: { lang: lang === defaultLang ? undefined : lang }
  }));
}

export const GET: APIRoute = async ({ params }) => {
  const lang = params.lang || defaultLang;
  const markdown = generateMarkdownForPage("index", lang);
  
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });
};
