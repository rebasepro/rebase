/**
 * JSON-serializable versions of Rebase collection and property types.
 *
 * These types strip all non-serializable fields (functions, React nodes,
 * class instances) from the original types in `@rebasepro/types`, making
 * them safe for `JSON.stringify()` / database storage.
 *
 * Use `toSerializableCollectionConfig` / `fromSerializableCollectionConfig` from
 * `./serializable_utils` to convert between the original and serializable forms.
 *
 * @module
 */

import type {
    ArrayPropertyValidationSchema,
    EnumValues,
    FileType,
    FilterPreset,
    FilterValues,
    ImageResize,
    JoinStep,
    NumberPropertyValidationSchema,
    OnAction,
    PropertyConditions,
    PropertyValidationSchema,
    SecurityRule,
    WhereFilterOp
} from "@rebasepro/types";
import type {
    CollectionSize,
    KanbanConfig,
    NavigationGroupMapping,
    ViewMode
} from "@rebasepro/admin-types";

// ═══════════════════════════════════════════════════════════════════════
// SERIALIZABLE PROPERTY TYPES
// ═══════════════════════════════════════════════════════════════════════

/**
 * JSON-serializable version of `AdminPropertyOptions`.
 * Drops `Field` and `Preview` (ComponentRef — functions/components).
 */
export interface SerializableAdminBaseOptions {
    columnWidth?: number;
    hideFromCollection?: boolean;
    readOnly?: boolean;
    disabled?: boolean | SerializablePropertyDisabledConfig;
    span?: 1 | 2 | 3 | 4;
    /** Opaque props handed to a custom `Field` / `Preview`. Round-tripped as-is. */
    customProps?: unknown;
    /** Narrows the filter operators offered for this property. Plain data. */
    filterOperators?: readonly WhereFilterOp[];
    // Field, Preview and Filter are dropped (ComponentRef is not serializable)
}

/** JSON-serializable version of `PropertyDisabledConfig`. Already serializable. */
export interface SerializablePropertyDisabledConfig {
    clearOnDisabled?: boolean;
    disabledMessage?: string;
    hidden?: boolean;
}

/**
 * JSON-serializable version of `StringPropertyValidationSchema`.
 * `matches` is forced to `string` (no RegExp).
 */
export interface SerializableStringValidation extends PropertyValidationSchema {
    length?: number;
    min?: number;
    max?: number;
    /** Regex pattern as a string. RegExp objects are converted to their `.source`. */
    matches?: string;
    matchesMessage?: string;
    trim?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
}

/**
 * JSON-serializable version of `DatePropertyValidationSchema`.
 * `min` and `max` are ISO 8601 strings instead of `Date` objects.
 */
export interface SerializableDateValidation extends PropertyValidationSchema {
    /** Minimum date as ISO 8601 string. */
    min?: string;
    /** Maximum date as ISO 8601 string. */
    max?: string;
}

/**
 * JSON-serializable version of `StorageConfig`.
 * Drops all function fields: `processFile`, `postProcess`, `previewUrl`.
 * `storagePath` and `fileName` are string-only (no function variant).
 */
export interface SerializableStorageConfig {
    acceptedFiles?: FileType[];
    imageResize?: ImageResize;
    metadata?: Record<string, unknown>;
    /** String template only. Function variant is not serializable. */
    fileName?: string;
    /** String template only. Function variant is not serializable. */
    storagePath: string;
    includeBucketUrl?: boolean;
    storeUrl?: boolean;
    maxSize?: number;
    /** Key of the named storage backend to use (see `StorageConfig.storageSource`). */
    storageSource?: string;
    // processFile, postProcess, previewUrl are dropped (functions)
}

// ── Serializable UI configs for specific property types ───────────────

/** JSON-serializable version of `AdminStringOptions`. */
export interface SerializableAdminStringOptions extends SerializableAdminBaseOptions {
    multiline?: boolean;
    markdown?: boolean;
    previewAsTag?: boolean;
    clearable?: boolean;
    /**
     * How a string holding a URL is rendered. Was mirrored here as `url`, the
     * name of the *core* flag that says the string is a URL at all — so this
     * option had no serializable form and the core flag had two.
     */
    urlPreview?: "image" | "video" | "audio" | "file";
}

/** JSON-serializable version of `AdminNumberOptions`. */
export interface SerializableAdminNumberOptions extends SerializableAdminBaseOptions {
    clearable?: boolean;
}

/** JSON-serializable version of `AdminDateOptions`. */
export interface SerializableAdminDateOptions extends SerializableAdminBaseOptions {
    clearable?: boolean;
}

