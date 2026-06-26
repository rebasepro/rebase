/**
 * JSON-serializable versions of Rebase collection and property types.
 *
 * These types strip all non-serializable fields (functions, React nodes,
 * class instances) from the original types in `@rebasepro/types`, making
 * them safe for `JSON.stringify()` / database storage.
 *
 * Use `toSerializableCollection` / `fromSerializableCollection` from
 * `./serializable_utils` to convert between the original and serializable forms.
 *
 * @module
 */

import type {
    DataType,
    EnumValues,
    PropertyValidationSchema,
    NumberPropertyValidationSchema,
    ArrayPropertyValidationSchema,
    PropertyConditions,
    ImageResize,
    FileType,
    ColorKey,
    ColorScheme,
} from "@rebasepro/types";

import type {
    ViewMode,
    CollectionSize,
    SecurityRule,
    FilterValues,
    FilterPreset,
    WhereFilterOp,
    KanbanConfig,
    SecurityOperation,
    NavigationGroupMapping,
} from "@rebasepro/types";

import type {
    OnAction,
    JoinStep,
} from "@rebasepro/types";

// ═══════════════════════════════════════════════════════════════════════
// SERIALIZABLE PROPERTY TYPES
// ═══════════════════════════════════════════════════════════════════════

/**
 * JSON-serializable version of `BaseUIConfig`.
 * Drops `Field` and `Preview` (ComponentRef — functions/components).
 */
export interface SerializableBaseUIConfig {
    columnWidth?: number;
    hideFromCollection?: boolean;
    readOnly?: boolean;
    disabled?: boolean | SerializablePropertyDisabledConfig;
    widthPercentage?: number;
    customProps?: unknown;
    // Field and Preview are dropped (ComponentRef is not serializable)
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
    // processFile, postProcess, previewUrl are dropped (functions)
}

// ── Serializable UI configs for specific property types ───────────────

/** JSON-serializable version of `StringUIConfig`. */
export interface SerializableStringUIConfig extends SerializableBaseUIConfig {
    multiline?: boolean;
    markdown?: boolean;
    previewAsTag?: boolean;
    clearable?: boolean;
    url?: boolean | "image" | "video" | "audio" | "file";
}

/** JSON-serializable version of `NumberUIConfig`. */
export interface SerializableNumberUIConfig extends SerializableBaseUIConfig {
    clearable?: boolean;
}

/** JSON-serializable version of `DateUIConfig`. */
export interface SerializableDateUIConfig extends SerializableBaseUIConfig {
    clearable?: boolean;
}

/** JSON-serializable version of `VectorUIConfig`. */
export interface SerializableVectorUIConfig extends SerializableBaseUIConfig {
    clearable?: boolean;
}

/** JSON-serializable version of `ReferenceUIConfig`. */
export interface SerializableReferenceUIConfig extends SerializableBaseUIConfig {
    previewProperties?: string[];
}

/** JSON-serializable version of `RelationUIConfig`. */
export interface SerializableRelationUIConfig extends SerializableBaseUIConfig {
    previewProperties?: string[];
    widget?: "select" | "dialog";
}

/** JSON-serializable version of `ArrayUIConfig`. */
export interface SerializableArrayUIConfig extends SerializableBaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
}

/** JSON-serializable version of `MapUIConfig`. */
export interface SerializableMapUIConfig extends SerializableBaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
    spreadChildren?: boolean;
}

// ── Serializable base property ────────────────────────────────────────

/**
 * JSON-serializable version of `BaseProperty`.
 * Drops: `dynamicProps` (function), `callbacks` (functions).
 * Keeps: `conditions` (JSON Logic — already serializable by design).
 */
export interface SerializableBaseProperty {
    ui?: SerializableBaseUIConfig;
    name: string;
    description?: string;
    propertyConfig?: string;
    columnName?: string;
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
    ui?: SerializableStringUIConfig;
    type: "string";
    columnType?: "varchar" | "text" | "char" | "uuid";
    validation?: SerializableStringValidation;
    isId?: boolean | "manual" | "uuid" | "cuid" | string;
    enum?: EnumValues;
    multiline?: boolean;
    markdown?: boolean;
    storage?: SerializableStorageConfig;
    userSelect?: boolean;
    url?: boolean | "image" | "video" | "audio" | "file";
    email?: boolean;
    previewAsTag?: boolean;
    reference?: SerializableReferenceProperty;
}

