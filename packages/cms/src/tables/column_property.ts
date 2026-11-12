/**
 * One column of a {@link TableDescriptor} as the panel's view-model property.
 *
 * Every column type picks a property the panel already has a field for — the
 * widget is then chosen by `getDefaultFieldId` exactly as it is for an
 * authored collection. Nothing here adds a widget; it only states the facts the
 * existing widgets read (`enum`, `storage`, `columnType`, `validation`, `isId`,
 * `autoValue`, `admin.readOnly`, …).
 */
import type {
    ArrayProperty,
    ColumnDescriptor,
    ColumnElementDescriptor,
    ColumnStorage,
    ColumnType,
    ColumnValidation,
    DateProperty,
    DatePropertyValidationSchema,
    EnumValueConfig,
    JsonShape,
    MapProperty,
    NumberProperty,
    NumberPropertyValidationSchema,
    PostgresProperty,
    Properties,
    Property,
    StorageConfig,
    StringProperty,
    StringPropertyValidationSchema,
    VectorDistance,
    VectorIndexConfig,
    VectorMetric,
    VectorProperty
} from "@rebasepro/types";
import { CHIP_COLORS, CHIP_SEED_KEYS, getColorSchemeForSeed } from "@rebasepro/ui";
import { enumValueLabel, labelFromIdentifier } from "@rebasepro/utils";

/**
 * What a column's projection needs to know about the table around it.
 */
export interface ColumnProjectionContext {
    /** The keys of the primary-key columns. */
    primaryKey: readonly string[];
    /** The key of the tenant column, when rows are scoped to a tenant. */
    tenantField?: string;
}

// ── Enum values ──────────────────────────────────────────────────────────────

/**
 * The chip colour a value is drawn with when nobody chose one.
 *
 * The same seeded pick the chip kit makes on its own (`getColorSchemeForSeed`),
 * named by its key so it survives serialization and can be read back. Seeded
 * by the value alone: the same value has the same colour on every load,
 * whatever its position among its siblings or which other values exist.
 */
export function enumValueColor(value: string | number): EnumValueConfig["color"] {
    const scheme = getColorSchemeForSeed(String(value));
    return CHIP_SEED_KEYS.find(key => CHIP_COLORS[key] === scheme);
}

/**
 * A closed set of values as select options: each labelled from its identifier
 * (`needs_review` → "Needs Review") and coloured from {@link enumValueColor}.
 */
export function enumValuesFrom(values: readonly (string | number)[]): EnumValueConfig[] {
    return values.map(value => ({
        id: value,
        label: enumValueLabel(value),
        color: enumValueColor(value)
    }));
}

// ── Validation ───────────────────────────────────────────────────────────────

function stringValidation(rules: ColumnValidation | undefined, length?: number): StringPropertyValidationSchema {
    const out: StringPropertyValidationSchema = {};
    if (typeof rules?.min === "number") out.min = rules.min;
    if (typeof rules?.max === "number") out.max = rules.max;
    else if (length !== undefined) out.max = length;
    if (rules?.length !== undefined) out.length = rules.length;
    if (rules?.matches !== undefined) {
        out.matches = rules.matchesFlags ? new RegExp(rules.matches, rules.matchesFlags) : rules.matches;
    }
    if (rules?.matchesMessage !== undefined) out.matchesMessage = rules.matchesMessage;
    if (rules?.trim) out.trim = true;
    if (rules?.lowercase) out.lowercase = true;
    if (rules?.uppercase) out.uppercase = true;
    return out;
}

function numberValidation(rules: ColumnValidation | undefined, integer: boolean): NumberPropertyValidationSchema {
    const out: NumberPropertyValidationSchema = {};
    if (typeof rules?.min === "number") out.min = rules.min;
    if (typeof rules?.max === "number") out.max = rules.max;
    if (rules?.lessThan !== undefined) out.lessThan = rules.lessThan;
    if (rules?.moreThan !== undefined) out.moreThan = rules.moreThan;
    if (rules?.positive) out.positive = true;
    if (rules?.negative) out.negative = true;
    if (integer || rules?.integer) out.integer = true;
    return out;
}

