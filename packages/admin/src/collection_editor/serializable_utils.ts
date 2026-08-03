/**
 * Conversion utilities between the full Rebase types and their
 * JSON-serializable counterparts.
 *
 * - `toSerializableCollectionConfig` / `toSerializableProperty` — strip non-serializable fields
 * - `fromSerializableCollectionConfig` / `fromSerializableProperty` — reconstruct original types
 *
 * @module
 */

import { isRelationalCollectionConfig, type Relation, type ArrayProperty, type BinaryProperty, type BooleanProperty, type DateProperty, type GeopointProperty, type MapProperty, type NumberProperty, type Properties, type Property, type ReferenceProperty, type RelationProperty, type StorageConfig, type StringProperty, type VectorProperty } from "@rebasepro/types";
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
    SerializableRelation,
    SerializableRelationProperty,
    SerializableStorageConfig,
    SerializableStringProperty,
    SerializableStringValidation,
    SerializableVectorProperty
} from "./serializable_types";

/**
 * Resolves a collection slug to the collection it names.
 *
 * Needed on the way back from JSON: a relation's `target` is a thunk, which
 * does not serialize, so it travels as a slug and has to be made callable
 * again against the other collections in the same set.
 */
export type CollectionLookup = (slug: string) => AdminCollection | undefined;

/**
 * Rebuild a serialized relation's `target` slug into the thunk consumers call.
 *
 * Shared by the relation *property* and the collection-level `relations` array.
 * They are the same shape on the wire and they need the same treatment coming
 * back, but only the property path had it — so a collection imported from an
 * existing table came off disk with `relations[n].target` still a string, which
 * typechecks (the serializable shape erases the difference) and throws "target
 * is not a function" at the first consumer.
 *
 * The lookup is consulted lazily, inside the thunk, so collections may
 * reference each other in any order, including circularly.
 */
