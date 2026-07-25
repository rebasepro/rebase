# Plan — separating the BaaS from the admin panel

> **Status: implemented, 2026-07-25.** Commits `e102bc11` → `04e02ece` on
> `feat/baas-admin-types-split`. See "What the plan got wrong" at the bottom — five
> things, all of which would have made the split look impossible if hit blind.

**Date:** 2026-07-25
**Goal:** Rebase must read, install and typecheck as a backend-as-a-service on its own.
Today the BaaS contract and the admin panel's view model live in one type package and one
collection object, so a BaaS user reads a 1408-line `CollectionConfig` full of `kanban`
and `sideDialogWidth`, and a React-free install typechecks against `.d.ts` files that
`import React from "react"`.

**Decisions taken (2026-07-25):**

1. **Authoring** — one collection file. Presentation moves into a nested `admin: { … }`
   block. The backend loads the file and never looks inside `admin`.
2. **Breakage** — clean break at 0.11 plus a codemod. No permanent compatibility shim.
3. **Packages** — `@rebasepro/types` becomes the React-free BaaS contract. A new
   `@rebasepro/admin-types` holds the React/admin layer and depends on `types`.

---

## 1. What is already right — and why this is smaller than it looks

The previous attempt is worth not repeating, and the reason it looked impossible is that
the *runtime* problem and the *type* problem got conflated. The runtime is already clean:

- `packages/types/dist/index.es.js` contains **zero** `react` references. Every React
  import in `src` is erased at build.
- Collection files already avoid React by indirection: `icon: "Users"` is a string
  (`app/config/collections/*.ts`, all 11 of them), `Field`/`Preview`/`Builder` are
  `ComponentRef` string paths that `rebaseCollectionsPlugin` rewrites into
  `LazyComponentRef` at build time, and custom entity views are registered on the
  frontend (`app/frontend/src/App.tsx`) and referenced from the collection by string key.
- Property UI is already namespaced: every property type carries `ui?: XUIConfig`.

So this is a **type-surface and conceptual** split, not a runtime one. That also means it
can be done mechanically and verified by the compiler, which is the part that failed last
time.

### The measured shape of the coupling

Across `server`, `server-postgres`, `client`, `common`, `utils`, `cli`, `codegen`,
`server-mongo`, the backend imports **209 distinct symbols** from `@rebasepro/types`.
Exactly **two** of them are admin view-model types (`DefaultSelectedViewBuilder`,
`DefaultSelectedViewParams`, both via `packages/common/src/util/collections.ts:88`).

Per-package import counts (`ui-imports` = imports of a symbol that lives in a
UI-flavoured file):

| package | files | imports from `types` | of which UI |
| --- | --- | --- | --- |
| admin | 236 | 772 | 145 |
| server | 58 | 206 | **0** |
| app | 66 | 185 | 56 |
| server-postgres | 35 | 182 | **0** |
| common | 31 | 179 | **0** |
| client | 17 | 85 | **0** |
| server-mongo | 8 | 60 | **0** |
| firebase | 15 | 58 | 8 |
| studio | 16 | 44 | 5 |
| cli | 7 | 20 | **0** |
| plugin-ai | 8 | 20 | 3 |
| inference | 5 | 13 | **0** |
| codegen | 2 | 11 | **0** |
| client-postgres | 1 | 9 | **0** |
| utils | 2 | 3 | **0** |
| plugin-insights | 1 | 2 | 2 |

`packages/ui` and `packages/forms` import from `@rebasepro/types` **not at all** — they
are already pure presentation.

The boundary the codebase wants is therefore already almost exactly the package boundary.
The work is to make it explicit and enforced.

### The concrete defects this closes

1. `@rebasepro/types` ships 13 `.d.ts` files containing `import React from "react"`, but
   declares `@types/react` only as a **devDependency**. A BaaS-only install
   (`server` + `server-postgres` + `client`, no React) has no `react` types to resolve
   them against.
2. `packages/server/package.json` — a backend package — carries `@types/react`,
   `@types/react-dom` and `@vitejs/plugin-react` in devDependencies.
3. `@rebasepro/common`, on the backend dependency path, exports admin-panel helpers:
   `resolveDefaultSelectedView`, `navigation_from_path.ts`, `navigation_utils.ts`,
   `parent_references_from_path.ts`, `builders.ts`.
4. `resolveProperty` in `@rebasepro/common` requires `authController: AuthController` —
   a frontend controller type — and is called from
   `packages/server-postgres/src/schema/generate-drizzle-schema-logic.ts`.
