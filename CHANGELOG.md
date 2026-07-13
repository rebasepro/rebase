# Changelog

## [Unreleased]

## [0.9.0] - 2026-07-13

### Breaking

- **Entity → Entity vocabulary rename** — The `Entity` noun has been removed from the entire public API surface. Every type, hook, component, prop, config key, and wire-protocol message that previously used "entity" now uses "entity" (or, in backend callbacks, the flat database term "row"). This is a search-and-replace-level migration for consumers — no behavioral changes. The full rename map follows.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `Entity<M>` | `Entity<M>` |
  | `EntityCollection<M>` | `CollectionConfig<M>` |
  | `EntityCallbacks<M>` | `CollectionCallbacks<M>` |
  | `EntityValues<M>` | `EntityValues<M>` |
  | `EntityStatus` | `EntityStatus` |
  | `EntityReference` | `EntityReference` |
  | `EntityView` | `EntityCustomView` |
  | `EntityAction<M>` | `EntityAction<M>` |
  | `EntityActionClickProps<M>` | `EntityActionClickProps<M>` |
  | `EntityFormProps` | `EntityFormProps` |
  | `EntitySidePanelProps` | `EntitySidePanelProps` |
  | `SideEntityController` | `SideEntityController` |
  | `EntitySelectionProps` | `EntitySelectionProps` |
  | `EntityPreview` | `EntityPreview` |
  | `EntityCollectionView` | `DataCollectionView` |
  | `EntityCard` | `EntityCard` |
  | `EntitySelectionTable` | `EntitySelectionTable` |

  **Collection config props**

  | Old Prop | New Prop |
  |----------|----------|
  | `entityViews` | `entityViews` |
  | `entityActions` | `entityActions` |
  | `openEntityMode` | `openEntityMode` |
  | `includeEntityLink` | `includeEntityLink` |
  | `entityId` (in panel props) | `entityId` |

  **React hooks & components (`@rebasepro/admin`)**

  | Old Name | New Name |
  |----------|----------|
  | `useSideEntityController()` | `useSideEntityController()` |
  | `useEntitySelectionDialog()` | `useEntitySelectionDialog()` |
  | `SideEntityProvider` | `SideEntityProvider` |
  | `mergeEntityActions()` | `mergeEntityActions()` |
  | `resolveEntityAction()` | `resolveEntityAction()` |
  | `resolveEntityView()` | `resolveEntityView()` |
  | `editEntityAction` | `editEntityAction` |
  | `copyEntityAction` | `copyEntityAction` |
  | `deleteEntityAction` | `deleteEntityAction` |

  **Callback API (`CollectionCallbacks`)** — beyond the rename, the parameter shapes changed:

  | Old Param | New Param | Notes |
  |-----------|-----------|-------|
  | `entity` (in `afterRead`) | `row` | Now a flat `Record<string, unknown>`, not a `Entity<M>` wrapper |
  | `entityId` (in save/delete) | `id` | `string \| number` |
  | `previousEntity` | `previousValues` | `Partial<EntityValues<M>>` |
  | `afterCreate` / `afterUpdate` | `afterSave` | Use `status: "new" \| "existing"` to distinguish |

  Migration example:
  ```diff
  -import type { EntityCallbacks } from "@rebasepro/types";
  -const callbacks: EntityCallbacks = {
  -    afterRead: ({ entity }) => {
  -        return { ...entity, values: { ...entity.values, email: "***" } };
  -    },
  -    afterCreate: ({ entity }) => { /* ... */ },
  -    beforeDelete: ({ entityId }) => { /* ... */ },
  +import type { CollectionCallbacks } from "@rebasepro/types";
  +const callbacks: CollectionCallbacks = {
  +    afterRead: ({ row }) => {
  +        return { ...row, email: "***" };
  +    },
  +    afterSave: ({ id, status }) => { if (status === "new") { /* ... */ } },
  +    beforeDelete: ({ id }) => { /* ... */ },
  };
  ```

  **WebSocket wire protocol**

  | Old Message Type | New Message Type |
  |-----------------|-----------------|
  | `FETCH_ENTITY` | `FETCH_ONE` |
  | `SAVE_ENTITY` | `SAVE` |
  | `DELETE_ENTITY` | `DELETE` |
  | `COUNT_ENTITIES` | `COUNT` |
  | `subscribe_entity` | `subscribe_one` |
  | `collection_entity_patch` | `collection_patch` |

  **Database schema**

  | Old Name | New Name |
  |----------|----------|
  | `rebase.entity_history` (table) | `rebase.entity_history` |
  | `entity_id` (column) | `entity_id` |
  | `rebase_entity_changes` (PG NOTIFY channel) | `rebase_entity_changes` |