/** JSON-serializable version of `AdminVectorOptions`. */
export interface SerializableAdminVectorOptions extends SerializableAdminBaseOptions {
    clearable?: boolean;
}

/** JSON-serializable version of `AdminReferenceOptions`. */
export interface SerializableAdminReferenceOptions extends SerializableAdminBaseOptions {
    previewProperties?: string[];
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
}

/** JSON-serializable version of `AdminRelationOptions`. */
export interface SerializableAdminRelationOptions extends SerializableAdminBaseOptions {
    previewProperties?: string[];
    widget?: "select" | "dialog";
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
    renderInForm?: boolean;
}

/** JSON-serializable version of `AdminArrayOptions`. */
export interface SerializableAdminArrayOptions extends SerializableAdminBaseOptions {
    expanded?: boolean;
    minimalistView?: boolean;
    sortable?: boolean;
    canAddElements?: boolean;
}

/** JSON-serializable version of `AdminMapOptions`. */
export interface SerializableAdminMapOptions extends SerializableAdminBaseOptions {
    expanded?: boolean;
    minimalistView?: boolean;
    spreadChildren?: boolean;
    previewProperties?: string[];
}

// ── Serializable base property ────────────────────────────────────────

/**
 * JSON-serializable version of `BaseProperty`.
 * Drops: `dynamicProps` (function), `callbacks` (functions).
 * Keeps: `conditions` (JSON Logic — already serializable by design).
 */
export interface SerializableBaseProperty {
    admin?: SerializableAdminBaseOptions;
    name: string;
    description?: string;
    propertyConfig?: string;
    columnName?: string;
    /**
     * Server-side guarantee that the column never reaches an API response — a
     * password hash, a verification token. Absent from this mirror until now,
     * so editing a collection in the panel silently unset it.
     */
    excludeFromApi?: boolean;
    validation?: PropertyValidationSchema;
    defaultValue?: unknown;
    /**
     * JSON Logic conditions — fully serializable by design.
     * These are the declarative alternative to `dynamicProps` functions.
     */
    conditions?: PropertyConditions;
    /**
     * Arbitrary key-value metadata for external consumers.
     * Not interpreted by Rebase — passed through serialization unchanged.
     */
    metadata?: Record<string, unknown>;
    // dynamicProps and callbacks are dropped (functions)
}

// ── Individual serializable property types ────────────────────────────

/** JSON-serializable `StringProperty`. */
export interface SerializableStringProperty extends SerializableBaseProperty {
    admin?: SerializableAdminStringOptions;
    type: "string";
    columnType?: "varchar" | "text" | "char" | "uuid";
    validation?: SerializableStringValidation;
    isId?: boolean | "manual" | "uuid" | "cuid" | string;
    enum?: EnumValues;
    storage?: SerializableStorageConfig;
    userSelect?: boolean;
    email?: boolean;
    /** The string holds a URL. Feeds the generated OpenAPI contract. */
    url?: boolean;
    reference?: SerializableReferenceProperty;
}

/** JSON-serializable `NumberProperty`. */
export interface SerializableNumberProperty extends SerializableBaseProperty {
    admin?: SerializableAdminNumberOptions;
    type: "number";
    columnType?: "integer" | "real" | "double precision" | "numeric" | "bigint" | "serial" | "bigserial";
    validation?: NumberPropertyValidationSchema;
    isId?: boolean | "manual" | "increment" | string;
    enum?: EnumValues;
}

/** JSON-serializable `BooleanProperty`. */
export interface SerializableBooleanProperty extends SerializableBaseProperty {
    admin?: SerializableAdminBaseOptions;
    type: "boolean";
    validation?: PropertyValidationSchema;
}

/** JSON-serializable `DateProperty`. */
export interface SerializableDateProperty extends SerializableBaseProperty {
    admin?: SerializableAdminDateOptions;
    type: "date";
    columnType?: "timestamp" | "date" | "time";
    validation?: SerializableDateValidation;
    mode?: "date" | "date_time";
    timezone?: string;
    autoValue?: "on_create" | "on_update";
}

/** JSON-serializable `GeopointProperty`. */
export interface SerializableGeopointProperty extends SerializableBaseProperty {
    admin?: SerializableAdminBaseOptions;
    type: "geopoint";
    validation?: PropertyValidationSchema;
}

/** JSON-serializable `VectorProperty`. */
export interface SerializableVectorProperty extends SerializableBaseProperty {
    admin?: SerializableAdminVectorOptions;
    type: "vector";
    dimensions: number;
    validation?: PropertyValidationSchema;
}