/** JSON-serializable `NumberProperty`. */
export interface SerializableNumberProperty extends SerializableBaseProperty {
    ui?: SerializableNumberUIConfig;
    type: "number";
    columnType?: "integer" | "real" | "double precision" | "numeric" | "bigint" | "serial" | "bigserial";
    validation?: NumberPropertyValidationSchema;
    isId?: boolean | "manual" | "increment" | string;
    enum?: EnumValues;
}

/** JSON-serializable `BooleanProperty`. */
export interface SerializableBooleanProperty extends SerializableBaseProperty {
    ui?: SerializableBaseUIConfig;
    type: "boolean";
    validation?: PropertyValidationSchema;
}

/** JSON-serializable `DateProperty`. */
export interface SerializableDateProperty extends SerializableBaseProperty {
    ui?: SerializableDateUIConfig;
    type: "date";
    columnType?: "timestamp" | "date" | "time";
    validation?: SerializableDateValidation;
    mode?: "date" | "date_time";
    timezone?: string;
    autoValue?: "on_create" | "on_update";
    clearable?: boolean;
}

/** JSON-serializable `GeopointProperty`. */
export interface SerializableGeopointProperty extends SerializableBaseProperty {
    ui?: SerializableBaseUIConfig;
    type: "geopoint";
    validation?: PropertyValidationSchema;
}

/** JSON-serializable `VectorProperty`. */
export interface SerializableVectorProperty extends SerializableBaseProperty {
    ui?: SerializableVectorUIConfig;
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
    ui?: SerializableReferenceUIConfig;
    type: "reference";
    isId?: boolean;
    path?: string;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
}

/**
 * JSON-serializable `RelationProperty`.
 * `target` is string-only (collection slug). The function variant
 * `() => EntityCollection` is not serializable.
 */
export interface SerializableRelationProperty extends SerializableBaseProperty {
    ui?: SerializableRelationUIConfig;
    type: "relation";
    isId?: boolean;
    /** Target collection slug. Function variant is not serializable. */
    target?: string;
    cardinality?: "one" | "many";
    direction?: "owning" | "inverse";
    inverseRelationName?: string;
    localKey?: string;
    foreignKeyOnTarget?: string;
    through?: {
        table: string;
        sourceColumn: string;
        targetColumn: string;
    };
    joinPath?: JoinStep[];
    onUpdate?: OnAction;
    onDelete?: OnAction;
    relationName?: string;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
    widget?: "select" | "dialog";
    // overrides are dropped (can contain non-serializable EntityCollection fields)
    // relation (resolved Relation object) is dropped (runtime-only, contains function target)
}

/** JSON-serializable `ArrayProperty`. */
export interface SerializableArrayProperty extends SerializableBaseProperty {
    ui?: SerializableArrayUIConfig;
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
    sortable?: boolean;
    canAddElements?: boolean;
}

/** JSON-serializable `MapProperty`. */
export interface SerializableMapProperty extends SerializableBaseProperty {
    ui?: SerializableMapUIConfig;
    type: "map";
    columnType?: "json" | "jsonb";
    properties?: SerializableProperties;
    propertiesOrder?: string[];
    validation?: PropertyValidationSchema;
    previewProperties?: string[];
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
 * JSON-serializable version of `EntityCollection` / `BaseEntityCollection`.
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
export interface SerializableCollection {
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
    driver?: string;
    databaseId?: string;

    properties: SerializableProperties;
    propertiesOrder?: string[];
    previewProperties?: string[];
    listProperties?: string[];
    titleProperty?: string;

    // ── Display config ────────────────────────────────────────────────
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    defaultEntityAction?: "view" | "edit";
    defaultViewMode?: ViewMode;
    enabledViews?: ViewMode[];
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
    securityRules?: SecurityRule[];

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
    load(): Promise<SerializableCollection[]>;

    /** Save (create or update) a single collection by its slug. */
    save(slug: string, data: SerializableCollection): Promise<void>;

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