- **Unified `<Rebase>` data props** — Removed the `data` and `driver` props. There are now exactly two ways to provide data: `client` (server transport) and `dataSources` (everything else). A `dataSources` entry keyed `"(default)"` with a `driver` replaces `client.data` as the default source — this is how a fully client-side app (e.g. Firestore-only via `RebaseFirebaseApp`) is wired. Migration: `driver={x}` → `dataSources={[{ key: "(default)", engine: "firestore", driver: x }]}`; `data={x}` had no known users (custom backends implement `DataDriver`, now the documented integration SPI).
- **Deterministic default-source resolution** — The default data source resolves as: `"(default)"`-keyed entry with driver → `client.data` → the sole registered source. Several sources without an explicit default now throw instead of silently picking the first object entry (order-dependent).

- **Side-panel / Edit-view / Collection-view component rename** — Renames mechanically-generated "Entity" component names to descriptive, role-based names. Components bound to Rebase core data use the `Binding` suffix. This is a search-and-replace migration — no behavioral changes.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `EntitySidePanelProps` | `SidePanelBindingProps` |
  | `sideEntityController` (on `RebaseContext`) | `sidePanelController` |
  | `sideEntityController` (on `EntityActionClickProps`) | `sidePanelController` |
  | `"Entity.FormActions"` (override key) | `"EditView.FormActions"` |
  | `"Entity.DetailView"` (override key) | `"DetailView"` |
  | `"Entity.Preview"` (override key) | `"RecordPreview"` |

  **Components (`@rebasepro/admin`)**

  | Old Name | New Name |
  |----------|----------|
  | `SideEntityProvider` | `SidePanelProvider` |
  | `EntitySidePanel` | `SidePanelBinding` |
  | `EntityEditView` | `EditViewBinding` |
  | `EntityEditViewFormActions` | `EditFormActions` |
  | `EntityDetailView` | `DetailViewBinding` |
  | `EntityView` | `RecordViewBinding` |
  | `EntityPreview` | `RecordPreviewBinding` |
  | `EntityJsonPreview` | `JsonPreviewBinding` |
  | `DataCollectionView` | `CollectionViewBinding` |
  | `EntityCollectionBoardView` | `CollectionBoardViewBinding` |
  | `EntityCollectionCardView` | `CollectionCardViewBinding` |
  | `EntityCollectionListView` | `CollectionListViewBinding` |
  | `DataCollectionViewActions` | `CollectionViewActions` |
  | `DataCollectionViewStartActions` | `CollectionViewStartActions` |
  | `DataCollectionTable` | `CollectionTableBinding` |
  | `EntityCollectionRowActions` | `CollectionRowActions` |
  | `EntitySelectionTable` | `SelectionTableBinding` |
  | `EntityBoardCard` | `BoardCardBinding` |
  | `EntityCard` | `RecordCardBinding` |
  | `useEntityPreviewSlots` | `usePreviewSlots` |
  | `SideEntityControllerContext` | `SidePanelControllerContext` |

  **Bridge key (`@rebasepro/core`)**

  | Old Key | New Key |
  |---------|---------|
  | `"sideEntityController"` | `"sidePanelController"` |
  | `sideEntityController` (on `StudioBridge`) | `sidePanelController` |

- **Client split into server/browser variants** — `RebaseClient` is now split so the RLS-bypassing accessor is explicit: use `rebase.dataAsAdmin` (server-only) for admin-scoped, RLS-bypassing access, and `rebase.data` for user-scoped access. The public API surface was curated to hide internal plumbing.

- **`update`/`delete` throw on not-found** — SDK `update()` and `delete()` now throw when the target row does not exist, instead of silently returning `undefined`.

- **`deleteAll` is now internal** — removed from the public data accessors.

- **Scaffold defaults to cookie auth** — new projects store the refresh token in an httpOnly cookie (`authFlowMode: "cookie"`) by default.

