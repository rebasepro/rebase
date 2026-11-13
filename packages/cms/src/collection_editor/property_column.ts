/**
 * The collection editor's property, as the column (or relation) the schema
 * editor writes.
 *
 * The editor renders and edits the panel's view model — a flat collection of
 * `Property`s, what `propertyFromColumn` projects a column to. A save sends
 * the server {@link WireColumnDef}s and {@link WireRelation}s. This module is
 * the inverse of the projector for the facts the editor can change: the
 * column type, nullability, the primary key and its strategy, the default,
 * validation, enum values, storage rules, the SQL name, field access and
 * stamps.
 *
 * Everything else a column says (a vector index, `.transform()`, a generated
 * expression, a JSON shape the editor does not draw) is kept from the column
 * as served: a property is always read **over** the column it was projected
 * from, so a fact the view model cannot carry is never dropped by a save.
 *
 * @module
 */
import type {
    ColumnDefault,
    ColumnDescriptor,
    ColumnStorage,
    ColumnType,
    ColumnValidation,
    JsonShape,
    RelationDescriptor,
    TableDescriptor,
    WireColumnDef,
    WireRelation
} from "@rebasepro/types";
import type {
    ArrayProperty,
    DateProperty,
    EnumValues,
    MapProperty,
    NumberProperty,
    Properties,
    Property,
    Relation,
    StorageConfig,
    StringProperty
} from "@rebasepro/cms-types";

// ── From what the server serves ─────────────────────────────────────────────

/**
 * A served column as the definition the wire carries: the flags that are off
 * left out, an array's item and a document's shape included.
 */
export function wireColumnOfDescriptor(column: ColumnDescriptor): WireColumnDef {
    const def: WireColumnDef = { type: column.type };
    if (column.column !== snakeCase(column.key)) def.column = column.column;
    if (!column.nullable) def.notNull = true;
    if (column.primaryKey) def.primaryKey = true;
    if (column.unique) def.unique = true;
    if (column.readOnly) def.readOnly = true;
    if (column.private) def.private = true;
    if (column.default !== undefined) def.default = column.default;
    if (column.generated !== undefined) def.generatedAs = column.generated.expression;
    if (column.access !== undefined) def.access = column.access;
    if (column.stamp !== undefined) def.stamp = column.stamp;
    if (column.validate !== undefined) def.validate = column.validate;
    if (column.oneOf !== undefined) def.oneOf = column.oneOf;
    if (column.description !== undefined) def.description = column.description;
    if (column.storage !== undefined) def.storage = column.storage;
    if (column.semantic !== undefined) def.semantic = column.semantic;
    if (column.vectorIndex !== undefined) def.vectorIndex = column.vectorIndex;
    if (column.json !== undefined) def.json = column.json;
    if (column.type.kind === "array" && column.element) {
        const element: WireColumnDef = { type: column.type.of };
        if (column.element.validate !== undefined) element.validate = column.element.validate;
        if (column.element.oneOf !== undefined) element.oneOf = column.element.oneOf;
        if (column.element.storage !== undefined) element.storage = column.element.storage;
        if (column.element.semantic !== undefined) element.semantic = column.element.semantic;
        def.element = element;
    }
    return def;
}

/**
 * A served relation as the wire carries it: its kind, its target by slug and
 * the options of its `rel.*` builder, every derived name stated.
 */