function fromSerializableRelation<R extends { target?: string; relationName?: string }>(
    relation: R,
    label: string,
    lookup?: CollectionLookup
): R & { target: () => AdminCollection } {
    const slug = relation.target;
    return {
        ...relation,
        target: () => {
            const found = slug ? lookup?.(slug) : undefined;
            if (!found) {
                throw new Error(
                    `Relation "${relation.relationName ?? label}" targets collection "${slug ?? "(none)"}", ` +
                    "which is not among the collections it was deserialized with. Pass the whole set to " +
                    "`fromSerializableCollectionConfigs` so slugs can be resolved against each other."
                );
            }
            return found;
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════
// PROPERTY CONVERSION: Original → Serializable
// ═══════════════════════════════════════════════════════════════════════

/**
 * Strip non-serializable fields from a `AdminPropertyOptions`.
 * Removes `Field` and `Preview` (ComponentRef).
 */
/**
 * Every `ComponentRef` on a property's admin block. These are components, not
 * data, and none of them survives `JSON.stringify` — a function-valued key is
 * dropped from the output object with no error, so a component written here
 * would leave a key that reads back as missing rather than as itself.
 *
 * `Filter` was absent from this list while `Field` and `Preview` were named
 * twice, once destructured and once compared by string.
 */
const NON_SERIALIZABLE_ADMIN_KEYS = ["Field", "Preview", "Filter"];

function toSerializableAdminOptions(ui: AdminPropertyOptions | undefined): SerializableAdminBaseOptions | undefined {
    if (!ui) return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ui as Record<string, unknown>)) {
        if (!NON_SERIALIZABLE_ADMIN_KEYS.includes(key) && value !== undefined) {
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
function resolveRelationTarget(target: RelationProperty["relation"] extends infer R ? R extends { target: infer T } ? T : never : never): string | undefined {
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
 * A `Relation` as JSON: `target` resolved from its thunk down to a slug.
 *
 * Switched on `kind` and assigned without a cast, so the compiler checks that
 * each branch writes the fields its kind owns and no others. This used to be
 * built as an untyped bag and cast into place — which is how the target
 * interface drifted a whole refactor behind the code writing to it.
 *
 * Shared by the relation *property* and the collection-level `relations` array,
 * which had no serializer at all: `buildCollectionFromTableMetadata` fills that
 * array from the table's foreign keys and junctions on import, and every one of
 * them was dropped on save.
 */
function toSerializableRelation(link: Relation): SerializableRelation {
    const target = resolveRelationTarget(link.target);
    const common = {
        ...(target ? { target } : {}),
        ...(link.relationName ? { relationName: link.relationName } : {}),
        ...(link.onUpdate ? { onUpdate: link.onUpdate } : {}),
        ...(link.onDelete ? { onDelete: link.onDelete } : {})
    };
    switch (link.kind) {
        case "belongsTo":
            return { kind: "belongsTo", ...common, ...(link.localKey ? { localKey: link.localKey } : {}) };
        case "hasOne":
        case "hasMany":
            return {
                kind: link.kind,
                ...common,
                ...(link.foreignKeyOnTarget ? { foreignKeyOnTarget: link.foreignKeyOnTarget } : {}),
                ...(link.sourceKey ? { sourceKey: link.sourceKey } : {})
            };
        case "manyToMany":
            return { kind: "manyToMany", ...common, ...(link.through ? { through: link.through } : {}) };
        case "via":
            return { kind: "via", ...common, cardinality: link.cardinality, joinPath: link.joinPath };
        default: {
            const exhaustive: never = link;
            throw new Error(`Unhandled relation kind: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/**
 * Strip non-serializable base property fields.
 * Returns a clean object with only the common serializable fields from BaseProperty.
 * Validation is intentionally excluded — each property type handles its own.
 */
function toSerializableBaseFields(property: Property): Omit<SerializableBaseProperty, "validation"> {
    const result: Partial<Omit<SerializableBaseProperty, "validation">> = {
        name: property.name
    };

    if (property.description) result.description = property.description;
    if (property.propertyConfig) result.propertyConfig = property.propertyConfig;
    if (property.columnName) result.columnName = property.columnName;
    if (property.excludeFromApi !== undefined) result.excludeFromApi = property.excludeFromApi;
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
                type: "string"
            };
            if (sp.columnType) result.columnType = sp.columnType;
            if (sp.isId !== undefined) result.isId = sp.isId;
            if (sp.enum) result.enum = sp.enum;
            if (sp.userSelect) result.userSelect = sp.userSelect;
            if (sp.email) result.email = sp.email;
            if (sp.url) result.url = sp.url;

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
                type: "number"
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
                type: "boolean"
            };
            if (bp.validation) result.validation = bp.validation;
            return result;
        }

        case "date": {
            const dp = property as DateProperty;
            const result: SerializableDateProperty = {
                ...base,
                type: "date"
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
                type: "geopoint"
            };
            if (gp.validation) result.validation = gp.validation;
            return result;
        }

        case "reference": {
            const rp = property as ReferenceProperty;
            const result: SerializableReferenceProperty = {
                ...base,
                type: "reference"
            };
            if (rp.isId !== undefined) result.isId = rp.isId;
            if (rp.path) result.path = rp.path;
            return result;
        }

        case "relation": {
            const rl = property as RelationProperty;
            const result: SerializableRelationProperty = {
                ...base,
                type: "relation"
            };
            if (rl.isId !== undefined) result.isId = rl.isId;
            // The link is one nested object now, so it serializes as one:
            // its `kind` says which fields are even meaningful.
            const link = rl.relation;
            if (link) {
                // Switched on `kind` and assigned without a cast: the
                // serialized union mirrors the authored one, so the compiler
                // checks that each branch writes the fields its kind owns and
                // no others. This used to be built as an untyped bag and cast
                // into place — which is how the target interface drifted a
                // whole refactor behind the code writing to it.
                result.relation = toSerializableRelation(link);
            }
            // overrides are dropped (may hold a non-serializable CollectionConfig)
            return result;
        }

        case "array": {
            const ap = property as ArrayProperty;
            const result: SerializableArrayProperty = {
                ...base,
                type: "array"
            };
            if (ap.columnType) result.columnType = ap.columnType;
            if (ap.validation) result.validation = ap.validation;

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
                    properties: toSerializableProperties(ap.oneOf.properties)
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
                type: "map"
            };
            if (mp.columnType) result.columnType = mp.columnType;
            if (mp.validation) result.validation = mp.validation;
            if (mp.propertiesOrder) result.propertiesOrder = mp.propertiesOrder;
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
                dimensions: vp.dimensions
            };
            if (vp.validation) result.validation = vp.validation;
            return result;
        }

        case "binary": {
            const bp = property as BinaryProperty;
            const result: SerializableBinaryProperty = {
                ...base,
                type: "binary"
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
        properties: toSerializableProperties(collection.properties)
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
    if (isRelationalCollectionConfig(collection) && collection.table) result.table = collection.table;
    if (isRelationalCollectionConfig(collection) && collection.relations?.length) {
        result.relations = collection.relations.map(toSerializableRelation);
    }
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
    if (isRelationalCollectionConfig(collection) && collection.disableDefaultPolicies !== undefined) {
        result.disableDefaultPolicies = collection.disableDefaultPolicies;
    }
    if (collection.strictWrites !== undefined) result.strictWrites = collection.strictWrites;

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
export function fromSerializableProperty(
    serialized: SerializableProperty,
    lookup?: CollectionLookup
): Property {
    switch (serialized.type) {
        case "date": {
            const sp = serialized as SerializableDateProperty;
            const { validation: dateValidation, ...dateRest } = sp;
            const result: Record<string, unknown> = { ...dateRest,
type: "date" };
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
                    result.of = sp.of.map(prop => fromSerializableProperty(prop, lookup));
                } else {
                    result.of = fromSerializableProperty(sp.of, lookup);
                }
            }
            // Recursively convert oneOf properties
            if (sp.oneOf) {
                result.oneOf = {
                    ...sp.oneOf,
                    properties: fromSerializableProperties(sp.oneOf.properties, lookup)
                };
            }
            return result;
        }

        case "map": {
            const sp = serialized as SerializableMapProperty;
            const result = { ...sp } as unknown as MapProperty;
            // Recursively convert nested properties
            if (sp.properties) {
                result.properties = fromSerializableProperties(sp.properties, lookup);
            }
            return result;
        }

        case "string": {
            const sp = serialized as SerializableStringProperty;
            const result = { ...sp } as unknown as StringProperty;
            return result;
        }

        case "relation": {
            // The one property whose serialized form is *not* already a valid
            // Property. `target` survives the round trip as a collection slug,
            // because a `() => CollectionConfig` thunk cannot be written to
            // JSON — so it has to be made callable again on the way back.
            //
            // Falling through to the pass-through below returned a relation
            // whose `target` was a string, and every consumer calls `target()`.
            // Nothing caught it: the cast to `Property` erased the difference.
            const sp = serialized as SerializableRelationProperty;
            const { relation, ...rest } = sp;
            const result = { ...rest,
type: "relation" } as unknown as RelationProperty;
            if (relation) {
                result.relation = fromSerializableRelation(
                    relation,
                    sp.name ?? "",
                    lookup
                ) as unknown as RelationProperty["relation"];
            }
            return result as Property;
        }

        default:
            // For all other types, the serializable form is already a valid Property
            return serialized as unknown as Property;
    }
}

/**
 * Convert a `SerializableProperties` record back to `Properties`.
 */
export function fromSerializableProperties(
    serialized: SerializableProperties,
    lookup?: CollectionLookup
): Properties {
    const result: Properties = {};
    for (const [key, property] of Object.entries(serialized)) {
        result[key] = fromSerializableProperty(property, lookup);
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
export function fromSerializableCollectionConfig(
    serialized: SerializableCollectionConfig,
    lookup?: CollectionLookup
): AdminCollection {
    const { properties, relations, ...rest } = serialized as SerializableCollectionConfig & {
        relations?: SerializableRelation[]
    };

    return {
        ...rest,
        ...(relations
            ? {
                relations: relations.map((relation, index) =>
                    fromSerializableRelation(relation, `relations[${index}]`, lookup))
            }
            : {}),
        properties: fromSerializableProperties(properties, lookup)
    } as AdminCollection;
}

/**
 * Deserialize a whole set of collections, resolving relation targets against
 * each other.
 *
 * This is the entry point to prefer. A relation's `target` is a slug on the
 * wire, and a slug only means something relative to the other collections — so
 * deserializing one at a time cannot rebuild a working thunk, and produces
 * relations that throw the moment anything resolves them.
 *
 * The lookup is consulted lazily, inside the thunk, so the collections may
 * reference each other in any order, including circularly.
 */
export function fromSerializableCollectionConfigs(
    serialized: SerializableCollectionConfig[]
): AdminCollection[] {
    const bySlug = new Map<string, AdminCollection>();
    const lookup: CollectionLookup = slug => bySlug.get(slug);

    const collections = serialized.map(c => fromSerializableCollectionConfig(c, lookup));
    for (const collection of collections) {
        if (collection.slug) bySlug.set(collection.slug, collection);
    }
    return collections;
}