- **`AdminUser.provider` → `providerId`** — renamed to match the canonical `User` type.

### Features & Improvements

- **Membership / relational RLS predicate (`policy.existsIn`)** — a first-class access predicate for scoping reads/writes by membership in a related collection (e.g. "only rows whose team the caller belongs to"). Compiles to a single correlated `EXISTS` subquery — no per-row `afterRead` lookups. Adds `policy.existsIn({ collection, where })` and the `policy.outerField(name)` operand for correlating the subquery to the outer row.

- **Built-in email → user lookup for invites** — opt-in `auth.allowUserLookup` exposes an authenticated `POST /auth/find-user` and a client `rebase.auth.findUserByEmail(email)` that returns a minimal public profile (`uid`, `displayName`, `photoURL` only). Removes the hand-rolled `dataAsAdmin` server function that invite flows previously required. Off by default (enables user enumeration by signed-in users).

- **Mount the admin under a path prefix** — `RebaseCMS` accepts a `basePath` so the admin can live under a sub-path route (e.g. `/admin`) without the collection data-grid hanging on URL↔collection resolution.

- **Filter operators** — LIKE family (`like`, `ilike`, etc.) and null checks, with engine-aware, customizable filter fields.

- **Scoped storage tokens** — storage access is now governed by scoped, time-limited tokens, with a documented public-files + scoped-token URL model.

- **Uniform server error envelope** — server error responses are routed through a central handler for a consistent `{ error: { message, code, details? } }` wire shape.

- **Inferred data-source transport** — `DataSourceDefinition.transport` is now optional: entries with a client-side `driver` default to `"direct"`, entries without to `"server"`. A `"(default)"`-keyed entry without a driver can be used to declare the default source's engine/capabilities while the client keeps serving the data.

- **`installShutdownHandlers`** — New `@rebasepro/server-core` helper that encapsulates graceful shutdown: drains via `backend.shutdown()`, runs `onCleanup` (e.g. closing your database pool), guards against repeated signals, and force-exits if shutdown hangs. Replaces the hand-rolled ~40-line shutdown block in the backend templates — the CLI template previously lacked the re-entry guard and force-exit timer entirely.

- **Honest Realtime Meta** — Added `FindResponse.meta.estimated` flag on realtime first-paint updates. When `listen()` emits its immediate heuristic metadata, the emission now carries `estimated: true`. Redundant second emissions are skipped when the authoritative count matches the heuristic, and count failures no longer silently pretend to be authoritative — the `estimated` flag remains as the signal.

### Fixes

- **Concurrency-safe refresh-token rotation** — token rotation now uses an atomic `INSERT … ON CONFLICT DO UPDATE` instead of a DELETE-then-INSERT. Concurrent `/refresh` calls (which cookie-mode boot can fire at once) previously raced into a `unique_device_session` violation and returned 500, breaking the session. The client also single-flights concurrent refreshes.

- **Cookie session restore** — `/auth/refresh` now returns the user object, and the client restores the user (falling back to `/me`) instead of leaving a blank `uid`. A cold start restored from an httpOnly cookie alone no longer yields an empty user.

- **Resilient auto-refresh** — a transient refresh failure (network blip, backend restart, 5xx) now retries with exponential backoff instead of immediately signing the user out; only a genuine auth failure (401/403/invalid/expired token) or exhausted retries signs out.

- **`server-postgresql` ships `src/`** — the driver package now packs `src` alongside `dist`, fixing `✗ Could not find CLI entry point for @rebasepro/server-postgresql` for `rebase db push` / `schema generate` in published/packed installs (the CLI runs `src/cli.ts` via tsx; no `dist/cli.js` is built).

- **Malformed request bodies** — the API now rejects malformed JSON bodies with `400` and tightens the public-path check.

- **Auth collection callbacks warning** — the server warns at startup when an auth collection defines `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`, since auth-driven user creation bypasses the collection save pipeline (use the `afterUserCreate` auth hook instead).

- **CLI DX** — friendly diagnostics for "SSL is not enabled on the server" (suggests `sslmode=disable`) and for dependency-drop failures that leave a schema half-migrated; a clear warning when `--collections` resolves to a missing path; and `rebase dev` now surfaces when it overrides the project's `.env` PORT / `VITE_API_URL` with its derived per-project port.

