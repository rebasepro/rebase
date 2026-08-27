# Type placement audit — 2026-07-28

Scope: every type in the workspace that is declared somewhere other than where it
belongs. Three failure shapes, in descending order of how much they cost:

1. **A driver-specific field on a driver-agnostic type.** Nothing reads it for that
   driver, so it is inert config the user is invited to write.
2. **An admin-panel field on a core (BaaS) type.** The collection-level half of the
   BaaS/admin split shipped; the property-level half did not.
3. **A type defined more than once.** Every copy is a drift site, and four of them
   have already drifted.

The starting point was `disableDefaultPolicies` — RLS is Postgres-only, but the flag
is declared on `BaseCollectionConfig`, so a MongoDB collection accepts it. That is
not one mistake; it is the general case.

**All four tiers are resolved.** One finding below turned out to be wrong on the way
through and is corrected in place: `securityRules` is *not* Postgres-only —
`@rebasepro/server-mongo` enforces it as a query filter — so it stayed on the base
type. See Tier 2.

The framing that makes the whole list legible: `DataSourceCapabilities`
(`packages/types/src/types/data_source.ts:14`) **already declares the exact axes** —
`supportsRLS`, `supportsColumnTypes`, `supportsRelations`, `supportsSubcollections`,
`supportsReferences`. `MONGODB_CAPABILITIES` sets `supportsRLS: false` and
`supportsColumnTypes: false`. The runtime knows. The type system does not. The
engine split (`PostgresCollectionConfig` / `FirebaseCollectionConfig` /
`MongoDBCollectionConfig`, and `PostgresProperty` / `FirebaseProperty` /
`MongoProperty`) exists too — but it splits by property **kind**, never by **field**.
The two halves were never connected.

---

## Tier 1 — leaks that already misbehave — **DONE**

These are not placement smells. Each one produces a wrong result today.

> All five resolved 2026-07-28. 1.1 fell out of the Tier 3 work; 1.2–1.5 were
> fixed directly. Findings kept below as written; what changed is recorded at the
> end of each. Three further drifted fields turned up in the same mirror while
> fixing 1.4 — see there.

### 1.1 `RelationProperty.widget` is dead

`packages/types/src/types/properties.ts:573` declares:

```ts
widget?: "select" | "dialog";   // "Choose the widget to use for selecting the relation."
```

`packages/cms-types/src/types/property_options.ts:120` declares the same option
again on `AdminRelationOptions`. The admin reads **only** the admin-block one:

- `packages/cms/src/form/field_bindings/RelationFieldBinding.tsx:32` — `property.admin?.widget ?? "select"`
- `packages/cms/src/components/CollectionTableBinding/table_bindings.tsx:237` — `(property as RelationProperty).admin?.widget === "dialog"`

So a user who follows the core doc comment and writes `widget: "dialog"` on the
property gets a `select` and no error. Two declarations, one reader.

**Fixed** — the core declaration is deleted, not moved. `AdminRelationOptions` was
already the one that worked.

### 1.2 The client SDK cannot create an admin API key

`ApiKeyPermission`, `ApiKeyMasked`, `ApiKeyWithSecret`, `CreateApiKeyRequest`,
`UpdateApiKeyRequest` are declared **three times**:

| Copy | `admin` on Create/Update? |
| --- | --- |
| `packages/server/src/auth/api-keys/api-key-types.ts` | yes |
| `packages/types/src/types/api_keys.ts` | yes |
| `packages/client/src/api-keys.ts` | **no** |

The client copy opens with a comment that is now false:

> `// Re-define the types locally since they live in server, not in @rebasepro/types.`

They do live in `@rebasepro/types` — `types/src/types/api_keys.ts`, re-exported from
the package index. And `packages/client/src/index.ts:183` types the client's surface
as `ReturnType<typeof createApiKeys>`, i.e. the local copy, not `ApiKeysAPI`. So
`client.apiKeys.createKey({ name, permissions, admin: true })` is an excess-property
error. `admin` is the flag that grants the `admin` role — admin routes plus the RLS
`default_admin` policies — so the one privileged thing about a key is unreachable
through the SDK.

**Fixed** — one declaration, in `@rebasepro/types`, carrying the server's docs.
The client and the server both re-export it. `ApiKey` — the database row with
`key_hash` — stays server-side; nothing off the server may see it.

### 1.3 `HistoryEntry.updated_at` is `string` in one driver and `Date` in the other

Same interface name, same field list, two packages, no shared declaration:

- `packages/server-postgres/src/history/HistoryService.ts:5` — `updated_at: string`
- `packages/server-mongo/src/services/MongoHistoryService.ts:65` — `updated_at: Date`

`RecordHistoryParams` and `HistoryRetentionConfig` are duplicated alongside them
(the Mongo copy has lost the retention doc comments). History is a cross-driver
feature — `DatabaseAdapter.initializeHistory` is on the shared adapter interface,
and `HistoryConfig` already lives in `types/src/controllers/client.ts` — so the entry
shape belongs there too. As it stands nothing can consume history driver-agnostically
without picking a side.

**Fixed** — and there was a *fourth* copy: `HistoryEntryData` in the admin's
`useHistory` hook. `EntityHistoryEntry` now lives in `types/src/types/history.ts`
with `updated_at: string`, because that is what it is on the wire, and the admin
reads it over JSON. MongoDB's `Date` was never the contract, only its storage: the
driver keeps a `MongoHistoryDocument` for the stored document (`_id`, `updated_at:
Date` so the retention query can `$lt` it) and derives it from the shared type by
`Omit`. Naming that document `HistoryEntry` — the same name Postgres used for its
wire shape — is what let the two disagree silently.

### 1.4 The collection editor's serializable mirror silently drops five fields

`packages/cms/src/collection_editor/serializable_types.ts` is a 497-line
hand-maintained mirror of the types in `@rebasepro/types` and `@rebasepro/cms-types`,
and `serializable_utils.ts` copies field-by-field through an explicit whitelist
(`toSerializableCollectionConfig`, line 434). Fields added to core since the mirror
was last synced are absent from both:

| Field | Declared in | In the mirror? |
| --- | --- | --- |
| `strictWrites` | `BaseCollectionConfig` | no |
| `disableDefaultPolicies` | `BaseCollectionConfig` | no |
| `excludeFromApi` | `BaseProperty` | no |
| `filterOperators` | `AdminPropertyOptions` | no |
| `urlPreview` | `AdminStringOptions` | no |

Because the collection editor round-trips a collection through this shape on the way
to the ts-morph writer, editing a collection in the panel drops whichever of these it
had. `excludeFromApi` is the one that matters: it is the server-side guarantee that a
password hash never reaches a response, and it is not in the whitelist.

**Fixed** — all five, plus three more the same search turned up once the mirror was
open:

- `StringProperty.url` was not mirrored at all, so it was dropped on save. It feeds
  the generated OpenAPI contract.
- `urlPreview` was mirrored under the name `url` on the *admin* options — so the
  core flag had two serializable spellings and the admin option had none.
- `Filter` is a `ComponentRef` like `Field` and `Preview`, but the serializer
  strips components by naming them, and it named only those two. `Filter` was
  copied into the result — then silently dropped by `JSON.stringify`, which
  omits function-valued keys, so it read back as absent rather than as itself.
  All three now come off one list.

### 1.5 A third, stale `WhereFilterOp`

`packages/studio/src/components/JSEditor/JSMonacoEditor.tsx:48` declares a private
copy with the ten Firestore-era operators — missing `like`, `ilike`, `not-like`,
`not-ilike`, `is-null`, `is-not-null`. The canonical one
(`types/src/types/filter-operators.ts:61`) has sixteen. The `packages/ui` copy
(`VirtualTable/VirtualTableProps.tsx:281`) is currently in sync, but it is a copy,
so it is a matter of time; this is the known-and-documented one, and studio is the
proof that the pattern spreads.

**Fixed** — studio's block is a template literal fed to Monaco as an ambient `.d.ts`,
so it cannot import a type. The operator union is interpolated from
`ALL_WHERE_FILTER_OPS` instead, which is the one part that now cannot fall behind.

Two neighbouring declarations in the same block were wrong the same way, and both
taught the mistake through autocomplete: `where?: Record<string, string>` (the
canonical `FindParams.where` takes `[op, value]` tuples — a bare string reaches
PostgREST and builds a malformed query) and `orderBy?: string` (a `[field,
direction]` tuple). `logical` was missing entirely. All three corrected; the rest of
that block is still hand-maintained.

The `packages/ui` copy is untouched and still a copy.

---

## Tier 2 — Postgres-only fields on driver-agnostic types — **DONE**