export function wireRelationOfDescriptor(relation: RelationDescriptor, owner: TableDescriptor): WireRelation {
    const access = {
        ...(relation.access !== undefined ? { access: relation.access } : {}),
        ...(relation.private ? { private: true } : {})
    };
    switch (relation.kind) {
        case "belongsTo": {
            const derived = owner.columns.find(column => column.key === relation.localField && column.derived === true);
            return {
                kind: "belongsTo",
                target: relation.target,
                localKey: relation.localKey,
                ...(derived && !derived.nullable ? { notNull: true } : {}),
                ...(derived?.unique ? { unique: true } : {}),
                ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {}),
                ...(relation.onUpdate !== undefined ? { onUpdate: relation.onUpdate } : {}),
                ...(relation.index ? {} : { index: false }),
                ...(relation.constraint ? {} : { constraint: false }),
                ...access
            };
        }
        case "hasOne":
        case "hasMany":
            return {
                kind: relation.kind,
                target: relation.target,
                foreignKey: relation.foreignKey,
                ...(relation.sourceKey !== undefined ? { sourceKey: relation.sourceKey } : {}),
                ...(relation.kind === "hasMany" && relation.orderBy !== undefined ? { orderBy: relation.orderBy } : {}),
                ...access
            };
        case "manyToMany": {
            const pivot: Record<string, WireColumnDef> = {};
            for (const column of relation.through.pivot) pivot[column.key] = wireColumnOfDescriptor(column);
            return {
                kind: "manyToMany",
                target: relation.target,
                through: relation.through.table,
                sourceKey: relation.through.sourceKey,
                targetKey: relation.through.targetKey,
                ...(relation.through.pivot.length > 0 ? { pivot } : {}),
                ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {}),
                ...access
            };
        }
        case "via":
            return {
                kind: "via",
                target: relation.target,
                steps: relation.steps.map(step => ({ ...step })),
                cardinality: relation.cardinality,
                ...access
            };
    }
}

// ── From the editor's property ──────────────────────────────────────────────

/**
 * A property the editor cannot write as a column of a table, with why: a
 * relation is a relation, and a view-model type with no column equivalent is
 * not offered for a table.
 */
export class PropertyNotAColumnError extends Error {
    constructor(readonly key: string, message: string) {
        super(message);
        this.name = "PropertyNotAColumnError";
    }
}

const snakeCase = (key: string): string => key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** The ids of a property's enum values, whichever form they were written in. */
export function enumIds(values: EnumValues | undefined): (string | number)[] | undefined {
    if (values === undefined) return undefined;
    if (Array.isArray(values)) return values.map(value => value.id);
    return Object.keys(values);
}

/**
 * What the projector makes of a column type — the property's type and its
 * `columnType` — as one key. Two types with the same key are the same choice
 * in the editor's type picker: a column keeps its exact type (a `smallint`, a
 * `varchar(80)`) while the editor leaves that choice alone.
 */
function familyOfType(type: ColumnType, semantic?: string): string {
    switch (type.kind) {
        case "text": case "varchar": case "char": case "uuid": return `string:${type.kind}`;
        case "other": return "string:";
        case "enum": return "string:enum";
        case "smallint": case "integer": return "number:integer";
        case "smallserial": case "serial": return "number:serial";
        case "bigint": case "bigserial": case "real": case "numeric": return `number:${type.kind}`;
        case "doublePrecision": return "number:double precision";
        case "boolean": return "boolean";
        case "timestamptz": return "date:timestamp";
        case "date": return "date:date";
        case "time": return "date:time";
        case "json": case "jsonb": return semantic === "geopoint" ? "geopoint" : `json:${type.kind}`;
        case "vector": return `vector:${type.dimensions}`;
        case "bytea": return "binary";
        case "array": {
            const of = type.of.kind;
            if (of === "text" || of === "varchar") return "array:text[]";
            if (of === "smallint" || of === "integer" || of === "bigint") return "array:integer[]";
            if (of === "boolean") return "array:boolean[]";
            if (of === "numeric") return "array:numeric[]";
            return `array:${of}`;
        }
    }
}

function familyOfProperty(property: Property): string | undefined {
    switch (property.type) {
        case "string":
            if (property.columnType) return `string:${property.columnType}`;
            return property.enum !== undefined ? "string:enum" : "string:";
        case "reference":
            return "string:";
        case "number":
            return `number:${property.columnType ?? (property.validation?.integer ? "integer" : "double precision")}`;
        case "boolean": return "boolean";
        case "date": return `date:${property.columnType ?? "timestamp"}`;
        case "geopoint": return "geopoint";
        case "map": return `json:${property.columnType ?? "jsonb"}`;
        case "vector": return `vector:${property.dimensions}`;
        case "binary": return "binary";
        case "array":
            return property.columnType === undefined || property.columnType === "json" || property.columnType === "jsonb"
                ? `json:${property.columnType ?? "jsonb"}`
                : `array:${property.columnType}`;
        case "relation": return undefined;
    }
}