5. `CollectionConfig` mixes both concerns in one 1408-line file, including all six
   `SecurityRule` variants.

### The cycles that make a naive lift fail

```
collections.ts  ⇄  properties.ts
collections.ts  ⇄  entity_views.tsx
collections.ts  ⇄  entity_actions.tsx
properties.ts    →  controllers/auth   (AuthController)
properties.ts    →  component_ref      (React.ComponentType)
```

You cannot move `collections.ts` into a React-free package while it still names
`EntityCustomView`, `EntityAction` and `RebaseContext`, because each of those names
`CollectionConfig` back. **This is the thing to solve first.** Three moves break every
cycle, and each is independently verifiable:

**(a) `ComponentRef` becomes structural — no React import.**

```ts
// @rebasepro/types — component_ref.ts
export type ComponentRef<P = any> =
    | string
    | LazyComponentRef<P>
    | (() => Promise<{ default: unknown }>)
    | ((props: P) => unknown)                       // function components
    | (new (props: P, context?: any) => { render(): unknown });   // class components
```

Every React form is assignable to this: an FC is `(props: P) => ReactNode`, a class
component satisfies the construct signature, and `memo`/`forwardRef` exotics are callable.
`@rebasepro/admin-types` re-exports a narrowed `ReactComponentRef<P>` typed against
`React.ComponentType` for authoring and for the admin's own internals. This single change
is what lets **`properties.ts` stay whole in core** — no augmentation, no duplication.

**(b) `icon` in core is `string` only.** `string | React.ReactNode` becomes `string` on
the core side; a `ReactNode` icon is an admin concern and lives in the `admin` block. This
matches every collection in `app/config` already.

**(c) `RebaseContext` moves; `RebaseCallContext` stays.** `rebase_context.tsx` already
declares the split correctly — `RebaseCallContext` is the "available on both sides"
context and is the *only* one `entity_callbacks.ts` uses
(`packages/types/src/types/entity_callbacks.ts:4`). The full `RebaseContext`, with its
nine UI controllers, is referenced from `collections.ts` at exactly four places — all four
admin view-model types (`CollectionActionsProps`, `EntityAction`,
`AdditionalFieldDelegate.Builder`, `DefaultSelectedViewParams`) — and from
`export_import.ts`. All of those move to `admin-types`.

---

## 2. End state

Strict DAG, one direction only:

```
@rebasepro/types          (React-free BaaS contract; no react in src or dist)
   ├── @rebasepro/common · client · utils · codegen
   ├── @rebasepro/server · server-postgres · server-mongo · cli · inference
   └── @rebasepro/admin-types      (React/admin view model; depends on types)
         ├── @rebasepro/app · admin · studio · firebase
         ├── @rebasepro/plugin-ai · plugin-insights
         └── @rebasepro/admin-common   (admin helpers lifted out of common)
```

`@rebasepro/ui` and `@rebasepro/forms` stay where they are — they already import from
neither.

### The collection object

```ts
// collections/posts.ts — one file, two audiences
export default {
    // ── BaaS contract: @rebasepro/types ──────────────────────
    slug: "posts",
    table: "posts",
    properties: { title: { type: "string", validation: { required: true } } },
    relations: [ … ],
    securityRules: [ { ownerField: "author_id" } ],
    callbacks: { beforeSave: … },
    auth: false,
    history: true,
    strictWrites: true,

    // ── Admin panel: @rebasepro/admin-types ──────────────────
    admin: {
        icon: "FileText",
        group: "Content",
        listProperties: ["title", "status"],
        entityViews: ["blog_preview"],
        defaultViewMode: "table",
        kanban: { … },
        components: { "Entity.Form": { Component: "…/PostForm" } }
    }
} satisfies AdminCollectionConfig;
```

Core declares the field opaquely, so there is exactly one definition of every admin field
and it lives in `admin-types`:

```ts
// @rebasepro/types
export interface BaseCollectionConfig<M, USER> {
    /** Admin-panel presentation. Opaque to the backend — typed by @rebasepro/admin-types. */
    admin?: AdminBlock;
    …
}
export type AdminBlock = { readonly [key: string]: unknown };

// @rebasepro/admin-types
export interface AdminCollectionOptions<M, USER> { icon?: string | ReactNode; … }
export type AdminCollectionConfig<M, USER> =
    Omit<CollectionConfig<M, USER>, "admin"> & { admin?: AdminCollectionOptions<M, USER> };
export function defineCollection<…>(c: AdminCollectionConfig<…>): AdminCollectionConfig<…>;
```

