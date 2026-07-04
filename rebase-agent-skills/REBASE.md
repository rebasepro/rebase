---
name: rebase
description: Rebase is an open-source Backend-as-a-Service (BaaS). The master skill to understand the Rebase ecosystem.
---

# What is Rebase?

**Rebase** is a fully open-source, Docker-ready Backend-as-a-Service (BaaS) alternative to Supabase — natively built in TypeScript, powered by Hono and Drizzle ORM.

It provides **auto-generated REST APIs**, **built-in authentication**, **role-based access control (RBAC)**, **row-level security (RLS)**, **file storage**, **realtime updates**, and a **visual admin studio** — all from TypeScript collection definitions.

## Key Services

| Service | Description |
|---------|-------------|
| **Collections** | Schema-as-Code data models with full CRUD endpoints |
| **Authentication** | Built-in JWT auth with Google OAuth support |
| **Roles & RLS** | Application-level row-level security policies |
| **Storage** | Local or S3-compatible file storage |
| **Realtime** | WebSocket-based live updates (LISTEN/NOTIFY) |
| **Studio** | Visual admin panel (table, cards, kanban, list views) |
| **Collection Editor** | AST-backed visual schema editing |
| **Custom Functions** | Auto-mounted Hono route files |
| **Cron Jobs** | Auto-scheduled background jobs |
| **Snapshot History** | Audit trails with diff viewer |
| **Data Enhancement** | AI-powered autofill plugin |

## Core Philosophy

### Schema-as-Code
Collections are defined as standalone TypeScript files (e.g., `config/collections/posts.ts`). This preserves rich configuration — validation, callbacks, enum definitions, relations — while enabling both visual and code-based editing.

### Collection Callbacks
Collections support lifecycle hooks (`beforeSave`, `afterSave`, `afterRead`, `beforeDelete`, `afterDelete`) for business logic, data synchronization, and side effects. **Use callbacks instead of raw SQL triggers or external scripts.**

### Inline Relations
Relations are defined **directly on the property** using `type: "relation"` with `target`, `cardinality`, and `direction`. There is no separate `relations[]` array — the framework auto-extracts relations during collection normalization.

### Two-Step Migrations
1. `rebase schema generate` — Converts collections to a Drizzle ORM schema
2. `rebase db push` (dev) or `rebase db generate && rebase db migrate` (production)

## Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (frontend + backend) |
| `rebase schema generate` | Collections → Drizzle schema |
| `rebase db push` | Apply schema to dev database |
| `rebase db generate` | Generate SQL migration files |
| `rebase db migrate` | Apply pending migrations |
| `rebase login` | Authenticate with Rebase Cloud |
| `rebase deploy` | Deploy to Rebase Cloud |

## Detailed Skills

For specific topics, see:
- `rebase-basics` — Setup, CLI, MCP tools, project structure
- `rebase-collections` — Collection schemas, properties, relations, callbacks, snapshot actions
- `rebase-backend-postgres` — PostgreSQL setup, Drizzle, migrations, bootstrapper protocol
- `rebase-auth` — Authentication, roles, RLS policies
- `rebase-studio` — Visual admin panel, collection editor, custom views
- `rebase-deployment` — Rebase Cloud, Docker, Firebase Hosting
- `rebase-storage` — File uploads, S3, local storage
- `rebase-custom-functions` — Custom Hono API routes + frontend invocation via `client.functions.invoke()`
- `rebase-cron-jobs` — Scheduled background jobs

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