/** The column type a property asks for, read over the type it had. */
function columnTypeOf(key: string, property: Property, base: ColumnType | undefined): ColumnType {
    const family = familyOfProperty(property);
    if (family === undefined) throw new PropertyNotAColumnError(key, `"${key}" is a relation, not a column.`);
    if (base && familyOfType(base) === family) {
        // The same choice: keep the exact type, with the editor's enum values.
        if (base.kind === "enum" && property.type === "string") {
            const values = enumIds(property.enum)?.map(String) ?? [...base.values];
            // The same values in another order is how they are offered, not
            // the type: the order stays as written.
            const sameSet = values.length === base.values.length && values.every(value => base.values.includes(value));
            return sameSet ? base : { ...base, values };
        }
        if (base.kind === "numeric" && property.type === "number") {
            return compact({ kind: "numeric", precision: property.precision, scale: property.scale });
        }
        return base;
    }
    switch (property.type) {
        case "string":
        case "reference": {
            const columnType = property.type === "string" ? property.columnType : undefined;
            if (columnType === "varchar" || columnType === "char") {
                const max = property.type === "string" ? property.validation?.max : undefined;
                return { kind: columnType, length: typeof max === "number" && max > 0 ? max : 255 };
            }
            if (columnType === "uuid") return { kind: "uuid" };
            if (property.type === "string" && columnType === undefined && property.enum !== undefined) {
                const values = (enumIds(property.enum) ?? []).map(String);
                if (values.length === 0) throw new PropertyNotAColumnError(key, `"${key}" lists no enum values. Add at least one value.`);
                return { kind: "enum", values };
            }
            return { kind: "text" };
        }
        case "number":
            switch (property.columnType) {
                case "integer": return { kind: "integer" };
                case "bigint": return { kind: "bigint" };
                case "serial": return { kind: "serial" };
                case "bigserial": return { kind: "bigserial" };
                case "real": return { kind: "real" };
                case "numeric": return compact({ kind: "numeric", precision: property.precision, scale: property.scale });
                case "double precision": return { kind: "doublePrecision" };
                default: return property.validation?.integer ? { kind: "integer" } : { kind: "doublePrecision" };
            }
        case "boolean": return { kind: "boolean" };
        case "date":
            return property.columnType === "date" ? { kind: "date" } : property.columnType === "time" ? { kind: "time" } : { kind: "timestamptz" };
        case "geopoint": return { kind: "jsonb" };
        case "map": return { kind: property.columnType ?? "jsonb" };
        case "vector":
            if (!(property.dimensions > 0)) throw new PropertyNotAColumnError(key, `"${key}" needs its number of dimensions.`);
            return { kind: "vector", dimensions: property.dimensions };
        case "binary": return { kind: "bytea" };
        case "array":
            switch (property.columnType) {
                case "text[]": return { kind: "array", of: { kind: "text" } };
                case "integer[]": return { kind: "array", of: { kind: "integer" } };
                case "boolean[]": return { kind: "array", of: { kind: "boolean" } };
                case "numeric[]": return { kind: "array", of: { kind: "numeric" } };
                default: return { kind: property.columnType ?? "jsonb" };
            }
        case "relation":
            throw new PropertyNotAColumnError(key, `"${key}" is a relation, not a column.`);
    }
}

/** Drop the keys a builder left `undefined`. */
function compact<T extends object>(value: T): T {
    for (const key of Object.keys(value)) {
        if (Reflect.get(value, key) === undefined) Reflect.deleteProperty(value, key);
    }
    return value;
}

const nonEmpty = <T extends object>(value: T): T | undefined =>
    Object.keys(compact(value)).length > 0 ? value : undefined;

const dateBound = (value: unknown): string | undefined =>
    value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : typeof value === "string" ? value : undefined;

