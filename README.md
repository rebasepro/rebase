<p align="center">
  <a href="https://rebase.pro">
    <img src="https://rebase.pro/img/logo_small.png" width="240px" alt="Rebase logo" />
  </a>
</p>

<h1 align="center">Rebase</h1>
<h3 align="center">The Open-Source Headless CMS & Admin Panel for Postgres</h3>
<p align="center">
  <strong>Ship production-ready backends and radically extensible back-office apps in minutes.</strong><br/>
  Own your data, own your code. The absolute easiest way to build on PostgreSQL.
</p>

<p align="center">
  <a href="https://demo.rebase.pro">Live Demo</a> •
  <a href="https://rebase.pro/docs">Documentation</a> •
  <a href="https://rebase.pro/features">Features</a> •
  <a href="https://discord.gg/fxy7xsQm3m">Discord</a>
</p>

<p align="center">
  <a href="https://github.com/rebasepro/rebase/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rebasepro/rebase/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@rebasepro/core"><img src="https://img.shields.io/npm/v/@rebasepro/core.svg?style=flat-square&color=orange" alt="NPM Version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-purple.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/@rebasepro/core"><img src="https://img.shields.io/npm/dw/@rebasepro/core?style=flat-square&color=blue" alt="NPM Downloads" /></a>
  <a href="https://discord.gg/fxy7xsQm3m"><img src="https://img.shields.io/discord/1013768502458470442?style=flat-square&logo=discord&logoColor=white&label=Discord" alt="Discord" /></a>
</p>

<br/>

<p align="center">
  <img src="https://rebase.pro/img/demo_products.png" width="800px" alt="Rebase Dashboard" />
</p>

---

## What is Rebase?

Rebase is a **developer-first**, open-source headless CMS and admin panel framework built with **React** and **TypeScript**. It gives you a complete backend-as-a-service layer on top of PostgreSQL — including authentication, S3-compatible storage, a full admin UI, and auto-generated APIs — while letting you extend every layer with custom React components, serverless functions, and scripts. It's fully self-hosted and agent-native, with a built-in MCP server for AI-assisted development.

### ✨ Key Highlights

- 🔓 **No Vendor Lock-in** — Self-host anywhere. Full control over your infrastructure, code, and database.
- ⚡ **Instant Setup** — `npx @rebasepro/cli init` scaffolds a production-ready project in seconds.
- 🗄️ **PostgreSQL First** — First-class Postgres support with Drizzle ORM, schema introspection, and automatic migrations.
- 🧩 **Radical Extensibility** — Not constrained to pre-built widgets. If you can build it in React, you can build it in Rebase.
- 🎨 **Premium UI** — Fast, accessible design system built on Tailwind CSS v4 and Radix UI.
- 🤖 **AI-Ready** — MCP server for AI-assisted database management, plus data enhancement and insights plugins.

---

## ⚡ Quick Start

Scaffold a complete, self-hosted Rebase application connected to your database:

```bash
npx @rebasepro/cli init my-rebase-app
cd my-rebase-app
```

Start the database, push the schema, and launch:

```bash
docker compose up -d db
pnpm run db:push
pnpm run dev
```

Your admin panel is running at `http://localhost:5173` and the API at `http://localhost:3001`.

### Just want the API?

Rebase is modular — take only the parts you want:

```bash
npx @rebasepro/cli init my-api --flavor baas
```

That scaffolds a headless backend: REST, auth, storage, realtime and backups over
your database, with **no collection files and no UI**. Every table is served
automatically, derived from your schema at boot — change the schema with a migration
and the API follows. No React anywhere in the dependency tree.

The three adoption modes — BaaS (like Supabase), CMS (like Payload/Directus), and
both together — are described in [MODULAR-ARCHITECTURE.md](MODULAR-ARCHITECTURE.md).

---

## Features

### 🏓 Full Admin Panel & CMS

An incredibly fast, windowed spreadsheet view to manage your database with inline editing, real-time updates, filtering, sorting, and text search. Switch between multiple view modes:

- **Spreadsheet table** — Inline editing, column reordering, drag-and-drop
- **Card grid** — Visual overview with image previews
- **List view** — Compact, scannable layout
- **Custom views** — Build any React component as a collection view

### 🔒 Typed Schema & Database Migrations