/** JSON-serializable `BinaryProperty`. */
export interface SerializableBinaryProperty extends SerializableBaseProperty {
    type: "binary";
    validation?: PropertyValidationSchema;
}

/**
 * JSON-serializable `ReferenceProperty`.
 * Already largely serializable; just inherits the serializable base.
 */
export interface SerializableReferenceProperty extends SerializableBaseProperty {
    admin?: SerializableAdminReferenceOptions;
    type: "reference";
    isId?: boolean;
    path?: string;
}

/**
 * A `Relation` as JSON: the same tagged union, with `target` narrowed to a
 * collection slug because a `() => CollectionConfig` thunk cannot be
 * serialized. `kind` decides which of the remaining fields mean anything.
 */
export type SerializableRelation =
    | { kind: "belongsTo"; target?: string; relationName?: string; localKey?: string; onUpdate?: OnAction; onDelete?: OnAction }
    | { kind: "hasOne"; target?: string; relationName?: string; foreignKeyOnTarget?: string; sourceKey?: string; onUpdate?: OnAction; onDelete?: OnAction }
    | { kind: "hasMany"; target?: string; relationName?: string; foreignKeyOnTarget?: string; sourceKey?: string; onUpdate?: OnAction; onDelete?: OnAction }
    | {
        kind: "manyToMany";
        target?: string;
        relationName?: string;
        // Optional exactly as authored — resolution fills the gaps, so the
        // editor must be able to round-trip a partially-specified junction.
        through?: { table?: string; sourceColumn?: string; targetColumn?: string };
        onUpdate?: OnAction;
        onDelete?: OnAction;
    }
    | {
        kind: "via";
        target?: string;
        relationName?: string;
        cardinality: "one" | "many";
        joinPath: JoinStep[];
        onUpdate?: OnAction;
        onDelete?: OnAction;
    };

/**
 * JSON-serializable `RelationProperty`.
 */
export interface SerializableRelationProperty extends SerializableBaseProperty {
    admin?: SerializableAdminRelationOptions;
    type: "relation";
    isId?: boolean;
    /**
     * The link, as one nested object, mirroring the authored union.
     *
     * This used to be a flat spread — `target`, `cardinality`, `direction`,
     * `inverseRelationName` and every join field side by side — and it outlived
     * the union. The serializer was migrated to write a nested `relation`, but
     * this interface was not, so it assigned the field through a
     * `Record<string, unknown>` cast that its own type did not admit. The type
     * went on describing a shape nothing produced, and the cast hid it.
     */
    relation?: SerializableRelation;
    // overrides are dropped (can contain non-serializable CollectionConfig fields)
}

/** JSON-serializable `ArrayProperty`. */
export interface SerializableArrayProperty extends SerializableBaseProperty {
    admin?: SerializableAdminArrayOptions;
    type: "array";
    columnType?: "json" | "jsonb" | "text[]" | "integer[]" | "boolean[]" | "numeric[]";
    of?: SerializableProperty | SerializableProperty[];
    oneOf?: {
        properties: SerializableProperties;
        propertiesOrder?: string[];
        typeField?: string;
        valueField?: string;
    };
    validation?: ArrayPropertyValidationSchema;
}

/** JSON-serializable `MapProperty`. */
export interface SerializableMapProperty extends SerializableBaseProperty {
    admin?: SerializableAdminMapOptions;
    type: "map";
    columnType?: "json" | "jsonb";
    properties?: SerializableProperties;
    propertiesOrder?: string[];
    validation?: PropertyValidationSchema;
    keyValue?: boolean;
}

// ── Aggregates ────────────────────────────────────────────────────────

/**
 * Union of all JSON-serializable property types.
 * Mirrors `Property` from `@rebasepro/types` but with all non-serializable
 * fields stripped.
 */
export type SerializableProperty =
    | SerializableStringProperty
    | SerializableNumberProperty
    | SerializableBooleanProperty
    | SerializableDateProperty
    | SerializableGeopointProperty
    | SerializableReferenceProperty
    | SerializableRelationProperty
    | SerializableArrayProperty
    | SerializableMapProperty
    | SerializableVectorProperty
    | SerializableBinaryProperty;

/** Record of serializable properties, keyed by property key. */
export type SerializableProperties = {
    [key: string]: SerializableProperty;
};

// ═══════════════════════════════════════════════════════════════════════
// SERIALIZABLE COLLECTION TYPE
// ═══════════════════════════════════════════════════════════════════════

