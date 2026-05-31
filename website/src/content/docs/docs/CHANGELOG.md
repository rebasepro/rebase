---
slug: docs/changelog
title: Changelog
---
# Changelog

## [0.2.1] - 2026-05-30

### Fixes

- **Lockfile & Build Issues** — Fixed a missing integrity hash for the `xlsx` dependency in the lockfile, and resolved frontend build failures by adding `@types/node` and `vite/client` type definitions.
- **SQL Editor Component** — Updated the `SQLEditor` component for improved stability and rendering.

### CI & E2E Testing

- **E2E Test Runner Improvements** — Replaced the `execa` dependency with a custom spawn helper in E2E tests, resolved package packing/resolution issues, and fixed split chunk E2E test failures by accumulating logs for dev server URL detection.
- **Vite Template Config** — Tracked `virtual.d.ts` in git and fixed glob inclusions in `tsconfig` files to prevent template compilation errors.

---

## [0.2.0] - 2026-05-29

### Features & Improvements

- **Postgres Vector (pgvector) Support** — Added a `vector` property type for embeddings, including admin UI field bindings, validation, Postgres schema generation, API generators, and data transformations.
- **Pluggable AuthAdapter Architecture** — Replaced direct Firebase Auth logic in key controllers with a pluggable adapter system to support dynamic/external authentication providers (e.g., dynamic Postgres auth schemas).
- **Users & Roles Collections** — Migrated the user/role system to be treated as standard, customizable data collections, with built-in overrides and migration of auth UI components to the core package.
- **A/B Testing & Landing Page Revamp** — Added A/B testing infrastructure, hero CTAs, testimonials, landing page Bento Grid layouts (`ProductContent`), and demo view modes.
- **SDK Drift Detection** — Added SDK drift detection to the CLI doctor command to check for drift between collection definitions and generated SDKs.
- **EntityDetailView & UI Enhancements** — Created `EntityDetailView` for read-only displays, new `FilterChip` components, and support for collection filter presets.
- **CLI and Test Improvements** — Upgraded pnpm to v11, added CLI init E2E tests, localhost validation tests, and AI coding assistant rules to CLI templates.
- **Database Role Switching Config** — Introduced `DISABLE_DB_ROLE_SWITCHING` and `ADMIN_CONNECTION_STRING` options with troubleshooting documentation.
- **License Update** — Relicensed the project under the MIT License.

### Fixes & Refactoring

- **Realtime Service Shutdown Deadlock** — Fixed potential deadlocks during shutdown by cleaning up websocket realtime services before closing the database pool.
- **Environment Validation** — Centralized environment variable validation in `server-core`.
- **UI Styling & Translations** — Refactored UI components to use consistent Typography/Alert variants, and updated i18n translation strings.

---

## [0.1.2] - 2026-05-15

### Improvements

- **Removed `lodash` dependency** — Replaced `lodash/cloneDeep` with a custom `deepClone` utility in `@rebasepro/utils`. This eliminates the external dependency and fixes `npx create-rebase-app` failing due to missing `lodash` at runtime.
- **New `deepClone` utility** — A lightweight deep-clone function that preserves function references and class instances (Date, GeoPoint, etc.), designed specifically for Rebase collection objects.

### CI & Tooling

- **Automated release pipeline** — New GitHub Actions workflow (`Publish Stable Release`) that handles version bumping, npm publishing, and GitHub Release creation in a single click from the Actions tab.
- **Local release script** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` for releasing from the command line with the same pipeline.
- **Canary releases** — Every push to `main` publishes a canary version to npm (`@canary` dist-tag).

### Fixes

- Fixed navigation utility tests to assert the correct call signature with `undefined` options parameter.
- Updated package descriptions to reflect the Postgres-based architecture.

---

## [0.1.0] - 2025-05-14

🎉 **First public release of Rebase** — an open-source headless CMS and admin panel for Postgres.

### Highlights

- **Full Admin Panel** — Spreadsheet, card, list, and table views for managing your data with inline editing, filtering, sorting, and search.
- **PostgreSQL Backend** — First-class Postgres support with Drizzle ORM, schema introspection, and automatic migrations.
- **Authentication** — Built-in auth with email/password, Google OAuth, and anonymous sign-in. Role-based access control with customizable permissions.
- **Storage** — S3-compatible file storage with image resizing, drag-and-drop uploads, and metadata management.
- **Studio** — SQL editor, RLS policy editor, schema visualizer, JS/TS editor, cron jobs, and API explorer.
- **CLI** — `npx create-rebase-app` to scaffold a new project in seconds. Supports both npm and pnpm.
- **SDK Generator** — Auto-generate fully typed TypeScript SDKs from your collection definitions.
- **MCP Server** — Model Context Protocol server for AI-assisted database management.
- **Plugins** — Data enhancement and insights plugins for extending the admin experience.
- **UI Component Library** — A comprehensive set of accessible, themeable React components built on Radix primitives.
- **Firebase Support** — Optional Firebase/Firestore data source and authentication adapters.
- **MongoDB Support** — Optional MongoDB data source adapter.

### Packages

| Package | Description |
|---|---|
| `@rebasepro/types` | Core TypeScript type definitions |
| `@rebasepro/utils` | Shared utility functions |
| `@rebasepro/common` | Common modules shared across packages |
| `@rebasepro/formex` | Lightweight form management library |
| `@rebasepro/ui` | React component library |
| `@rebasepro/core` | Core CMS logic and controllers |
| `@rebasepro/client` | Client-side data access layer |
| `@rebasepro/client-postgresql` | PostgreSQL client adapter |
| `@rebasepro/client-firebase` | Firebase/Firestore client adapter |
| `@rebasepro/server-core` | Server framework and middleware |
| `@rebasepro/server-postgresql` | PostgreSQL server adapter with Drizzle |
| `@rebasepro/server-mongodb` | MongoDB server adapter |
| `@rebasepro/auth` | Authentication controllers and views |
| `@rebasepro/admin` | Full admin panel interface |
| `@rebasepro/studio` | SQL editor, schema tools, and developer utilities |
| `@rebasepro/cli` | CLI for project scaffolding and management |
| `@rebasepro/sdk-generator` | TypeScript SDK code generation |
| `@rebasepro/mcp-server` | MCP server for AI integrations |
| `@rebasepro/schema-inference` | Database schema introspection and inference |
| `@rebasepro/plugin-data-enhancement` | AI-powered data enhancement plugin |
| `@rebasepro/plugin-insights` | Analytics and insights plugin |
