/**
 * What changed in 0.31 beyond the kernel moves, in the spellings a project's
 * own code can hold: exports renamed or removed outside `@rebasepro/types` /
 * `@rebasepro/common`, call options, environment variables, route paths, tool
 * names. `rebase migrate sdk-calls` reads it (`moved-imports.ts`).
 *
 * The kernel moves are not here: they are generated from the headless guard's
 * JSON into `moved-symbols.generated.ts`, and a row there wins over a row here
 * for the same name and package.
 *
 * - A row of {@link EXPORT_CHANGES} with `to` set is rewritten: the meaning is
 *   the same and only the spelling (or the package) changed.
 * - A row with `to: null` is not rewritten — the export is gone, or it still
 *   exists but takes or returns something different — so the codemod finds
 *   the import and prints a manual step with `instead` and the upgrade-guide
 *   section.
 * - {@link CALL_OPTION_CHANGES} and {@link CODE_SPELLINGS} are detected the
 *   same way, never rewritten.
 *
 * The list is the diff of every package's root exports between 0.30.1 and
 * this release, and the upgrade guide's sections; the coverage of each
 * Breaking entry is recorded in the slice notes. The test
 * (`moved-imports.test.ts`) holds every renamed name to an export of its
 * package today and every `guide` to a heading of the upgrade guide.
 */
import type { MovedSymbol } from "./types";

/** The upgrade guide this release's manual steps point into. */
export const UPGRADE_GUIDE = "https://rebase.pro/docs/upgrading/0-30-to-0-31/";

/** Sections of the upgrade guide, by number: the anchor of each heading. */
export const GUIDE = {
    tables: "#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first",
    configPackage: "#109-there-is-no-config-package",
    bootOptions: "#110-boot-options-and-hooks-name-tables",
    adminPanel: "#111-the-admin-panel-renders-the-tables-the-server-serves",
    sdk: "#115-the-sdk-addresses-a-table-datatableslug",
    cliFlags: "#116-cli-flags---schema-dir-not---collections",
    schemaEditor: "#117-the-schema-editor-edits-backendschema-with-tablepatch",
    componentSlot: "#118-a-component-slot-is-a-component",
    uiPreferences: "#119-panel-preferences-are-ui-preferences",
    mongo: "#120-mongodb-is-retired",
    mcp: "#122-mcp-tools-are-named-for-tables",
    rlsCheck: "#125-rls-check---format-agent-says-rls",
    review: "#126-rebaseproplugin-review-reviewrls",
    codegen: "#127-rebaseprocodegen-reads-descriptors",
    jsonCollections: "#129-usejsoncollectionsconfigcontroller-is-removed",
    history: "#132-history-is-served-as-reads",
    serverExports: "#133-rebaseproserver-exports-name-tables",
    postgresExports: "#134-rebaseproserver-postgres-exports-name-tables",
    kernel: "#135-rebaseprotypes-and-rebaseprocommon-drop-the-collection-model-from-their-roots"
} as const;

const removed = (from: string, symbols: readonly string[], instead: string, guide?: string): MovedSymbol[] =>
    symbols.map(symbol => ({ symbol, from, to: null, instead, ...(guide ? { guide } : {}) }));

const MONGO = "Nothing: MongoDB is retired and Postgres is the only server engine; move the data to Postgres.";
const COMPONENT = "Pass the component itself: import it by value in the frontend/src/cms file and give it to the slot (`Field`, `Preview`, `Actions`, `Builder`, …). `customizeTable` refuses a string path or a lazy thunk.";
const COLLECTION_MODEL = "Nothing: the collection model left the kernel. Read the table's `TableDescriptor` (`compileTables` from @rebasepro/common, `backend.getTableDescriptors()`, `GET /api/schema/tables`).";
const LOADING = "`compileTables` (@rebasepro/common) checks the tables and throws one `SchemaDefinitionError` naming every problem; `schemaDir` / `loadBackendSchema` load backend/schema.";
const REGISTRY = "`TableRegistryInterface` from @rebasepro/types: `setGlobalHooks?` / `setTableHooks?` replace `getGlobalCallbacks` / `setGlobalCallbacks?`.";
const SCHEMA_EDIT = "`TablePatch` from @rebasepro/types: a schema edit is a list of `TablePatch` edits (`POST /api/admin/schema-editor/preview` and `/apply`, live schema `{ patches }`).";