> Resolved 2026-07-28, and one claim below is **wrong**: `securityRules` is not
> Postgres-only. `@rebasepro/server-mongo` implements it, translating the rules
> into a query filter it AND-s into every read and write — `access`,
> `ownerField`, `roles`, `mode`, `operation`/`operations`, and a best effort at
> raw `using`/`withCheck` SQL. It stayed on the base, now documented as the
> cross-engine authorization contract it is. `supportsRLS` answers "does this
> engine generate policies", which is a different question from "does this
> engine honour a rule", and reading it as the latter is what produced the
> error.
>
> What moved: `table`, `relations`, `disableDefaultPolicies` to
> `PostgresCollectionConfig`; `columnType` and `columnName` off the document
> engines' property maps. See **Resolution** at the end of this tier.

### 2.1 `BaseCollectionConfig`

`packages/types/src/types/collections.ts`. Every one of these is inherited by
`FirebaseCollectionConfig` and `MongoDBCollectionConfig`, both of which `extends
BaseCollectionConfig`:

| Field | Line | Note |
| --- | --- | --- |
| `securityRules` | 223 | RLS. `supportsRLS: false` for both document engines. |
| `disableDefaultPolicies` | 136 | Opts out of policies that are never generated. |
| `table` | 210 | Also re-declared on `PostgresCollectionConfig:251`. |
| `relations` | 217 | Also re-declared on `PostgresCollectionConfig:264`. `supportsRelations: false` for both. |

`securityRules`, `table` and `relations` are each declared **twice** — once on the
base and again on `PostgresCollectionConfig`, the second time with the correct
Postgres-specific doc comment. Someone knew where they belonged, moved the
documentation, and left the declaration behind.

Every consumer is SQL-side: `server-postgres/src/schema/generate-postgres-ddl-logic.ts`,
`server-postgres/src/security/rls-enforcement.ts`, `common/src/util/auth-default-policies.ts`,
`common/src/util/junction-policies.ts`.

This typechecks today and is entirely inert:

```ts
const c: MongoDBCollectionConfig = {
    slug: "x", name: "X", engine: "mongodb", properties: {},
    securityRules: [{ using: "auth.uid() = owner_id" }],
    disableDefaultPolicies: true,
};
```

### 2.2 `BaseProperty.columnName`

`properties.ts:184`, documented as "the SQL column name, bypassing any snake_case
conversion", populated by `rebase schema introspect`. Inherited by every property of
every engine.

### 2.3 `columnType` on five shared property types

`StringProperty:255`, `NumberProperty:327`, `DateProperty:398`, `ArrayProperty:587`,
`MapProperty:659`. The value unions are pure Postgres — `uuid`, `bigserial`,
`double precision`, `jsonb`, `text[]`, `numeric[]`. `supportsColumnTypes: false`
for Firestore and MongoDB.

This is the largest single instance, because the engine property split
(`properties.ts:68-83`) only ever excluded whole property *kinds*:

```ts
export type PostgresProperty = Exclude<Property, ReferenceProperty>;
export type FirebaseProperty = Exclude<Property, RelationProperty>;
export type MongoProperty   = Exclude<Property, RelationProperty>;
```

A `StringProperty` in a Mongo collection is the same `StringProperty`, `columnType`
and all.

### 2.4 `isId` strategy unions

`StringProperty:273` (`"uuid" | "cuid" | …`) and `NumberProperty:342` (`"increment"`)
document Drizzle behaviour — `Drizzle append: .primaryKey()` — on shared types.
`ReferenceProperty:465` carries the same Drizzle note, which is the sharpest version
of the problem: `ReferenceProperty` is *excluded* from `PostgresProperty`, so that
comment describes something that cannot happen.

### 2.5 Postgres introspection shapes in `types/src/types/websockets.ts`

`TableColumnInfo`, `TableForeignKeyInfo`, `TableJunctionInfo`, `TablePolicyInfo`,
`TableMetadata` (lines 122-159). These are raw `information_schema` / `pg_policies`
row shapes — `udt_name`, `is_nullable: string`, `character_maximum_length`, `qual`,
`with_check` — snake_cased straight off a `SELECT`. Wrong on two axes: Postgres-only
in the shared package, and in a file about WebSocket frames.

Consumers: `server-postgres/src/PostgresBackendDriver.ts` (the producer),
`admin/src/collection_editor/pgColumnToProperty.ts`, `studio/src/utils/pgColumnToProperty.ts`.

### 2.6 `VectorProperty.dimensions`

`properties.ts:373`. pgvector-shaped, in the shared union, and there is no
`supportsVectors` capability flag to gate it — so unlike the others there is not even
a runtime answer to appeal to.

### Resolution

