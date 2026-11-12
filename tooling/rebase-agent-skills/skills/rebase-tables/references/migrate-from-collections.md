# Migrating a project from `config/collections` to tables

A project created before the tables release keeps its data model in
`config/collections/*.ts` (`defineCollection`, `properties`, `securityRules`,
`callbacks`, `admin` blocks). This release no longer reads that layout: the
backend reads `backend/schema/`, and the CMS reads its presentation from
`frontend/src/cms/`. There are no aliases, so a project is moved once, with
the CLI's codemod. **Do not hand-port collections**: the codemod proves the
result generates byte-identical SQL, which a hand port cannot.

Signs a project needs this: a `config/` directory with `collections/`,
`import { defineCollection } from "@rebasepro/cms-types"`, a
`virtual:rebase-collections` import in `frontend/src/App.tsx`,
`<RebaseCMS collections={…}>`, or `client.data.collection("…")` calls.

## The steps

Run every command from the project root (where `rebase.json` is), on a clean
git tree: a run refuses a dirty tree unless `--force` is given, so the diff it
leaves is exactly the migration.

```bash
# 1. See the plan. Writes nothing; lists every file, refusal and manual step.
rebase migrate collections-to-tables --dry-run

# 2. Migrate. Writes the files, then reads them back through the new pipeline:
#    DDL, policies, search, vector, triggers, views and the Drizzle schema must be
#    byte-identical to what config/collections generated, or every file is put back.
rebase migrate collections-to-tables

# 3. After the manual steps (below), check again while config/ is still there.
rebase migrate collections-to-tables --check
```

`--json` prints one JSON document instead (files, refusals, notes, manual
steps, the SQL check), which is the form to parse. `--skip-sdk-calls` leaves
the project's SDK calls alone (step 2 otherwise runs `rebase migrate sdk-calls`
as part of the migration). An optional positional argument names the project
directory.

If the run says **Refused**, nothing was written. Each refusal names the file,
the line and the collection: a construct the codemod cannot carry exactly (a
spread of callbacks, a computed key, a Firestore collection in a project with
no frontend). Change that construct in `config/collections` so it can be read,
or tell the human what is refused — never edit the generated output to get
around a refusal.

When it ends with **Migrated** (or **The migrated schema matches
config/collections**), it prints the `git rm` line that removes `config/`.
`config/` is never deleted by the codemod. Show the line to the human, or run
it once the manual steps are done and `--check` passes.

## What it writes

| File | From |
|---|---|
| `backend/schema/<table>.ts` | one `defineTable` / `defineAuthTable` / `defineView` per collection: columns, relations, `rls` (from `securityRules`), `hooks` (from `callbacks`), indexes, search |
| `backend/schema/index.ts` | every table, and `defaultRls` when `config/collections` had `defaultSecurityRules` |
| `frontend/src/cms/<table>.tsx` | `customizeTable(...)`, only for a collection whose presentation (`admin` block, labels, enum colours, custom fields) was not the default |
| `frontend/src/cms/<name>.ts` | `defineFirestoreCollection(...)`, for `engine: "firestore"` collections |
| `backend/resources.ts`, `backend/storage.ts`, `backend/generated/register.ts` | their `config/` counterparts |
| `rebase.json`, `package.json`, `pnpm-workspace.yaml`, `backend/tsconfig.json` | without the config package |

## The manual steps it prints

The report ends with numbered **Manual steps**, each with the file it is about.
Do each one; they are the parts the codemod will not guess. The ones you will
meet:

- **Mount the table customizations** — `App.tsx` drops
  `import { collections } from "virtual:rebase-collections"` and
  `<RebaseCMS collections={collections}>` for
  `<RebaseCMS tableCustomizations={tableCustomizations}>` (and
  `externalCollections` for Firestore). The panel now projects every table from
  the backend and layers the customizations on.
- **Remove the collections Vite plugin** and **drop the virtual collections
  module declaration** (`declare module "virtual:rebase-collections"` in a
  `.d.ts`): nothing provides them any more.
- **Move the global collection callbacks** — the `callbacks` the old config
  package's index exported become `export const hooks` in `backend/hooks.ts`; hook
  props say `table` instead of `collection`, and `afterRead` / `beforeDelete` /
  `afterDelete` receive the row as `values` instead of `row`.
- **Update the importers of …** / **Repoint the imports of …** — code that
  imported a collection object now imports the table (`import { posts } from
  "../backend/schema/posts"`), or its type only from frontend code.
- **Replace the collection-model type …** — moved code that names a
  collection-model type with type arguments (callback props and the like) takes
  the table-model type from `@rebasepro/server/schema` instead: `TableHooks`,
  `TableBeforeSaveProps`, `TableHookProps["context"]`, `InferRow<typeof posts>`.
- **Replace … in …** — a use of a collection-model server API in your own code
  (`initializeRebaseBackend({ collectionsDir })`, …), with the line numbers and
  what to use instead.
