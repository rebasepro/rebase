# The Rebase monorepo

For development of the Rebase framework itself, the repository is organized as a modular monorepo:

```
rebase/
├── app/                      # Example application (same shape as a scaffolded project)
│   ├── frontend/             # React frontend (Vite)
│   ├── backend/              # Hono backend server
│   └── config/               # Application configuration
│       └── collections/      # TypeScript collection files (one per collection)
├── packages/                 # each directory is its package: `@rebasepro/<dir>`
│   ├── types/                # shared kernel — isomorphic, no UI, no node
│   ├── utils/
│   ├── common/
│   ├── cms-types/            # `defineCollection` and the authored collection shape
│   ├── client/               # the SDK
│   ├── client-postgres/
│   ├── server/               # BaaS — Hono coordinator. Never imports a UI package
│   ├── server-postgres/      # database driver
│   ├── server-mongo/         # database driver
│   ├── cli/
│   ├── codegen/
│   ├── inference/
│   ├── mcp/
│   ├── rls-check/            # the standalone RLS audit
│   ├── ui/                   # component library — React tier
│   ├── forms/
│   ├── app/                  # the runtime the CMS/studio/plugins register into
│   ├── cms/                  # the admin panel, built from collection files
│   ├── firebase/
│   ├── studio/               # Full — BaaS console (cms is an optional peer)
│   ├── plugin-ai/
│   └── plugin-insights/
├── pnpm-workspace.yaml
└── package.json
```

The tiers are adoption modes, not separate products — see `MODULAR-ARCHITECTURE.md`.
A BaaS install is `server` + a driver + `client`, with no React in the tree.

## Package Reference

| Package | Purpose | When to use |
|---------|---------|-------------|
| `@rebasepro/server` | Hono server coordinator, API generation, auth middleware, storage, email, cron, custom functions | Backend entry point — every Rebase backend imports this |
| `@rebasepro/server-postgres` | PostgreSQL bootstrapper and Drizzle ORM data driver | Backend setup when using PostgreSQL |
| `@rebasepro/server-mongo` | MongoDB bootstrapper and data driver | Backend setup when using MongoDB |
| `@rebasepro/app` | The frontend runtime: hooks, providers, context, the auth controller (`useRebaseAuthController`) and `LoginView` | Frontend — React integration, hooks, providers, auth flows |
| `@rebasepro/types` | Shared TypeScript type definitions (`PostgresCollectionConfig`, `CollectionConfig`, `RebaseClient`, etc.) | Type imports across all packages |
| `@rebasepro/ui` | Standalone component library (Tailwind CSS v4 + Radix) | Building custom views in Studio or standalone UI |
| `@rebasepro/cms` | The CMS: `RebaseCMS`, collection views, entity forms, collection editor — built from your collection definitions | The admin panel. Needs collection files |
| `@rebasepro/studio` | The BaaS console: SQL editor, schema visualizer, RLS editor, storage browser, logs, API explorer, API keys, backups, cron | Database tooling. Ships on BaaS with no CMS — `admin` is an optional peer |
| `@rebasepro/client` | Client SDK for consuming the Rebase API | Any client-side or script-side data operations |
| `@rebasepro/firebase` | Firebase client adapter | When connecting to a Firebase backend |
| `@rebasepro/common` | Shared utilities, `defaultUsersCollection` | Shared constants and default collection exports |
| `@rebasepro/forms` | Form engine | Building dynamic forms from collection schemas |
| `@rebasepro/mcp` | AI agent MCP tools | The MCP server that agents use |
| `@rebasepro/codegen` | Typed SDK generation from collection definitions | Used by `rebase generate-sdk` command |
| `@rebasepro/inference` | Auto-infer schema from data / database introspection | Used by `rebase schema introspect` |
| `@rebasepro/plugin-ai` | AI-powered data autofill | Studio plugin for auto-completing fields |
| `@rebasepro/plugin-insights` | Usage and data insights views | Plugin for analytics over your collections |
| `@rebasepro/cli` | CLI tool | The `rebase` CLI binary |
| `@rebasepro/utils` | Utility functions | Low-level shared helpers |