function dateBound(bound: number | string | undefined): Date | undefined {
    if (typeof bound !== "string") return undefined;
    const date = new Date(bound);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateValidation(rules: ColumnValidation | undefined): DatePropertyValidationSchema {
    const out: DatePropertyValidationSchema = {};
    const min = dateBound(rules?.min);
    const max = dateBound(rules?.max);
    if (min) out.min = min;
    if (max) out.max = max;
    return out;
}

/** Drop the keys a builder left `undefined`, so a property states only what it holds. */
function compact<T extends object>(value: T): T {
    for (const key of Object.keys(value)) {
        if (Reflect.get(value, key) === undefined) Reflect.deleteProperty(value, key);
    }
    return value;
}

/** A validation block, or nothing when it holds no rule. */
function nonEmpty<T extends object>(rules: T): T | undefined {
    return Object.keys(compact(rules)).length > 0 ? rules : undefined;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * A column's storage rules as the upload field's configuration: the bucket,
 * the path, what is accepted and how large, and how images are resized. The
 * browser-only options (`processFile`, `previewUrl`, function-valued paths)
 * are `customizeTable`'s to add.
 */
export function storageConfigFrom(storage: ColumnStorage): StorageConfig {
    return compact<StorageConfig>({
        storagePath: storage.path,
        storageSource: storage.source,
        acceptedFiles: storage.accept ? [...storage.accept] : undefined,
        maxSize: storage.maxBytes,
        imageResize: storage.imageResize ? { ...storage.imageResize } : undefined,
        public: storage.public,
        fileName: storage.fileName,
        metadata: storage.metadata ? { ...storage.metadata } : undefined,
        includeBucketUrl: storage.includeBucketUrl,
        storeUrl: storage.storeUrl
    });
}

/** Whether a storage rule accepts images (and so previews as one). */
export function acceptsImages(storage: ColumnStorage | undefined): boolean {
    return Boolean(storage?.accept?.some(type => type.toLowerCase().startsWith("image/")));
}

// ── Scalars by column type ───────────────────────────────────────────────────

const INTEGER_KINDS: ReadonlySet<ColumnType["kind"]> = new Set([
    "smallint", "integer", "bigint", "smallserial", "serial", "bigserial"
]);

const SERIAL_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["smallserial", "serial", "bigserial"]);

function numberColumnType(type: ColumnType): NumberProperty["columnType"] {
    switch (type.kind) {
        case "smallint":
        case "integer": return "integer";
        case "bigint": return "bigint";
        case "smallserial":
        case "serial": return "serial";
        case "bigserial": return "bigserial";
        case "real": return "real";
        case "doublePrecision": return "double precision";
        case "numeric": return "numeric";
        default: return undefined;
    }
}

function stringColumnType(type: ColumnType): StringProperty["columnType"] {
    switch (type.kind) {
        case "text": return "text";
        case "varchar": return "varchar";
        case "char": return "char";
        case "uuid": return "uuid";
        default: return undefined;
    }
}

function arrayColumnType(of: ColumnType): ArrayProperty["columnType"] {
    switch (of.kind) {
        case "text":
        case "varchar": return "text[]";
        case "smallint":
        case "integer":
        case "bigint": return "integer[]";
        case "boolean": return "boolean[]";
        case "numeric": return "numeric[]";
        default: return undefined;
    }
}

const VECTOR_DISTANCE: Readonly<Record<VectorMetric, VectorDistance>> = {
    cosine: "cosine",
    l2: "l2",
    ip: "inner_product"
};

function vectorIndexFrom(index: ColumnDescriptor["vectorIndex"]): VectorIndexConfig | false | undefined {
    if (index === undefined || index === false) return index;
    const metric = index.metric;
    const distance = metric === undefined
        ? undefined
        : typeof metric === "string" ? VECTOR_DISTANCE[metric] : metric.map(m => VECTOR_DISTANCE[m]);
    return compact<VectorIndexConfig>({
        method: index.method,
        distance,
        m: index.m,
        efConstruction: index.efConstruction,
        lists: index.lists
    });
}

/** The facts of a column (or of an array's items) that decide what its values are. */
interface ValueFacts {
    validate?: ColumnValidation;
    oneOf?: readonly (string | number)[];
    storage?: ColumnStorage;
    json?: JsonShape;
    semantic?: "geopoint";
    vectorIndex?: ColumnDescriptor["vectorIndex"];
    element?: ColumnElementDescriptor;
}

/**
 * What a value of one column type is, before the column's own facts
 * (nullability, defaults, access, …) are applied. Also used for the items of
 * an array column, with the item's rules.
 */
function valueProperty(
    type: ColumnType,
    facts: ValueFacts
): PostgresProperty {
    const { validate, oneOf, storage } = facts;
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "uuid":
        case "other": {
            const length = type.kind === "varchar" || type.kind === "char" ? type.length : undefined;
            return compact<StringProperty>({
                type: "string",
                columnType: stringColumnType(type),
                validation: nonEmpty(stringValidation(validate, length)),
                enum: oneOf ? enumValuesFrom(oneOf) : undefined,
                storage: storage ? storageConfigFrom(storage) : undefined,
                email: validate?.email ? true : undefined,
                url: validate?.url ? true : undefined
            });
        }
        case "enum":
            return compact<StringProperty>({
                type: "string",
                enum: enumValuesFrom(type.values)
            });
        case "smallint":
        case "integer":
        case "bigint":
        case "smallserial":
        case "serial":
        case "bigserial":
        case "real":
        case "doublePrecision":
        case "numeric":
            return compact<NumberProperty>({
                type: "number",
                columnType: numberColumnType(type),
                precision: type.kind === "numeric" ? type.precision : undefined,
                scale: type.kind === "numeric" ? type.scale : undefined,
                validation: nonEmpty(numberValidation(validate, INTEGER_KINDS.has(type.kind))),
                enum: oneOf ? enumValuesFrom(oneOf) : undefined
            });
        case "boolean":
            return { type: "boolean" };
        case "timestamptz":
            return compact<DateProperty>({ type: "date", columnType: "timestamp", mode: "date_time", validation: nonEmpty(dateValidation(validate)) });
        case "date":
            return compact<DateProperty>({ type: "date", columnType: "date", mode: "date", validation: nonEmpty(dateValidation(validate)) });
        case "time":
            return compact<DateProperty>({ type: "date", columnType: "time", validation: nonEmpty(dateValidation(validate)) });
        case "json":
        case "jsonb":
            if (facts.semantic === "geopoint") return { type: "geopoint" };
            return jsonColumnProperty(type.kind, facts.json);
        case "vector":
            return compact<VectorProperty>({ type: "vector", dimensions: type.dimensions, index: vectorIndexFrom(facts.vectorIndex) });
        case "bytea":
            return { type: "binary" };
        case "array":
            return arrayProperty(type.of, facts);
    }
}

