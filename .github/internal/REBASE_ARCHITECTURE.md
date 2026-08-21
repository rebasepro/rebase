# Rebase Architecture Spec

## The Vision: A Supabase Alternative
Rebase is a full Backend-as-a-Service (BaaS), designed as a completely open-source, Docker-ready, Node/TypeScript alternative to Supabase.

While Supabase stitched together many tools (GoTrue, PostgREST, Realtime), Rebase is fully integrated, tightly coupled, and written natively in TypeScript powered by Drizzle ORM.

### Core Pillars
1. **Auto-Generated PostgREST-style APIs:** Every collection gets full REST CRUD endpoints dynamically.
2. **Built-in Authentication & RLS:** Simple context injection to protect all endpoints based on Application-Level Security Rules.
3. **Integrated Storage:** S3 / Local storage registries handled smoothly.
4. **Realtime Engine:** WebSockets for instant table updates broadcast to clients.

## Current Status

The following features are fully shipped and production-ready:

| Area | Capabilities |
|------|-------------|
| **Views** | Table, Cards, Kanban board, List, Split view |
| **Entity Modes** | Full-screen, side panel, split panel (`openEntityMode`) |
| **Relations** | Inline relation properties with `target`, `cardinality`, `direction` — auto-extracted at normalization time |
| **History** | Entity audit trails with diff viewer (`history: true`) |
| **Custom Functions** | Auto-mounted Hono route files via `functionsDir` |
| **Cron Jobs** | Auto-scheduled jobs via `cronsDir` |
| **API Docs** | OpenAPI/Swagger documentation auto-generated from collections |
| **Health Check** | `/health` endpoint with latency metrics |
| **i18n** | Full localization system with `t()` hook (EN, ES, FR, DE, IT, PT, HI) |
| **SPA Serving** | `serveSPA()` for bundling frontend with backend in production |

## The Core Problem: Where is the Source of Truth?
Supabase uses **PostgreSQL itself** as the single source of truth for the schema. When you click "Add Column" in their dashboard, it runs `ALTER TABLE`.
* **Problem:** Postgres doesn't know what "UI" metadata is. If a user sets a field as `multiline`, or an `enum`, or assigns a custom Markdown preview callback, a Postgres `VARCHAR` column loses all of that rich UI configuration context.
* **Rebase Advantage:** Rebase currently stores everything as rich TypeScript configuration objects, allowing deep configuration, callbacks (e.g., `target: () => ...` for relations), and powerful validation. 

How do we build a visual "No-Code" Database Studio for non-developers, without destroying the powerful TypeScript configuration that developers love?

## The Solution: The Git-Backed Hybrid Approach (Schema-as-Code)
Rebase uses a "UI as a Code Generator" approach (similar to TinaCMS or modern AI code tools).

1. **Structured TypeScript is King**
   Schemas are defined as standalone TypeScript files (e.g., `/rebase/collections/products.ts`). This ensures perfect typing and complex callback potential for advanced users.

2. **The Rebase Studio Uses AST Manipulation**
   When a user is in the deployed visual Rebase Studio and clicks "Add Field: Price (Number)":
   - The Studio does **not** blindly run SQL or overwrite the TS file with JSON.
   - The Rebase Node Backend opens `products.ts` parsing it via Abstract Syntax Tree (AST) tools like [`ts-morph`](https://ts-morph.com/).
   - It inserts the AST node `price: { type: "number" }` precisely inside the `properties` block.
   - *Crucially, any custom, complex TS callbacks manually written by developers directly in the same file are completely preserved and untouched.*

3. **Hot-Reload & Drizzle Migrations**
   - The server saves the file.
   - The backend detects the file change and dynamically restarts that specific route/schema on the Hono server.
   - Under the hood, Rebase calls Drizzle ORM to generate SQL and seamlessly migrates the Postgres database to match the new TS definition.
   - **Database Safety Guardrails**: To prevent any loss of database objects or tables created outside the Rebase schema (e.g., legacy tables, external schemas, extension helper tables), the generated Drizzle configuration implements a strict `tablesFilter` that dynamically includes only the active collections, ensuring unrecognized database objects are never dropped or modified.

4. **"The Git Commit" Feature**
   Because the Schema lives in code, Rebase embraces Git. When the visual UI saves the new AST change:
   - If Rebase is running locally via Docker, it will execute a Git commit on the user's behalf: `git commit -m "feat(rebase): Added price field to products"`.
   - If Rebase is hosted on Cloud, it uses the GitHub API to push a commit to the repository.
   
This solves the metadata problem natively while providing a fully visual experience for non-developers, all without holding advanced developers hostage to JSON or raw SQL configs. 