/** A property's validation rules, as a column's `validate`. Required and unique are the column's flags, not rules. */
function validateOf(property: Property, type: ColumnType): ColumnValidation | undefined {
    const rules = property.validation;
    const out: ColumnValidation = {};
    if (rules?.requiredMessage) out.requiredMessage = rules.requiredMessage;
    switch (property.type) {
        case "string": {
            const v = property.validation;
            if (v?.min !== undefined) out.min = v.min;
            // A varchar's length is projected as `max`; it is the type's, not a rule.
            const typeLength = type.kind === "varchar" || type.kind === "char" ? type.length : undefined;
            if (v?.max !== undefined && v.max !== typeLength) out.max = v.max;
            if (v?.length !== undefined) out.length = v.length;
            if (v?.matches !== undefined) {
                if (v.matches instanceof RegExp) {
                    out.matches = v.matches.source;
                    if (v.matches.flags) out.matchesFlags = v.matches.flags;
                } else {
                    out.matches = v.matches;
                }
            }
            if (v?.matchesMessage !== undefined) out.matchesMessage = v.matchesMessage;
            if (v?.trim) out.trim = true;
            if (v?.lowercase) out.lowercase = true;
            if (v?.uppercase) out.uppercase = true;
            if (property.email) out.email = true;
            if (property.url) out.url = true;
            break;
        }
        case "number": {
            const v = property.validation;
            if (v?.min !== undefined) out.min = v.min;
            if (v?.max !== undefined) out.max = v.max;
            if (v?.lessThan !== undefined) out.lessThan = v.lessThan;
            if (v?.moreThan !== undefined) out.moreThan = v.moreThan;
            if (v?.positive) out.positive = true;
            if (v?.negative) out.negative = true;
            // An integer column is an integer: the projector says so, the type keeps it.
            const integerType = type.kind === "smallint" || type.kind === "integer" || type.kind === "bigint"
                || type.kind === "smallserial" || type.kind === "serial" || type.kind === "bigserial";
            if (v?.integer && !integerType) out.integer = true;
            break;
        }
        case "date": {
            const v = property.validation;
            const min = dateBound(v?.min);
            const max = dateBound(v?.max);
            if (min) out.min = min;
            if (max) out.max = max;
            break;
        }
        case "array": {
            const v = property.validation;
            if (v?.min !== undefined) out.minItems = v.min;
            if (v?.max !== undefined) out.maxItems = v.max;
            if (v?.uniqueInArray) out.uniqueItems = true;
            break;
        }
        default:
            break;
    }
    return nonEmpty(out);
}

/** An upload field's configuration as a column's storage rules. Function-valued options are code, and are not written. */
export function columnStorageOf(storage: StorageConfig): ColumnStorage {
    return compact<ColumnStorage>({
        source: typeof storage.storageSource === "string" ? storage.storageSource : undefined,
        path: typeof storage.storagePath === "string" ? storage.storagePath : "",
        accept: storage.acceptedFiles ? [...storage.acceptedFiles] : undefined,
        maxBytes: storage.maxSize,
        imageResize: storage.imageResize ? { ...storage.imageResize } : undefined,
        public: storage.public,
        fileName: typeof storage.fileName === "string" ? storage.fileName : undefined,
        metadata: storage.metadata ? { ...storage.metadata } : undefined,
        includeBucketUrl: storage.includeBucketUrl,
        storeUrl: storage.storeUrl
    });
}

/** The nominal column type a JSON node's rules are read against: never a length or an integer type. */
const NODE_RULE_TYPE: Readonly<Record<"string" | "number" | "date" | "array", ColumnType>> = {
    string: { kind: "text" },
    number: { kind: "numeric" },
    date: { kind: "timestamptz" },
    array: { kind: "jsonb" }
};

/**
 * A JSON node's rules: the ones the property states, and the API error for a
 * missing key, which the form never shows and so never edits, kept from the
 * served node.
 */