function arrayProperty(of: ColumnType, facts: ValueFacts): ArrayProperty {
    const element = facts.element;
    // `col.storage().multiple()` states its storage on the column; an array of
    // storage items states it on the element. Either way each item is a file.
    const itemStorage = element?.storage ?? facts.storage;
    const item = valueProperty(of, { validate: element?.validate, oneOf: element?.oneOf, storage: itemStorage });
    return compact<ArrayProperty>({
        type: "array",
        columnType: arrayColumnType(of),
        of: item,
        validation: nonEmpty({
            min: facts.validate?.minItems,
            max: facts.validate?.maxItems,
            uniqueInArray: facts.validate?.uniqueItems ? true : undefined
        })
    });
}

// ── JSON documents ───────────────────────────────────────────────────────────

/** The free-form JSON editor: what a document with no known shape is edited with. */
function freeFormJson(columnType?: MapProperty["columnType"]): MapProperty {
    return compact<MapProperty>({ type: "map", columnType, keyValue: true });
}

function jsonColumnProperty(kind: "json" | "jsonb", shape: JsonShape | undefined): PostgresProperty {
    if (!shape) return freeFormJson(kind);
    const property = jsonNodeProperty(shape);
    if (property.type === "map" || (property.type === "array" && property.columnType === undefined)) {
        property.columnType = kind;
    }
    return property;
}