- **Scaffold hardening** — the frontend Vite config ships `resolve.dedupe` for React / React Router so a locally `link:`ed Rebase checkout doesn't load duplicate React copies (which broke the admin's data router); `.env.example` documents `sslmode=disable`.

## [0.8.0] - 2026-07-01

### Changed

- **Strict collection accessors** — When a `collections` dictionary is passed to `createRebaseClient`, unknown property accessors on `client.data` now throw immediately with a nearest-match suggestion instead of silently producing a 404 later. Use `data.collection("slug")` for dynamic slugs.

### Cleanup

- **Removed** — Six unused FireCMS-legacy builder identity functions (`buildProperties`, `buildPropertiesOrBuilder`, `buildEnum`, `buildEnumValueConfig`, `buildEntityCallbacks`, `buildAdditionalFieldDelegate`). Migration: remove the wrapper call — they were identity functions, so the object literal is the same value.
- **Deprecated** — `buildCollection` / `buildProperty` in favor of `defineCollection`. Both are marked `@deprecated` and will be removed before 1.0.
- **Removed** — Unused `<Rebase apiKey>` prop (it was never consumed by the component).
- **Fixed** — Duplicated sentences in `propertiesOrder` JSDoc; rewrote `subcollection:` description to cover both Firestore and Postgres.

### Features & Improvements

- **Unified Policy & Filter Engine** — Replaced ad-hoc permission checks with a centralized `evaluatePolicy` system and `Policy` type. This system translates high-level security rules into both frontend conditions (for UI gating) and backend-specific filters (Postgres RLS, Firestore security rules). Includes `policyToPostgres` and `securityRuleToConditions` utilities, ensuring the admin UI matches database enforcement by construction.
- **`defineCron` authoring helper** — Typed identity wrapper for cron job files (parity with `defineFunction`). Demo app now ships a working cron job (`refresh-product-stats`).
- **Multi-Backend Storage Sources** — Introduced a first-class `StorageSource` system allowing a single project to use multiple storage backends (S3, GCS, Local, Firebase) simultaneously. Added `GCSStorageController` for native Google Cloud Storage support with TUS resumable uploads. Managed via `StorageSourcesContext` and `StorageRegistry`, enabling complex multi-cloud storage architectures.
- **Custom Backend Functions** — New `defineFunction()` API for creating type-safe, discoverable backend endpoints. Functions are automatically mounted, type-checked, and can be invoked directly from the client SDK with full type safety. Includes a new `invoke_function` MCP tool for interacting with custom endpoints from AI agents.
- **Property Schema Consolidation** — Refactored the property system to unify how database-level schemas, UI configurations, and validation rules are defined. Removed overlapping property types and introduced a more robust `PropertyConfig` system that handles complex relations and references consistently across all data drivers (Postgres, MongoDB, Firestore).
- **Editable UI Table** — Significantly enhanced `VirtualTable` with native editable cells (`VirtualTableInput`, `VirtualTableSelect`, `VirtualTableNumberInput`, `VirtualTableDateField`). Added a new `SelectionStore` and `SelectionContext` for robust multi-row selection, keyboard navigation, and batch operations within the CMS.
- **Expanded Agent Skills** — Massive overhaul of the Rebase AI coding skills. Added new specialized skills for `rebase-custom-functions`, `rebase-ui-components`, and `rebase-storage`. Expanded existing skills for auth, security, and SDK with deep architectural context, common patterns, and safety rules.
- **Public API Refinement** — Cleaned up the public API surface of `@rebasepro/client` and `@rebasepro/core`, simplifying integration into existing applications. Consolidated data controllers, improved type inference, and refined the `Rebase` component props for better developer experience.
- **NPM Publishing Safeguards** — Added `validate-no-workspace-protocol.sh` and `check-packages.sh` scripts to the release pipeline. These prevent publishing packages with `workspace:` dependencies or inconsistent versions, ensuring library consumers always get stable, resolved dependencies.

### Fixes

