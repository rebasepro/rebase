// @ts-check
import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import path from "node:path";
import fs from "node:fs";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";
import yaml from "@rollup/plugin-yaml";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
    site: "https://rebase.pro",
    integrations: [
        react({
            experimentalReactChildren: true
        }),
        starlight({
            title: "Rebase Docs",
            // Starlight emits og:title, og:type, og:url and og:description and
            // no og:image at all, so every documentation page previewed as a
            // bare text card. One image for the whole section: a page-specific
            // one would mean generating 1,200 of them, and the section is the
            // useful unit anyway.
            head: [
                { tag: "meta", attrs: { property: "og:image", content: "https://rebase.pro/img/og/docs.png" } },
                { tag: "meta", attrs: { name: "twitter:image", content: "https://rebase.pro/img/og/docs.png" } },
                { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } }
            ],
            locales: { root: { label: "English", lang: "en" }, es: { label: "Español", lang: "es" }, de: { label: "Deutsch", lang: "de" }, fr: { label: "Français", lang: "fr" }, it: { label: "Italiano", lang: "it" }, pt: { label: "Português", lang: "pt" } },
            customCss: [
                "./src/styles/global.css",
                "./src/styles/starlight.css"
            ],
            social: [
                {
                    icon: "github",
                    label: "GitHub",
                    href: "https://github.com/rebasepro/rebase"
                }
            ],
            expressiveCode: {
                themes: ["github-dark"],
                styleOverrides: {
                    borderRadius: "0.5rem",
                    codeFontFamily: "var(--font-mono)",
                    codeFontSize: "0.875rem",
                    codeBackground: "var(--color-surface-900)"
                },
                frames: {
                    showCopyToClipboardButton: true
                },
                defaultProps: {
                    frame: "none"
                },
                shiki: {
                    // Two fence languages the docs use that Shiki does not resolve
                    // on its own, which made every build log four warnings and
                    // silently fall back to plain `txt`:
                    //
                    // - `env` — the grammar exists but is registered as `dotenv`
                    //   with no alias, and the blocks are plain KEY=value, so this
                    //   is an exact match.
                    // - `caddyfile` — no Caddy grammar is bundled. `nginx` is the
                    //   closest structural fit (site block, braces, directive plus
                    //   arguments) and highlights the host and directive correctly.
                    //   Swap this the day a real Caddy grammar ships.
                    langAlias: {
                        env: "dotenv",
                        caddyfile: "nginx"
                    }
                }
            },
            sidebar: [
                {
                    label: "Getting Started",
                    collapsed: false,
                    items: [
                        { label: "Introduction", slug: "docs" },
                        { label: "Quickstart", slug: "docs/getting-started/quickstart" },
                        { label: "Project Structure", slug: "docs/getting-started/project-structure" },
                        { label: "Environment & Configuration", slug: "docs/getting-started/configuration" },
                        { label: "Upgrading", slug: "docs/upgrading" },
                        { label: "Compatibility", slug: "docs/compatibility" }
                    ]
                },
                {
                    label: "Collections",
                    collapsed: false,
                    items: [
                        { label: "Defining Collections", slug: "docs/collections" },
                        { label: "Properties", slug: "docs/collections/properties" },
                        { label: "Relations", slug: "docs/collections/relations" },
                        { label: "Entity Callbacks", slug: "docs/collections/callbacks" },
                        { label: "Security Rules (RLS)", slug: "docs/collections/security-rules" }
                    ]
                },
                {
                    label: "Backend",
                    collapsed: false,
                    items: [
                        { label: "Backend Setup", slug: "docs/backend" },
                        { label: "REST API", slug: "docs/backend/api" },
                        { label: "Live schema editing", slug: "docs/backend/live-schema-editing" },
                        { label: "Authentication", slug: "docs/backend/authentication" },
                        { label: "Storage Configuration", slug: "docs/backend/storage" },
                        { label: "Multiple Sources", slug: "docs/backend/multiple-sources" },
                        { label: "MongoDB", slug: "docs/backend/mongodb" },
                        { label: "Realtime & WebSocket", slug: "docs/backend/realtime" },
                        { label: "Search", slug: "docs/backend/search" },
                        { label: "Indexes", slug: "docs/backend/indexes" },
                        { label: "Cron Jobs", slug: "docs/backend/cron-jobs" },
                        { label: "Background Jobs", slug: "docs/backend/jobs" },
                        { label: "Custom Functions", slug: "docs/backend/custom-functions" },
                        { label: "Global Hooks", slug: "docs/backend/hooks" },
                        { label: "Entity History", slug: "docs/backend/history" },
                        { label: "Database Branching", slug: "docs/backend/branching" },
                        { label: "Custom Server Integration", slug: "docs/backend/custom-server" }
                    ]
                },
                {
                    label: "Frontend",
                    collapsed: false,
                    items: [
                        { label: "Frontend Setup", slug: "docs/frontend" },
                        { label: "Extending Rebase", slug: "docs/frontend/extending" },
                        { label: "Styling Custom UI", slug: "docs/frontend/styling" },
                        { label: "Translations", slug: "docs/frontend/i18n" },
                        { label: "Component Overrides (Swizzling)", slug: "docs/frontend/component-overrides" },
                        { label: "Authentication & Login", slug: "docs/frontend/authentication" },
                        { label: "Storage & File Uploads", slug: "docs/frontend/storage" },
                        { label: "View Modes", slug: "docs/frontend/view-modes" },
                        { label: "Firebase", slug: "docs/frontend/firebase" },
                        { label: "Custom Fields", slug: "docs/frontend/custom-fields" },
                        { label: "Form Layout", slug: "docs/frontend/form-layout" },
                        { label: "Entity Views", slug: "docs/frontend/entity-views" },
                        { label: "Entity Actions", slug: "docs/frontend/entity-actions" },
                        { label: "Additional Columns", slug: "docs/frontend/additional-columns" },
                        { label: "Slots", slug: "docs/frontend/slots" },
                        { label: "Data Import & Export", slug: "docs/frontend/data-import-export" },
                        { label: "Plugins", slug: "docs/plugins" },
                        { label: "Hooks Reference", slug: "docs/hooks" }
                    ]
                },
                {
                    // Generated by tooling/design-sync/gen-ui-docs.mjs from the design
                    // system's own .d.ts and render-verified previews. Do not
                    // hand-edit the pages under docs/ui — regenerate them.
                    // Starlight >= 0.39 removed autogenerated *groups*: the
                    // autogenerate config goes inside `items`, not beside it.
                    label: "UI components",
                    collapsed: true,
                    items: [{ autogenerate: { directory: "docs/ui" } }]
                },
                {
                    label: "Client SDK",
                    collapsed: false,
                    items: [
                        { label: "Getting Started", slug: "docs/sdk" },
                        { label: "Querying Data", slug: "docs/sdk/querying" },
                        { label: "Authentication", slug: "docs/sdk/authentication" },
                        { label: "Realtime Subscriptions", slug: "docs/sdk/realtime" },
                        { label: "Offline & Local-First", slug: "docs/sdk/offline" },
                        { label: "Storage & Files", slug: "docs/sdk/storage" }
                    ]
                },
                {
                    label: "AI & Agents",
                    collapsed: false,
                    items: [
                        { label: "Overview", slug: "docs/ai" },
                        { label: "MCP Server", slug: "docs/ai/mcp" },
                        { label: "Agent Skills", slug: "docs/ai/skills" },
                        { label: "AI Instruction Files", slug: "docs/ai/instruction-files" }
                    ]
                },
                {
                    label: "CLI & Tooling",
                    collapsed: true,
                    items: [
                        { label: "CLI Commands", slug: "docs/cli" },
                        { label: "Schema Generation", slug: "docs/cli/schema" },
                        { label: "Studio", slug: "docs/studio" },
                        { label: "rls-check (RLS audit)", slug: "docs/rls-check" }
                    ]
                },
                {
                    label: "Architecture",
                    collapsed: true,
                    items: [
                        { label: "How Rebase Works", slug: "docs/architecture" },
                        { label: "Schema as Code", slug: "docs/architecture/schema-as-code" },
                        { label: "Runtime & Bundles", slug: "docs/architecture/runtime-and-bundles" },
                        { label: "Apps & Repositories", slug: "docs/architecture/apps-and-repositories" }
                    ]
                },
                {
                    label: "Deployment",
                    collapsed: true,
                    items: [
                        { label: "Deployment Guide", slug: "docs/getting-started/deployment" },
                        { label: "Rebase Cloud", slug: "docs/deployment/cloud" },
                        { label: "Self-Hosting", slug: "docs/deployment/self-hosting" },
                        { label: "Split Processes", slug: "docs/deployment/split-processes" },
                        { label: "Kubernetes", slug: "docs/deployment/kubernetes" },
                        { label: "AWS", slug: "docs/deployment/aws" },
                        { label: "Google Cloud", slug: "docs/deployment/gcp" },
                        { label: "Azure", slug: "docs/deployment/azure" },
                        { label: "Hetzner Cloud", slug: "docs/deployment/hetzner" },
                        { label: "Scaleway", slug: "docs/deployment/scaleway" },
                        { label: "Railway", slug: "docs/deployment/railway" },
                        { label: "Fly.io", slug: "docs/deployment/flyio" }
                    ]
                },
                {
                    label: "Recipes",
                    collapsed: true,
                    items: [
                        { label: "Blog CMS", slug: "docs/recipes/blog-cms" },
                        { label: "Custom Dashboard", slug: "docs/recipes/custom-dashboard" },
                        { label: "Webhook Integration", slug: "docs/recipes/webhooks" }
                    ]
                }
            ],
            components: {
                PageFrame: "./src/components/starlight/PageFrame.astro",
                Header: "./src/components/starlight/Header.astro",
                SiteTitle: "./src/components/starlight/SiteTitle.astro",
                Head: "./src/components/starlight/Head.astro"
            }
        }),
        mdx(),
        sitemap({
            i18n: {
                defaultLocale: 'en',
                locales: {
                    en: 'en',
                    es: 'es',
                    de: 'de',
                    fr: 'fr',
                    it: 'it',
                    pt: 'pt',
                },
            },
        })
    ],
    build: {
        // The only render-blocking resource left on the landing page was the
        // 28.5KB stylesheet, costing a full round trip before anything could
        // paint. Inlining trades the cross-page stylesheet cache for one fewer
        // hop on first paint, which is the right trade for a marketing site
        // where most visits are a cold single page view.
        inlineStylesheets: "always"
    },
    vite: {
        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        // Merge Astro's prefetch into ClientRouter
                        if (id.includes("astro/dist/assets/prefetch") ||
                            id.includes("ClientRouter") ||
                            id.includes("astro/transitions")) {
                            return "astro-router";
                        }
                        // Bundle React runtime into a single vendor chunk
                        if (id.includes("node_modules/react/") ||
                            id.includes("node_modules/react-dom/") ||
                            id.includes("react-compiler-runtime") ||
                            id.includes("node_modules/scheduler/") ||
                            id.includes("node_modules/clsx")) {
                            return "react-vendor";
                        }
                        // Bundle @firecms/neat together with NeatBackground
                        if (id.includes("@firecms/neat") ||
                            id.includes("NeatBackground")) {
                            return "neat";
                        }
                    }
                }
            }
        },
        plugins: [
            yaml(),
            tailwindcss()
        ],
        resolve: {
            dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "react-compiler-runtime"],
            alias: {
                "@rebasepro/ui": path.resolve(new URL(".", import.meta.url).pathname, "../packages/ui/src"),
                "@rebasepro/editor": path.resolve(new URL(".", import.meta.url).pathname, "../packages/editor/src"),
                "@rebasepro/cms": path.resolve(new URL(".", import.meta.url).pathname, "../packages/cms/src")
            }
        },
        optimizeDeps: {
            include: [
                "react",
                "react-dom",
                "react/jsx-runtime",
                "react/jsx-dev-runtime",
                "react-dom/client",
                "react-compiler-runtime"
            ]
        },
        ssr: {
            noExternal: ["lucide-react", "@firecms/neat"]
        },
        server: {
            fs: {
                allow: [
                    path.resolve(new URL(".", import.meta.url).pathname, ".."),
                    path.resolve(new URL(".", import.meta.url).pathname, "."),
                    path.resolve(new URL(".", import.meta.url).pathname, "../../neat"),
                    // A git worktree borrows the primary checkout's install by
                    // symlinking, so dependencies have realpaths OUTSIDE this
                    // project root and Vite 403s them. Two distinct places, and
                    // missing either one breaks the page in a way that looks like
                    // deleted code rather than a resolution failure:
                    //
                    //   .pnpm         — third-party deps, including @astrojs/react's
                    //                   client entry. Without it NOTHING hydrates:
                    //                   no Neat canvases, no live demos, just
                    //                   static HTML.
                    //   @rebasepro/*  — the workspace packages, linked to the
                    //                   primary's `packages/`. Without it the
                    //                   /ui reference view 403s on
                    //                   `packages/app/dist/index.es.js` and the
                    //                   island renders blank with no error.
                    //
                    // Both no-op in the primary checkout, where the realpath is
                    // already inside the root.
                    ...(() => {
                        const here = new URL(".", import.meta.url).pathname;
                        const roots = new Set();
                        const store = path.resolve(here, "../node_modules/.pnpm");
                        if (fs.existsSync(store)) roots.add(fs.realpathSync(store));
                        // Both scopes: pnpm puts the workspace links in the
                        // IMPORTER's own node_modules (website/), not only at the
                        // repo root, and it is the website one that carries
                        // @rebasepro/app. Checking only the root silently allows
                        // nothing and the 403 persists.
                        for (const rel of ["node_modules/@rebasepro", "../node_modules/@rebasepro"]) {
                            const scope = path.resolve(here, rel);
                            if (!fs.existsSync(scope)) continue;
                            for (const entry of fs.readdirSync(scope)) {
                                try {
                                    roots.add(path.dirname(fs.realpathSync(path.join(scope, entry))));
                                } catch { /* dangling link — nothing to allow */ }
                            }
                        }
                        return [...roots];
                    })()
                ]
            }
        }
    }
});
