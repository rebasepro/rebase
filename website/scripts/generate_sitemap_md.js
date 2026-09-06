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
    
    const marketingPages = [
        { name: "Home", path: "/" },
        { name: "Compare Rebase", path: "/compare" },
        { name: "Rebase CMS", path: "/cms" },
        { name: "Rebase Studio", path: "/studio" },
        { name: "Client SDK", path: "/sdk" },
        { name: "CLI Tooling", path: "/cli" },
        { name: "Backend & APIs", path: "/backend" },
        { name: "AI & Agents", path: "/ai" },
        { name: "Security & Auth", path: "/security" },
        { name: "UI Components", path: "/ui" },
        { name: "For Startups", path: "/startups" },
        { name: "For Agencies", path: "/agencies" },
        { name: "About Rebase", path: "/about" },
        { name: "Developers Overview", path: "/developers" },
        { name: "Product Catalog", path: "/product" },
        { name: "Contact", path: "/contact" }
    ];
    
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
