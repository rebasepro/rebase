import { ui, defaultLang } from "../i18n/ui";

type LangKey = keyof typeof ui;

export function generateMarkdownForPage(page: string, lang: string): string {
  const currentLang = (lang in ui ? lang : defaultLang) as LangKey;
  const t = ui[currentLang];

  const tr = (key: string): string => {
    const val = (t as Record<string, string>)[key] || (ui[defaultLang] as Record<string, string>)[key] || "";
    return val;
  };

  const cleanHtml = (text: string): string => {
    return text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
      .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)")
      .replace(/<[^>]*>/g, "");
  };

  /**
   * `cleanHtml` turns `<br/>` into a newline, which is right in a paragraph and
   * wrong inside a bullet — a title carrying one split the list item across two
   * lines and broke the list. This also drops a trailing full stop, because
   * these titles are followed by a colon and "already running.:" is not a
   * sentence anyone wrote.
   */
  const inline = (text: string): string =>
    cleanHtml(text).replace(/\s+/g, " ").replace(/\s*[.:]\s*$/, "").trim();


  if (page === "index" || page === "") {
    /*
     * This is what an agent reads about Rebase — `/index.md` is what `llms.txt`
     * is assembled from — so it must say what the page says. It did not.
     *
     * It built "Key Benefits" from `howitworks.*`, copy that renders on NO page
     * (grep it), and whose bold term in each bullet is the PROBLEM rather than
     * the benefit. The rendered result read:
     *
     *     ## Key Benefits
     *     - **Boilerplate admin UIs**: ...
     *     - **Hand-rolled API layers**: ...
     *     - **Brittle auth & permissions**: ...
     *
     * — which tells a model that Rebase's key benefits are boilerplate admin
     * UIs and brittle auth. It then opened its feature list with kanban boards,
     * the first item SITE-STORY §2 puts BELOW the line as never-the-headline.
     *
     * It now mirrors the home page's beats in the page's own order, from keys
     * the page actually renders, so the two cannot drift without someone
     * noticing. See PRODUCT.md: "when a home-page beat changes, change the
     * generator in the same commit".
     */
    return `# ${cleanHtml(tr("index.meta.title"))}

${cleanHtml(tr("index.meta.description"))}

## What Rebase is

${cleanHtml(tr("hero.title.part1"))} ${cleanHtml(tr("hero.title.part2"))}

${cleanHtml(tr("hero.subtitle"))}

## The claims, in the order the page makes them

1. **One definition, every surface** — ${inline(tr("engine.title"))}: ${cleanHtml(tr("engine.subtitle"))}
2. **Security lives in the database** — ${inline(tr("security.title"))}: ${cleanHtml(tr("security.desc"))}
3. **Take only the half you need** — ${inline(tr("modes.title"))}: ${cleanHtml(tr("modes.subtitle"))}
4. **Agent-native** — ${inline(tr("agentera.badge"))}: ${cleanHtml(tr("agentera.p1"))}
5. **It is yours** — ${inline(tr("opensource.title"))}: ${cleanHtml(tr("opensource.desc"))}

## Three adoption modes

Rebase is adopted in layers, and each one is additive:

- **BaaS** — REST, a typed SDK, realtime, auth, storage, functions, cron and backups over your own Postgres. No React in the dependency tree.
- **CMS** — the above, plus a schema-driven admin panel generated from the same collection definitions.
- **Full** — the above, plus Studio: SQL editor, schema visualizer, RLS editor, logs and an API explorer.

Authorization is Postgres row-level security in every mode. \`npx @rebasepro/rls-check $DATABASE_URL\` audits any Postgres, read-only, with nothing installed.

## In the admin panel

Below the headline claims, and never a substitute for them:

- **${cleanHtml(tr("features.api.title"))}** (Badge: ${cleanHtml(tr("features.api.badge"))}): ${cleanHtml(tr("features.api.desc"))}
- **${cleanHtml(tr("features.sdk.title"))}** (Badge: ${cleanHtml(tr("features.sdk.badge"))}): ${cleanHtml(tr("features.sdk.desc"))}
- **${cleanHtml(tr("features.realtime.title"))}** (Badge: ${cleanHtml(tr("features.realtime.badge"))}): ${cleanHtml(tr("features.realtime.desc"))}
- **${cleanHtml(tr("features.customization.title"))}** (Badge: ${cleanHtml(tr("features.customization.badge"))}): ${cleanHtml(tr("features.customization.desc"))}
- **${cleanHtml(tr("features.history.title"))}** (Badge: ${cleanHtml(tr("features.history.badge"))}): ${cleanHtml(tr("features.history.desc"))}
- **${cleanHtml(tr("features.import.title"))}** (Badge: ${cleanHtml(tr("features.import.badge"))}): ${cleanHtml(tr("features.import.desc"))}
- **${cleanHtml(tr("features.kanban.title"))}** (Badge: ${cleanHtml(tr("features.kanban.badge"))}): ${cleanHtml(tr("features.kanban.desc"))}

## Frequently Asked Questions
- **${cleanHtml(tr("faq.q1"))}**
  ${cleanHtml(tr("faq.a1"))}
- **${cleanHtml(tr("faq.q2"))}**
  ${cleanHtml(tr("faq.a2"))}
- **${cleanHtml(tr("faq.q3"))}**
  ${cleanHtml(tr("faq.a3"))}
- **${cleanHtml(tr("faq.q4"))}**
  ${cleanHtml(tr("faq.a4"))}
- **${cleanHtml(tr("faq.q5"))}**
  ${cleanHtml(tr("faq.a5"))}
- **${cleanHtml(tr("faq.q6"))}**
  ${cleanHtml(tr("faq.a6"))}
- **${cleanHtml(tr("faq.q7"))}**
  ${cleanHtml(tr("faq.a7"))}
`;
  }

  if (page === "compare") {
    return `# Rebase compared to the alternatives

Rebase eliminates the custom boilerplate work between database, API, and UI by generating your admin panel and type-safe APIs directly from your database schema.

- **${cleanHtml(tr("opensource.title"))}**: ${cleanHtml(tr("opensource.desc"))}
- **${cleanHtml(tr("showcase.sync.title"))}**: ${cleanHtml(tr("showcase.sync.subtitle"))}
  - **${cleanHtml(tr("showcase.sync.tab1.title"))}**: ${cleanHtml(tr("showcase.sync.tab1.desc"))}
  - **${cleanHtml(tr("showcase.sync.tab2.title"))}**: ${cleanHtml(tr("showcase.sync.tab2.desc"))}
  - **${cleanHtml(tr("showcase.sync.tab3.title"))}**: ${cleanHtml(tr("showcase.sync.tab3.desc"))}
  - **${cleanHtml(tr("showcase.sync.tab4.title"))}**: ${cleanHtml(tr("showcase.sync.tab4.desc"))}
`;
  }

  if (page === "agencies") {
    return `# Rebase for Agencies

## ${cleanHtml(tr("agencies.hero.title"))}
${cleanHtml(tr("agencies.hero.subtitle"))}

### ${cleanHtml(tr("agencies.weapon.title"))}
${cleanHtml(tr("agencies.weapon.desc1"))}
${cleanHtml(tr("agencies.weapon.desc2"))}

### ${cleanHtml(tr("agencies.accelerate.title"))}
- **${cleanHtml(tr("agencies.accelerate.f1.title"))}**: ${cleanHtml(tr("agencies.accelerate.f1.desc"))}
- **${cleanHtml(tr("agencies.accelerate.f2.title"))}**: ${cleanHtml(tr("agencies.accelerate.f2.desc"))}
- **${cleanHtml(tr("agencies.accelerate.f3.title"))}**: ${cleanHtml(tr("agencies.accelerate.f3.desc"))}

### Customization & Developer Experience
${cleanHtml(tr("agencies.customize.title"))}
- ${cleanHtml(tr("agencies.customize.desc1"))}
- ${cleanHtml(tr("agencies.customize.desc2"))}

### Agency Features
- **${cleanHtml(tr("agencies.features.f1.title"))}**: ${cleanHtml(tr("agencies.features.f1.desc"))}
- **${cleanHtml(tr("agencies.features.f2.title"))}**: ${cleanHtml(tr("agencies.features.f2.desc"))}
- **${cleanHtml(tr("agencies.features.f3.title"))}**: ${cleanHtml(tr("agencies.features.f3.desc"))}
- **${cleanHtml(tr("agencies.features.f4.title"))}**: ${cleanHtml(tr("agencies.features.f4.desc"))}
- **${cleanHtml(tr("agencies.features.f5.title"))}**: ${cleanHtml(tr("agencies.features.f5.desc"))}
- **${cleanHtml(tr("agencies.features.f6.title"))}**: ${cleanHtml(tr("agencies.features.f6.desc"))}
`;
  }

  if (page === "about") {
    return `# About Rebase

## ${cleanHtml(tr("about.hero.title"))}
${cleanHtml(tr("about.hero.subtitle"))}

### Our Story
${cleanHtml(tr("about.story.p1"))}

${cleanHtml(tr("about.story.p2"))}

${cleanHtml(tr("about.story.p3"))}

### Our Values
- **${cleanHtml(tr("about.values.v1.title"))}**: ${cleanHtml(tr("about.values.v1.desc"))}
- **${cleanHtml(tr("about.values.v2.title"))}**: ${cleanHtml(tr("about.values.v2.desc"))}
- **${cleanHtml(tr("about.values.v3.title"))}**: ${cleanHtml(tr("about.values.v3.desc"))}
`;
  }

  if (page === "backend") {
    return `# Rebase — Backend & APIs

Define your collections in TypeScript and get a complete API server.

## Features
- **Hono & Drizzle Engine**: Built on lightweight Hono server and Drizzle ORM.
- **REST API**: Full CRUD endpoints with pagination, filtering, sorting, and relations.

- **WebSocket Realtime**: Live data subscriptions, broadcast channels, and presence tracking.
- **Auto-generated Documentation**: Instant OpenAPI/Swagger docs for all routes.
`;
  }

  if (page === "admin") {
    return `# Rebase — Admin panel

A generated back office that sits on top of a Rebase backend — optional, and a client of the same API.

## How it relates to the backend
- **Opt-in**: the \`admin\` block on a collection only type-checks once \`@rebasepro/cms-types\` is added to the project.
- **Non-invasive**: the server loads your collection files and never reads inside \`admin\`; the REST, auth and realtime APIs are identical with or without a panel.
- **Same data path**: the panel reads and writes through the same APIs you build on, under the same Postgres row-level security.

## Features
- **Every view**: data grid, cards, list and Kanban over the same rows, with inline editing.
- **Rich content editing**: block editor, Markdown fields and structured content written straight to Postgres.
- **Media & storage**: uploads and previews backed by your own storage bucket.
- **History & audit**: per-collection version history with side-by-side comparison and revert.
- **Import & export**: CSV, JSON and Excel with automatic field mapping.
- **Users & roles**: account management against the same roles your RLS policies read.
- **Extensible in React**: custom fields, previews, entity views and actions referenced from the \`admin\` block.
`;
  }

  if (page === "ai") {
    return `# Rebase — AI & Agents

Let AI agents read, write, and act on your Postgres data autonomously.

## Capabilities
- **Model Context Protocol (MCP) Server**: Exposes your Postgres database and admin tools directly to AI assistants like Cursor and Claude.
- **Scoped API Keys**: Per-collection, per-operation permissions for agents, enforced by Postgres row-level security on every query.
`;
  }

  if (page === "studio") {
    return `# Rebase Studio

A visual developer workspace to manage database content, edit schemas, and inspect logs.

## Features
- **Visual Schema Builder**: Edit tables, columns, relations, and permissions visually.
- **Spreadsheet Editing**: Edit Postgres records directly in a clean grid layout.
- **AST Syncing**: Visual editor changes are synchronized directly back to your local TypeScript schema files.
- **Developer Tools**: Explore SQL, RLS rules, custom cron jobs, and background workers in real time.
`;
  }

  if (page === "sdk") {
    return `# Rebase Client SDK

A type-safe client library to interact with your Rebase backend from client-side or server-side TypeScript.

## Features
- **Type Safety**: Automatic TypeScript types generated directly from your collection schemas.
- **CRUD Operations**: Securely fetch and update documents with IDE autocomplete.
- **Realtime Subscriptions**: Subscribe to table updates or broadcast channels over WebSockets.
- **Auth & Storage**: Built-in methods to handle login, sign-up, JWT auth, and resumable file uploads.
`;
  }

  if (page === "cli") {
    return `# Rebase CLI & Tooling

A powerful terminal CLI to scaffold, introspect, migrate, and deploy Rebase projects.

## Core Commands
- \`init\`: Initialize a new Rebase project in the current directory.
- \`pull\`: Introspect an existing PostgreSQL database schema and generate TypeScript collections.
- \`db:push\`: Push schema changes to your database.
- \`dev\`: Spin up the admin panel, API, and WebSocket server locally.
`;
  }

  if (page === "security") {
    return `# Rebase — Security & Auth

Bulletproof, version-controlled access control for your PostgreSQL database.

## Security Architecture
- **Row-Level Security (RLS)**: Define RLS policies directly in your TypeScript schema — no raw SQL required.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions per collection, per field, and per user role.
- **JWT Authentication**: Secure JSON Web Token plumbing out of the box.
- **SSO & OAuth**: OIDC single sign-on including Microsoft Entra ID, plus Google, GitHub, Apple, LinkedIn and more.
`;
  }

  if (page === "ui") {
    return `# Rebase UI Components

Tailwind-styled, accessible React components to build premium custom layouts.

## UI Toolkit
- **Spreadsheet Grids**: Performant, editable table views for large datasets.
- **Form Layouts**: Dynamic, schema-aware inputs, rich text editors, and file dropzones.
- **Visualizations**: Interactive chart widgets, dashboard metrics, and progress grids.
`;
  }

  if (page === "startups") {
    return `# Rebase for Startups

Ship your product faster with schema-driven development. Eliminate backend boilerplate and focus on your core product.

## Benefits
- **Zero Boilerplate**: Define your schema once; get admin, API, and SDK instantly.
- **Database Native**: Connect directly to your existing Postgres — no vendor lock-in.
- **Scale Securely**: RLS policies and JWT auth version-controlled in Git.
- **Cost Effective**: Open-source and free to run yourself, no per-seat developer pricing.
`;
  }

  if (page === "developers") {
    return `# Rebase — Developers Overview

A developer-first BaaS and admin dashboard framework built on TypeScript and React.

## Key Principles
- **Schema-as-Code**: Your TypeScript definitions are the single source of truth.
- **AST Generation**: Code changes flow bi-directionally between visual studio and Git.
- **Extensible**: Override form fields and add custom dashboard views using standard React components.
- **Lightweight**: Zero SSR, zero bloated monoliths — runs as a fast React SPA.
`;
  }

  if (page === "product") {
    return `# Rebase Product Ecosystem

Rebase combines an auto-generated admin panel, lightweight backend APIs, and a client SDK into a unified developer platform.

## Key Components
- **Lightweight API Engine**: Hono-based REST and WebSocket server.
- **Visual Studio**: Spreadsheet editor and visual schema manager syncing back to code.
- **TypeScript Client SDK**: Isomorphic library for type-safe queries, auth, and storage.
- **React UI Kit**: Reusable widgets and layout components to build custom admin dashboards.
`;
  }

  if (page === "contact") {
    return `# Contact Rebase Team

Get in touch for enterprise support, dedicated hosting plans, or custom database integrations.

- **Email**: hello@rebase.pro
- **GitHub**: https://github.com/rebasepro/rebase
- **Discord Community**: Join our developer community on Discord.
`;
  }

  const pageTitle = page.charAt(0).toUpperCase() + page.slice(1).replace("-", " ");
  return `# Rebase — ${pageTitle}

Manage your PostgreSQL database with a schema-driven admin panel and auto-generated APIs.

- **Developer First**: Built with React 19, TypeScript, and Hono.
- **Postgres Native**: Integrates with your existing database schemas, enums, relations, and RLS rules.
- **Fast Delivery**: Eliminates CRUD glue code.
- **Visual Schema Builder**: Customize your schema visually while keeping TypeScript definitions in version control.
`;
}
