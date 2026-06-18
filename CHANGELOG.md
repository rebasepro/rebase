# Changelog

## [0.6.0] - 2026-06-18

### Features & Improvements

- **Schema Drift & Previews** — Added a schema drift notification banner to Starlight and Studio home page, and improved previews for collection reference/relation properties.
- **Rebase Client & Types** — Consolidated RebaseClient context hooks, aligned types in `@rebasepro/client` and reconciled data controllers for cleaner imports.
- **Observability** — Integrated structured request-logger middleware and an `X-Request-ID` correlation header to trace client requests across core backend services.
- **Code Quality & Testing** — Added robust unit/integration tests across `@rebasepro/ui` components, StudioHomePage, and data plugins. Cleaned up Vite configuration targets, and strengthened type-safety checks.

### Fixes

- **Auth Refactoring** — Resolved auth issues and cleaned up redundant user management hooks, admin routes, and legacy decorators.
- **Studio & UI Components** — Corrected icon sizing bugs in navigation cards, restored and stabilized SQLEditor panel logic, improved tab scroll styles, and updated third-party dependencies across all packages.

---

## [0.5.0] - 2026-06-15

### Features & Improvements

- **Aesthetic Landing Page** — Added high-performance custom NEAT canvas background gradients, revamped hero illustrations, and introduced localized documentation and responsive demo page structures.
- **Developer Workspaces** — Added curated development skills rules (covering cron jobs, design-language, email, history, and SDK specs) directly into the agent workspace configs.
- **Data Insights & Migrations** — Integrated database migration `0002` schema changes and a seed script, and introduced an automated insights calculator service.
- **CLI Improvements** — Hardened CLI initialization options for PostgreSQL 18.

### Fixes

- **RLS & Security** — Resolved critical security gaps in Postgres Row-Level Security (RLS) policies.
- **Multi-DB Drivers** — Cleaned up type-safety and package path dependencies for `server-mongodb` and `server-postgresql`.

---

## [0.4.0] - 2026-06-11

### Features & Improvements

- **Unified Authentication** — Redesigned default auth routing, eliminated the `defaultUsersCollection` construct, and streamlined default view redirects.
- **Email Config** — Added custom `SMTP_NAME` parameter configuration in SMTP email delivery properties.

### Fixes

- **Layout & Sizing** — Resolved side navigation alignment glitches, added scroll-overflow fixes in entity data grids, and corrected `ReadOnlyFieldBinding` form fields.
- **Missing Build Configurations** — Added missing `tsconfig.prod.json` compiler files and stabilized workspace-level packaging dependencies.

---

## [0.2.5] - 2026-06-09

### Features & Improvements

- **Role Model Simplification** — Removed roles as an independent table/collection, simplifying permissions into a standard DB enum column directly in the `users` table.
- **SDK & Client Methods** — Extended Rebase client drivers with new data persistence methods.

### Fixes

- **Types & Layouts** — Extended schema types to support native UUID format in string fields, adjusted scroll behaviors in tab grids, and solved pnpm lockfile conflicts.

---

## [0.2.4] - 2026-06-08

### Features & Improvements

- **PostgreSQL 18** — Upgraded core infrastructure and Docker configurations to support PostgreSQL v18.
- **Scaffold Configurations** — Added VPC and S3-compatible cloud storage setup inputs directly into the CLI project-creation prompts.
- **Auth Hooks & Orgs** — Added basic multi-tenant organization support and renamed `AuthOverrides` to `AuthHooks`.
- **Advanced Query Operators** — Introduced `array-contains-any` and `not-in` filter clauses for postgres client drivers.
- **Error Boundaries** — Wrapped main application routes in a robust `ErrorBoundary` with specific full-page and authorization error layouts, and attached global listeners for unhandled promise rejections.

### Fixes

- **Stricter Typing & Logging** — Replaced broad `any` usages with type-safe `unknown` keywords, and migrated core controllers from `console.log` to the structured monorepo logger.

---

## [0.2.3] - 2026-05-31

### Features & Improvements

- **OIDC Publish Workflows** — Migrated package publishing workflows to use GitHub Actions OIDC federation with NPM, removing hardcoded auth tokens and adding secure ID-token scopes.
- **Dynamic Versions** — Dynamically resolved workspace versions from `lerna.json` during canary package releases.

### Fixes

- **CLI Scaffold** — Fixed CLI template installation bugs, repaired Docker database image configs, and restored correct properties inside template collection schemas.

---

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