`AdminCollectionOptions` is assignable to `AdminBlock`, so a collection typed for
authoring is accepted everywhere the backend expects a `CollectionConfig` — no cast, no
generic threading through 209 symbols. Nothing in core can *read* a typed admin field,
which is the point.

**Consequence to accept deliberately:** the shared config package (`app/config`) takes a
**type-only devDependency** on `@rebasepro/admin-types`. That is correct rather than a
leak — per `MODULAR-ARCHITECTURE.md`, BaaS mode has no collection files at all (it
introspects the database), so a shared collections package is by definition a CMS-mode
artifact. The backend runtime still imports nothing from `admin-types`, and CI enforces it.

---

## 3. File-by-file allocation

### Stays in `@rebasepro/types` (33 files)

`errors.ts` · `users/user.ts` · `types/entities.ts` · `types/properties.ts` ·
`types/collections.ts` (trimmed) · `types/relations.ts` · `types/policy.ts` ·
`types/entity_callbacks.ts` · `types/filter-operators.ts` · `types/collection_contract.ts` ·
`types/schema_version.ts` · `types/backend.ts` · `types/auth_adapter.ts` ·
`types/database_adapter.ts` · `types/data_source.ts` · `types/storage_source.ts` ·
`types/storage_authorize.ts` · `types/api_keys.ts` · `types/backup.ts` · `types/cron.ts` ·
`types/channel_bus.ts` · `types/websockets.ts` · `types/project_manifest.ts` ·
`types/chips.ts` · `types/component_ref.ts` (rewritten) · `controllers/client.ts` ·
`controllers/data.ts` · `controllers/data_driver.ts` · `controllers/collection_registry.ts` ·
`controllers/storage.ts` · `controllers/email.ts` · `controllers/database_admin.ts` ·
`controllers/effective_role.ts`

Plus `controllers/auth.tsx → auth.ts` (already React-free; the `.tsx` extension is
vestigial) and a new `call_context.ts` holding `RebaseCallContext`.

`chips.ts` stays deliberately: `ColorKey`/`ColorScheme` are plain string unions consumed by
`EnumValueConfig.color` inside `properties.ts`. Moving them would split `EnumValueConfig`.

### Moves to `@rebasepro/admin-types` (25 files, 89 exports)

`types/entity_views.tsx` · `types/entity_actions.tsx` · `types/component_overrides.ts` ·
`types/property_config.tsx` · `types/plugins.tsx` · `types/slots.tsx` · `types/formex.ts` ·
`types/builders.ts` · `types/modify_collections.tsx` · `types/breadcrumbs.ts` ·
`types/locales.ts` · `types/translations.ts` · `types/entity_link_builder.ts` ·
`types/user_management_delegate.ts` · `types/export_import.ts` ·
`controllers/navigation.ts` · `controllers/registry.ts` ·
`controllers/dialogs_controller.tsx` · `controllers/side_dialogs_controller.tsx` ·
`controllers/side_panel_controller.tsx` · `controllers/customization_controller.tsx` ·
`controllers/analytics_controller.tsx` · `controllers/local_config_persistence.tsx` ·
`controllers/snackbar.ts` · `RebaseContext` (from `rebase_context.tsx`)

### `collections.ts` — 35 exports, split 23 / 12

**Core (23):** `BaseCollectionConfig` (trimmed) · `PostgresCollectionConfig` ·
`FirebaseCollectionConfig` · `MongoDBCollectionConfig` · `CollectionConfig` ·
`isPostgresCollectionConfig` · `isFirebaseCollectionConfig` · `isMongoDBCollectionConfig` ·
`getCollectionDataPath` · `getDeclaredSubcollections` · `InferCollectionConfigType` ·
`SecurityOperation` · `SecurityRule` · `SecurityRuleBase` · `OwnerSecurityRule` ·
`PublicSecurityRule` · `StructuredSecurityRule` · `RawSQLSecurityRule` ·
`RolesOnlySecurityRule` · `AuthCollectionConfig` · `AuthCollectionContext` ·
`AuthCollectionCreateResult` · `AuthCollectionResetResult`

**`admin-types` (12):** `KanbanConfig` · `ViewMode` · `CollectionSize` ·
`CollectionActionsProps` · `SelectionController` · `EntityTableController` ·
`SelectedCellProps` · `FilterCombination` · `AdditionalFieldDelegate` ·
`AdditionalFieldDelegateProps` · `DefaultSelectedViewBuilder` · `DefaultSelectedViewParams`

