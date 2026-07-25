/**
 * Conversion utilities between the full Rebase types and their
 * JSON-serializable counterparts.
 *
 * - `toSerializableCollectionConfig` / `toSerializableProperty` — strip non-serializable fields
 * - `fromSerializableCollectionConfig` / `fromSerializableProperty` — reconstruct original types
 *
 * @module
 */

import type { ArrayProperty, BinaryProperty, BooleanProperty, DateProperty, GeopointProperty, MapProperty, NumberProperty, Properties, Property, ReferenceProperty, RelationProperty, StorageConfig, StringProperty, VectorProperty } from "@rebasepro/types";
import type { AdminPropertyOptions } from "@rebasepro/admin-types";
import type { AdminCollection } from "@rebasepro/admin-types";

import type {
    SerializableArrayProperty,
    SerializableBaseProperty,
    SerializableAdminBaseOptions,
    SerializableBinaryProperty,
    SerializableBooleanProperty,
    SerializableCollectionConfig,
    SerializableDateProperty,
    SerializableDateValidation,
    SerializableGeopointProperty,
    SerializableMapProperty,
    SerializableNumberProperty,
    SerializableProperties,
    SerializableProperty,
    SerializableReferenceProperty,
    SerializableRelationProperty,
    SerializableStorageConfig,
    SerializableStringProperty,
    SerializableStringValidation,
    SerializableVectorProperty,
} from "./serializable_types";

// ═══════════════════════════════════════════════════════════════════════
// PROPERTY CONVERSION: Original → Serializable
// ═══════════════════════════════════════════════════════════════════════

/**
 * Strip non-serializable fields from a `AdminPropertyOptions`.
 * Removes `Field` and `Preview` (ComponentRef).
 */
function toSerializableAdminOptions(ui: AdminPropertyOptions | undefined): SerializableAdminBaseOptions | undefined {
    if (!ui) return undefined;
    const { Field, Preview, ...rest } = ui as AdminPropertyOptions & Record<string, unknown>;
    // Only return if there are remaining fields
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
        if (key !== "Field" && key !== "Preview" && value !== undefined) {
            result[key] = value;
        }
    }
    return Object.keys(result).length > 0 ? result as SerializableAdminBaseOptions : undefined;
}

/**
 * Convert a `StorageConfig` to its serializable form.
 * Drops function variants of `storagePath`, `fileName`, and all function fields.
 */
function toSerializableStorageConfig(storage: StorageConfig | undefined): SerializableStorageConfig | undefined {
    if (!storage) return undefined;

    // storagePath must be a string for serialization
    const storagePath = typeof storage.storagePath === "string" ? storage.storagePath : undefined;
    if (!storagePath) return undefined;

    const result: SerializableStorageConfig = { storagePath };

    if (storage.acceptedFiles) result.acceptedFiles = storage.acceptedFiles;
    if (storage.imageResize) result.imageResize = storage.imageResize;
    if (storage.metadata) result.metadata = storage.metadata;
    if (typeof storage.fileName === "string") result.fileName = storage.fileName;
    if (storage.includeBucketUrl !== undefined) result.includeBucketUrl = storage.includeBucketUrl;
    if (storage.storeUrl !== undefined) result.storeUrl = storage.storeUrl;
    if (storage.maxSize !== undefined) result.maxSize = storage.maxSize;
    if (storage.storageSource !== undefined) result.storageSource = storage.storageSource;
    // processFile, postProcess, previewUrl are intentionally dropped (functions)

    return result;
}

/**
 * Convert a RegExp or string `matches` validation to a plain string.
 */
function serializeMatches(matches: string | RegExp | undefined): string | undefined {
    if (matches === undefined) return undefined;
    if (typeof matches === "string") return matches;
    return matches.source;
}

/**
 * Resolve a relation target to a string slug.
 * Functions are called to extract the target; AdminCollection objects
 * use their slug.
 */
function resolveRelationTarget(target: RelationProperty["target"]): string | undefined {
    if (!target) return undefined;
    if (typeof target === "string") return target;
    if (typeof target === "function") {
        try {
            const resolved = target();
            if (typeof resolved === "string") return resolved;
            if (resolved && typeof resolved === "object" && "slug" in resolved) {
                return (resolved as AdminCollection).slug;
            }
        } catch {
            // If the lazy resolver throws (e.g., circular dependency not yet ready), return undefined
        }
    }
    return undefined;
}