function nodeRules(property: Property, kind: keyof typeof NODE_RULE_TYPE, served: JsonShape | undefined): ColumnValidation | undefined {
    const rules: ColumnValidation = { ...validateOf(property, NODE_RULE_TYPE[kind]) };
    const servedMessage = served && "validate" in served ? served.validate?.requiredMessage : undefined;
    if (rules.requiredMessage === undefined && servedMessage !== undefined) rules.requiredMessage = servedMessage;
    if (property.type === "array" && !Array.isArray(property.of) && property.of?.type === "map" && property.of.properties) {
        // `uniqueBy` is projected onto the item's fields as `uniqueInArray` —
        // on a field that is not itself an array, where it means `uniqueItems`.
        const uniqueBy = Object.entries(property.of.properties)
            .filter(([, field]) => marksUniqueBy(field))
            .map(([key]) => key);
        if (uniqueBy.length > 0) rules.uniqueBy = uniqueBy;
    }
    return nonEmpty(rules);
}

/**
 * The DEFAULT of a JSON node: the property's `defaultValue` for the kinds the
 * form opens with one, else the served node's, which the form never shows.
 */
function nodeDefault(property: Property, served: JsonShape | undefined, kind: JsonShape["kind"]): unknown {
    switch (property.type) {
        case "string":
        case "number":
        case "boolean":
        case "map":
        case "array":
            if (kind !== "unknown") return property.defaultValue;
            break;
        default:
            break;
    }
    return served?.kind === kind ? served.default : undefined;
}

/**
 * A JSON document's node, from the property that edits it, read over the
 * node as served: what the form does not carry (a user stamp, an open
 * object, the API error for a missing key, a default it does not open with)
 * is kept from `served`, so a save never drops it.
 *
 * @param property the property that edits the node
 * @param served the node as the column serves it, when there is one
 */
export function jsonShapeOf(property: Property, served?: JsonShape): JsonShape {
    return nodeShape(property, served, {
        description: property.description,
        required: property.validation?.required ? true : undefined
    });
}

/**
 * One node. `base` is what the node says about itself: for a nested node,
 * read from its property; for the document itself, the served node's — the
 * property's description and required flag are the column's.
 */
function nodeShape(property: Property, served: JsonShape | undefined, base: { description?: string; required?: true }): JsonShape {
    const head = (kind: JsonShape["kind"]) => compact({ ...base, default: nodeDefault(property, served, kind) });
    switch (property.type) {
        case "string":
        case "reference": {
            const oneOf = property.type === "string" ? enumIds(property.enum)?.map(String) : undefined;
            const storage = property.type === "string" && property.storage ? columnStorageOf(property.storage) : undefined;
            const stamp = served?.kind === "string" ? served.stamp : undefined;
            return compact({
                ...head("string"),
                kind: "string" as const,
                validate: nodeRules(property, "string", served),
                oneOf,
                storage,
                stamp,
                semantic: property.type === "string" && property.userSelect ? "user" as const : undefined
            });
        }
        case "number": {
            const oneOf = enumIds(property.enum)?.filter((id): id is number => typeof id === "number");
            return compact({ ...head("number"), kind: "number" as const, validate: nodeRules(property, "number", served), oneOf: oneOf && oneOf.length > 0 ? oneOf : undefined });
        }
        case "boolean": return { ...head("boolean"), kind: "boolean" };
        case "date": {
            const stamp = property.autoValue === "on_create" ? "create" as const : property.autoValue === "on_update" ? "update" as const : undefined;
            return compact({ ...head("date"), kind: "date" as const, validate: nodeRules(property, "date", served), stamp });
        }
        case "geopoint": return { ...head("geopoint"), kind: "geopoint" };
        case "map": {
            if (!property.properties || property.keyValue) return { ...head("unknown"), kind: "unknown" };
            const servedObject = served?.kind === "object" ? served : undefined;
            return compact({
                ...head("object"),
                kind: "object" as const,
                fields: jsonFieldsOf(property.properties, property.propertiesOrder, servedObject?.fields),
                additional: servedObject?.additional
            });
        }
        case "array": {
            const servedArray = served?.kind === "array" ? served : undefined;
            const validate = nodeRules(property, "array", served);
            if (property.oneOf) {
                const servedVariants = servedArray?.of.kind === "oneOf" ? servedArray.of.variants : undefined;
                return compact({
                    ...head("array"),
                    kind: "array" as const,
                    validate,
                    of: {
                        kind: "oneOf" as const,
                        typeField: property.oneOf.typeField ?? "type",
                        valueField: property.oneOf.valueField ?? "value",
                        variants: jsonFieldsOf(property.oneOf.properties, property.oneOf.propertiesOrder, servedVariants)
                    }
                });
            }
            const item = Array.isArray(property.of) ? undefined : property.of;
            return compact({
                ...head("array"),
                kind: "array" as const,
                validate,
                of: item ? jsonShapeOf(withoutItemUniqueness(item), servedArray?.of) : { kind: "unknown" as const }
            });
        }
        default:
            return { ...head("unknown"), kind: "unknown" };
    }
}