- **Dependency Management** — Resolved workspace-wide dependency conflicts and fixed "workspace protocol" leakage in built artifacts that caused installation failures in certain environments.
- **Lifecycle Interception** — Unified lifecycle interception systems across different data drivers. This ensures consistent execution of `beforeSave`, `afterSave`, `beforeDelete`, and `afterDelete` hooks regardless of whether the collection is backed by Postgres, MongoDB, or Firestore.
- **OAuth Configuration** — Refactored and stabilized OAuth provider configuration. Resolved inconsistencies in how environment variables were parsed for Discord, Microsoft, and LinkedIn providers.
- **MongoDB & Firestore Parity** — Improved collection support for MongoDB and Firestore, bringing their relation/reference capabilities and storage integration closer to parity with the PostgreSQL driver.
- **Any Type Audit** — Conducted a comprehensive audit of `any` types across the core packages, replacing them with strict types or narrowing guards (e.g., `isSQLAdmin`) to improve overall codebase robustness and prevent runtime errors.

### Testing

- **Security Policy Tests** — New test suites for `evaluatePolicy`, `policyToPostgres`, and `securityRuleToConditions` covering Kleene logic and complex nested expressions.
- **Storage Tests** — Added comprehensive integration tests for `GCSStorageController`, multi-storage routing, and TUS upload flows.
- **UI Tests** — New unit and integration tests for `VirtualTable` editable fields, selection logic, and keyboard accessibility.
- **Schema Gates** — Added `collection_registry_property_gates` tests to validate property resolution and permission-based visibility gating at the registry level.

---

## [0.7.0] - 2026-06-29

### Features & Improvements