/**
 * Strip non-serializable base property fields.
 * Returns a clean object with only the common serializable fields from BaseProperty.
 * Validation is intentionally excluded — each property type handles its own.
 */
function toSerializableBaseFields(property: Property): Omit<SerializableBaseProperty, "validation"> {
    const result: Partial<Omit<SerializableBaseProperty, "validation">> = {
        name: property.name,
    };

    if (property.description) result.description = property.description;
    if (property.propertyConfig) result.propertyConfig = property.propertyConfig;
    if (property.columnName) result.columnName = property.columnName;
    if (property.defaultValue !== undefined) result.defaultValue = property.defaultValue;
    if (property.conditions) result.conditions = property.conditions;
    if (property.metadata) result.metadata = property.metadata;
    // dynamicProps and callbacks are intentionally dropped (functions)

    const ui = toSerializableAdminOptions(property.admin);
    if (ui) result.admin = ui;

    return result as Omit<SerializableBaseProperty, "validation">;
}

/**
 * Convert a single `Property` to its JSON-serializable form.
 * Strips functions, converts RegExp to string, Date to ISO string.
 */
export function toSerializableProperty(property: Property): SerializableProperty {
    const base = toSerializableBaseFields(property);

    switch (property.type) {
        case "string": {
            const sp = property as StringProperty;
            const result: SerializableStringProperty = {
                ...base,
                type: "string",
            };
            if (sp.columnType) result.columnType = sp.columnType;
            if (sp.isId !== undefined) result.isId = sp.isId;
            if (sp.enum) result.enum = sp.enum;
            if (sp.userSelect) result.userSelect = sp.userSelect;
            if (sp.email) result.email = sp.email;

            // Convert validation.matches from RegExp to string
            if (sp.validation) {
                const { matches, ...restValidation } = sp.validation;
                const serializedValidation: SerializableStringValidation = { ...restValidation };
                const matchStr = serializeMatches(matches);
                if (matchStr !== undefined) serializedValidation.matches = matchStr;
                result.validation = serializedValidation;
            }

            // Storage: convert to serializable form
            const storage = toSerializableStorageConfig(sp.storage);
            if (storage) result.storage = storage;

            return result;
        }

        case "number": {
            const np = property as NumberProperty;
            const result: SerializableNumberProperty = {
                ...base,
                type: "number",
            };
            if (np.columnType) result.columnType = np.columnType;
            if (np.validation) result.validation = np.validation;
            if (np.isId !== undefined) result.isId = np.isId;
            if (np.enum) result.enum = np.enum;
            return result;
        }

        case "boolean": {
            const bp = property as BooleanProperty;
            const result: SerializableBooleanProperty = {
                ...base,
                type: "boolean",
            };
            if (bp.validation) result.validation = bp.validation;
            return result;
        }

        case "date": {
            const dp = property as DateProperty;
            const result: SerializableDateProperty = {
                ...base,
                type: "date",
            };
            if (dp.columnType) result.columnType = dp.columnType;
            if (dp.mode) result.mode = dp.mode;
            if (dp.timezone) result.timezone = dp.timezone;
            if (dp.autoValue) result.autoValue = dp.autoValue;

            // Convert Date validation min/max to ISO strings
            if (dp.validation) {
                const serializedValidation: SerializableDateValidation = {};
                if (dp.validation.required !== undefined) serializedValidation.required = dp.validation.required;
                if (dp.validation.requiredMessage) serializedValidation.requiredMessage = dp.validation.requiredMessage;
                if (dp.validation.unique) serializedValidation.unique = dp.validation.unique;
                if (dp.validation.uniqueInArray) serializedValidation.uniqueInArray = dp.validation.uniqueInArray;
                if (dp.validation.min instanceof Date) {
                    serializedValidation.min = dp.validation.min.toISOString();
                } else if (typeof dp.validation.min === "string") {
                    serializedValidation.min = dp.validation.min;
                }
                if (dp.validation.max instanceof Date) {
                    serializedValidation.max = dp.validation.max.toISOString();
                } else if (typeof dp.validation.max === "string") {
                    serializedValidation.max = dp.validation.max;
                }
                result.validation = serializedValidation;
            }
            return result;
        }

        case "geopoint": {
            const gp = property as GeopointProperty;
            const result: SerializableGeopointProperty = {
                ...base,
                type: "geopoint",
            };
            if (gp.validation) result.validation = gp.validation;
            return result;
        }

        case "reference": {
            const rp = property as ReferenceProperty;
            const result: SerializableReferenceProperty = {
                ...base,
                type: "reference",
            };
            if (rp.isId !== undefined) result.isId = rp.isId;
            if (rp.path) result.path = rp.path;
            if (rp.fixedFilter) result.fixedFilter = rp.fixedFilter;
            if (rp.includeId !== undefined) result.includeId = rp.includeId;
            if (rp.includeEntityLink !== undefined) result.includeEntityLink = rp.includeEntityLink;
            return result;
        }

        case "relation": {
            const rl = property as RelationProperty;
            const result: SerializableRelationProperty = {
                ...base,
                type: "relation",
            };
            if (rl.isId !== undefined) result.isId = rl.isId;
            // Resolve target to string
            const target = resolveRelationTarget(rl.target);
            if (target) result.target = target;
            if (rl.cardinality) result.cardinality = rl.cardinality;
            if (rl.direction) result.direction = rl.direction;
            if (rl.inverseRelationName) result.inverseRelationName = rl.inverseRelationName;
            if (rl.localKey) result.localKey = rl.localKey;
            if (rl.foreignKeyOnTarget) result.foreignKeyOnTarget = rl.foreignKeyOnTarget;
            if (rl.through) result.through = rl.through;
            if (rl.joinPath) result.joinPath = rl.joinPath;
            if (rl.onUpdate) result.onUpdate = rl.onUpdate;
            if (rl.onDelete) result.onDelete = rl.onDelete;
            if (rl.relationName) result.relationName = rl.relationName;
            if (rl.fixedFilter) result.fixedFilter = rl.fixedFilter;
            if (rl.includeId !== undefined) result.includeId = rl.includeId;
            if (rl.includeEntityLink !== undefined) result.includeEntityLink = rl.includeEntityLink;
            if (rl.widget) result.widget = rl.widget;
            // overrides and relation (resolved) are dropped
            return result;
        }

        case "array": {
            const ap = property as ArrayProperty;
            const result: SerializableArrayProperty = {
                ...base,
                type: "array",
            };
            if (ap.columnType) result.columnType = ap.columnType;
            if (ap.validation) result.validation = ap.validation;
            if (ap.sortable !== undefined) result.sortable = ap.sortable;
            if (ap.canAddElements !== undefined) result.canAddElements = ap.canAddElements;

            // Recursively serialize the "of" property
            if (ap.of) {
                if (Array.isArray(ap.of)) {
                    result.of = ap.of.map(toSerializableProperty);
                } else {
                    result.of = toSerializableProperty(ap.of);
                }
            }

            // Recursively serialize oneOf properties
            if (ap.oneOf) {
                result.oneOf = {
                    properties: toSerializableProperties(ap.oneOf.properties),
                };
                if (ap.oneOf.propertiesOrder) result.oneOf.propertiesOrder = ap.oneOf.propertiesOrder;
                if (ap.oneOf.typeField) result.oneOf.typeField = ap.oneOf.typeField;
                if (ap.oneOf.valueField) result.oneOf.valueField = ap.oneOf.valueField;
            }
            return result;
        }

        case "map": {
            const mp = property as MapProperty;
            const result: SerializableMapProperty = {
                ...base,
                type: "map",
            };
            if (mp.columnType) result.columnType = mp.columnType;
            if (mp.validation) result.validation = mp.validation;
            if (mp.propertiesOrder) result.propertiesOrder = mp.propertiesOrder;
            if (mp.previewProperties) result.previewProperties = mp.previewProperties;
            if (mp.keyValue) result.keyValue = mp.keyValue;

            // Recursively serialize nested properties
            if (mp.properties) {
                result.properties = toSerializableProperties(mp.properties);
            }
            return result;
        }

        case "vector": {
            const vp = property as VectorProperty;
            const result: SerializableVectorProperty = {
                ...base,
                type: "vector",
                dimensions: vp.dimensions,
            };
            if (vp.validation) result.validation = vp.validation;
            return result;
        }

        case "binary": {
            const bp = property as BinaryProperty;
            const result: SerializableBinaryProperty = {
                ...base,
                type: "binary",
            };
            if (bp.validation) result.validation = bp.validation;
            return result;
        }

        default:
            // Exhaustive check: if new types are added, this will produce a compile error
            return base as SerializableProperty;
    }
}