- **Split … by hand** — a module shared by the collections (enum values with
  their labels) goes in two halves: the values in `backend/lib`, the labels in
  `frontend/src/cms/lib`.
- **Relation renamed in …**, **Check `fields.<key>.dynamicProps` of …**,
  **Child collections of …** — read the customization it names and confirm it
  still says what was meant.
- **Point backend/tsconfig.json at the backend only**, **Add @rebasepro/server
  to the backend** — package wiring.
- **Regenerate the typed SDK** — `rebase generate-sdk`; generated SDK files are
  never rewritten by the codemod.
- **Files of config/ nothing moved** — move whatever is still used before
  deleting `config/`.

## SDK calls in your own code: `rebase migrate sdk-calls`

Part of step 2 unless `--skip-sdk-calls`; run it alone on a project already
migrated, or after merging a branch that still uses the old names:

```bash
rebase migrate sdk-calls --dry-run   # what would change
rebase migrate sdk-calls             # rewrite (clean git tree, or --force)
```

It rewrites, in the project's own code (never in generated files):

| Before | After |
|---|---|
| `client.data.collection("posts")`, `context.data.collection(…)`, `rebase.dataAsAdmin.collection(…)` | `.table("posts")` |
| `createRebaseClient({ collections, collectionsDictionary })` | `{ tables, tablesDictionary }` |
| `CollectionName`, `CollectionsDictionary` from the generated types | `TableName`, `TablesDictionary` |
| batch operations `{ op, collection }` | `{ op, table }` |
| `CollectionClient`, `SDKCollectionClient`, `CollectionAccessor` | `TableClient`, `SDKTableClient`, `TableAccessor` |
| `UNKNOWN_COLLECTION`, `NO_COLLECTIONS`, `COLLECTION_READ_ONLY` | `UNKNOWN_TABLE`, `NO_TABLES`, `TABLE_READ_ONLY` |
| `maxCachedQueriesPerCollection` / `maxCachedRowsPerCollection` | `…PerTable` |
| `backend.setCollectionCallbacks(slug, cb)` | `backend.setTableHooks(slug, hooks)` (props adapted) |
| `storageAuthorize` data `.collection` | `.table` |

A `.collection(` call whose receiver is not the SDK is left as written and
listed under **Left unchanged** — check each one.

## The vocabulary, old → new

For reading old code, issues and blog posts:

| Collections (before) | Tables (now) |
|---|---|
| `defineCollection({ slug, table, properties })` in `config/collections/` | `defineTable("name", { columns })` in `backend/schema/` |
| `properties: { title: { type: "string" } }` | `columns: { title: col.text() }` |
| `validation: { required: true }` | `.notNull()` |
| `isId: "uuid"` | `col.uuid().primaryKey().defaultRandom()` |
| `type: "relation", relation: { kind: "belongsTo", target }` | `relations: { author: rel.belongsTo(() => authors) }` |
| `type: "reference"` (Postgres) | `rel.belongsTo` |
| `securityRules: [...]`, `defaultSecurityRules` | `rls: [...]` (required), `defaultRls` + `rls: "inherit"` |
| `callbacks: { onPreSave, … }` | `hooks: { beforeSave, … }` |
| property `callbacks` | `.transform({ beforeSave, afterRead })` |
| `admin: { … }` on a collection or property | `customizeTable<typeof t>("slug", { …, fields: { … } })` in `frontend/src/cms/` |
| `admin.propertiesOrder`, `kanban.columnProperty`, `orderProperty` | `fieldOrder`, `kanban.columnField`, `kanban.orderField` |
| `userSelect: true` | `.userId()` on the column |
| `auth: { … }` collection | `defineAuthTable("users", { …, auth: { … } })` |
| `view: { query }` collection | `defineView("name", { query, columns })` |
| `engine: "firestore"` collection | `defineFirestoreCollection(…)` in `frontend/src/cms/`, passed as `externalCollections` |
| `--collections <dir>`, `collectionsDir` | `--schema-dir <dir>`, `schemaDir`; `rebase.json` key `tables` |
| `policy.existsIn({ collection })`, `tenant.from.membership.collection` | `policy.existsIn({ table })`, `…membership.table` |
| MCP `list_collections` / `query_collection` / `*_document` | `list_tables` / `query_table` / `*_row` |
| MongoDB data source | retired; Postgres only on the server |

## The agent skills

The skill that taught collections, `rebase-collections`, is now `rebase-tables`.
`rebase skills install` replaces it: the installer removes a Rebase skill the
package no longer ships (one it recorded, or a `rebase-collections` body still
carrying its own name) and keeps anything you wrote or edited.

## Verify

After the manual steps: `rebase migrate collections-to-tables --check`
(SQL still identical), `rebase verify` (the tables compile), the project's own
typecheck and tests, then `pnpm dev` and open the panel — every table should be
listed, with the customizations applied.
