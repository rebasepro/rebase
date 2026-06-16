import { defineMiddleware } from "astro:middleware";
import { ui, defaultLang } from "./i18n/ui";
import { generateMarkdownForPage } from "./utils/markdownGenerator";
import fs from "node:fs";
import path from "node:path";

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) {
    return next();
  }

  const acceptHeader = context.request.headers.get("accept") || "";
  const url = new URL(context.request.url);
  const formatParam = url.searchParams.get("format");
  
  console.log("MIDDLEWARE EXEC:", url.pathname, "Accept:", acceptHeader, "format:", formatParam);
  
  const wantsMarkdown = acceptHeader.includes("text/markdown") || 
                        acceptHeader.includes("text/x-markdown") || 
                        formatParam === "markdown" || 
                        formatParam === "md";
                        
  if (wantsMarkdown) {
    const pathname = url.pathname;
    
    // 1. Resolve language prefix
    // Path could be /, /es, /de, /fr, /docs/getting-started/quickstart, etc.
    const segments = pathname.split("/").filter(Boolean);
    let lang = defaultLang;
    let restSegments = [...segments];
    
    if (segments.length > 0 && segments[0] in ui) {
      lang = segments[0];
      restSegments = segments.slice(1);
    }
    
    // 2. Handle /docs/... routes
    const isDocRoute = restSegments[0] === "docs";
    if (isDocRoute) {
      // Find MD/MDX file under src/content/docs/[lang]/docs or src/content/docs/docs
      const docSubPath = restSegments.slice(1).join("/");
      
      const contentDir = lang === defaultLang
        ? path.join(process.cwd(), "src/content/docs/docs")
        : path.join(process.cwd(), "src/content/docs", lang, "docs");
      const mdPath = path.join(contentDir, docSubPath + ".md");
      const mdxPath = path.join(contentDir, docSubPath + ".mdx");
      const indexPath = path.join(contentDir, docSubPath, "index.md");
      const indexMdxPath = path.join(contentDir, docSubPath, "index.mdx");
      
      let docContent = "";
      if (fs.existsSync(mdPath)) {
        docContent = fs.readFileSync(mdPath, "utf-8");
      } else if (fs.existsSync(mdxPath)) {
        docContent = fs.readFileSync(mdxPath, "utf-8");
      } else if (fs.existsSync(indexPath)) {
        docContent = fs.readFileSync(indexPath, "utf-8");
      } else if (fs.existsSync(indexMdxPath)) {
        docContent = fs.readFileSync(indexMdxPath, "utf-8");
      }
      
      if (docContent) {
        // Strip frontmatter if we want clean markdown for AI agents
        const cleanContent = docContent.replace(/^---[\s\S]*?---\n*/, "");
        return new Response(cleanContent, {
          headers: {
            "content-type": "text/markdown; charset=utf-8"
          }
        });
      }
    } else {
      // 3. Handle marketing pages
      const page = restSegments[0] || "index";
      // Remove extensions if present (like .html or .md)
      const cleanPage = page.replace(/\.(html|md)$/i, "");
      
      const markdown = generateMarkdownForPage(cleanPage, lang);
      return new Response(markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8"
        }
      });
    }
  }
  
  return next();
});