function nodeDefault<T>(value: unknown, guard: (v: unknown) => v is T): T | undefined {
    return guard(value) ? value : undefined;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

function nodeProperties(fields: Record<string, JsonShape>): { properties: Properties; propertiesOrder: string[] } {
    const properties: Properties = {};
    for (const [key, field] of Object.entries(fields)) {
        properties[key] = { ...jsonNodeProperty(field), name: labelFromIdentifier(key) };
    }
    return { properties, propertiesOrder: Object.keys(fields) };
}

/**
 * One node of a JSON shape as a property: an object is a group of fields, an
 * array repeats its item, a `oneOf` inside an array is a list of typed blocks,
 * and the leaves are the same fields a column of that type gets.
 */
export function jsonNodeProperty(node: JsonShape): PostgresProperty {
    const base = {
        description: node.description,
        validation: node.required ? { required: true } : undefined
    };
    switch (node.kind) {
        case "string":
            return compact<StringProperty>({
                ...base,
                type: "string",
                validation: nonEmpty({ ...stringValidation(node.validate), ...base.validation }),
                enum: node.oneOf ? enumValuesFrom(node.oneOf) : undefined,
                storage: node.storage ? storageConfigFrom(node.storage) : undefined,
                email: node.validate?.email ? true : undefined,
                url: node.validate?.url ? true : undefined,
                defaultValue: nodeDefault(node.default, isString)
            });
        case "number":
            return compact<NumberProperty>({
                ...base,
                type: "number",
                validation: nonEmpty({ ...numberValidation(node.validate, false), ...base.validation }),
                enum: node.oneOf ? enumValuesFrom(node.oneOf) : undefined,
                defaultValue: nodeDefault(node.default, isNumber)
            });
        case "boolean":
            return compact({ ...base, type: "boolean" as const, defaultValue: nodeDefault(node.default, isBoolean) });
        case "date": {
            const stamped = node.stamp !== undefined;
            return compact<DateProperty>({
                ...base,
                type: "date",
                mode: "date_time",
                validation: nonEmpty({ ...dateValidation(node.validate), ...base.validation }),
                autoValue: node.stamp === "create" ? "on_create" : node.stamp === "update" ? "on_update" : undefined,
                admin: stamped ? { readOnly: true } : undefined
            });
        }
        case "geopoint":
            return compact({ ...base, type: "geopoint" as const });
        case "object": {
            const { properties, propertiesOrder } = nodeProperties(node.fields);
            return compact<MapProperty>({
                ...base,
                type: "map",
                properties,
                propertiesOrder,
                defaultValue: nodeDefault(node.default, isRecord)
            });
        }
        case "array": {
            const item = node.of;
            const validation = nonEmpty({
                ...base.validation,
                min: node.validate?.minItems,
                max: node.validate?.maxItems,
                uniqueInArray: node.validate?.uniqueItems ? true : undefined
            });
            if (item.kind === "oneOf") {
                const { properties, propertiesOrder } = nodeProperties(item.variants);
                return compact<ArrayProperty>({
                    ...base,
                    type: "array",
                    validation,
                    oneOf: { properties, propertiesOrder, typeField: item.typeField, valueField: item.valueField },
                    defaultValue: nodeDefault(node.default, isArray)
                });
            }
            return compact<ArrayProperty>({
                ...base,
                type: "array",
                validation,
                of: jsonNodeProperty(item),
                defaultValue: nodeDefault(node.default, isArray)
            });
        }
        case "oneOf":
        case "unknown":
            // A single typed block outside a list, and a value of any shape,
            // have no structured field; the free-form editor keeps them editable.
            return compact<MapProperty>({ ...freeFormJson(), ...base });
    }
}

// ── The column ───────────────────────────────────────────────────────────────

function isTimeStampable(property: Property): property is DateProperty {
    return property.type === "date";
}

/**
 * The id strategy of a primary-key column: `uuid` for `gen_random_uuid()`,
 * `increment` for identity and serial columns, `true` for any other generated
 * default, `manual` when the value is typed in.
 */
function idStrategy(column: ColumnDescriptor): "uuid" | "increment" | "manual" | true {
    const fallback = column.default;
    if (SERIAL_KINDS.has(column.type.kind) || fallback?.kind === "identity") return "increment";
    if (fallback?.kind === "random-uuid") return "uuid";
    if (fallback?.kind === "sql" || fallback?.kind === "database") return true;
    return "manual";
}

function applyId(property: Property, strategy: "uuid" | "increment" | "manual" | true): void {
    switch (property.type) {
        case "string":
        case "number":
            property.isId = strategy;
            return;
        case "date":
            property.isId = strategy === "manual" ? "manual" : true;
            return;
        default:
            return;
    }
}

/** A literal DEFAULT as the value a new record's form opens with. */
function applyLiteralDefault(property: Property, value: unknown): void {
    switch (property.type) {
        case "string":
            if (isString(value) && (!property.enum || enumHas(property.enum, value))) property.defaultValue = value;
            return;
        case "number":
            if (isNumber(value)) property.defaultValue = value;
            return;
        case "boolean":
            if (isBoolean(value)) property.defaultValue = value;
            return;
        case "date": {
            if (!isString(value) && !isNumber(value)) return;
            const date = new Date(value);
            if (!Number.isNaN(date.getTime())) property.defaultValue = date;
            return;
        }
        case "map":
            if (isRecord(value)) property.defaultValue = { ...value };
            return;
        case "array":
            if (isArray(value)) property.defaultValue = [...value];
            return;
        default:
            return;
    }
}

function enumHas(values: StringProperty["enum"], value: string): boolean {
    return Array.isArray(values) ? values.some(entry => entry.id === value) : true;
}

function applyStamp(property: Property, stamp: NonNullable<ColumnDescriptor["stamp"]>): void {
    if (stamp.value === "now" && isTimeStampable(property)) {
        property.autoValue = stamp.on === "create" ? "on_create" : "on_update";
        // The record block shows both audit dates; a table column of them is noise.
        property.admin = { ...property.admin, readOnly: true, hideFromCollection: true };
        return;
    }
    if (stamp.value === "user" && property.type === "string") {
        property.autoValue = stamp.on === "create" ? "user_on_create" : "user_on_update";
    }
    property.admin = { ...property.admin, readOnly: true };
}

/**
 * A column as a property, or `undefined` for a column that must not reach the
 * panel (`private`: the server never serves one, and one that slips through is
 * dropped here rather than rendered).
 *
 * - `nullable: false` is `validation.required`, except where nobody types the
 *   value: a generated id, a stamp, a generated or read-only column.
 * - A DEFAULT keeps the column required on edit and lets a create leave it out:
 *   a literal opens the form with the value, anything else is `databaseDefault`.
 * - `readOnly`, `generated` and stamps are read-only in the form; time stamps
 *   are also left out of the default table columns.
 * - The tenant column is filled by the server on create (`filledByServer`) and
 *   left out of the default table columns. It stays editable: a caller in a
 *   bypass role creates rows in a tenant they name.
 */
export function propertyFromColumn(column: ColumnDescriptor, context: ColumnProjectionContext): PostgresProperty | undefined {
    if (column.private) return undefined;

    const property = valueProperty(column.type, {
        validate: column.validate,
        oneOf: column.oneOf,
        storage: column.storage,
        json: column.json,
        semantic: column.semantic,
        vectorIndex: column.vectorIndex,
        element: column.element
    });
    property.name = labelFromIdentifier(column.key);
    if (column.description) property.description = column.description;
    if (column.key !== column.column) property.columnName = column.column;
    if (column.access) {
        property.access = compact({
            read: column.access.read ? [...column.access.read] : undefined,
            write: column.access.write ? [...column.access.write] : undefined
        });
    }

    const isKey = context.primaryKey.includes(column.key);
    const strategy = isKey ? idStrategy(column) : undefined;
    if (strategy !== undefined) applyId(property, strategy);
    const generatedKey = strategy !== undefined && strategy !== "manual";

    const writtenByServer = Boolean(column.readOnly || column.generated || column.stamp);
    if (column.stamp) applyStamp(property, column.stamp);
    if (column.readOnly || column.generated) property.admin = { ...property.admin, readOnly: true };

    const fallback = column.default;
    if (fallback && !generatedKey) {
        if (fallback.kind === "literal") applyLiteralDefault(property, fallback.value);
        else property.databaseDefault = fallback.kind === "sql" ? `sql\`${fallback.expression}\`` : true;
    }

    const validation: { required?: boolean; requiredMessage?: string; unique?: boolean } = {};
    if (!column.nullable && !generatedKey && !writtenByServer) validation.required = true;
    if (validation.required && column.validate?.requiredMessage) validation.requiredMessage = column.validate.requiredMessage;
    if (column.unique && !isKey) validation.unique = true;
    if (Object.keys(validation).length > 0) {
        property.validation = { ...property.validation, ...validation };
    }

    if (context.tenantField === column.key) {
        property.admin = { ...property.admin, filledByServer: true, hideFromCollection: true };
    }

    return compact(property);
}
