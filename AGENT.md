We are developing a custom backend for Rebase that is based on PostgreSQL and Drizzle ORM. 
This backend will be used to store and manage data for Rebase applications, providing a robust and scalable solution for developers.

## UI Coherency & Design Rules
- **The UI must be coherent always.** Every time you create a new view or component, you must ensure it matches the design system perfectly. We do not want messy or inconsistent UIs.
- **There is a UI Kit** available via `@rebasepro/ui`. You MUST use components from this UI kit (e.g., `Card`, `Typography`, `Button`, etc.) rather than building raw HTML elements or using ad-hoc classes.
- **Always use a reference UI view** when building new features. Look at existing views (such as `NavigationCard`, `RolesView`, or other studio views) to understand the established design patterns, spacing, and typography before creating something new. Future agents must take this into account every single time.

## Project Layout
- The developer-facing example application lives in the `app/` folder (singular) at the repo root, containing `frontend/`, `backend/`, and `config/` subdirectories.
- Collection definitions are individual TypeScript files under `app/config/collections/` (e.g., `posts.ts`, `products.ts`).
- Library code lives under `packages/`. Key backend packages are:
  - `packages/server-core` — Hono server coordinator, API generation, auth, storage
  - `packages/server-postgresql` — PostgreSQL bootstrapper, data driver, realtime (LISTEN/NOTIFY)
  - `packages/types` — Shared TypeScript type definitions (including `PostgresCollection`)
  - `packages/core` — Core framework, hooks, and components

## Data Model
- Collections use `PostgresCollection` from `@rebasepro/types` as their type.
- Relations are defined **inline on the property** using `type: "relation"` with `target`, `cardinality`, and `direction` fields directly on the property definition. There is no need for a separate `relations[]` array.
- The `enum` shorthand (array of `{ id, label, color }`) replaces the old `enumValues` pattern.

Be careful when escaping strings, avoid this lint error and similar ones:
ESLint: Unnecessary escape character: \". (no-useless-escape)

NEVER convert to any.

Use `pnpm` exclusively, do not use `npm` or `yarn`.

## Scripts & Temporary Files
- **NEVER** create one-off scripts, codemods, or utility files in the repo root or inside any package directory. This includes files like `fix_*.mjs`, `transform_*.mjs`, `patch_*.js`, `test-*.js`, `scratch.js`, etc.
- If you need a utility/migration/codemod script, **put it in the `/scripts/` directory** at the repo root.
- If you need a truly throwaway scratch file, use the agent scratch directory (`<appDataDir>/brain/<conversation-id>/scratch/`), NOT the repo.
- Log files (`*.log`), diff files (`*.diff`), and temporary text output files should never be committed.
- The `.gitignore` has aggressive patterns to block these, but don't rely on it — just don't create them in the wrong place.