/**
 * Convert a `Properties` record to its serializable form.
 */
export function toSerializableProperties(properties: Properties): SerializableProperties {
    const result: SerializableProperties = {};
    for (const [key, property] of Object.entries(properties)) {
        result[key] = toSerializableProperty(property);
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// COLLECTION CONVERSION: Original → Serializable
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert an `AdminCollection` to its JSON-serializable form.
 *
 * Strips all non-serializable fields (functions, React nodes, class instances)
 * while preserving the structural schema that the collection editor works with.
 *
 * The result is safe for `JSON.stringify()` and database storage.
 */
export function toSerializableCollectionConfig(collection: AdminCollection): SerializableCollectionConfig {
    const result: SerializableCollectionConfig = {
        slug: collection.slug,
        name: collection.name,
        properties: toSerializableProperties(collection.properties),
    };

    // String fields
    if (collection.singularName) result.singularName = collection.singularName;
    if (collection.description) result.description = collection.description;
    if (collection.group) result.group = collection.group;
    if (collection.engine) result.engine = collection.engine;
    if (collection.dataSource) result.dataSource = collection.dataSource;
    if (collection.databaseId) result.databaseId = collection.databaseId;
    if (collection.titleProperty) result.titleProperty = collection.titleProperty as string;
    if (collection.ownerId) result.ownerId = collection.ownerId;
    if (collection.metadata) result.metadata = collection.metadata;
    if (collection.table) result.table = collection.table;
    if ("schema" in collection && collection.schema) result.schema = collection.schema as string;
    if (collection.orderProperty) result.orderProperty = collection.orderProperty as string;

    // Icon: only keep string variant
    if (typeof collection.icon === "string") result.icon = collection.icon;

    // Array fields
    if (collection.propertiesOrder) result.propertiesOrder = collection.propertiesOrder as string[];
    if (collection.previewProperties) result.previewProperties = collection.previewProperties;
    if (collection.listProperties) result.listProperties = collection.listProperties;
    if (collection.enabledViews) result.enabledViews = collection.enabledViews;
    if (collection.disableDefaultActions) result.disableDefaultActions = collection.disableDefaultActions;
    if (collection.securityRules) result.securityRules = collection.securityRules;

    // Enum-like fields
    if (collection.openEntityMode) result.openEntityMode = collection.openEntityMode;
    if (collection.defaultEntityAction) result.defaultEntityAction = collection.defaultEntityAction;
    if (collection.defaultViewMode) result.defaultViewMode = collection.defaultViewMode;
    if (collection.defaultSize) result.defaultSize = collection.defaultSize;
    if (collection.localChangesBackup !== undefined) result.localChangesBackup = collection.localChangesBackup;

    // Kanban
    if (collection.kanban) result.kanban = collection.kanban as SerializableCollectionConfig["kanban"];

    // Filters and sorting
    if (collection.fixedFilter) result.fixedFilter = collection.fixedFilter as SerializableCollectionConfig["fixedFilter"];
    if (collection.defaultFilter) result.defaultFilter = collection.defaultFilter as SerializableCollectionConfig["defaultFilter"];
    if (collection.filterPresets) result.filterPresets = collection.filterPresets as SerializableCollectionConfig["filterPresets"];
    if (collection.sort) result.sort = collection.sort as SerializableCollectionConfig["sort"];

    // Numeric / boolean flags
    if (collection.pagination !== undefined) result.pagination = collection.pagination;
    if (collection.selectionEnabled !== undefined) result.selectionEnabled = collection.selectionEnabled;
    if (collection.inlineEditing !== undefined) result.inlineEditing = collection.inlineEditing;
    if (collection.hideFromNavigation !== undefined) result.hideFromNavigation = collection.hideFromNavigation;
    if (collection.hideIdFromForm !== undefined) result.hideIdFromForm = collection.hideIdFromForm;
    if (collection.hideIdFromCollection !== undefined) result.hideIdFromCollection = collection.hideIdFromCollection;
    if (collection.formAutoSave !== undefined) result.formAutoSave = collection.formAutoSave;
    if (collection.alwaysApplyDefaultValues !== undefined) result.alwaysApplyDefaultValues = collection.alwaysApplyDefaultValues;
    if (collection.includeJsonView !== undefined) result.includeJsonView = collection.includeJsonView;
    if (collection.history !== undefined) result.history = collection.history;
    if (collection.sideDialogWidth !== undefined) result.sideDialogWidth = collection.sideDialogWidth;

    // Exportable: only keep boolean variant
    if (typeof collection.exportable === "boolean") result.exportable = collection.exportable;

    // Auth: only keep boolean variant
    if (typeof collection.auth === "boolean") result.auth = collection.auth;

    // defaultSelectedView: only keep string variant
    if (typeof collection.defaultSelectedView === "string") result.defaultSelectedView = collection.defaultSelectedView;

    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// PROPERTY CONVERSION: Serializable → Original
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a serializable property back to the original `Property` type.
 *
 * This is a mostly pass-through operation since serializable properties
 * are a subset of the original types. The main conversions are:
 * - `validation.matches` (string) stays as string (compatible with Property)
 * - `validation.min/max` on dates: ISO strings → Date objects
 */
export function fromSerializableProperty(serialized: SerializableProperty): Property {
    switch (serialized.type) {
        case "date": {
            const sp = serialized as SerializableDateProperty;
            const { validation: dateValidation, ...dateRest } = sp;
            const result: Record<string, unknown> = { ...dateRest, type: "date" };
            // Convert ISO string dates back to Date objects
            if (dateValidation) {
                const convertedValidation: Record<string, unknown> = { ...dateValidation };
                if (typeof dateValidation.min === "string") {
                    convertedValidation.min = new Date(dateValidation.min);
                }
                if (typeof dateValidation.max === "string") {
                    convertedValidation.max = new Date(dateValidation.max);
                }
                result.validation = convertedValidation;
            }
            return result as unknown as DateProperty;
        }

        case "array": {
            const sp = serialized as SerializableArrayProperty;
            const result = { ...sp } as unknown as ArrayProperty;
            // Recursively convert "of" property
            if (sp.of) {
                if (Array.isArray(sp.of)) {
                    result.of = sp.of.map(fromSerializableProperty);
                } else {
                    result.of = fromSerializableProperty(sp.of);
                }
            }
            // Recursively convert oneOf properties
            if (sp.oneOf) {
                result.oneOf = {
                    ...sp.oneOf,
                    properties: fromSerializableProperties(sp.oneOf.properties),
                };
            }
            return result;
        }

        case "map": {
            const sp = serialized as SerializableMapProperty;
            const result = { ...sp } as unknown as MapProperty;
            // Recursively convert nested properties
            if (sp.properties) {
                result.properties = fromSerializableProperties(sp.properties);
            }
            return result;
        }

        case "string": {
            const sp = serialized as SerializableStringProperty;
            const result = { ...sp } as unknown as StringProperty;
            return result;
        }

        default:
            // For all other types, the serializable form is already a valid Property
            return serialized as unknown as Property;
    }
}

/**
 * Convert a `SerializableProperties` record back to `Properties`.
 */
export function fromSerializableProperties(serialized: SerializableProperties): Properties {
    const result: Properties = {};
    for (const [key, property] of Object.entries(serialized)) {
        result[key] = fromSerializableProperty(property);
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// COLLECTION CONVERSION: Serializable → Original
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a `SerializableCollectionConfig` back to an `AdminCollection`.
 *
 * The result will NOT contain any of the non-serializable fields
 * (callbacks, entityActions, etc.) — those must be re-attached by the
 * consumer if needed.
 */
export function fromSerializableCollectionConfig(serialized: SerializableCollectionConfig): AdminCollection {
    const { properties, ...rest } = serialized;

    return {
        ...rest,
        properties: fromSerializableProperties(properties),
    } as AdminCollection;
}