The two halves the audit kept pointing at — an engine split that knew the fields
and a capability descriptor that knew the engines — are now joined by one guard:

```ts
export function isRelationalCollectionConfig<C extends CollectionConfig<any, any>>(
    collection: C
): collection is C & PostgresCollectionConfig<any, any> {
    return getDataSourceCapabilities(collection.engine).supportsRelations;
}
```

It is the capability check the call sites were already making, with the narrowing
the type system was missing. Every site that read `collection.table` or
`collection.relations` was *already* guarded on `supportsRelations` at runtime and
then read a field the base type had to declare for it — which is precisely why
those fields were on the base. Using the guard keeps a custom SQL engine
registered through `registerDataSourceCapabilities` working, which naming
Postgres directly would not.

For properties the fields stay on the concrete interfaces — that is where their
per-type value unions live — and the *document engines' aliases* omit them:

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type SqlColumnFields = "columnType" | "columnName";

export type MongoProperty = DistributiveOmit<Exclude<Property, RelationProperty>, SqlColumnFields>;
```

The distribution matters: a bare `Omit` over a discriminated union collapses it
into one object with a widened `type`, so `property.type === "string"` would stop
narrowing everywhere.

**Cost.** Far below the estimate. The reference counts in the table above are
mostly `.table` on other objects entirely: the real fallout was 64 errors across
6 files, and the property gating landed at **zero**. Fixed sites:
`common/util/relations.ts`, `auth-default-policies.ts`, `junction-policies.ts`,
`admin/collection_editor/serializable_utils.ts`, `app/collections/title-property.ts`,
`server-postgres/PostgresBootstrapper.ts`.

**The test that was supposed to catch all of this.**
`packages/types/test/property_engine_gates.test.ts` already existed, and its own
header said "the real value is that `tsc --noEmit` validates the
`@ts-expect-error` annotations". Nothing ever ran tsc over it. Jest strips types
without checking them, so the file was inert — and it had drifted to asserting
`driver: "firestore"` (the field is `engine`), `collectionPath` on a relation
(replaced by the tagged union), `previewAsTag` and `reference` on
`StringProperty` (moved to the admin block, and deleted), and properties missing
their required `name`. Green every run, for months.

It is rewritten to cover both the old gates and the new ones, and
`packages/types/test` is added to the root `tsconfig.tests.json` so
`pnpm typecheck` reads it. Verified sensitive: adding a deliberately-unused
`@ts-expect-error` now fails with `TS2578`, which it did not before.

---

## Tier 3 — admin-panel fields still on core property types — **DONE**

> Resolved 2026-07-28. The nine fields below moved into `Admin*Options`; `widget`
> lost its duplicate core declaration, which also closes **1.1**. Two stayed, with
> the reason recorded on the field. The rest of this section is the original
> finding, kept for the record.


`packages/cms-types/src/augment.ts` adds `admin?: Admin*Options` back onto
`BaseCollectionConfig` and all ten property interfaces by declaration merging. Its
header states the intent plainly: a BaaS install "cannot even write one". For
collections that holds — `ADMIN_COLLECTION_KEYS` lists 37 keys and none of them is
declared on the base config. For **properties** it does not: these presentation
options never moved.

| Field | Where | Read from |
| --- | --- | --- |
| `RelationProperty.fixedFilter` | `properties.ts:558` | top level |
| `RelationProperty.includeId` | 563 | top level |
| `RelationProperty.includeEntityLink` | 567 | top level |
| `RelationProperty.widget` | 573 | **admin block only — see 1.1** |
| `ReferenceProperty.fixedFilter` | 481 | top level |
| `ReferenceProperty.includeId` | 486 | top level |
| `ReferenceProperty.includeEntityLink` | 490 | top level |
| `ArrayProperty.sortable` | 642 | top level |
| `ArrayProperty.canAddElements` | 647 | top level |
| `ArrayProperty.oneOf.propertiesOrder` | 621 | top level |
| `MapProperty.propertiesOrder` | 669 | top level |
| `MapProperty.previewProperties` | 679 | **nothing reads it as a map field** |

Note the `─── UI configuration ───` section marker at `properties.ts:552`: the file
labels the block as UI and keeps it in the BaaS package anyway.

Two of these are not straightforward moves, and both stayed in core:

- `MapProperty.keyValue` *looks* like the same category but is read by
  `server/src/api/openapi-generator.ts:636` — it says the map has no declared shape,
  which is what the generated schema is emitted from.
- `MapProperty.propertiesOrder` is read by `sortProperties` in `@rebasepro/common`,
  which `@rebasepro/firebase` calls when it builds collections. A core package cannot
  read the admin block at all — the field only exists once `@rebasepro/cms-types`
  is installed — so moving it would break a driver.

`MapProperty.previewProperties` did move: `AdminReferenceOptions` and
`AdminRelationOptions` already declared it, `AdminMapOptions` now does too.

**Verification.** Every package typechecks against its own `tsconfig.prod.json` with
workspace paths pointed at source rather than stale `dist` — that mapping is what
makes the check meaningful, since the packages otherwise resolve each other through
built declarations. `types`, `admin-types`, `common`, `app` and `admin` test suites
pass (1226 tests), lint is clean, and `verify:docs` typechecks 701 doc snippets
against the edited source.

**Residue found while doing it.** The docs had the *previous* round of this same
refactor half-applied: `properties.mdx` (all six locales) and the collections skill
listed `multiline`, `markdown`, `previewAsTag`, `clearable`, `expanded`,
`minimalistView`, `spreadChildren` as top-level, wrote the reference example with a
top-level `previewProperties`, and prefixed half the rows of the shared options table
with a `ui.` namespace that no longer exists. All corrected here.

One thing deliberately not touched: `PropertyConditions` in core declares condition
keys — `canAddElements`, `sortable`, `referenceFilter`, `disabled`, `readOnly` —
that now target fields living in the admin block. The evaluator writes into `admin`
correctly, but a core type still names admin-only options. Same category as this
tier, different mechanism; worth its own pass.

---

## Tier 4 — duplicated definitions — **DONE**

> Resolved 2026-07-28, and a second sweep after the first pass turned up five more.
> See **Resolution** at the end.

Beyond the ones already covered above (API keys ×3, `WhereFilterOp` ×3, history ×2):

| Type | Copies | Note |
| --- | --- | --- |
| `PostgresPolicy` | `admin/…/CollectionRLSTab.tsx:47`, `studio/…/RLSEditor.tsx:66` | Two UI copies of a pg policy — plus `TablePolicyInfo` in `types`, which describes the same object. Three shapes for one thing, none shared. |
| `RebaseAuthConfig` | `admin-types/src/controllers/registry.ts:77`, `server/src/init.ts:67` | The auth config contract, front and back, unlinked. |
| `pgColumnToProperty` | `admin/src/collection_editor/`, `studio/src/utils/` | ~10 KB each, near-identical. The test for it lives only in `studio`, so the `admin` copy is untested. |
| `serializable_types.ts` | `admin/src/collection_editor/` | 497-line mirror; drift documented in 1.4. |
| `RelationKind` | `types/src/types/relations.ts:26`, `rls-check/src/types.ts:69` | Genuine name collision, unrelated meanings (`"belongsTo" \| …` vs `"table" \| "view" \| …`). Harmless, but the two are one import away from being confused. |

### Resolution

The table above, plus what a re-scan for repeated exported names found afterwards:

| Type | Was | Now |
| --- | --- | --- |
| `PostgresPolicy` | admin + studio, one commented "inline to avoid depending on @rebasepro/studio" | `types/postgres_introspection.ts`, alongside the `Table*` shapes moved out of `websockets.ts` |
| `SecurityRule` (admin's local shadow) | a local `{ operation?: string }` in the RLS tab | deleted — see below |
| `pgColumnToProperty` | admin's copy called and wrong, studio's copy correct and never called | one copy in `@rebasepro/common`, retyped off `AdminCollection` |
| `RebaseAuthConfig` | the admin's `{ loginView }` vs the server's whole auth config | admin-side renamed `RebaseAuthViewConfig`, old name deprecated |
| `DatabaseConnection` | server's `{ db, pool, query }` vs types' `{ type, isConnected, close }` — disjoint, both public | server's renamed `DriverConnection`, old name deprecated |
| `RelationKind` | `belongsTo`\|… in types vs `table`\|`view`\|… in rls-check | rls-check's renamed `PgRelationKind` |
| `FunctionInvokeOptions` | client + types, identical | client re-exports |
| `ChannelHistoryEntry` | client + types — the client's had drifted `at` to optional | client re-exports |
| `EffectiveRoleController` | app + types, identical | app re-exports |
| `UploadFn` | `editor/extensions/Image.ts` and `editor/extensions/Image/index.ts` | the `Image/` directory was dead — module resolution always picked the sibling file — and is deleted |

`WhereFilterOp` in `@rebasepro/ui` is the one duplicate left standing, and it should:
`@rebasepro/ui` has no `@rebasepro/*` dependency at all, and
`types/test/filter-operators-duplication.test.ts` already parses both files and
fails if their members diverge. That is the pattern for a duplicate that has to
exist.

**What the shadow was hiding.** Deleting the admin RLS tab's local `SecurityRule`
turned up six type errors that had never been reachable. The form wrote
`cmd?.toLowerCase()` — a `string` — into `operation`, which takes a union, so an
unrecognised `cmd` would have been saved as a policy operation that compiles to
nothing. And it assembled raw-SQL rules with an optional `using`, where that
variant requires it: an INSERT-only policy carries only `WITH CHECK` and is a
roles-only rule, not a raw-SQL one. Both now go through named converters.

---

## Status

All four tiers are resolved. Verification, run after each tier:

- `tsc --noEmit` per package against its own `tsconfig.prod.json`, with workspace
  `paths` pointed at **source** rather than `dist`. That mapping is the part that
  makes the check mean anything: the packages resolve each other through built
  declarations, so a naive run typechecks the *previous* build and reports clean
  no matter what changed.
- The repo's own `tsconfig.typecheck.json`, `tsconfig.tests.json` and
  `tsconfig.core.json`.
- Every package suite: 4,720 tests.
- `eslint --quiet` on each changed package, and `verify:docs` (701 doc snippets
  typechecked against workspace source, API names across all six locales).

### Verified in the running app

Static checks passed the whole way and still missed two things; running the panel
against a real database found both.

- **A test I wrote passed with a deliberately-invalid `@ts-expect-error`.** That is
  how the inert `property_engine_gates.test.ts` was found in the first place.
- **The serializable mirror had two more holes**, and the test written to pin them
  caught a third: `url` had been added to the mirror's *type* and never to the
  copy, so it was still being dropped. Collection-level `relations` had no
  serializer at all — importing an existing table detects its foreign keys and
  junction tables, shows them on the form, and discarded every one on save.

What the panel confirmed working after the move: relation fields resolve and render
their preview properties, entity link and `select` widget through `admin`; array
blocks keep their drag handles and *Add to Content* button, so `sortable` and
`canAddElements` still default to `true` when unset.

The riskiest change — swapping the `pgColumnToProperty` the editor calls — is
pinned by `table-import-round-trip.test.ts`, which runs real `information_schema`
and `pg_policies` row shapes through the producer, the save, and back off disk.
That is the producer/consumer contract the two copies disagreed about, and it
outlasts a click-through.

One pre-existing bug turned up and was **not** introduced here — verified by putting
`main`'s sources back and reproducing it. `RelationFieldBinding` throws *"expected a
collection with relations support"* for any collection that declares its relation
inline on the property rather than in a top-level `relations` array. Four of the
demo app's collections do exactly that (`order_items`, `posts`, `product_locales`,
`tickets`), and the field falls to the error boundary. The guard should ask
`resolveCollectionRelations`, not `"relations" in collection`.

Two things worth carrying forward, both instances of the same failure:

1. **A test that is never typechecked asserts nothing.** `property_engine_gates.test.ts`
   said so in its own header — "the real value is that `tsc --noEmit` validates the
   `@ts-expect-error` annotations" — and nothing ran tsc over it, so it sat green for
   months against `driver:`, `collectionPath` and a `StringProperty` shape that had
   been gone the whole time. When adding a compile-time test, add its directory to
   `tsconfig.tests.json` in the same change, then prove it by inserting a
   deliberately-unused `@ts-expect-error` and watching `TS2578` fire.
2. **A local shadow of a shared type suppresses the errors it was meant to model.**
   The admin's `SecurityRule` with `operation?: string` accepted a `.toLowerCase()`
   the real union rejects. Both times, the shape being shadowed was one import away.

Still open, deliberately:

- `PropertyConditions` in core declares condition keys — `canAddElements`,
  `sortable`, `referenceFilter`, `disabled`, `readOnly` — that name fields living in
  the admin block. The evaluator writes into `admin` correctly, so nothing is broken;
  a core type just still names admin-only options.
- `serializable_types.ts` remains a 497-line hand-maintained mirror. It is in sync
  now, and drifted three times over while nobody was looking. Generating it, or
  testing it against the source types, is the durable fix.
- `VectorProperty.dimensions` is pgvector-shaped and there is no `supportsVectors`
  capability to gate it against, so unlike every other field here there is not even a
  runtime answer to appeal to.