/** Exports renamed (rewritten) or changed (a manual step) outside the kernel moves. */
export const EXPORT_CHANGES: readonly MovedSymbol[] = [
    // Renamed, same signature: rewritten.
    { symbol: "reviewSecurityRules", from: "@rebasepro/plugin-review", to: "@rebasepro/plugin-review", as: "reviewRls", guide: GUIDE.review },
    { symbol: "reviewSecurityRules", from: "@rebasepro/plugin-review/config", to: "@rebasepro/plugin-review/config", as: "reviewRls", guide: GUIDE.review },
    { symbol: "assertUploadWithinPropertyLimits", from: "@rebasepro/server", to: "@rebasepro/server", as: "assertUploadWithinColumnLimits", guide: GUIDE.serverExports },
    { symbol: "UPLOAD_COLLECTION_FIELD", from: "@rebasepro/server", to: "@rebasepro/server", as: "UPLOAD_TABLE_FIELD", guide: GUIDE.serverExports },
    { symbol: "UPLOAD_PROPERTY_FIELD", from: "@rebasepro/server", to: "@rebasepro/server", as: "UPLOAD_COLUMN_FIELD", guide: GUIDE.serverExports },

    // @rebasepro/types
    ...removed("@rebasepro/types", ["CollectionPatch", "CollectionPatchOp", "applyCollectionPatch", "collectionPatchProblems", "isCollectionPatch", "nestCollectionPatchPaths"], SCHEMA_EDIT, GUIDE.schemaEditor),
    ...removed("@rebasepro/types", ["CollectionRegistryInterface"], REGISTRY, GUIDE.kernel),
    ...removed("@rebasepro/types", ["ComponentLike", "ComponentRef", "LazyComponentRef", "isLazyComponentRef"], COMPONENT, GUIDE.componentSlot),
    ...removed("@rebasepro/types", ["DocumentAdmin", "isDocumentAdmin", "MONGODB_CAPABILITIES", "MongoDBCollectionConfig", "MongoProperties", "MongoProperty", "isMongoDBCollectionConfig"], MONGO, GUIDE.mongo),
    ...removed("@rebasepro/types", ["RUNTIME_ONLY_COLLECTION_KEYS", "runtimeOnlyKeyIn", "toCollectionJson", "diffCollections", "diffJsonValues"], COLLECTION_MODEL, GUIDE.kernel),
    ...removed("@rebasepro/types", ["ListenOneTarget"], "`ListenOneProps` from @rebasepro/types: `ListenOneTarget` was internal, and its fields are `ListenOneProps`'s."),

    // @rebasepro/common
    ...removed("@rebasepro/common", ["IntrospectedCollection", "IntrospectedRelation", "buildCollectionFromTableMetadata"], "An introspected table is a `TableDescriptor`; `rebase schema introspect` writes `defineTable` files to backend/schema.", GUIDE.serverExports),
    ...removed("@rebasepro/common", ["buildTenantSecurityRule", "defaultPoliciesDisabled", "getJunctionConfigForRelation", "isRelationRequired", "relationDeclaringProperty", "requireCallbackCollection", "restoresSoftDeletedRow", "softDeleteFieldOf"], COLLECTION_MODEL, GUIDE.kernel),
    ...removed("@rebasepro/common", ["toCollectionAccessor"], "Nothing: a typed accessor is the table's name (`client.data.posts`), and a reserved one is `<name>Table`.", GUIDE.sdk),

    // @rebasepro/server
    ...removed("@rebasepro/server", ["BundleConfigExports", "loadBundleConfigExports"], "Nothing: there is no config package, and a bundle carries `entry.tables`, `entry.resources`, `entry.storage` and `entry.hooks`.", GUIDE.configPackage),
    ...removed("@rebasepro/server", ["CollectionConfigError", "ConfigProblem", "ValidateCollectionConfigOptions", "findCollectionConfigProblems", "assertCollectionConfigs", "CollectionDefaults", "applyCollectionDefaults", "UnknownKeyPolicy", "unknownKeyPolicyFromEnv", "accessModelFromCollections", "loadCollectionsFromDirectory", "loadUsersCollection"], LOADING, GUIDE.tables),
    ...removed("@rebasepro/server", ["CollectionRegistryInterface"], REGISTRY, GUIDE.kernel),
    ...removed("@rebasepro/server", ["DataTransformer"], "Nothing: the Postgres driver's codecs read the column descriptor."),
    ...removed("@rebasepro/server", ["composeCallbacks"], "`composeTableHooks` from @rebasepro/common: table hooks get `table` instead of `collection`, and `values` instead of `row`.", GUIDE.bootOptions),
    ...removed("@rebasepro/server", ["createUserThroughAuthCollection"], "`createUserThroughAuthTable(adapter, served, body, caller, save)` from @rebasepro/server: it takes the served table, not a collection.", GUIDE.serverExports),
    ...removed("@rebasepro/server", ["readUploadPropertyContext"], "`readUploadColumnContext` from @rebasepro/server: it returns `{ table, column }` instead of `{ collection, property }`.", GUIDE.serverExports),
    ...removed("@rebasepro/server", ["versionProperty"], "`versionColumn` from @rebasepro/server: it takes a `TableDescriptor`.", GUIDE.serverExports),

    // @rebasepro/server-postgres
    ...removed("@rebasepro/server-postgres", ["PostgresCollectionRegistry"], "`PostgresTableRegistry` (`getTable` → `getPgTable`, `registerTable` → `registerPgTable`), opened on the compiled tables (`compileSchema`).", GUIDE.postgresExports),
    ...removed("@rebasepro/server-postgres", ["CollectionRegistryInterface"], REGISTRY, GUIDE.kernel),
    ...removed("@rebasepro/server-postgres", ["DataTransformer"], "Nothing: the Postgres driver's codecs read the column descriptor."),
    ...removed("@rebasepro/server-postgres", ["resolveDriftCheckName"], "Nothing: the boot drift check reads the tables itself.", GUIDE.kernel),

    // @rebasepro/cms, @rebasepro/cms-types, @rebasepro/app
    ...removed("@rebasepro/cms", ["useJsonCollectionsConfigController", "UseJsonCollectionsConfigControllerOptions", "JsonCollectionStore"], "Declare the tables with `defineTable` in backend/schema; how the panel shows them lives in UI preferences (`frontend/src/cms/ui-config.json`, passed as `<RebaseCMS uiConfig>`).", GUIDE.jsonCollections),
    ...removed("@rebasepro/cms", ["ProposedCollectionChange"], SCHEMA_EDIT, GUIDE.schemaEditor),
    ...removed("@rebasepro/cms-types", ["PartialCollectionConfig"], "`UiTablePreferences`: `UserConfigurationPersistence` takes `getTablePreferences` / `saveTablePreferences`.", GUIDE.uiPreferences),
    ...removed("@rebasepro/cms-types", ["ReactComponentRef", "asComponentRef", "asReactComponent"], COMPONENT, GUIDE.componentSlot),
    ...removed("@rebasepro/app", ["resolveComponentRef", "useResolvedComponent"], COMPONENT, GUIDE.componentSlot),

    // Still exported, but they take something else now.
    ...removed("@rebasepro/codegen", ["generateSDK", "generateTypedefs"], "Still exported, but it takes `TableDescriptor[]` now — `compileTables(...)` or what `GET /api/schema/tables` serves — instead of collections; or run `rebase generate-sdk`.", GUIDE.codegen),
    ...removed("@rebasepro/codegen", ["toCollectionAccessor"], "Nothing: a typed accessor is the table's name (`client.data.posts`), and a reserved one is `<name>Table`.", GUIDE.sdk),
    ...removed("@rebasepro/plugin-review", ["findReviewConfigProblems", "assertReviewConfig"], "Still exported, but it takes table descriptors now: pass `services.tables()` or `compileTables(...)`.", GUIDE.review),
    ...removed("@rebasepro/plugin-review/config", ["findReviewConfigProblems", "assertReviewConfig"], "Still exported, but it takes table descriptors now: pass `services.tables()` or `compileTables(...)`.", GUIDE.review)
];

