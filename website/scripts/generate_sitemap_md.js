import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractSidebarSlugs } from "./sidebar-slugs.js";

// This script generates website/public/sitemap.md alongside sitemap.xml
// It lists all pages on the website in Markdown format for AI agents (Claude, GPT, Perplexity, etc.)

(async () => {
    const configFilePath = "../astro.config.mjs";
    const outputFilePath = "./public/sitemap.md";
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const absoluteConfigPath = path.resolve(__dirname, configFilePath);
    
    let slugs = [];
    try {
        // Shared with generate_llms_txt.js, and it expands
        // `{ autogenerate: { directory } }` groups: a `slug:`-only scan misses
        // every page Starlight lists that way, which was the whole UI component
        // reference.
        const found = extractSidebarSlugs(
            absoluteConfigPath,
            path.resolve(__dirname, "../src/content/docs")
        );
        if (found === null) {
            console.warn("Could not find sidebar config in astro.config.mjs, using default fallback slugs.");
            slugs = ["index", "getting-started/quickstart"];
        } else {
            slugs = found;
        }
    } catch (e) {
        console.error("Error reading astro.config.mjs:", e.message);
        slugs = ["index", "getting-started/quickstart"];
    }
    
    /*
     * The marketing routes, read off the routes.
     *
     * This was sixteen hand-written rows in a file that calls itself a list of
     * "all pages of the Rebase website", against thirty-one routes: the word
     * "pricing" appeared in it zero times, and so did every comparison page.
     * A hand-kept mirror of a directory is a mirror that is wrong from the next
     * page onwards, and `robots.txt` points crawlers at this file.
     *
     * `noindex` routes are left out — the pitch deck is a page we ask engines
     * not to list, so listing it in the sitemap an agent reads would be asking
     * twice and meaning neither.
     */
    const pagesDir = path.resolve(__dirname, "../src/pages/[...lang]");
    const NAMES = {
        index: "Home",
        compare: "Compare Rebase",
        cms: "Rebase CMS",
        studio: "Rebase Studio",
        sdk: "Client SDK",
        cli: "CLI Tooling",
        backend: "Backend & APIs",
        ai: "AI & Agents",
        security: "Security & Auth",
        ui: "UI Components",
        startups: "For Startups",
        agencies: "For Agencies",
        about: "About Rebase",
        developers: "Developers Overview",
        product: "Product Catalog",
        contact: "Contact",
        "rls-check": "rls-check (free RLS audit)",
        "kit-digital": "Kit Digital",
        europe: "European hosting"
    };
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    const titleFor = (slug) => {
        if (NAMES[slug]) return NAMES[slug];
        // The comparison pages read as a sentence, not as a slug: "Rebase vs
        // Supabase", never "Rebase Vs Supabase".
        const versus = /^rebase-vs-(.+)$/.exec(slug);
        if (versus) return `Rebase vs ${cap(versus[1])}`;
        return slug.split("-").map(cap).join(" ");
    };

    const marketingPages = fs
        .readdirSync(pagesDir)
        .filter(file => file.endsWith(".astro"))
        .filter(file => !/noindex/.test(fs.readFileSync(path.join(pagesDir, file), "utf-8")))
        .map(file => file.replace(/\.astro$/, ""))
        .sort()
        .map(slug => ({ name: titleFor(slug), path: slug === "index" ? "/" : `/${slug}` }));

    /* `alternatives/[competitor].astro` is one route per entry in the data file.
       They are real pages with real content and had no row here either. */
    const alternativesSource = fs.readFileSync(
        path.resolve(__dirname, "../src/data/alternatives.ts"), "utf-8");
    const alternativesBlock = alternativesSource.slice(
        alternativesSource.indexOf("export const ALTERNATIVES_PAGES"));
    for (const m of alternativesBlock.matchAll(/slug:\s*"([a-z0-9-]+)",\s*\n\s*name:\s*"([^"]+)"/g)) {
        marketingPages.push({ name: `${m[2]} alternatives`, path: `/alternatives/${m[1]}`, md: false });
    }
    
    const languages = ["en", "es", "de", "fr"];
    
    let mdContent = `# Rebase Sitemap (Markdown Format for AI Agents)
    
This sitemap lists all pages of the Rebase website and documentation. It is formatted specifically for AI agents, web crawlers, and search engines.

## Marketing Pages (Multilingual)
`;

    for (const lang of languages) {
        const langPrefix = lang === "en" ? "" : `/${lang}`;
        const langName = lang.toUpperCase();
        mdContent += `\n### ${langName} Pages\n`;
        for (const page of marketingPages) {
            const pagePath = page.path === "/" ? (langPrefix || "/") : `${langPrefix}${page.path}`;
            const fullUrl = `https://rebase.pro${pagePath}`;
            
            // `[page].md.ts` mirrors the flat routes only; the nested
            // `/alternatives/*` pages have no `.md` twin, and advertising one
            // would put a 404 in the file that claims to list every page.
            if (page.md === false) {
                mdContent += `- [${page.name} (${langName})](${fullUrl})\n`;
                continue;
            }

            let fullMdUrl;
            if (pagePath === "/" || pagePath === "/es" || pagePath === "/de" || pagePath === "/fr") {
                const prefix = pagePath === "/" ? "" : pagePath;
                fullMdUrl = `https://rebase.pro${prefix}/index.md`;
            } else {
                fullMdUrl = `https://rebase.pro${pagePath}.md`;
            }

            mdContent += `- [${page.name} (${langName})](${fullUrl}) — [Markdown Version](${fullMdUrl})\n`;
        }
    }
    
    mdContent += `\n## Documentation (Multilingual)\n`;
    
    for (const lang of languages) {
        const langPrefix = lang === "en" ? "" : `/${lang}`;
        const langName = lang.toUpperCase();
        mdContent += `\n### ${langName} Documentation\n`;
        for (const slug of slugs) {
            const fullUrl = `https://rebase.pro${langPrefix}/${slug}`;
            const cleanTitle = slug
                .split("/")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).replace("-", " "))
                .join(" > ");
            mdContent += `- [${cleanTitle} (${langName})](${fullUrl})\n`;
        }
    }
    
    fs.writeFileSync(outputFilePath, mdContent, "utf-8");
    console.log(`✓ Successfully generated ${outputFilePath}`);
})();