/** Whether an array item's field carries the `uniqueInArray` mark of its array's `uniqueBy`. */
function marksUniqueBy(field: Property): boolean {
    return field.type !== "array" && field.validation !== undefined
        && "uniqueInArray" in field.validation && field.validation.uniqueInArray === true;
}

/**
 * An array's item without the `uniqueInArray` marks `uniqueBy` put on its
 * fields: those are the array's rule ({@link nodeRules}), not the fields'.
 */
function withoutItemUniqueness(item: Property): Property {
    if (item.type !== "map" || !item.properties) return item;
    const properties: Properties = {};
    for (const [key, field] of Object.entries(item.properties)) {
        if (!marksUniqueBy(field) || field.validation === undefined || !("uniqueInArray" in field.validation)) {
            properties[key] = field;
            continue;
        }
        const { uniqueInArray: _unique, ...validation } = field.validation;
        void _unique;
        properties[key] = Object.assign({}, field, { validation });
    }
    return { ...item, properties };
}

function jsonFieldsOf(properties: Properties, order: readonly string[] | undefined, served: Record<string, JsonShape> | undefined): Record<string, JsonShape> {
    const keys = [...(order ?? []).filter(key => key in properties), ...Object.keys(properties).filter(key => !order?.includes(key))];
    const out: Record<string, JsonShape> = {};
    for (const key of keys) out[key] = jsonShapeOf(properties[key], served?.[key]);
    return out;
}

/** The DEFAULT a property states, if any. */
function defaultOf(property: Property, base: ColumnDefault | undefined): ColumnDefault | undefined {
    const databaseDefault = property.databaseDefault;
    if (typeof databaseDefault === "string") {
        const expression = databaseDefault.replace(/^sql`/, "").replace(/`$/, "");
        return { kind: "sql", expression };
    }
    if (databaseDefault === true) {
        // The database's own default: keep what the column states, whatever kind it is.
        return base && base.kind !== "literal" ? base : { kind: "database" };
    }
    const value = "defaultValue" in property ? property.defaultValue : undefined;
    if (value === undefined || value === null) return undefined;
    if (value instanceof Date) return { kind: "literal", value: value.toISOString() };
    return { kind: "literal", value };
}

/** The id strategy of a primary-key property, as a column default. */
function idDefault(property: Property, type: ColumnType): ColumnDefault | undefined {
    const isId = property.type === "string" || property.type === "number" || property.type === "date" ? property.isId : undefined;
    if (isId === "uuid") return { kind: "random-uuid" };
    if (isId === "increment") {
        return type.kind === "serial" || type.kind === "bigserial" || type.kind === "smallserial" ? undefined : { kind: "identity" };
    }
    return undefined;
}

const isIdProperty = (property: Property): boolean => {
    const isId = property.type === "string" || property.type === "number" || property.type === "date" ? property.isId : undefined;
    return isId !== undefined && isId !== false;
};

/** The stamp a property's `autoValue` asks for. */
function stampOf(property: Property): WireColumnDef["stamp"] {
    const auto = property.type === "date" || property.type === "string" ? property.autoValue : undefined;
    switch (auto) {
        case "on_create": return { on: "create", value: "now" };
        case "on_update": return { on: "update", value: "now" };
        case "user_on_create": return { on: "create", value: "user" };
        case "user_on_update": return { on: "update", value: "user" };
        default: return undefined;
    }
}

/**
 * A property as the column the schema editor writes, read over `base` — the
 * column as served, when there is one.
 *
 * Throws {@link PropertyNotAColumnError} for a relation, and for a property
 * the editor cannot express as a column.
 */