While here, lift the six `SecurityRule` variants (lines 969–1320) into
`types/security_rules.ts`. They are 350 lines of RLS policy contract with no relationship
to the collection shape, and they are the most-read types in the BaaS surface.

### `BaseCollectionConfig` fields → `admin`

Move: `icon` (`ReactNode` form), `group`, `entityViews`, `previewProperties`,
`listProperties`, `openEntityMode`, `defaultEntityAction`, `formView`,
`disableDefaultActions`, `propertiesOrder`, `pagination`, `selectionEnabled`,
`selectionController`, `defaultSize`, `inlineEditing`, `hideFromNavigation`,
`defaultSelectedView`, `hideIdFromForm`, `hideIdFromCollection`, `formAutoSave`,
`exportable`, `sideDialogWidth`, `alwaysApplyDefaultValues`, `includeJsonView`,
`localChangesBackup`, `defaultViewMode`, `enabledViews`, `kanban`, `entityActions`,
`Actions`, `components`.

Stay at top level: `slug`, `name`, `singularName`, `description`, `childCollections`,
`dataSource`, `engine`, `databaseId`, `properties`, `auth`, `disableDefaultPolicies`,
`callbacks`, `ownerId`, `metadata`, `history`, `strictWrites`, `table`, `schema`,
`relations`, `securityRules`.

Judgement calls worth reviewing: `singularName` and `description` are arguably
presentation, but both are consumed by the OpenAPI generator
(`packages/server/src/api/openapi-generator.ts`), so they stay. `icon` stays as `string`
in core for the same reason — the cloud console renders it from the contract.

### `@rebasepro/common` → new `@rebasepro/admin-common`

Move out of `packages/common/src/util/`: `navigation_from_path.ts` ·
`navigation_utils.ts` · `parent_references_from_path.ts` · `builders.ts` ·
`resolveDefaultSelectedView` (from `collections.ts`).

And fix `resolveProperty` (`packages/common/src/util/resolutions.ts:42`): narrow
`authController: AuthController` to the `{ user, roles }` shape `dynamicProps` actually
reads, and make it optional. `PropertyBuilderProps.authController`
(`properties.ts:890`) narrows with it. This is the one place where the backend's schema
generator is forced to construct a frontend controller.

---

## 4. Seams that will bite

These are the things that make the difference between a split that holds and one that
rots back within two months.

1. **`packages/server/src/api/ast-schema-editor.ts` (289 lines).** The *backend* rewrites
   collection files on disk with ts-morph, driven by the admin panel's collection editor.
   With `admin:` nested, it must write into the nested block, and the "which key goes
   where" table now lives in two places — the type definition and the AST writer. Fix by
   generating the writer's key table from a single exported manifest
   (`ADMIN_COLLECTION_KEYS`) in `admin-types`, and gate the whole route behind the
   existing schema-editor module flag so BaaS mode never mounts it.

2. **`serializeCollections` / `computeSchemaVersion`.** Today `toSerializable`
   (`types/collection_contract.ts`) drops functions and React elements individually, and
   the comment there notes that an empty `callbacks: {}` husk landing in the schema hash
   would "report perfectly current SDKs as stale". Nesting makes this strictly better:
   drop `admin` as one subtree and exclude it from the hash, so an admin-only edit stops
   invalidating every client's SDK version. Add a test asserting that.

3. **`packages/app/src/vitePlugin.ts:20`** — `LAZY_COMPONENT_KEYS` is
   `{"Field", "Preview", "Builder"}`. The transform is key-name based, so nesting under
   `admin:` needs no change. But `Filter` is **missing** — `BaseUIConfig.Filter`
   (`properties.ts:193`) is a `ComponentRef` that never gets the lazy treatment. Pre-existing
   bug, fix it in the same pass since it is one line and the same subsystem.

4. **`WhereFilterOp` has two definitions** — `packages/types` and
   `packages/ui`'s `VirtualTableProps` (`VirtualTableWhereFilterOp`). Do not create a
   third in `admin-types`; `admin-types` re-exports core's.

5. **`packages/server` devDependencies** — drop `@types/react`, `@types/react-dom`,
   `@vitejs/plugin-react`. If the build breaks, that is the finding, not a nuisance.