- **Multi-Datasource Architecture** — Introduced a first-class `DataSourceDefinition` / `DataSourceCapabilities` system that lets a single Rebase instance route collections to different database engines (Postgres, Firestore, MongoDB, or custom drivers). Collections declare a `dataSource` key, and the frontend router, backend driver registry, and collection editor all resolve capabilities from the same definition. Includes `resolveDataSource()`, `createDataSourceRegistry()`, `registerDataSourceCapabilities()`, and a new `DataSourcesContext` React provider. The editor automatically shows/hides tabs (Relations, Subcollections, RLS) and property types based on each source's declared feature flags.
- **Headless Collection Views** — Extracted reusable, data-agnostic collection view components (`CollectionView`, `CollectionTableView`, `CollectionCardView`, `CollectionListView`, `CollectionKanbanView`) into `@rebasepro/ui`. These headless components accept a generic `CollectionDataController<T>` — no coupling to entities or the CMS data layer — making them usable in custom pages, standalone apps, and third-party integrations. Includes a `CollectionViewToolbar` with view-mode toggle, search, filters, and pagination.
- **Headless Entity Forms** — Decoupled `EntityForm`, `EntityFormActions`, and `EntityFormBinding` from the admin package internals. Forms now accept pluggable field bindings and layout props, enabling standalone entity editing outside the CMS shell. Added `PopupFormField` for inline editing and extended form layout controls.
- **Auth Hooks Expansion** — Significantly expanded the `AuthHooks` interface with new lifecycle hooks: `beforeLogin`, `afterLogout`, `onPasswordReset`, `beforeUserDelete`, `afterUserDelete`, `onAdminCreateUser`, `onAdminResetPassword`, and `transformAuthResponse`. The `transformAuthResponse` hook lets developers inject external tokens (e.g. Firebase Custom Tokens) or project-specific metadata into every auth response. Added `AuthMethod` type covering all authentication methods.
- **Custom Auth Adapter** — New `createCustomAuthAdapter()` factory for plugging existing auth systems into Rebase with minimal config. Only `verifyRequest` is required — capabilities, user lookup, and registration are all optional overrides.
- **Magic Link Authentication** — Added passwordless magic-link login flow with `mountMagicLinkRoutes()`. Generates secure tokens with 15-minute expiry, sends branded emails via the configured email provider, and integrates with the `transformAuthResponse` hook and rate limiting.
- **API Keys** — Full API key management with collection-level permission scoping (`read` / `write` / `delete`), admin keys, rate limiting, expiration, and revocation. Includes server-side middleware (`api-key-middleware.ts`), a Postgres-backed key store, a Studio management UI (`ApiKeysView`), a CLI command (`rebase api-keys list|create|revoke`), and a client SDK module (`@rebasepro/client` `api-keys.ts`). Keys are stored with hashed secrets; the full key is only returned on creation.
- **Atlas Migrations (replaces Drizzle Kit)** — Replaced `drizzle-kit` with [Atlas](https://atlasgo.io/) for schema migrations. Added `generate-postgres-ddl-logic.ts` that produces raw SQL DDL (with enums, RLS policies, and indexes) from collection definitions. Migrations are now version-controlled SQL files under `drizzle/migrations/` with an `atlas.sum` integrity file. CLI `rebase db` commands updated accordingly.
- **Improved RLS Editor** — Overhauled the Studio RLS editor with better policy visualization, shared `table-classification.ts` module (classifying tables as `rebase-internal`, `junction`, or `user`), and improved default auth policies generation.
- **Headless Collection Editor** — Made the collection schema editor headless and decoupled from the admin shell. Extracted serializable types and utilities, allowing the editor to be embedded in custom Studio views or third-party tools.
- **Security Audit Logging** — Added structured security audit logging across all OAuth providers (Apple, Google, GitHub, GitLab, Facebook, Discord, Microsoft, LinkedIn, Slack, Spotify, Twitter, Bitbucket). Improved `ECONNREFUSED` error handling with actionable diagnostics, and fixed `chalk` CJS compatibility.
- **Landing Page & Demos** — New layered architecture diagram on the developers page, improved CRM dashboard demo (`CrmDashboardDemo`), and fixed NEAT gradient mismatches across all landing pages.
- **CLI Skills Enhancements** — Extended the `rebase skills` command with updated skill definitions for auth, security, collections, realtime, and SDK documentation.

### Fixes

- **Security Hardening** — Parameterized queries in API key store and cron store to prevent SQL injection. Hardened WebSocket connection safeguards, strengthened `EntityPersistService` input validation, and added `.dockerignore` / `.gitignore` rules to prevent secrets leakage. Sanitized environment variable handling in production.
- **Repo Cleanup** — Reorganized internal documentation (`BREAKING_CHANGES_POSTGRES.md`, `PUBLISHING.md`, `REBASE_ARCHITECTURE.md`) into `.github/internal/`. Cleaned up legacy `formex` `.yarn/cache` artifacts, updated `CONTRIBUTING.md`, `README.md`, and `AGENT.md`. Deprecated export documentation moved to `docs/DEPRECATED_EXPORTS.md`.
- **UI & Ergonomics** — Multiple ergonomic fixes across the admin panel: improved Sheet/Dialog focus management, refined `DrawerNavigationGroup` and breadcrumb context, stabilized navigation resolution hooks, and cleaned up `BreadcrumbsContext` and `CollectionRegistryContext`.

### Testing

- **Multi-Datasource Tests** — New test suites for `buildRoutedRebaseData`, `resolveDataSource`, `collection_registry_datasource`, `routing_integration`, `multi-datasource-routing`, and `routed-realtime-service`.
- **Auth Tests** — Added tests for `custom-auth-adapter`, `transform-auth-response`, and extended `auth-routes` tests covering magic links and lifecycle hooks.
- **Postgres Tests** — New `auth-default-policies` tests, extended `cli-helpers-extended` tests, `connection` tests, `databasePoolManager` tests, `doctor-extended` tests, and `generate-postgres-ddl` tests.
- **UI Tests** — Added `views.test.tsx` covering the new headless `CollectionView`, `ListView`, `CardView`, and `TableView` components.
- **E2E Tests** — Updated Playwright E2E tests for collections, studio features, and the new API keys flow.

---

## [0.6.1] - 2026-06-23

### Fixes

- **CLI Init Crash** — Fixed `rebase init` crashing with `UnknownPromptTypeError: Prompt type "list" is not registered` after entering the project name. The `inquirer` v14 dependency renamed the `"list"` prompt type to `"select"`, breaking the interactive flow. The non-interactive (`--yes`) path was unaffected, which is why E2E tests did not catch it.

### Testing

- **Interactive Prompt Validation** — Extracted prompt question building into a testable `buildInitQuestions()` function and added unit tests that validate all prompt `type` values against the installed `inquirer` version's registered types. This prevents prompt-type regressions from shipping silently when `inquirer` is upgraded.

---

## [0.6.0] - 2026-06-18


### Features & Improvements

- **Schema Drift & Previews** — Added a schema drift notification banner to Starlight and Studio home page, and improved previews for collection reference/relation properties.
- **Rebase Client & Types** — Consolidated RebaseClient context hooks, aligned types in `@rebasepro/client` and reconciled data controllers for cleaner imports.
- **Observability** — Integrated structured request-logger middleware and an `X-Request-ID` correlation header to trace client requests across core backend services.
- **Code Quality & Testing** — Added robust unit/integration tests across `@rebasepro/ui` components, StudioHomePage, and data plugins. Cleaned up Vite configuration targets, and strengthened type-safety checks.
- **Multi-Factor Authentication (MFA)** — Full TOTP-based MFA implementation with enroll, verify, challenge, and unenroll flows. Includes recovery codes, `aal1`→`aal2` token upgrade on challenge verification, and an `onMfaVerified` auth hook. Auth routes extracted into dedicated `mfa-routes.ts` and `session-routes.ts` modules.
- **Component Override System** — New `ComponentOverrideContext` and `useComponentOverride` hook allow developers to replace built-in UI components at both the global (`<Rebase components={…}>`) and per-collection level, with resolution priority: collection → global → default.
- **CLI Skills Command** — `rebase skills` auto-detects and installs Rebase AI coding skills for Cursor, Claude Code, Windsurf, and Gemini/Antigravity, writing the correct file format (`.mdc`, `SKILL.md`, `.md`) to each agent's rules directory.
- **MCP Server Expansion** — Added storage tools (`storage_list_objects`, `storage_delete_object`, `storage_get_metadata`), cron tools (`cron_list_jobs`, `cron_get_job`, `cron_trigger_job`, `cron_get_job_logs`, `cron_toggle_job`), and `invoke_function` for calling custom backend functions. Automatic package-manager detection for dev server commands.
- **Server Init Refactor** — Decomposed the monolithic `init.ts` into focused modules: `init/middlewares.ts` (request ID, body limits, CSRF, CORS warnings, logging), `init/health.ts` (health-check endpoint with DB latency), `init/shutdown.ts` (graceful teardown ordering), `init/storage.ts` (multi-backend storage bootstrap), and `init/docs.ts` (OpenAPI serving).
- **Entity Form Improvements** — Enhanced `EntityDetailView` and `EntityEditView` with better field-binding support, added `PopupFormField` inline editing, extended `EntityForm` with additional layout controls, and added `replace` option to `navigateToEntity`.
- **Drizzle Schema Generation** — Improved generated schema logic with richer column-type support and cleaned up `EntityPersistService` by extracting reusable persist utilities.
- **Documentation & Website** — Added `llms.txt`, updated `sitemap.md`, expanded backend auth, realtime, collections, SDK, and component-overrides documentation. Agent skills updated for auth, collections, realtime, SDK, and Studio.


### Fixes

- **Auth Refactoring** — Resolved auth issues and cleaned up redundant user management hooks, admin routes, and legacy decorators.
- **Studio & UI Components** — Corrected icon sizing bugs in navigation cards, restored and stabilized SQLEditor panel logic, improved tab scroll styles, and updated third-party dependencies across all packages.
- **Relation Preview Rendering** — Fixed broken relation previews in list views by correcting `useEntityPreviewSlots` resolution and adding proper hydration logic in `RelationPreview` and `PropertyPreview` components.
- **Security Hardening** — Hardened WebSocket client with connection-level safeguards, added input validation to GraphQL and REST generators, tightened API key store and cron store queries, improved image-transform and SPA-serve path handling, and added branch-service authorization checks.
- **PostgreSQL Error Handling** — New `pg-error-utils.ts` module extracts native PG errors from Drizzle's cause chain, translates 5-character SQLSTATE codes into user-friendly messages, and surfaces constraint, column, and table metadata.
- **Roles Query** — Fixed roles query resolution in user management flows.
- **Package Cleanup** — Cleaned up `package.json` files across the monorepo, fixed dependency declarations, and corrected `plugin-insights` version reference.
- **VirtualTable & UI** — Refactored `VirtualTable` and `VirtualTableHeader` for better resize handling and simplified render logic. Improved `Dialog` focus management and `LoginView`/`ErrorView` layout.

### Testing

- **Admin Package Tests** — Added component-level tests, data export tests, data import tests (including `get_import_inference_type` and transforms), and extended navigation utils test coverage.
- **PostgreSQL Tests** — New `relations.test.ts` for relation service, `pg-error-utils.test.ts` for error extraction, and expanded `drizzle-conditions.test.ts` and `generate-drizzle-schema.test.ts`.
- **MCP Server Tests** — Extended test suite covering new storage, cron, and function tool handlers.


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
