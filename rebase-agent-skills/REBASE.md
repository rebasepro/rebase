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
| **Authentication** | Built-in JWT auth, twelve OAuth providers, magic links, anonymous sign-in and TOTP two-factor |
| **Roles & RLS** | **Database-level** row-level security — collections compile to real PostgreSQL policies, and the app role reaches SQL through `rebase.uid()` / `rebase.roles()` |
| **Storage** | Local, S3-compatible, or Google Cloud Storage — always via `rebase.storage` (never a cloud SDK directly) |
| **Realtime** | WebSocket-based live updates (LISTEN/NOTIFY) |
| **Offline** | Opt-in local-first sync in the client SDK — local row database, queued writes, live queries |
| **Studio** | Visual admin panel (table, cards, kanban, list views) |
| **Collection Editor** | AST-backed visual schema editing |
| **Custom Functions** | Auto-mounted Hono route files |
| **Cron Jobs** | Auto-scheduled background jobs |
| **Entity History** | Audit trails with diff viewer |
| **Data Enhancement** | AI-powered autofill plugin |

## Core Philosophy

### Schema-as-Code
Collections are defined as standalone TypeScript files (e.g., `config/collections/posts.ts`). This preserves rich configuration — validation, callbacks, enum definitions, relations — while enabling both visual and code-based editing.

### Collection Callbacks
Collections support lifecycle hooks (`beforeSave`, `afterSave`, `afterRead`, `beforeDelete`, `afterDelete`) for business logic, data synchronization, and side effects. **Use callbacks instead of raw SQL triggers or external scripts.**

### Inline Relations
Relations are declared on the property under `relation`, as a tagged union: pick a `kind` (`belongsTo`, `hasOne`, `hasMany`, `manyToMany`, `via`) and a `target`, and the type offers only the fields that kind uses. A link with no form field of its own goes in the collection's `relations` array instead.

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
| `rebase cloud login` | Authenticate with Rebase Cloud |
| `rebase cloud deploy` | Deploy to Rebase Cloud |

## Building UI — read this first

**Before writing or modifying any admin view, custom page, or dashboard, read `rebase-design-language`.** Rebase has a specific, opinionated visual language (data-dense, monochromatic, near-zero chrome), and UI that ignores it looks broken next to the rest of the panel.

That skill also points you at the **live UI reference** that ships inside every Rebase project — readable source at `node_modules/@rebasepro/app/src/components/Debug/UIReferenceView.tsx`, rendered at the hidden route `/debug/ui`. Copy from it; don't invent layouts.

- `rebase-design-language` — **Design rules + whole-view skeletons. Mandatory for any UI work.**
- `rebase-ui-components` — `@rebasepro/ui` component API reference (props, variants)
- `rebase-admin` — Admin CMS APIs: navigation, side drawers, embedding collections, custom views

## Detailed Skills

For specific topics, see:
- `rebase-basics` — Setup, CLI, MCP tools, project structure
- `rebase-local-env-setup` — First-time setup only: Node.js, pnpm, PostgreSQL, Docker
- `rebase-sdk` — The client SDK: CRUD, filtering, live queries, offline / local-first sync
- `rebase-realtime` — WebSocket engine, broadcast channels, presence
- `rebase-collections` — Collection schemas, properties, relations, callbacks, entity actions
- `rebase-backend-postgres` — PostgreSQL setup, Drizzle, migrations, bootstrapper protocol
- `rebase-auth` — Authentication, roles, RLS policies
- `rebase-security` — Backend security architecture, RLS, API keys, threat model
- `rebase-api` — Auto-generated REST and GraphQL APIs
- `rebase-studio` — Visual admin panel, collection editor, custom views
- `rebase-deployment` — Rebase Cloud, Docker, Firebase Hosting
- `rebase-storage` — File uploads, S3, local storage
- `rebase-custom-functions` — Custom Hono API routes + frontend invocation via `client.functions.invoke()`
- `rebase-cron-jobs` — Scheduled background jobs
- `rebase-webhooks` — Outbound HTTP webhooks on entity changes
- `rebase-email` — SMTP setup, email templates, custom providers
- `rebase-entity-history` — Entity versioning, audit log, reverting changes

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
