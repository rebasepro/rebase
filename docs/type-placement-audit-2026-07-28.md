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

## Tier 1 — leaks that already misbehave

These are not placement smells. Each one produces a wrong result today.

### 1.1 `RelationProperty.widget` is dead

`packages/types/src/types/properties.ts:573` declares:

```ts
widget?: "select" | "dialog";   // "Choose the widget to use for selecting the relation."
```

`packages/admin-types/src/types/property_options.ts:120` declares the same option
again on `AdminRelationOptions`. The admin reads **only** the admin-block one:

- `packages/admin/src/form/field_bindings/RelationFieldBinding.tsx:32` — `property.admin?.widget ?? "select"`
- `packages/admin/src/components/CollectionTableBinding/table_bindings.tsx:237` — `(property as RelationProperty).admin?.widget === "dialog"`

So a user who follows the core doc comment and writes `widget: "dialog"` on the
property gets a `select` and no error. Two declarations, one reader.

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

### 1.4 The collection editor's serializable mirror silently drops five fields

`packages/admin/src/collection_editor/serializable_types.ts` is a 497-line
hand-maintained mirror of the types in `@rebasepro/types` and `@rebasepro/admin-types`,
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

### 1.5 A third, stale `WhereFilterOp`

`packages/studio/src/components/JSEditor/JSMonacoEditor.tsx:48` declares a private
copy with the ten Firestore-era operators — missing `like`, `ilike`, `not-like`,
`not-ilike`, `is-null`, `is-not-null`. The canonical one
(`types/src/types/filter-operators.ts:61`) has sixteen. The `packages/ui` copy
(`VirtualTable/VirtualTableProps.tsx:281`) is currently in sync, but it is a copy,
so it is a matter of time; this is the known-and-documented one, and studio is the
proof that the pattern spreads.

---

## Tier 2 — Postgres-only fields on driver-agnostic types

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

---

## Tier 3 — admin-panel fields still on core property types

`packages/admin-types/src/augment.ts` adds `admin?: Admin*Options` back onto
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

Two of these are not straightforward moves:

- `MapProperty.keyValue` (684) *looks* like the same category but is read by
  `server/src/api/openapi-generator.ts:636` — it changes the generated contract, so
  it is genuinely core. Leave it.
- `MapProperty.previewProperties` has no reader at all in that position.
  `AdminReferenceOptions` and `AdminRelationOptions` both declare `previewProperties`;
  `AdminMapOptions` does not. Whichever way it goes, it is inconsistent today.

---

## Tier 4 — duplicated definitions

Beyond the ones already covered above (API keys ×3, `WhereFilterOp` ×3, history ×2):

| Type | Copies | Note |
| --- | --- | --- |
| `PostgresPolicy` | `admin/…/CollectionRLSTab.tsx:47`, `studio/…/RLSEditor.tsx:66` | Two UI copies of a pg policy — plus `TablePolicyInfo` in `types`, which describes the same object. Three shapes for one thing, none shared. |
| `RebaseAuthConfig` | `admin-types/src/controllers/registry.ts:77`, `server/src/init.ts:67` | The auth config contract, front and back, unlinked. |
| `pgColumnToProperty` | `admin/src/collection_editor/`, `studio/src/utils/` | ~10 KB each, near-identical. The test for it lives only in `studio`, so the `admin` copy is untested. |
| `serializable_types.ts` | `admin/src/collection_editor/` | 497-line mirror; drift documented in 1.4. |
| `RelationKind` | `types/src/types/relations.ts:26`, `rls-check/src/types.ts:69` | Genuine name collision, unrelated meanings (`"belongsTo" \| …` vs `"table" \| "view" \| …`). Harmless, but the two are one import away from being confused. |

---

## Recommended sequencing

The Tier 1 items are independent, small, and fix real behaviour — do them first,
regardless of what happens to the rest.

Tier 2 is where the cost is. Blast radius, counting references outside
`packages/types`:

| Field | refs |
| --- | --- |
| `disableDefaultPolicies` | 8 |
| `securityRules` | 80 |
| `relations` | 47 |
| `columnType` | 127 |
| `table` | 230 |

`disableDefaultPolicies` alone is an afternoon. `columnType` and `table` are not, and
neither should be attempted as a type edit — `rls-enforcement.ts:258` already takes a
structural `{ slug?; securityRules? }[]` rather than a collection type, which is the
shape the rest of the call sites will need too.

There is also a design question to settle before moving anything in Tier 2, because
it decides the whole approach: should the driver-agnostic types stay *narrow* (fields
live only on `PostgresCollectionConfig`, and agnostic code narrows via
`isPostgresCollectionConfig`), or stay *wide* with the capability flags enforcing
correctness (a conditional type keyed on `engine`)? The first is honest and noisy;
the second keeps every existing call site compiling. `DataSourceCapabilities` already
holds the data either way.

Tier 3 is mechanical but wide, and it is the second half of a split that already
shipped — worth finishing so the property surface matches the collection surface.

Tier 4 wants one decision per row about which copy is canonical; the API-key and
history rows are the two with live consequences.