/** Packages that are gone: any import of them is a manual step. */
export const REMOVED_PACKAGES: Readonly<Record<string, { instead: string; guide: string }>> = {
    "@rebasepro/server-mongo": { instead: MONGO, guide: GUIDE.mongo }
};

/** A call whose options named collections: detected (object-literal arguments), never rewritten. */
export interface CallOptionChange {
    /** The function, as called (`openRebase`). */
    callee: string;
    /** Option keys of the collection model. */
    keys: readonly string[];
    instead: string;
    guide: string;
}

/** Calls whose options named the collection model. */
export const CALL_OPTION_CHANGES: readonly CallOptionChange[] = [
    { callee: "openRebase", keys: ["collections", "callbacks"], instead: "`openRebase({ tables, hooks })` with `tables` from `compileSchema([...])`; the result's `.collections` is `.tables`.", guide: GUIDE.bootOptions },
    { callee: "openPostgresDriver", keys: ["collections"], instead: "`openPostgresDriver(config, { tables })` with `tables` from `compileSchema([...])`; the `collection` props of driver calls are ignored.", guide: GUIDE.postgresExports },
    { callee: "createHistoryRoutes", keys: ["collections"], instead: "`createHistoryRoutes({ tables })`.", guide: GUIDE.serverExports }
];

/** A spelling found anywhere in a source file (not only in an import): detected, never rewritten. */
export interface CodeSpelling {
    /** What the step calls it. */
    spelling: string;
    /** Where it is: each match is one line of the step. */
    pattern: RegExp;
    /** Only files whose text also matches this are read (a cheap guard against a common word). */
    onlyIf?: RegExp;
    instead: string;
    guide: string;
}