6. **`examples/firebase/src/collections/*.tsx`** are React-authored collections, but they
   are frontend-only (no backend loads them). They migrate to the `admin` block for
   consistency, not for correctness.

7. **Naming consistency, one open question.** Collection-level UI lands under `admin:`,
   property-level UI stays under `ui:`. Two words for one concept. Recommendation: keep
   `ui` for properties — it is already shipped, widely used, and reads correctly on a
   field, whereas `admin` reads correctly on a collection (it configures the panel's
   *behaviour*, not just styling). Flagging it rather than deciding silently; renaming
   property `ui` → `admin` is a one-line addition to the same codemod if preferred.

---

## 5. Enforcement — the part that makes it stick

Written before the refactor, so it fails first and passes last.

1. **No-React guard.** A CI script asserting that no file under
   `packages/{types,common,client,utils,codegen,server,server-postgres,server-mongo,cli,inference}/src`
   or their `dist` matches `/["']react["']/`. Today this fails on 13 files in
   `packages/types/src` — that failing run is the baseline.
2. **BaaS typecheck smoke project.** `e2e/baas-typecheck/`: a fixture installing only
   `@rebasepro/server` + `@rebasepro/server-postgres` + `@rebasepro/client`, with **no**
   `react` or `@types/react` present and `"skipLibCheck": false`. It typechecks a small
   server and a collection file. This is the single test that would have caught the
   present state, and the one that keeps the boundary honest.
3. **Import direction lint.** `no-restricted-imports` (or dependency-cruiser) forbidding
   `@rebasepro/admin-types` and `@rebasepro/admin-common` from every core package.
4. **Wire it into CI that actually runs.** Per the `security-tests-not-in-ci` finding,
   several suites here run nowhere. These three go into the existing Postgres CI job, not
   a new workflow.

---

## 6. Phasing

Each phase ends green and shippable. The order is deliberate: mechanical and
compiler-verifiable work first, semantic changes second, so a failure in phase 3 cannot be
confused with a failure in phase 1 — which is how the previous attempt became
unreviewable.

**Phase 0 — guards (½ day).** Land §5.1–5.4 with the no-React guard and BaaS smoke test
**expected to fail**, recorded as the baseline. Nothing else changes.

**Phase 1 — break the cycles (1 day).** React-free `ComponentRef`; `icon: string` in core;
`AuthController` narrowed; `RebaseCallContext` into `call_context.ts`; `auth.tsx → auth.ts`;
`SecurityRule`s into `security_rules.ts`. No files move packages yet. Verify:
`packages/types/src` no longer imports React *except* in the 25 files destined for
`admin-types`.

**Phase 2 — the package cut (1–2 days, mostly codemod).** Create `@rebasepro/admin-types`
and `@rebasepro/admin-common`; move the 25 files and the 12 `collections.ts` view-model
exports; rewrite ~220 import specifiers across `admin`, `app`, `firebase`, `studio`,
`plugin-ai`, `plugin-insights` with a codemod (`@rebasepro/types` →
`@rebasepro/admin-types` for the 89 known UI symbols, splitting mixed import statements).
Strip `packages/server`'s React devDeps. **The no-React guard and the BaaS smoke test go
green here** — the headline goal is met at the end of phase 2, before any user-visible
change.

**Phase 3 — the `admin` block (2 days).** Add `admin?: AdminBlock` to core and
`AdminCollectionOptions`/`AdminCollectionConfig`/`defineCollection` to `admin-types`;
remove the 31 flat UI fields from `BaseCollectionConfig`; export `ADMIN_COLLECTION_KEYS`;
teach every reader to look in `admin` (`packages/admin` is the bulk); exclude `admin` from
`serializeCollections` and `computeSchemaVersion` with a test. Ship the codemod
(`rebase codemod collections-admin-block`) and run it over `app/config`, `saas/config`,
`examples/*`, plus the two external consumers (`dadaki`, `rebase-growth`).

**Phase 4 — the schema editor (1 day).** `ast-schema-editor.ts` writes into `admin` from
`ADMIN_COLLECTION_KEYS`; the collection editor UI groups schema vs presentation to match;
verify the round-trip (edit in panel → file on disk → reload) since per the
`drizzle-generate-mangles-policies` finding, generated-config round-trips are where this
codebase has been bitten before.

