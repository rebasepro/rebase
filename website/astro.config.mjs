// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import path from "node:path";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";
import yaml from "@rollup/plugin-yaml";

// https://astro.build/config
export default defineConfig({
    site: "https://rebase.pro",
    integrations: [
        react({
            experimentalReactChildren: true
        }),
        starlight({
            title: "Rebase Docs",
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
                        { label: "Environment & Configuration", slug: "docs/getting-started/configuration" }
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
                        { label: "REST & GraphQL API", slug: "docs/backend/api" },
                        { label: "Authentication", slug: "docs/backend/authentication" },
                        { label: "Storage Configuration", slug: "docs/backend/storage" },
                        { label: "Realtime & WebSocket", slug: "docs/backend/realtime" },
                        { label: "Cron Jobs", slug: "docs/backend/cron-jobs" },
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
                        { label: "Authentication & Login", slug: "docs/frontend/authentication" },
                        { label: "Storage & File Uploads", slug: "docs/frontend/storage" },
                        { label: "View Modes", slug: "docs/frontend/view-modes" },
                        { label: "Custom Fields", slug: "docs/frontend/custom-fields" },
                        { label: "Entity Views", slug: "docs/frontend/entity-views" },
                        { label: "Entity Actions", slug: "docs/frontend/entity-actions" },
                        { label: "Additional Columns", slug: "docs/frontend/additional-columns" },
                        { label: "Data Import & Export", slug: "docs/frontend/data-import-export" },
                        { label: "Plugins", slug: "docs/plugins" },
                        { label: "Hooks Reference", slug: "docs/hooks" }
                    ]
                },
                {
                    label: "Client SDK",
                    collapsed: false,
                    items: [
                        { label: "Getting Started", slug: "docs/sdk" },
                        { label: "Querying Data", slug: "docs/sdk/querying" },
                        { label: "Authentication", slug: "docs/sdk/authentication" },
                        { label: "Realtime Subscriptions", slug: "docs/sdk/realtime" },
                        { label: "Storage & Files", slug: "docs/sdk/storage" }
                    ]
                },
                {
                    label: "CLI & Tooling",
                    collapsed: true,
                    items: [
                        { label: "CLI Commands", slug: "docs/cli" },
                        { label: "Schema Generation", slug: "docs/cli/schema" },
                        { label: "Studio", slug: "docs/studio" }
                    ]
                },
                {
                    label: "Architecture",
                    collapsed: true,
                    items: [
                        { label: "How Rebase Works", slug: "docs/architecture" },
                        { label: "Schema as Code", slug: "docs/architecture/schema-as-code" }
                    ]
                },
                {
                    label: "Deployment",
                    collapsed: true,
                    items: [
                        { label: "Deployment Guide", slug: "docs/getting-started/deployment" },
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
    vite: {
        plugins: [
            tailwindcss(),
            yaml()
        ],
        resolve: {
            dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
            alias: {
                "@rebasepro/ui": path.resolve(new URL(".", import.meta.url).pathname, "../packages/ui/src"),
                "@rebasepro/editor": path.resolve(new URL(".", import.meta.url).pathname, "../packages/editor/src"),
                "@rebasepro/admin": path.resolve(new URL(".", import.meta.url).pathname, "../packages/admin/src")
            }
        },
        optimizeDeps: {
            include: [
                "react",
                "react-dom",
                "react/jsx-runtime",
                "react/jsx-dev-runtime",
                "react-dom/client"
            ]
        },
        ssr: {
            noExternal: ["lucide-react"]
        },
        server: {
            fs: {
                allow: [path.resolve(new URL(".", import.meta.url).pathname, ".."), path.resolve(new URL(".", import.meta.url).pathname, ".")]
            }
        }
    }
});