/**
 * JSON-serializable version of `CollectionConfig` / `BaseCollectionConfig`.
 *
 * Strips all non-serializable fields:
 * - Functions: `callbacks`, `childCollections`, `additionalFields`, `defaultSelectedView` (fn)
 * - React nodes: `icon` (ReactNode variant), `entityViews`, `formView`
 * - Runtime objects: `selectionController`, `overrides`
 * - Component refs: `Actions`, `components`, `entityActions`
 * - `exportable` when it's an `ExportConfig` (contains functions)
 * - `auth` when it's an `AuthCollectionConfig` (contains functions)
 *
 * Keeps all data-describing fields that the collection editor works with.
 */
export interface SerializableCollectionConfig {
    slug: string;
    name: string;
    singularName?: string;
    description?: string;

    /**
     * Icon name as a string (e.g. Lucide icon key).
     * React.ReactNode variant is not serializable and is stripped.
     */
    icon?: string;

    group?: string;
    engine?: string;
    dataSource?: string;
    databaseId?: string;

    properties: SerializableProperties;
    propertiesOrder?: string[];
    previewProperties?: string[];
    listProperties?: string[];

    // ── Display config ────────────────────────────────────────────────
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    defaultEntityAction?: "view" | "edit";
    defaultViewMode?: ViewMode;
    enabledViews?: ViewMode[];
    /**
     * Keys only. A custom view declared inline carries a `Builder` function,
     * which does not survive a round trip through a config file — the editor
     * can reference app-registered views, not author new ones.
     */
    customViews?: string[];
    kanban?: KanbanConfig<Record<string, unknown>>;
    defaultSize?: CollectionSize;
    sideDialogWidth?: number | string;

    // ── Behavior flags ────────────────────────────────────────────────
    pagination?: boolean | number;
    selectionEnabled?: boolean;
    inlineEditing?: boolean;
    hideFromNavigation?: boolean;
    hideIdFromForm?: boolean;
    hideIdFromCollection?: boolean;
    formAutoSave?: boolean;
    alwaysApplyDefaultValues?: boolean;
    includeJsonView?: boolean;
    history?: boolean;
    localChangesBackup?: "manual_apply" | "auto_apply" | false;
    exportable?: boolean;
    auth?: boolean;

    /**
     * Default selected view as a string key.
     * The function variant (`DefaultSelectedViewBuilder`) is not serializable.
     */
    defaultSelectedView?: string;

    // ── Filters and sorting ───────────────────────────────────────────
    fixedFilter?: FilterValues<string>;
    defaultFilter?: FilterValues<string>;
    filterPresets?: FilterPreset<string>[];
    sort?: [string, "asc" | "desc"];
    orderProperty?: string;

    // ── Disable built-in actions ──────────────────────────────────────
    disableDefaultActions?: ("edit" | "copy" | "delete")[];

    // ── SQL / Postgres-specific ───────────────────────────────────────
    table?: string;
    schema?: string;
    /**
     * Collection-level relations, `target` as a slug — a thunk does not
     * serialize, same as on a relation property.
     *
     * Absent from this mirror until now, and `buildCollectionFromTableMetadata`
     * is the reason it matters: importing a table detects its foreign keys and
     * junctions, puts them on the form, and the save then dropped every one of
     * them. The import looked like it worked.
     */
    relations?: SerializableRelation[];
    securityRules?: readonly SecurityRule[];
    /** Removes the framework's injected baseline RLS policies. */
    disableDefaultPolicies?: boolean;

    // ── Write behaviour ───────────────────────────────────────────────
    /** Whether a write naming an undeclared field is rejected with a 400. */
    strictWrites?: boolean;

    // ── Owner ─────────────────────────────────────────────────────────
    ownerId?: string;

    /**
     * Arbitrary key-value metadata for external consumers.
     * Not interpreted by Rebase — passed through serialization unchanged.
     */
    metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// JSON COLLECTION STORE ADAPTER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Adapter interface for persisting serializable collections to a JSON backend.
 * Implement this to store collection configs in a database, API, localStorage, etc.
 */
export interface JsonCollectionStore {
    /** Load all persisted collections. */
    load(): Promise<SerializableCollectionConfig[]>;

    /** Save (create or update) a single collection by its slug. */
    save(slug: string, data: SerializableCollectionConfig): Promise<void>;

    /** Delete a collection by its slug. */
    delete(slug: string): Promise<void>;

    /**
     * Optional: save navigation group mappings.
     * If not implemented, navigation entries are not persisted.
     */
    saveNavigationEntries?(entries: NavigationGroupMapping[]): Promise<void>;

    /**
     * Optional: load navigation group mappings.
     * If not implemented, an empty array is used.
     */
    loadNavigationEntries?(): Promise<NavigationGroupMapping[]>;
}