Define your data models using pure TypeScript collections. Rebase automatically generates your Drizzle ORM schema, handles PostgreSQL migrations, and keeps your live database perfectly in sync using built-in tooling like `rebase doctor`.

### 💾 Backups & Restore

First-class database backups for self-hosted Postgres, built on `pg_dump` / `pg_restore`:

- `rebase db backup --out <path|s3://…>` — compressed, custom-format dumps
- `rebase db restore <backup>` — confirmation-gated, with `--create-db` / `--target-db` to restore into a fresh database
- **Scheduled backups** via the built-in cron system, uploading to your configured storage backend with retention pruning
- **Studio Backups panel** — browse and download backups from the admin UI

See **[docs/backups.md](docs/backups.md)** for the full guide, including security and PITR notes.

### 🔐 Authentication & Access Control

Built-in authentication with multiple providers:

- **Email/Password** — With password reset flow
- **Google OAuth** — One-click sign-in
- **Anonymous** — For guest access

Granular **role-based access control (RBAC)** with customizable permissions per collection, field, and action.

### 📦 S3-Compatible Storage

Native S3-compatible file storage with:

- Drag-and-drop uploads with progress tracking
- Automatic image resizing and optimization
- File metadata management
- Storage browser in Studio

### 🛠️ Studio — Developer Toolbox

A full developer environment built into the admin panel:

| Tool | Description |
|---|---|
| **SQL Editor** | Write and execute SQL queries directly against your database with schema-aware autocomplete |
| **RLS Policy Editor** | Visual editor for PostgreSQL Row-Level Security policies |
| **Schema Visualizer** | Interactive ER diagram of your database with relationship mapping |
| **JS/TS Editor** | In-browser code editor for scripts and functions |
| **API Explorer** | Browse and test your auto-generated REST API endpoints |
| **Cron Jobs** | Schedule and monitor recurring tasks |
| **Storage Browser** | Browse and manage files in your S3-compatible storage |

### 🔌 Realtime Engine

A full WebSocket engine built into every Rebase backend:

- **Live data subscriptions** — Subscribe to collection queries or individual entities. Changes propagate instantly with RLS-aware security.
- **Broadcast channels** — Send typed messages between connected clients. Build chat, notifications, or collaborative features.
- **Presence tracking** — Track who's online, sync user state across clients (typing indicators, cursor positions, online status).
- **Auto-reconnect** — Exponential backoff, automatic resubscription, and token refresh on reconnect.

### ⚡ Extensible API & Edge Functions

Drop custom Hono routes or scheduled tasks into the `functions/` and `crons/` directories. Rebase auto-loads them with database access and JWT authentication middleware injected automatically.

### 🧬 SDK Generator

Auto-generate fully typed **TypeScript SDKs** from your collection definitions. Use them in any frontend, script, or service to interact with your Rebase backend with complete type safety.

```bash
npx @rebasepro/cli generate-sdk
```

### 🤖 MCP Server

A built-in **Model Context Protocol** server that enables AI assistants to:

- Query and manage your database schema
- Create, read, update, and delete documents
- Manage users and roles
- Introspect your data model

### 🔍 Schema Inference & Introspection

Point Rebase at an existing PostgreSQL database and automatically generate collection definitions from your tables — including types, relations, validation constraints, and more.

### 📥📤 Import & Export

Import data from **CSV, JSON, and Excel** with an intuitive field mapper. Export your data in multiple formats with configurable column selection.

### 🧩 Plugins

Extend the admin experience with first-party plugins:

- **Data Enhancement** — AI-powered field suggestions and auto-fill
- **Insights** — Analytics dashboards and usage metrics

### 📜 Standalone Scripting

Write standalone data manipulation scripts that connect directly to your running backend using the `@rebasepro/client` SDK. The CLI persists the dev server URL to `.rebase-dev-url` for zero-config local development.

### 🧩 Custom Views & React Extensibility

Build entirely custom views — dashboards, previews, charts — and drop them into the main navigation or as entity-level tabs. Use built-in hooks to interact with Rebase's internal state.

---

## 🛠️ Core Technologies

Built entirely on modern, battle-tested web standards:

| Technology | What we use it for |
|---|---|
| 💙 **TypeScript 5.x** | End-to-end type safety |
| ⚛️ **React 19** | Component-driven UI |
| 🌊 **Tailwind CSS v4** | Utility-first styling |
| 🔌 **WebSockets** | Real-time synchronization |
| 🗄️ **Drizzle ORM** | Type-safe SQL migrations and queries |
| 🧱 **Radix UI** | Accessible UI primitives |
| 📝 **ProseMirror** | Rich text editing engine |
| 🌐 **Hono** | Ultrafast HTTP server framework |

---

## 📦 Packages

Rebase is structured as a modular monorepo — install only the layers you need:

| Package | Description |
|---|---|
| `@rebasepro/types` | Core TypeScript type definitions |
| `@rebasepro/utils` | Shared utility functions |
| `@rebasepro/common` | Common modules shared across packages |
| `@rebasepro/formex` | Lightweight form management library |
| `@rebasepro/ui` | Standalone React component library (Tailwind + Radix) |
| `@rebasepro/core` | Core CMS logic and controllers |
| `@rebasepro/client` | Client-side data access layer |
| `@rebasepro/client-postgresql` | PostgreSQL client adapter |
| `@rebasepro/client-firebase` | Firebase/Firestore client adapter |
| `@rebasepro/server-core` | Server framework and middleware (Hono) |
| `@rebasepro/server-postgresql` | PostgreSQL server adapter with Drizzle |
| `@rebasepro/server-mongodb` | MongoDB server adapter |
| `@rebasepro/auth` | Authentication controllers and login views |
| `@rebasepro/admin` | Full admin panel interface |
| `@rebasepro/studio` | SQL editor, RLS editor, schema visualizer, API explorer |
| `@rebasepro/cli` | CLI for project scaffolding and management |
| `@rebasepro/sdk-generator` | TypeScript SDK code generation |
| `@rebasepro/mcp-server` | MCP server for AI integrations |
| `@rebasepro/schema-inference` | Database schema introspection and inference |
| `@rebasepro/plugin-data-enhancement` | AI-powered data enhancement plugin |
| `@rebasepro/plugin-insights` | Analytics and insights plugin |

---

## 🎨 Standalone UI Library

Rebase exposes its design system as a completely independent library. Fully typed, accessible, and customizable via Tailwind CSS v4:

```bash
npm install @rebasepro/ui
```

---

## Demo

Explore a live interactive sandbox with all features — data resets periodically:

**👉 [demo.rebase.pro](https://demo.rebase.pro)**

---

## 🤖 AI Coding Assistants & Agent Support

Rebase is designed from the ground up to be **AI-agent ready**. When developing a Rebase project using AI coding assistants (like Cursor, Windsurf, or Copilot):

### 1. Built-in Agent Guidelines (`.cursorrules`)
Every new project scaffolded with `rebase init` automatically includes a pre-configured `.cursorrules` file at the root. This instructs your AI agent on:
- Using the **Rebase SDK** instead of raw SQL / direct Drizzle queries (which ensures data validation, RLS, and lifecycle callbacks run correctly).
- The two-step schema migration workflow (`rebase schema generate` -> `rebase db push`).
- Structuring custom functions and cron jobs.

### 2. Built-in MCP Server
Rebase runs a Model Context Protocol (MCP) server that connects your AI assistant directly to your live Rebase schemas and databases for automated schema discovery, entity management, and data migrations.

### 3. Troubleshooting Database Permissions in Studio
If your AI coding agent or database role permissions cause a `permission denied for table <table_name>` error when executing queries in the **Rebase Studio SQL Editor**:
- Add `DISABLE_DB_ROLE_SWITCHING=true` to your `.env` file.
- This forces the SQL Editor queries to execute under the default connection owner user (e.g. `rebase`) rather than trying to perform a PostgreSQL role switch to a non-existent database-level role.

---

## Support & Community

- 📖 [Documentation](https://rebase.pro/docs)
- 💬 [Discord Community](https://discord.gg/fxy7xsQm3m)
- 🐛 [GitHub Issues](https://github.com/rebasepro/rebase/issues)
- 📝 [Changelog](./CHANGELOG.md)

---

## ⭐ Star Us

If you find Rebase useful, please consider giving us a star on GitHub — it helps more developers discover the project!

---

## License

Rebase is open-source and licensed under the **MIT License**.
See the full [License](https://github.com/rebasepro/rebase/blob/main/LICENSE) for details.