export function wireColumnFromProperty(key: string, property: Property, base?: WireColumnDef): WireColumnDef {
    const type = columnTypeOf(key, property, base?.type);
    const sameType = base !== undefined && JSON.stringify(base.type) === JSON.stringify(type);
    const out: WireColumnDef = { type };

    if (property.columnName && property.columnName !== snakeCase(key)) out.column = property.columnName;
    else if (base?.column !== undefined && !property.columnName) out.column = base.column;

    const isKey = isIdProperty(property);
    const stamp = stampOf(property);
    if (isKey) out.primaryKey = true;
    const generatedId = isKey ? idDefault(property, type) : undefined;

    // Not null: required, or a primary key. A column the server fills (a
    // generated id, a stamp, a read-only or generated column) is never
    // "required" in the form, so its nullability is kept from the column.
    const writtenByServer = Boolean(generatedId || stamp || base?.readOnly || base?.generatedAs
        || (isKey && property.type === "number" && property.isId === "increment"));
    if (isKey || property.validation?.required || (writtenByServer && base?.notNull)) out.notNull = true;
    if (property.validation?.unique && !isKey) out.unique = true;
    if (base?.readOnly) out.readOnly = true;
    if (base?.private) out.private = true;

    const fallback = generatedId ?? (isKey && base?.default && base.default.kind !== "literal" ? base.default : undefined)
        ?? defaultOf(property, base?.default);
    if (fallback) out.default = fallback;
    if (base?.generatedAs !== undefined) out.generatedAs = base.generatedAs;

    if (property.access) {
        out.access = compact({
            read: property.access.read ? [...property.access.read] : undefined,
            write: property.access.write ? [...property.access.write] : undefined
        });
    }
    if (stamp) out.stamp = stamp;
    else if (base?.stamp && property.type !== "date" && property.type !== "string") out.stamp = base.stamp;

    // A document's rules are its shape's (below); the column's own, which the
    // form does not show, are kept as served.
    const isDocument = type.kind === "json" || type.kind === "jsonb";
    const validate = isDocument ? base?.validate : validateOf(property, type);
    if (validate) out.validate = validate;

    // Enum values on a non-enum column are `.oneOf()`.
    if (type.kind !== "enum" && (property.type === "string" || property.type === "number") && property.enum !== undefined) {
        out.oneOf = enumIds(property.enum);
    }
    if (property.description !== undefined) out.description = property.description;
    else if (base?.description !== undefined) out.description = base.description;

    if (property.type === "string" && property.storage) out.storage = columnStorageOf(property.storage);
    if (property.type === "string" && property.userSelect) out.semantic = "user";
    if (property.type === "geopoint") out.semantic = "geopoint";
    if (sameType && base?.vectorIndex !== undefined) out.vectorIndex = base.vectorIndex;

    if (property.type === "array" && type.kind === "array") {
        const item = Array.isArray(property.of) ? undefined : property.of;
        // A storage column with `.multiple()` states its storage on the column.
        if (item?.type === "string" && item.storage && base?.storage) out.storage = columnStorageOf(item.storage);
        else if (item) {
            const element: WireColumnDef = { type: type.of };
            if (item.type === "string" || item.type === "number") {
                const oneOf = enumIds(item.enum);
                if (oneOf) element.oneOf = oneOf;
            }
            if (item.type === "string" && item.storage) element.storage = columnStorageOf(item.storage);
            if (item.type === "string" && item.userSelect) element.semantic = "user";
            const itemRules = validateOf(item, type.of);
            if (itemRules) element.validate = itemRules;
            if (Object.keys(element).length > 1) out.element = element;
        }
    }
    if (isDocument) {
        const shaped = (property.type === "map" && property.properties && !property.keyValue) || property.type === "array";
        if (shaped) {
            const servedShape = sameType ? base?.json : undefined;
            // The document's own description and required flag are the
            // served node's: the property's are the column's.
            const shape = nodeShape(property, servedShape, compact({
                description: servedShape?.description,
                required: servedShape?.required ? true as const : undefined
            }));
            // A shape the editor reads the same way as the served one is the
            // served one: its nested hooks and defaults stay as written.
            out.json = sameType && base?.json && JSON.stringify(stripShape(base.json)) === JSON.stringify(stripShape(shape)) ? base.json : shape;
        } else if (sameType && base?.json && property.type === "map" && property.keyValue) {
            out.json = base.json;
        }
    }
    return out;
}

