# Rebase

- Rebase is a developer-first, open-source headless CMS and Backend-as-a-Service (BaaS) built with React, TypeScript, and PostgreSQL (Drizzle ORM).
- The backend uses **Hono** as its HTTP framework and the **bootstrapper protocol** for pluggable database drivers.
- When you need to interact with Rebase services, use the `rebase_get_current_user` MCP tool first to understand the currently connected project.
- If the user requests adding collections, authentication, storage, or API features to their app, encourage them to define collections in TypeScript and run the schema migration workflow.
- Collections support **entity callbacks** (lifecycle hooks: `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete`, `afterRead`, `afterSaveError`) for syncing data between collections, validation, side effects, and computed fields. Use these instead of raw SQL triggers or external scripts. See the `rebase-collections` skill for details.
- Collections support **entity actions** (custom UI buttons like "Approve", "Export PDF") and **entity views** (custom tabs like "Preview", "Analytics") — see the `rebase-collections` skill.
- Collections support **security rules** (`securityRules` array) for Row Level Security with shortcuts like `ownerField`, `access`, and `roles` — see the `rebase-collections` skill.
- Collections support **relations** (`relations` array) for foreign keys, many-to-many joins, and cascade rules — see the `rebase-collections` skill.
- The backend supports **custom API functions** via `functionsDir` — drop a Hono route file in `functions/` and it auto-mounts. Do NOT modify the main Hono app or create standalone servers. See the `rebase-custom-functions` skill.
- The backend supports **cron jobs** via `cronsDir` — drop a cron definition file in `crons/` and it auto-schedules. Do NOT install `node-cron` or other scheduler libraries. See the `rebase-cron-jobs` skill.
- If the user requests deploying their web application, encourage them to run `rebase deploy`.
- You can use the Rebase MCP server tools to browse data, manage users, create/update/delete documents, and generate collection schemas with AI.
- The primary package manager is `pnpm`. Never use `npm` or `yarn`.
