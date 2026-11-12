# The Rebase monorepo

For development of the Rebase framework itself, the repository is organized as a modular monorepo:

```
rebase/
├── app/                      # Example application (same shape as a scaffolded project)
│   ├── frontend/             # React frontend (Vite)
│   ├── backend/              # Hono backend server
│   │   └── schema/           # The tables: one defineTable per file, exported from index.ts
│   └── frontend/src/cms/     # customizeTable files: how each table looks in the CMS
├── packages/                 # each directory is its package: `@rebasepro/<dir>`
│   ├── types/                # shared kernel — isomorphic, no UI, no node; src/schema/ is defineTable, col, rel, json
│   ├── utils/
│   ├── common/
│   ├── cms-types/            # the CMS's types: `TableCustomizationOptions`, field options, plugins
│   ├── client/               # the SDK
│   ├── server/               # BaaS — Hono coordinator. Never imports a UI package
│   ├── server-postgres/      # database driver
│   ├── cli/
│   ├── codegen/
│   ├── inference/
│   ├── mcp/
│   ├── rls-check/            # the standalone RLS audit
│   ├── ui/                   # component library — React tier
│   ├── forms/
│   ├── app/                  # the runtime the CMS/studio/plugins register into
│   ├── cms/                  # the admin panel: a collection per served table, plus `customizeTable`
│   ├── firebase/
│   ├── studio/               # Full — BaaS console (cms is an optional peer)
│   ├── plugin-ai/
│   └── plugin-insights/
├── pnpm-workspace.yaml
└── package.json
```

The tiers are adoption modes, not separate products — see `docs/MODULAR-ARCHITECTURE.md`.
A BaaS install is `server` + a driver + `client`, with no React in the tree.

## Package Reference

| Package | Purpose | When to use |
|---------|---------|-------------|
| `@rebasepro/server` | Hono server coordinator, API generation, auth middleware, storage, email, cron, custom functions. `@rebasepro/server/schema` is the table-authoring subpath (`defineTable`, `col`, `rel`, `json`), which loads no server code; `@rebasepro/server/functions` is what route handlers import | Backend entry point — every Rebase backend imports this |
| `@rebasepro/server-postgres` | PostgreSQL bootstrapper and Drizzle ORM data driver | Backend setup when using PostgreSQL |
| `@rebasepro/app` | The frontend runtime: hooks, providers, context, the auth controller (`useRebaseAuthController`) and `LoginView` | Frontend — React integration, hooks, providers, auth flows |
| `@rebasepro/types` | Shared TypeScript type definitions (`TableDef`, `TableDescriptor`, `SecurityRule`, `policy`, `RebaseClient`, etc.) | Type imports across all packages |
| `@rebasepro/ui` | Standalone component library (Tailwind CSS v4 + Radix) | Building custom views in Studio or standalone UI |
| `@rebasepro/cms` | The CMS: `RebaseCMS`, `customizeTable`, collection views, entity forms, collection editor — derived from the tables the backend serves at `GET /api/schema/tables` | The admin panel. Needs no per-table code |
| `@rebasepro/studio` | The BaaS console: SQL editor, schema visualizer, RLS editor, storage browser, logs, API explorer, API keys, backups, cron | Database tooling. Ships on BaaS with no CMS — `@rebasepro/cms` is an optional peer |
| `@rebasepro/client` | Client SDK for consuming the Rebase API | Any client-side or script-side data operations |
| `@rebasepro/firebase` | Firestore in the CMS: `defineFirestoreCollection`, `useFirestoreDataSource`, Firebase auth | Showing Firestore collections next to the tables (`<RebaseCMS externalCollections>`) |
| `@rebasepro/common` | Shared utilities, the schema compiler (`compileTables`), `composeTableHooks` | Shared helpers |
| `@rebasepro/forms` | Form engine | Building dynamic forms from a table's fields |
| `@rebasepro/mcp` | AI agent MCP tools | The MCP server that agents use |
| `@rebasepro/codegen` | Typed SDK generation from the table descriptors | Used by `rebase generate-sdk` command |
| `@rebasepro/inference` | Infer a schema from existing data | Used by the CMS collection editor and data import (`rebase schema introspect` is the driver's own) |
| `@rebasepro/plugin-ai` | AI-powered data autofill | Studio plugin for auto-completing fields |
| `@rebasepro/plugin-insights` | Figures for KPI tiles and charts | `useInsightData` — loads a figure once per signed-in user; the tiles and charts that draw it are `KpiTile`, `TimeSeriesChart` and `BarChart` in `@rebasepro/ui` |
| `@rebasepro/cli` | CLI tool | The `rebase` CLI binary |
| `@rebasepro/utils` | Utility functions | Low-level shared helpers |