/** The parts of a JSON shape the editor reads, for comparing two. */
function stripShape(shape: JsonShape): unknown {
    if (!isRecord(shape)) return shape;
    const { default: _default, ...rest } = shape;
    void _default;
    return rest;
}

/** The slug a relation's target points at. */
export function relationTargetSlug(relation: Relation, fallback?: string): string | undefined {
    try {
        const target: unknown = relation.target();
        if (isRecord(target) && typeof target.slug === "string") return target.slug;
    } catch {
        // A target that is not loaded: the caller's fallback stands.
    }
    return fallback;
}

/**
 * A relation the editor shows, as the relation the schema editor writes, read
 * over `base` — the relation as served, when there is one.
 */
export function wireRelationFromRelation(
    name: string,
    relation: Relation,
    options: {
        base?: WireRelation;
        /** The relation's field is required in the form. */
        required?: boolean;
        /**
         * The foreign key is the relation's own (no column declares it), so
         * its nullability is the relation's `notNull`. A foreign key a column
         * declares states its nullability on that column.
         */
        ownsForeignKey?: boolean;
        access?: Property["access"];
    } = {}
): WireRelation {
    const { base } = options;
    const target = relationTargetSlug(relation, base?.target);
    if (!target) throw new PropertyNotAColumnError(name, `The relation "${name}" has no target table. Pick the table it points at.`);
    const access = options.access
        ? { access: compact({ read: options.access.read ? [...options.access.read] : undefined, write: options.access.write ? [...options.access.write] : undefined }) }
        : base?.access !== undefined ? { access: base.access } : {};
    const isPrivate = base?.private ? { private: true } : {};
    switch (relation.kind) {
        case "belongsTo": {
            const from = base?.kind === "belongsTo" ? base : undefined;
            return compact({
                ...from,
                kind: "belongsTo" as const,
                target,
                localKey: relation.localKey ?? from?.localKey,
                notNull: options.ownsForeignKey === false ? from?.notNull : options.required ? true : undefined,
                onDelete: relation.onDelete,
                onUpdate: relation.onUpdate,
                index: relation.index === false ? false : relation.index === true ? undefined : from?.index,
                ...access,
                ...isPrivate
            });
        }
        case "hasOne":
        case "hasMany": {
            const from = base?.kind === relation.kind ? base : undefined;
            return compact({
                ...from,
                kind: relation.kind,
                target,
                foreignKey: relation.foreignKeyOnTarget ?? from?.foreignKey,
                sourceKey: relation.sourceKey ?? from?.sourceKey,
                ...access,
                ...isPrivate
            });
        }
        case "manyToMany": {
            const from = base?.kind === "manyToMany" ? base : undefined;
            return compact({
                ...from,
                kind: "manyToMany" as const,
                target,
                through: relation.through?.table ?? from?.through,
                sourceKey: relation.through?.sourceColumn ?? from?.sourceKey,
                targetKey: relation.through?.targetColumn ?? from?.targetKey,
                onDelete: relation.onDelete,
                ...access,
                ...isPrivate
            });
        }
        case "via":
            return compact({
                kind: "via" as const,
                target,
                steps: relation.joinPath.map(step => ({ ...step })),
                cardinality: relation.cardinality,
                ...access,
                ...isPrivate
            });
    }
}

/** Whether a property is one the editor writes as a column (not a relation). */
export function isColumnProperty(property: Property): boolean {
    return property.type !== "relation";
}

/** The view-model property types a table column can be, in the type picker's order. */
export const TABLE_PROPERTY_TYPES: readonly Property["type"][] = [
    "string", "number", "boolean", "date", "map", "array", "geopoint", "vector", "binary", "relation"
];

/** Narrowings the module's callers need without importing the property types. */
export type { ArrayProperty, DateProperty, MapProperty, NumberProperty, StringProperty };