/** Spellings a project's own code can hold whose meaning changed: each is a manual step. */
export const CODE_SPELLINGS: readonly CodeSpelling[] = [
    { spelling: "REBASE_LIVE_SCHEMA_COLLECTIONS_PATH", pattern: /\bREBASE_LIVE_SCHEMA_COLLECTIONS_PATH\b/g, instead: "`REBASE_LIVE_SCHEMA_PATH` (default `backend/schema`); the old variable refuses the boot. Rename it in your .env files and deployment variables too.", guide: GUIDE.schemaEditor },
    { spelling: "liveSchema.repository.collectionsPath", pattern: /\bcollectionsPath\s*:/g, onlyIf: /\brepository\b/, instead: "`schemaPath` — the directory of the tables (`backend/schema`), not of the collections.", guide: GUIDE.schemaEditor },
    { spelling: "REBASE_STRICT_COLLECTION_CONFIG", pattern: /\bREBASE_STRICT_COLLECTION_CONFIG\b/g, instead: "Nothing: it is no longer read; a schema that does not compile always refuses the boot.", guide: GUIDE.cliFlags },
    { spelling: "the schema-editor collection / property routes", pattern: /\/schema-editor\/(?:collection|property)\/(?:save|delete)\b/g, instead: "`GET /api/admin/schema-editor/tables`, `POST /preview` and `POST /apply` with `{ patches: TablePatch[] }`.", guide: GUIDE.schemaEditor },
    { spelling: "SCHEMA_EDIT_REFUSED", pattern: /["'`]SCHEMA_EDIT_REFUSED["'`]/g, instead: "A file that changed on disk after the edit was prepared now answers 409 `SCHEMA_EDIT_STALE_FILE` (reload and retry); `SCHEMA_EDIT_REFUSED` is still the code of every other refusal.", guide: GUIDE.schemaEditor },
    { spelling: "an MCP tool named for collections", pattern: /["'`](?:list_collections|describe_collection|query_collection|show_collection|count_documents|aggregate_documents|list_documents|get_document|create_document|update_document|delete_document)["'`]/g, onlyIf: /mcp/i, instead: "`list_tables`, `describe_table`, `query_table`, `show_table`, `count_rows`, `aggregate_rows`, `get_row`, `create_row`, `update_row`, `delete_row` (`list_documents` → `query_table`); their `collection` argument is `table`.", guide: GUIDE.mcp },
    { spelling: "remediation.rebase.securityRules", pattern: /\brebase\s*\??\.\s*securityRules\b/g, onlyIf: /remediation/, instead: "`remediation.rebase.rls` (rls-check agent format version 2).", guide: GUIDE.rlsCheck },
    { spelling: "UserConfigurationPersistence.getCollectionConfig / onCollectionModified", pattern: /\b(?:getCollectionConfig|onCollectionModified)\b/g, instead: "`getTablePreferences` / `saveTablePreferences`, which read and write a `UiTablePreferences` delta.", guide: GUIDE.uiPreferences },
    { spelling: "StudioSchemaEditing.updateCollection", pattern: /\bupdateCollection\b/g, onlyIf: /\bStudioSchemaEditing\b/, instead: "`applyTablePatches(slug, patches)`.", guide: GUIDE.uiPreferences },
    { spelling: "<CollectionsProvider collections>", pattern: /<CollectionsProvider\b[^>]*?\bcollections\s*=/g, instead: "`CollectionsProvider` takes `tableCustomizations`, `externalCollections` and `tables`.", guide: GUIDE.adminPanel },
    { spelling: "getGlobalCallbacks / setGlobalCallbacks", pattern: /\b(?:getGlobalCallbacks|setGlobalCallbacks)\b/g, instead: "A driver's registry is a `TableRegistryInterface`: `setGlobalHooks?` / `setTableHooks?`.", guide: GUIDE.kernel },
    { spelling: "a custom DataDriver", pattern: /\bimplements\s+(?:[\w.]+\s*,\s*)*DataDriver\b/g, instead: "Implement `serveStoredRows(path, rows)` to serve history: without it the history routes answer 501.", guide: GUIDE.history }
];

/** A `package.json` script spelling of the old CLI: detected, never rewritten. */
export const SCRIPT_SPELLINGS: readonly CodeSpelling[] = [
    { spelling: "--collections", pattern: /\brebase\b[^&|;]*\s(?:--collections\b|-c\s)/g, instead: "`--schema-dir <dir>` (only when the tables are not in backend/schema); `--collections` / `-c` are refused.", guide: GUIDE.cliFlags },
    { spelling: "schema introspect --output", pattern: /\bschema\s+introspect\b[^&|;]*\s--output\b/g, instead: "`rebase schema introspect` writes `defineTable` files to backend/schema: drop `--output`.", guide: GUIDE.cliFlags }
];