**Phase 5 — say it out loud (1 day).** `MODULAR-ARCHITECTURE.md` gains the type-layer
diagram; docs get a "collection anatomy: schema vs admin" page across all 6 locales
(`pnpm verify:docs` must pass); `README` and website copy lead with the two-package BaaS
install. Per the `backend-first-positioning` note this is the payoff, not decoration: the
install line for a BaaS user becomes two packages with no React anywhere in the tree, and
the type they read is the contract, not the panel.

**Total: ~7 working days.** Phases 0–2 are the load-bearing ones and are independently
shippable; if the work is interrupted after phase 2 the BaaS claim is already true and
verified, with only the authoring ergonomics left undone.

---

## 7. Explicitly out of scope

- Renaming published packages other than adding the two new ones.
- Any change to `@rebasepro/ui` or `@rebasepro/forms` — already clean.
- Runtime behaviour of the admin panel. Every phase is type-level and mechanical; a
  visible admin regression means something went wrong, not something changed.
- Making BaaS mode's DB introspection richer. Separate concern, already documented.


---

## What the plan got wrong

Recorded because each of these is a trap the next person would fall into.

**1. `AdminCollectionOptions` cannot be an `interface`.** The plan specified one.
TypeScript gives an implicit index signature to an object *type alias* but not to an
interface, so as an interface it is not assignable to `AdminBlock`, and every
collection authored with a typed block is rejected wherever a plain
`CollectionConfig` is expected. That single change cleared 60 of 119 remaining type
errors. This is the one that would most likely be read as "the opaque-block approach
doesn't work".

**2. `Omit<CollectionConfig, "admin">` collapses the union.** `CollectionConfig` is
discriminated on `engine`, and a non-distributive `Omit` widens the discriminant, so
the result stops being assignable back to `CollectionConfig` — breaking every call
that hands a resolved collection to a core function. Both mappings need
`C extends unknown ? … : never`.

**3. The panel needed a flat view model, not 350 rewritten call sites.** The plan
implied `collection.admin?.propertiesOrder` everywhere. The right answer was
`AdminCollection` — flat — resolved once at the registry funnel, because the panel
never reads a raw collection: by then the declared config has been merged with the
user's local overrides. Same split `Entity` already has against flat rows.

**4. `ADMIN_COLLECTION_KEYS` has to live in core, not `admin-types`.** The plan put it
in `admin-types`. The ts-morph schema editor is in `@rebasepro/server`, which the
guard forbids from importing an admin package. The list is plain data, so core owns it
and `admin-types` re-exports it through a `satisfies` clause that is the agreement
check.

**5. `icon` is not read server-side.** The plan claimed the OpenAPI generator and the
console render it, and kept it in core on that basis. Checked: nothing reads it.
`name`, `singularName` and `description` *are* read by the OpenAPI generator, so those
stayed. Measuring all 38 candidate fields against the backend packages before moving
any of them is what made the partition defensible — the answer was zero reads for all
38.

Also worth knowing:

- **Annotation, not `satisfies`, for collection files.** `satisfies` keeps the literal
  type, which then stops matching `CollectionConfig` where a relation's
  `target: () => otherCollection` thunk needs it. The annotation checks the same
  excess properties and widens.
- **The typed block must be a *type-only* import.** `defineCollection` from
  `admin-types` is a value, so it would put an admin package in the backend's module
  graph and fail `check:headless`. `import type { AdminCollectionConfig }` is erased
  and still gives excess-property checking.
- **The core type guards narrowed by replacement**, discarding the caller's type.
  Generic-over-input with intersection narrowing is strictly better and was required.
- **`CollectionRegistryController.collections` was hardcoded** to `CollectionConfig`
  while `getCollection` honoured the `EC` parameter.

## What is still open

- `packages/cli/test/e2e/templates.test.ts` has 6 pre-existing failures
  (`REGISTRATION_DISABLED` — `ALLOW_REGISTRATION` defaults to `false` and the
  scaffolded `.env` does not set it). Failing in CI before this work; spun off.
- `pnpm verify:docs` still reports 253 findings, warn-only and almost all
  pre-existing (256 before this work). Syntax findings are identical at 11, which is
  what proves the fence codemod broke nothing.
- `saas/config` is migrated but **uncommitted** — that checkout had another session's
  work in it, so the migration was left in the working tree rather than mixed into
  someone else's change.
- The CMS init e2e (`cli-init-e2e.ts`) verified scaffold → install → build →
  `db generate`/`db push` → dev boot → API reads, then stalled on step 9 pulling
  `node:22-alpine`. A bare `docker pull node:22-alpine` hangs the same way here, so
  that is Docker Hub, not the code.
