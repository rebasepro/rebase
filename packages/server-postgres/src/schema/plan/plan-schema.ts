/**
 * The only place a `Property` is read for schema purposes.
 *
 * Everything that used to `switch (prop.type)` — the Drizzle generator, the DDL
 * generator, the boot-time ensure — now renders the {@link SchemaPlan} this
 * produces. See `./types.ts` for why.
 *
 * Pure and synchronous. It reads collections and nothing else: no database, no
 * filesystem, no process-wide registry. The one fact about the world it needs
 * (which extensions a project's databases gave Rebase leave to install) is
 * passed in, because a plan that depended on whatever module happened to be
 * imported would not be comparable with itself.
 *
 * It **throws** rather than guessing. A configuration no renderer can honour —
 * an empty enum, `isId: "cuid"`, a foreign key into a composite key, an unknown
 * `columnType`, a relation to a collection that is not in the bundle, a
 * `search` block on a collection Postgres does not store — used to fail
 * differently in each of the three emitters, or not at all, and the failure
 * landed at `CREATE TABLE` time on a managed tenant with nobody in the loop.
 * Here it lands once, with the collection and the property named.
 */
import {
    isPostgresCollectionConfig,
    isManyToMany,
    REBASE_SCHEMA,
    type ArrayProperty,
    type CollectionConfig,
    type DateProperty,
    type MapProperty,
    type NumberProperty,
    type Properties,
    type Property,
    type ReferenceProperty,
    type RelationProperty,
    type ResolvedForeignKeyOnTarget,
    type ResolvedRelation,
    type SecurityRule,
    type StringProperty,
    type VectorProperty,
    type ColumnDef,
    type ColumnType,
    type CompiledTable,
    type TableDescriptor,
    hasForeignKeyOnTarget
} from "@rebasepro/types";
import {
    fieldKeyForColumn,
    findRelation,
    getEffectiveSecurityRules,
    getEnumVarName,
    getInjectedSecurityRules,
    getTenantConfig,
    tenantBypassRoles,
    TENANT_INDEX_REASON,
    getJunctionCollectionConfig,
    getJunctionSecurityRules,
    getTableName,
    type JunctionSpec,
    getTableVarName,
    compileRulePolicies,
    relationalCollections,
    resolveCollectionRelations,
    resolveJunctionSpecs,
    assertBeforeQueryIsPostgresOnly,
    resolveStringColumnLength,
    customSqlTypeProblem,
    declaredSchemaOf
} from "@rebasepro/common";
import {
    generateForeignKeyName,
    getPolicySupersededNames,
    legacyForeignKeyName,
    toPostgresIdentifier,
    toSnakeCase
} from "@rebasepro/utils";
import {
    declaresEnumType,
    enumLabelsOf,
    getPrimaryKeyColumn,
    getPrimaryKeyName,
    getPrimaryKeyProp,
    idColumnDefault,
    isIdProperty,
    primaryKeyPropertyNames,
    resolveColumnName,
    sqlExpressionText
} from "../column-plan-helpers";
import {
    AUTH_USERS_COLUMNS,
    authUsersColumnDefinition,
    authUsersColumnSql,
    isAuthCollection
} from "../auth-users-columns";
import {
    assertSearchIsPostgresOnly,
    buildSearchColumnSpec,
    searchColumnTypeSql,
    searchExtensionStatements,
    searchHelperFunctions
} from "../search-column";
import {
    buildVectorColumnSpecs,
    buildVectorIndexPlan,
    vectorExtensionDeclared,
    vectorExtensionStatement
} from "../vector-index";
import {
    buildCollectionIndexSpecs,
    collectionIndexStatement,
    deriveIndexName,
    foreignKeyIndexSpec,
    leadsWithColumn,
    type CollectionIndexSpec
} from "../collection-index";
import { createHash } from "node:crypto";
import { sharedRelationName } from "../relation-names";
import { SET_UPDATED_AT_FN, setUpdatedAtFunction } from "./updated-at-trigger";
import { keepTenantFunction, keepTenantTriggerName } from "./tenant-keep-trigger";
import { DEFAULT_VIEW_ROLES, viewRowsName } from "./view-names";
import { tableBelongsToOf, tableColumnOf } from "./table-input";
import { lowerCompiledTables } from "../lowered-tables";
import type {
    ColumnDefault,
    ColumnPlan,
    EnumPlan,
    ForeignKeyPlan,
    PgType,
    PlanOptions,
    PolicyPlan,
    RelationPlan,
    SchemaPlan,
    TablePlan,
    TriggerPlan,
    ViewPlan
} from "./types";

type ResolveCollection = (slug: string) => CollectionConfig | undefined;

/**
 * Single-quote escaping for a SQL string literal (PostgreSQL doubles the
 * quote). Enum labels and `defaultValue`s come straight from user-authored
 * collection config, so a value like `it's` closes the literal early and the
 * whole generated file stops parsing at that statement.
 */
export const quoteSqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const schemaOf = (collection: CollectionConfig): string =>
    isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";

const bareTableName = (name: string): string => (name.includes(".") ? name.split(".").pop()! : name);

const describe = (collection: CollectionConfig): string =>
    collection.slug ?? collection.name ?? "(unnamed)";

/** A link, as a refusal names it: `relation "posts.author"`. */
const linkLabel = (kind: string, collection: CollectionConfig, key: string): string =>
    `${kind} "${describe(collection)}.${key}"`;

/**
 * The `ON DELETE` a foreign key gets when the author did not say.
 *
 * One rule for every property that emits one — `belongsTo` relations and
 * `reference` properties alike. `reference` kept its own `CASCADE` default for
 * a release after this rule was written, which is exactly the split this
 * function exists to prevent: two spellings of the same link, two
 * data-retention behaviours, and only one of them documented.
 *
 * An optional link is `SET NULL`: the column can hold NULL, so dropping the
 * parent leaves the child row with an empty pointer, which is what "optional"
 * already means.
 *
 * A required link is **`RESTRICT`**, not `CASCADE`. `NOT NULL` says the child
 * cannot exist without a parent; it does not say deleting the parent should
 * take the child with it. That second claim is a data-retention decision, and
 * defaulting to it meant `onDelete` — a field nobody has to write — silently
 * turned every `DELETE FROM authors` into a cascade through posts, comments and
 * anything else that hung off them.
 */
export const defaultBelongsToOnDelete = (required: boolean | undefined): "RESTRICT" | "SET NULL" =>
    required ? "RESTRICT" : "SET NULL";

const foreignKeyPlan = (
    args: Omit<ForeignKeyPlan, "constraintName" | "sql">
): ForeignKeyPlan => {
    const constraintName = toPostgresIdentifier(`${args.table}_${args.column}_fkey`);
    const onUpdate = args.onUpdate ? ` ON UPDATE ${args.onUpdate.toUpperCase()}` : "";
    return {
        ...args,
        constraintName,
        sql:
            `ALTER TABLE "${args.schema}"."${args.table}" ADD CONSTRAINT "${constraintName}" ` +
            `FOREIGN KEY ("${args.column}") REFERENCES "${args.targetSchema}"."${args.targetTable}" ` +
            `("${args.targetColumn}") ON DELETE ${args.onDelete.toUpperCase()}${onUpdate}`
    };
};

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The type a column pointing at this collection's primary key must have — a
 * junction endpoint, a `belongsTo` foreign key, a `reference`.
 *
 * The key's own column type, from the same functions that typed the key: a
 * foreign key only holds between compatible types, so any second reading of
 * the key is a constraint waiting to fail. This used to look at the id
 * strategy alone, so `id: { isId: true, columnType: "uuid" }` was referenced by
 * TEXT columns (42804 — the constraint was never created) and a `bigint` key by
 * INTEGER ones, which overflow at 2^31.
 *
 * One exception: a `serial` key owns a sequence, and a column pointing at it is
 * the plain integer of the same width — `SERIAL` there would give every
 * referencing column a sequence of its own.
 *
 * @param via the link asking, named if the collection's key is composite and so
 *   cannot be pointed at — see `getPrimaryKeyProp`.
 */
export const primaryKeyPgType = (collection: CollectionConfig, via: string): PgType => {
    const { name, prop } = getPrimaryKeyProp(collection, via);
    const definition = prop?.type === "relation" ? undefined : tableColumnOf(prop);
    if (definition) {
        return withoutSequence(definedPgType(definition, { collection, propName: name, column: definedColumnName(name, definition) }));
    }
    if (prop?.type === "number") {
        return withoutSequence(numberType(name, prop as NumberProperty, collection, true));
    }
    if (prop?.type === "string") return stringType(name, prop as StringProperty, collection);
    // The implicit `id TEXT PRIMARY KEY` of a collection that declares no key.
    return { kind: "text" };
};

/**
 * The DEFAULT of the implicit `id TEXT PRIMARY KEY` a collection that declares
 * no key gets: a uuid, as text. The same generator `isId: "uuid"` uses, cast to
 * the column the key has always been.
 */
export const IMPLICIT_ID_DEFAULT = "gen_random_uuid()::text";

const withoutSequence = (type: PgType): PgType => {
    switch (type.kind) {
        case "smallserial": return { kind: "smallint" };
        case "serial": return { kind: "integer" };
        case "bigserial": return { kind: "bigint" };
        default: return type;
    }
};

/** The `columnType`s a `number` property may name, and what each one is. */
const NUMBER_COLUMN_TYPES: Record<string, PgType> = {
    "integer": { kind: "integer" },
    // `smallint` and `smallserial` are not in `NumberProperty["columnType"]`'s
    // union, and both have always reached the database: the DDL generator
    // upper-cased whatever it was given. Accepted here for that reason and
    // listed on purpose — the point of this table is that an unrecognised
    // `columnType` is refused with the property named rather than passed
    // through to fail at `CREATE TABLE`.
    "smallint": { kind: "smallint" },
    "smallserial": { kind: "smallserial" },
    "bigint": { kind: "bigint" },
    "serial": { kind: "serial" },
    "bigserial": { kind: "bigserial" },
    "real": { kind: "real" },
    "double precision": { kind: "doublePrecision" },
    "numeric": { kind: "numeric" }
};

const numberType = (propName: string, prop: NumberProperty, collection: CollectionConfig, isId: boolean): PgType => {
    // An identity column is INTEGER, and `columnType` is not read beside it, on
    // purpose: it is the type every identity key in the field was created with,
    // and every column pointing at one takes it too (`primaryKeyPgType`). The
    // Drizzle generator used to honour `columnType` here while the DDL one
    // ignored it, so the same property was int8 in `schema.generated.ts` and
    // int4 in the database; with `columnType: "bigserial"` the emitted
    // `.generatedByDefaultAsIdentity()` is not a method that exists, so the file
    // did not compile at all.
    if (prop.isId === "increment") return { kind: "integer" };
    if (prop.columnType) {
        const mapped = NUMBER_COLUMN_TYPES[prop.columnType];
        if (!mapped) {
            throw new Error(
                `Property "${propName}" of collection "${describe(collection)}" declares ` +
                `\`columnType: "${prop.columnType}"\`, which is not a Postgres numeric type Rebase emits. ` +
                `Use one of: ${Object.keys(NUMBER_COLUMN_TYPES).join(", ")}.`
            );
        }
        if (mapped.kind === "numeric") return numericType(prop);
        return mapped;
    }
    if (prop.validation?.integer || isId) return { kind: "integer" };
    return numericType(prop);
};

/** `NUMERIC`, with the precision and scale the property asks for. */
const numericType = (prop: NumberProperty): PgType => {
    const { precision, scale } = prop;
    if (precision === undefined) return { kind: "numeric" };
    return scale === undefined
        ? { kind: "numeric", precision }
        : { kind: "numeric", precision, scale };
};

const stringType = (propName: string, prop: StringProperty, collection: CollectionConfig): PgType => {
    if (prop.enum) {
        // Throws on an empty list rather than naming a type nothing creates —
        // the column type and the `CREATE TYPE` come from one reading of `enum`.
        const labels = enumLabelsOf(propName, prop as Property, collection);
        const table = getTableName(collection);
        const column = resolveColumnName(propName, prop as Property);
        return {
            kind: "enum",
            schema: schemaOf(collection),
            name: `${table}_${column}`,
            varName: getEnumVarName(table, propName),
            labels
        };
    }
    if (prop.isId === "uuid" || prop.columnType === "uuid") return { kind: "uuid" };
    // The width comes from `validation.max` when the property states one. It
    // used to be a hardcoded 255 in the DDL generator and *absent* on the
    // Drizzle path, so the same property produced a bounded column down one
    // generator and an unbounded one down the other.
    if (prop.columnType === "char") return { kind: "char", length: resolveStringColumnLength(prop) };
    if (prop.columnType === "varchar") return { kind: "varchar", length: resolveStringColumnLength(prop) };
    if (prop.columnType !== undefined && prop.columnType !== "text") {
        throw new Error(
            `Property "${propName}" of collection "${describe(collection)}" declares ` +
            `\`columnType: "${String(prop.columnType)}"\`, which is not a Postgres string type Rebase emits. ` +
            "Use one of: text, varchar, char, uuid."
        );
    }
    // `text` is the default, and the only length-unbounded choice.
    return { kind: "text" };
};

const arrayElementType = (prop: ArrayProperty): PgType | undefined => {
    let colType = prop.columnType;
    if (!colType && prop.of && !Array.isArray(prop.of)) {
        const of = prop.of as Property;
        if (of.type === "string") colType = "text[]";
        else if (of.type === "number") colType = of.validation?.integer ? "integer[]" : "numeric[]";
        else if (of.type === "boolean") colType = "boolean[]";
    }
    switch (colType) {
        case "text[]": return { kind: "text" };
        case "integer[]": return { kind: "integer" };
        case "boolean[]": return { kind: "boolean" };
        case "numeric[]": return { kind: "numeric" };
        default: return undefined;
    }
};

/**
 * The Postgres type a property's column has.
 *
 * Every member of `DataType` has an arm. A type this does not know is a
 * generator that has not been taught it yet, and it says so — a silent `TEXT`
 * here is how `geopoint` ended up with a database column, no Drizzle key, and
 * every write to it discarded with a 201.
 */
export const columnPgType = (
    propName: string,
    prop: Property,
    collection: CollectionConfig,
    resolveCollection: ResolveCollection
): PgType => {
    // A link is typed by what it points at, whatever column it absorbed.
    const definition = prop.type === "relation" ? undefined : tableColumnOf(prop);
    if (definition) return definedPgType(definition, { collection, propName, column: definedColumnName(propName, definition) });
    switch (prop.type) {
        case "string":
            return stringType(propName, prop as StringProperty, collection);
        case "number":
            return numberType(propName, prop as NumberProperty, collection, isIdProperty(propName, prop, collection));
        case "boolean":
            return { kind: "boolean" };
        case "date": {
            const dateProp = prop as DateProperty;
            if (dateProp.columnType === "date") return { kind: "date" };
            if (dateProp.columnType === "time") return { kind: "time" };
            return { kind: "timestamptz" };
        }
        case "map":
            return (prop as MapProperty).columnType === "json" ? { kind: "json" } : { kind: "jsonb" };
        // `{ latitude, longitude }` — a document, like `map`.
        case "geopoint":
            return { kind: "jsonb" };
        case "array": {
            const arrayProp = prop as ArrayProperty;
            if (arrayProp.columnType === "json") return { kind: "json" };
            const element = arrayElementType(arrayProp);
            return element ? { kind: "array", of: element } : { kind: "jsonb" };
        }
        case "vector":
            return { kind: "vector", dimensions: (prop as VectorProperty).dimensions };
        case "binary":
            return { kind: "bytea" };
        case "relation":
        case "reference": {
            const target = linkTarget(propName, prop, collection, resolveCollection);
            return target ? primaryKeyPgType(target, linkLabel(prop.type, collection, propName)) : { kind: "text" };
        }
        default:
            throw new Error(
                `No Postgres column type for property "${propName}" of type ` +
                `"${(prop as Property).type}" in collection "${describe(collection)}". ` +
                "Add a case to `columnPgType` in schema/plan/plan-schema.ts."
            );
    }
};

/** The collection a `relation` or `reference` points at, when it resolves. */
const linkTarget = (
    propName: string,
    prop: Property,
    collection: CollectionConfig,
    resolveCollection: ResolveCollection
): CollectionConfig | undefined => {
    if (prop.type === "reference") {
        const path = (prop as ReferenceProperty).path;
        return path ? resolveCollection(path) : undefined;
    }
    const relProp = prop as RelationProperty;
    const relation = findRelation(resolveCollectionRelations(collection), relProp.relation?.relationName ?? propName);
    if (relation?.kind !== "belongsTo") return undefined;
    try {
        return relation.target();
    } catch {
        return undefined;
    }
};

// ── Defaults ─────────────────────────────────────────────────────────────────

/** A value already written as a day, or as a time of day. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BARE_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * A date default in the shape its column's type accepts: a day for `date`, a
 * time of day for `time`, an instant for a timestamp.
 *
 * Rendered as a full ISO timestamp whatever the column, a `time` column's
 * DEFAULT was `'2024-03-01T15:30:00.000Z'`, which Postgres refuses — "invalid
 * input syntax for type time" — so the schema would not apply. A value already
 * written in the column's shape (`"2024-12-25"`, `"09:00"`) is kept as written;
 * anything else is read as an instant and its UTC day or time of day taken, the
 * same zone the timestamp rendering has always used. A string that is no date
 * at all is no DEFAULT, rather than a schema that cannot be applied.
 */
const dateDefaultLiteral = (value: unknown, type: PgType): string | undefined => {
    if (typeof value === "string") {
        if (type.kind === "date" && BARE_DATE.test(value)) return value;
        if (type.kind === "time" && BARE_TIME.test(value)) return value;
    }
    const instant = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
    if (!instant || Number.isNaN(instant.getTime())) return undefined;
    const iso = instant.toISOString();
    if (type.kind === "date") return iso.slice(0, 10);
    if (type.kind === "time") return iso.slice(11, 23);
    // A timestamp keeps a string default as it was written — its own offset
    // included — and a Date as the instant it is.
    return typeof value === "string" ? value : iso;
};

/**
 * A `defaultValue` as a database DEFAULT.
 *
 * `defaultValue` reached neither the schema nor — until recently — the write
 * path, so a documented, type-checked field did nothing at all: the panel
 * pre-filled it, an insert from anywhere else (the REST API, a seed, psql) did
 * not, and the column came out NULL. A DEFAULT is the one place that binds
 * every writer.
 *
 * Only literals. A `reference`'s default is an `EntityReference` object and a
 * `vector`'s is an embedding — neither is a column literal, and inventing one
 * would be a value the write path and the database disagree about.
 * `undefined` for those, which is what "no DEFAULT" means everywhere here.
 */
const literalDefault = (prop: Property, type: PgType): ColumnDefault | undefined => {
    const value = (prop as { defaultValue?: unknown }).defaultValue;
    if (value === undefined || value === null) return undefined;

    switch (prop.type) {
        case "string":
            // An enum default is its id, which is exactly the label the type
            // carries — the same string the write path stores.
            return typeof value === "string" ? { kind: "literal", value, sql: quoteSqlLiteral(value) } : undefined;
        case "number":
            return typeof value === "number" && Number.isFinite(value)
                ? { kind: "literal", value, sql: String(value) }
                : undefined;
        case "boolean":
            return typeof value === "boolean"
                ? { kind: "literal", value, sql: value ? "TRUE" : "FALSE" }
                : undefined;
        case "date": {
            const literal = dateDefaultLiteral(value, type);
            return literal === undefined ? undefined : { kind: "literal", value: literal, sql: quoteSqlLiteral(literal) };
        }
        case "map":
        case "array":
        case "geopoint": {
            // A document default is a JSON literal cast to the column's own
            // type, so `jsonb` and `json` columns each get a value Postgres
            // accepts without an implicit cast.
            if (type.kind !== "jsonb" && type.kind !== "json") return undefined;
            let json: string;
            try {
                json = JSON.stringify(value);
            } catch {
                return undefined;   // circular, or a BigInt: not a literal.
            }
            if (json === undefined) return undefined;
            return { kind: "literal", value, sql: `${quoteSqlLiteral(json)}::${type.kind}` };
        }
        default:
            return undefined;
    }
};

/**
 * The DEFAULT a column carries: id strategy, then `autoValue`, then a
 * `databaseDefault` given as SQL, then `defaultValue`.
 */
const columnDefault = (
    propName: string,
    prop: Property,
    collection: CollectionConfig,
    type: PgType
): ColumnDefault | undefined => {
    const idDefault = idColumnDefault(propName, prop, collection);
    if (idDefault) {
        if (idDefault.kind === "uuid") return { kind: "sql", expression: "gen_random_uuid()" };
        if (idDefault.kind === "identity") return { kind: "identity" };
        return { kind: "sql", expression: idDefault.expression };
    }
    if (prop.type === "date") {
        const autoValue = (prop as DateProperty).autoValue;
        if (autoValue === "on_create" || autoValue === "on_update") {
            return { kind: "sql", expression: "now()" };
        }
    }
    if (typeof prop.databaseDefault === "string") {
        const expression = sqlExpressionText(prop.databaseDefault).trim();
        if (expression) return { kind: "sql", expression };
    }
    return literalDefault(prop, type);
};

// ── Columns planned from their definition ────────────────────────────────────
//
// A property `lowerTables` produced carries the `ColumnDef` it came from, and
// its column is planned from that: the `ColumnType` is the Postgres type, the
// definition says whether it is a key, NOT NULL, UNIQUE, generated, stamped or
// defaulted. Nothing is re-derived from the document-shaped property beside it
// ("a string whose columnType is uuid"), which is what kept everything the
// legacy shape cannot say — a generated column, a non-key identity, a `uuid[]`
// — out of the planner. The legacy derivation above stays for collection
// literals written in the legacy shape.

/** Where a defined column lands: what its enum type, if any, is named after. */
interface DefinedColumnSite {
    /** The collection, or the synthetic one standing in for a junction. */
    collection: CollectionConfig;
    /** The property key — an unnamed enum's Drizzle variable is named after it. */
    propName: string;
    /** The SQL column — an unnamed enum's type is named after it. */
    column: string;
}

/** A defined column's SQL name: the one it states, or the snake_case of its key. */
const definedColumnName = (propName: string, definition: ColumnDef): string =>
    definition.column ?? toSnakeCase(propName);

/**
 * The element types a Postgres array column takes here: a scalar Rebase can
 * read and write item by item. A JSON document or a vector is already a list
 * of its own (`col.jsonb()` holds a list of documents), and a `bytea` item
 * would need a binary codec per element that nothing implements.
 */
const NON_ELEMENT_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["json", "jsonb", "vector", "bytea", "array", "other"]);

/**
 * The Postgres type a column definition states.
 *
 * One arm per {@link ColumnType} member: the two type unions are kept 1:1, so
 * this is a renaming, not a derivation. An enum is the one member that needs
 * the site — its type is named after the table and column it is declared on,
 * unless the definition names a shared type.
 */
export const definedPgType = (definition: ColumnDef, site: DefinedColumnSite): PgType =>
    pgTypeOf(definition.type, site);

const pgTypeOf = (type: ColumnType, site: DefinedColumnSite): PgType => {
    switch (type.kind) {
        case "text": return { kind: "text" };
        case "varchar": return { kind: "varchar", length: type.length };
        case "char": return { kind: "char", length: type.length };
        case "uuid": return { kind: "uuid" };
        case "enum": return definedEnumType(type, site);
        case "smallint": return { kind: "smallint" };
        case "integer": return { kind: "integer" };
        case "bigint": return { kind: "bigint" };
        case "smallserial": return { kind: "smallserial" };
        case "serial": return { kind: "serial" };
        case "bigserial": return { kind: "bigserial" };
        case "real": return { kind: "real" };
        case "doublePrecision": return { kind: "doublePrecision" };
        case "numeric":
            if (type.precision === undefined) return { kind: "numeric" };
            return type.scale === undefined
                ? { kind: "numeric", precision: type.precision }
                : { kind: "numeric", precision: type.precision, scale: type.scale };
        case "boolean": return { kind: "boolean" };
        case "timestamptz": return { kind: "timestamptz" };
        case "date": return { kind: "date" };
        case "time": return { kind: "time" };
        case "json": return { kind: "json" };
        case "jsonb": return { kind: "jsonb" };
        case "vector": return { kind: "vector", dimensions: type.dimensions };
        case "bytea": return { kind: "bytea" };
        case "array":
            if (NON_ELEMENT_KINDS.has(type.of.kind)) {
                throw new Error(
                    `Column "${site.column}" of "${describe(site.collection)}" is an array of ` +
                    `\`${type.of.kind}\`, which is not an element type Rebase stores in a Postgres array. ` +
                    "An array column holds scalars (text, uuid, numbers, booleans, dates, enums); a list of " +
                    "documents or vectors is a `col.jsonb()` column."
                );
            }
            return { kind: "array", of: pgTypeOf(type.of, site) };
        case "other": {
            // `col.custom(sqlType)`, written into DDL verbatim — so refused
            // again here, whoever built the definition, unless it is a type
            // name that cannot leave the statement.
            const problem = customSqlTypeProblem(type.sqlType);
            if (problem !== undefined) {
                throw new Error(
                    `Column "${site.column}" of "${describe(site.collection)}" is \`col.custom(${JSON.stringify(type.sqlType)})\`, ` +
                    `and that type name ${problem}. Write the Postgres type as \`format_type\` prints it.`
                );
            }
            return { kind: "custom", sqlType: type.sqlType.trim() };
        }
    }
};

/**
 * The type name an enum states when it names a shared type: its `name`, unless
 * that is exactly the `<table>_<column>` an unnamed one gets — then it is that
 * column's own type, named and declared as it always was.
 */
const sharedEnumName = (type: Extract<ColumnType, { kind: "enum" }>, table: string, column: string): string | undefined =>
    type.name !== undefined && type.name !== `${table}_${column}` ? type.name : undefined;

/**
 * The Drizzle variable of a shared enum type: one per type, whichever columns
 * use it, so it is named after the type (and its schema, outside `public`)
 * rather than after any one column. The `Enum` suffix keeps it apart from the
 * table variables, which are named after tables in the same namespace.
 */
const sharedEnumVarName = (schema: string, name: string): string =>
    `${getTableVarName(schema === "public" ? name : `${schema}_${name}`)}Enum`;

const definedEnumType = (type: Extract<ColumnType, { kind: "enum" }>, site: DefinedColumnSite): PgType => {
    const table = getTableName(site.collection);
    const schema = schemaOf(site.collection);
    // As `enumLabelsOf` reads a legacy enum: an empty label is no label, and a
    // type with none is refused rather than created empty.
    const labels = type.values.filter(label => label.length > 0);
    if (labels.length === 0) {
        throw new Error(
            `Column "${site.column}" of "${describe(site.collection)}" is an enum with no values. A Postgres enum ` +
            "type needs at least one label."
        );
    }
    const shared = sharedEnumName(type, table, site.column);
    return {
        kind: "enum",
        schema,
        name: shared ?? `${table}_${site.column}`,
        varName: shared ? sharedEnumVarName(schema, shared) : getEnumVarName(table, site.propName),
        labels
    };
};

/** The enum type a defined column's values are typed by — its own, or its items'. */
const definedEnumOf = (type: PgType): Extract<PgType, { kind: "enum" }> | undefined => {
    if (type.kind === "enum") return type;
    if (type.kind === "array" && type.of.kind === "enum") return type.of;
    return undefined;
};

/**
 * A defined column's DEFAULT.
 *
 * The precedence the legacy reading has — the key's strategy, then the time
 * stamp, then a SQL expression, then a literal — over the one `default` a
 * definition holds. `identity` is planned on any integer column now, key or
 * not, at the width the column declares. `database` plans none: the database
 * owns that default. A generated column has none at all.
 */
const definedColumnDefault = (definition: ColumnDef, type: PgType): ColumnDefault | undefined => {
    if (definition.generatedAs !== undefined) return undefined;
    const declared = definition.default;
    if (declared?.kind === "identity") return { kind: "identity" };
    if (definition.primaryKey) {
        // A key's strategy, as written: the expression is not trimmed (the
        // legacy `isId` reading never trimmed it either).
        if (declared?.kind === "random-uuid") return { kind: "sql", expression: "gen_random_uuid()" };
        if (declared?.kind === "sql") return { kind: "sql", expression: declared.expression };
    }
    if (definition.stamp?.value === "now" && (type.kind === "timestamptz" || type.kind === "date" || type.kind === "time")) {
        return { kind: "sql", expression: "now()" };
    }
    if (declared?.kind === "random-uuid") return { kind: "sql", expression: "gen_random_uuid()" };
    if (declared?.kind === "sql") {
        const expression = declared.expression.trim();
        return expression ? { kind: "sql", expression } : undefined;
    }
    if (declared?.kind !== "literal") return undefined;
    return definedLiteralDefault(declared.value, type);
};

/**
 * A literal default, as the column's type quotes it. The same spellings as
 * {@link literalDefault}, chosen by the Postgres type rather than by the
 * property's: a native array, a vector and a `bytea` take none (the driver
 * still applies the value on create), exactly as their legacy reading did.
 */
const definedLiteralDefault = (value: unknown, type: PgType): ColumnDefault | undefined => {
    if (value === undefined || value === null) return undefined;
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "uuid":
        case "enum":
            return typeof value === "string" ? { kind: "literal", value, sql: quoteSqlLiteral(value) } : undefined;
        case "smallint":
        case "integer":
        case "bigint":
        case "smallserial":
        case "serial":
        case "bigserial":
        case "real":
        case "doublePrecision":
        case "numeric":
            return typeof value === "number" && Number.isFinite(value) ? { kind: "literal", value, sql: String(value) } : undefined;
        case "boolean":
            return typeof value === "boolean" ? { kind: "literal", value, sql: value ? "TRUE" : "FALSE" } : undefined;
        case "timestamptz":
        case "date":
        case "time": {
            const literal = dateDefaultLiteral(value, type);
            return literal === undefined ? undefined : { kind: "literal", value: literal, sql: quoteSqlLiteral(literal) };
        }
        // A custom scalar takes a string literal, which Postgres reads as the
        // column's type (`'10.0.0.1'` for `inet`, `'1 day'` for `interval`).
        case "custom":
            return typeof value === "string" && !/\]\s*$/.test(type.sqlType)
                ? { kind: "literal", value, sql: quoteSqlLiteral(value) }
                : undefined;
        case "json":
        case "jsonb": {
            let json: string | undefined;
            try {
                json = JSON.stringify(value);
            } catch {
                return undefined;
            }
            if (json === undefined) return undefined;
            return { kind: "literal", value, sql: `${quoteSqlLiteral(json)}::${type.kind}` };
        }
        default:
            return undefined;
    }
};

/**
 * One column planned from its definition — the defined twin of
 * {@link planPropertyColumn}, which hands over to it whenever the property
 * carries one, collection table and junction payload alike.
 */
function planDefinedColumn(propName: string, definition: ColumnDef, ctx: PropertyColumnContext): ColumnPlan {
    const { collection, schema, table, auth } = ctx;
    const column = definedColumnName(propName, definition);
    const isKey = definition.primaryKey;
    const type = definedPgType(definition, { collection, propName, column });
    const authDefinition = auth && !isKey ? authUsersColumnDefinition(column) : undefined;

    const plan: ColumnPlan = {
        key: propName,
        column,
        type,
        nullable: !(isKey || definition.notNull),
        primaryKey: isKey,
        unique: !isKey && definition.unique,
        default: definedColumnDefault(definition, type),
        sqlDefinition: authDefinition,
        source: { kind: "property", propName, slug: collection.slug }
    };
    if (definition.generatedAs !== undefined) {
        plan.generated = { expression: definition.generatedAs, stored: true };
    }
    if (definition.stamp?.on === "update" && definition.stamp.value === "now") {
        plan.touchOnUpdate = true;
        ctx.triggerFunctionNeeded.value = true;
        ctx.triggers.push({
            schema,
            table,
            column,
            name: toPostgresIdentifier(`${table}_${column}_touch`)
        });
    }
    return plan;
}

// ── Policies ─────────────────────────────────────────────────────────────────

/**
 * One security rule, compiled to the clauses a policy is made of.
 *
 * The compilation is `compileRulePolicies` in `@rebasepro/common`, which the
 * Studio's RLS editor also compares the live database against — so the UI, the
 * DDL and the database agree about who can read a row. What this adds is only
 * the planner's bookkeeping: which rule a policy came from, and whether Rebase
 * injected it.
 */
export const compileSecurityRule = (
    collection: CollectionConfig,
    rule: SecurityRule,
    resolveCollection: ResolveCollection,
    injected: boolean,
    ruleKey = rule.name ?? "(unnamed)"
): PolicyPlan[] => {
    const supersedes = getPolicySupersededNames(rule, getTableName(collection));
    // This driver switches admin requests to `<role>_admin`, so it may have
    // server-or-admin grants written TO rebase_admin (`rls.adminPolicies`),
    // and makes `rebase_admin_request` for their companions.
    const compiled = compileRulePolicies(collection, rule, { resolveCollection, adminRole: true, adminRequestRole: true });
    const plans: PolicyPlan[] = [];
    for (const policy of compiled) {
        // A companion follows its base: carried on it, not planned beside it.
        if (policy.adminRequestTarget) {
            const base = plans[plans.length - 1];
            if (base) base.adminRequestCompanion = { name: policy.name, using: policy.using, withCheck: policy.withCheck };
            continue;
        }
        plans.push({
            ...policy,
            ruleKey,
            injected,
            ...(plans.length === 0 && supersedes.length > 0 ? { supersedes } : {})
        });
    }
    return plans;
};

/**
 * Refuse two of a table's policies that Postgres would store under one name.
 *
 * Each policy is rendered as `DROP POLICY IF EXISTS "<name>"` and then its
 * `CREATE`, and Postgres keeps the first 63 bytes of the name, so the second
 * of two policies whose names share those bytes drops the first and takes its
 * place. On a table of 56 bytes or more every unnamed rule of one operation is
 * `<table>_<op>` once stored, so a restrictive gate followed by a grant left
 * the grant alone in force. One rule's own operations never collide here —
 * `getPolicyNamesForRule` names them apart — so a collision is always two
 * rules, and the author names one of them.
 */
const sameStoredPolicy = (a: PolicyPlan, b: PolicyPlan): boolean =>
    a.name === b.name && a.operation === b.operation && a.mode === b.mode
    && a.roles.join(",") === b.roles.join(",") && a.using === b.using && a.withCheck === b.withCheck;

function assertDistinctStoredPolicyNames(policies: PolicyPlan[]): void {
    const owners = new Map<string, PolicyPlan>();
    for (const policy of policies) {
        const stored = toPostgresIdentifier(policy.name);
        const first = owners.get(stored);
        if (!first) {
            owners.set(stored, policy);
            continue;
        }
        // The same policy twice — a rule repeated verbatim — replaces itself.
        if (sameStoredPolicy(first, policy)) continue;
        throw new Error(
            `The security rules "${first.ruleKey}" and "${policy.ruleKey}" compile to the policies ` +
            `"${first.name}" and "${policy.name}", which Postgres stores under one name, "${stored}": it ` +
            "keeps only the first 63 bytes of an identifier, so the second would replace the first. " +
            "Give one of the rules a shorter `name`, or the collection a shorter `table`."
        );
    }
}

/**
 * A table's policies, minus any superseded name Postgres would store one of
 * them under.
 *
 * A superseded name is a 63-byte cut, and another rule's over-long name can
 * cut to the very same bytes — `<table>_default_admin_read` and the old
 * `<table>_default_admin_write_<op>` both do on a 50-byte table. Dropping it
 * then would drop that policy right after its own `CREATE`. Its own `DROP
 * POLICY IF EXISTS` already removes the old policy, so nothing is lost.
 */
const withoutLiveSupersededNames = (policies: PolicyPlan[]): PolicyPlan[] => {
    assertDistinctStoredPolicyNames(policies);
    const stored = new Set(policies.map(policy => toPostgresIdentifier(policy.name)));
    return policies.map(policy => {
        if (!policy.supersedes) return policy;
        const supersedes = policy.supersedes.filter(name => !stored.has(name));
        if (supersedes.length === policy.supersedes.length) return policy;
        const kept: PolicyPlan = { ...policy };
        if (supersedes.length > 0) kept.supersedes = supersedes;
        else delete kept.supersedes;
        return kept;
    });
};

/**
 * Whether a collection serves a SQL view rather than a table.
 *
 * A link into one is read-side only. Postgres refuses a foreign key that
 * references a view ("referenced relation is not a table"), and the generated
 * drizzle file declares no variable for a view, so a link into one plans no
 * constraint and no generated relation. The runtime still reads it: its
 * relations are built from the catalogue, which holds views.
 */
const servesView = (collection: CollectionConfig): boolean =>
    isPostgresCollectionConfig(collection) && Boolean(collection.view);

// ── The planner ──────────────────────────────────────────────────────────────

/**
 * Everything a set of tables asks the database for.
 *
 * The input is the compiled tables — what `compileSchema` returns and every
 * door (`loadTables`, boot, the CLI) hands over. Planned in the order given:
 * the callers sort by slug first, and the generated files keep that order.
 *
 * @param compiledTables the compiled tables, in slug order.
 * @param options the planner's world: the extensions it may install.
 */
export function planSchema(compiledTables: readonly CompiledTable[], options: PlanOptions = {}): SchemaPlan {
    // B-PLAN-2: removed in step 4. The parts of the planner not yet ported to
    // the descriptor read the tables lowered into the legacy shape.
    const allCollections: CollectionConfig[] = lowerCompiledTables(compiledTables);
    const descriptorOf = new Map(compiledTables.map(table => [table.descriptor.slug, table.descriptor]));
    const requireDescriptor = (collection: CollectionConfig): TableDescriptor => {
        const descriptor = descriptorOf.get(collection.slug);
        if (!descriptor) throw new Error(`The planner lost the descriptor of table "${describe(collection)}".`);
        return descriptor;
    };
    // Before the filter, deliberately: a `search` block on a collection this
    // engine does not store would otherwise be dropped without a word.
    assertSearchIsPostgresOnly(allCollections);
    // Same reasoning, and a stronger reason to be loud: a `beforeQuery` that
    // does nothing is a row filter that does nothing.
    assertBeforeQueryIsPostgresOnly(allCollections);

    // A Firestore collection has no table here, and generating one
    // is not merely wasted output: `db push` would create it, and the doctor
    // would then report the store the collection actually reads from as drift.
    const relational = relationalCollections(allCollections);
    // A collection that serves a view has no table, policy or enum: it is
    // planned on its own (`views`), and resolvable as a relation target.
    const collections = relational.filter(c => !servesView(c));

    // The first collection, in declaration order, whose slug or table name is
    // the key — what `collections.find(...)` answered, from a map built once
    // rather than a scan per lookup.
    const firstBySlugOrTable = new Map<string, CollectionConfig>();
    for (const c of relational) {
        for (const key of [c.slug, getTableName(c)]) {
            if (!firstBySlugOrTable.has(key)) firstBySlugOrTable.set(key, c);
        }
    }
    const resolveCollection: ResolveCollection = (slug) => firstBySlugOrTable.get(slug);

    const declaredSchemas = Array.from(new Set(collections.flatMap(c => {
        const declared = declaredSchemaOf(requireDescriptor(c));
        return declared === undefined ? [] : [declared];
    })));
    const schemas = Array.from(new Set([REBASE_SCHEMA, ...declaredSchemas]));

    // ── Enum types ───────────────────────────────────────────────────────────
    // The name is derived from table + column, so two collections mapped onto
    // the same table — or two properties whose `columnName` resolves to the
    // same column — land on the same type. `CREATE TYPE` has no IF NOT EXISTS,
    // so emitting it twice aborts the whole file; deduplicated by name here,
    // once, for every renderer.
    //
    // Deduplicated by the name *Postgres* holds, which is the first 63 bytes,
    // and only for the same column. Two different columns deriving one name —
    // `orders.item_status` and `orders_item.status`, or two long names that
    // share their first 63 bytes — cannot share a type: the second column would
    // be typed with the first one's labels and reject its own. The name is
    // frozen once a database holds it, so this refuses rather than renaming.
    const enums: EnumPlan[] = [];
    const enumOwners = new Map<string, { table: string; column: string; owner: string; shared?: { name: string; labels: string[] } }>();
    /**
     * The enum type a defined column is typed by, appended once.
     *
     * A column's own type (`<table>_<column>`) is claimed by that column alone,
     * as above. A type the definition names (`col.enum(values, { name })`) is
     * shared: every column naming it is typed by the one `CREATE TYPE`, and
     * they must agree on its values — `compileTables` refuses a disagreement
     * first, and so does this, for a plan reached any other way.
     */
    const collectDefinedEnumType = (
        collection: CollectionConfig,
        propName: string,
        definition: ColumnDef,
        declaredSchema: string | undefined
    ): void => {
        const column = definedColumnName(propName, definition);
        const enumType = definedEnumOf(definedPgType(definition, { collection, propName, column }));
        if (!enumType) return;
        const { schema, name, labels } = enumType;
        const table = getTableName(collection);
        const qualified = `${schema}.${toPostgresIdentifier(name)}`;
        const owner = `property "${propName}" of collection "${describe(collection)}"`;
        const shared = name === `${table}_${column}` ? undefined : { name, labels };
        const claimed = enumOwners.get(qualified);
        if (claimed) {
            if (claimed.table === table && claimed.column === column) return;
            if (shared && claimed.shared?.name === name) {
                if (claimed.shared.labels.join("\u0000") === labels.join("\u0000")) return;
                throw new Error(
                    `The enum type "${schema}"."${name}" is given the values (${labels.join(", ")}) by ${owner} and ` +
                    `(${claimed.shared.labels.join(", ")}) by ${claimed.owner}. Columns sharing a named enum type must ` +
                    "list the same values, in the same order. Make them agree, or give one column its own type `name`."
                );
            }
            throw new Error(
                `The enum ${owner} and the enum ${claimed.owner} both derive the Postgres type ` +
                `"${schema}"."${toPostgresIdentifier(name)}" (Postgres keeps the first 63 bytes of a name). One type ` +
                "cannot hold both columns' values, and a type's name cannot change once a database holds it. Give " +
                "one of the two columns another name with `.column()`, its table another `table` or `schema`, or " +
                "its enum another `name`."
            );
        }
        enumOwners.set(qualified, { table, column, owner, shared });
        enums.push({ schema, name, qualified, declaredSchema, varName: enumType.varName, labels });
    };
    /**
     * Every enum type one table's properties declare, appended once.
     *
     * `declaredSchema` is passed rather than read off the config because a
     * junction's synthetic collection carries `schema: "public"` as a resolved
     * fact and not as a declaration — emitting it as one would make the
     * generated file reach for a `pgSchema("public")` variable that exists for
     * nobody.
     */
    const collectEnumTypes = (
        collection: CollectionConfig,
        properties: Properties,
        declaredSchema: string | undefined
    ): void => {
        for (const [propName, rawProp] of Object.entries(properties)) {
            const prop = rawProp as Property;
            // A link is typed by its target's key, whose type its table declares.
            const definition = prop.type === "relation" ? undefined : tableColumnOf(prop);
            if (definition) {
                // A closed value set that is no enum type (`.oneOf()`) still
                // refuses an empty list, as `enumLabelsOf` refuses one.
                if (definition.oneOf !== undefined && definition.oneOf.every(value => String(value).length === 0)) {
                    enumLabelsOf(propName, { type: "string", enum: [] }, collection);
                }
                collectDefinedEnumType(collection, propName, definition, declaredSchema);
                continue;
            }
            if (!("enum" in prop) || !prop.enum) continue;
            if (prop.type !== "string" && prop.type !== "number") continue;
            // Refuses an empty list whatever the property's type, then declares
            // a type only for the string ones: a `number` enum's column is
            // NUMERIC or INTEGER on every path, so the type used to be created
            // and referenced by nothing.
            const labels = enumLabelsOf(propName, prop, collection);
            if (!declaresEnumType(prop)) continue;
            const schema = schemaOf(collection);
            const table = getTableName(collection);
            const column = resolveColumnName(propName, prop);
            const name = `${table}_${column}`;
            const qualified = `${schema}.${toPostgresIdentifier(name)}`;
            const owner = `property "${propName}" of collection "${describe(collection)}"`;
            const claimed = enumOwners.get(qualified);
            if (claimed) {
                if (claimed.table === table && claimed.column === column) continue;
                throw new Error(
                    `The enum ${owner} and the enum ${claimed.owner} both derive the Postgres type ` +
                    `"${schema}"."${toPostgresIdentifier(name)}" (an enum type is named <table>_<column>, ` +
                    "and Postgres keeps the first 63 bytes). One type cannot hold both columns' values, and a " +
                    "type's name cannot change once a database holds it. Give one of the two columns another " +
                    "name with `columnName`, or its collection another `table` or `schema`."
                );
            }
            enumOwners.set(qualified, { table, column, owner });
            enums.push({
                schema,
                name,
                qualified,
                declaredSchema,
                varName: getEnumVarName(getTableName(collection), propName),
                labels
            });
        }
    };
    for (const collection of collections) {
        collectEnumTypes(
            collection,
            (collection.properties ?? {}) as Properties,
            isPostgresCollectionConfig(collection) ? collection.schema : undefined
        );
    }

    // ── The table set ────────────────────────────────────────────────────────
    // Each collection's table, then any junction its relations imply, in the
    // order the collections arrive. `schema.sql` and `schema.generated.ts` are
    // compared against their committed copies, so this order is the file's.
    const tableEntries = new Map<string, {
        collection: CollectionConfig;
        junction?: { relation: ResolvedRelation; source: CollectionConfig };
    }>();
    const junctionShapes = new Map<string, { keys: string; claim: string }>();
    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (tableName) tableEntries.set(tableName, { collection });
        for (const [relationKey, relation] of Object.entries(resolveCollectionRelations(collection))) {
            if (!isManyToMany(relation)) continue;
            const junctionTable = relation.through.table;
            assertOneJunctionShape(junctionShapes, junctionTable, collection, relation.relationName ?? relationKey, relation);
            if (tableEntries.has(junctionTable)) continue;
            tableEntries.set(junctionTable, {
                collection: { table: junctionTable, properties: {} } as CollectionConfig,
                junction: { relation, source: collection }
            });
        }
    }

    const junctionSpecs = resolveJunctionSpecs(collections);

    // A junction's payload may declare an enum too, and the type it names is
    // created by nobody else: no collection owns the table, so the loop above
    // never sees the property. Appended after the collections' — the enum block
    // is compared byte-for-byte against its committed copy, and a junction
    // whose type interleaved with the collections' would reorder that file
    // whenever a `through.properties` block moved.
    for (const spec of junctionSpecs.values()) {
        if (Object.keys(spec.properties).length === 0) continue;
        collectEnumTypes(getJunctionCollectionConfig(spec), spec.properties, undefined);
    }

    const triggerFunctionNeeded = { value: false };

    const tables: TablePlan[] = [];
    for (const [tableName, entry] of tableEntries) {
        tables.push(entry.junction
            ? planJunctionTable(
                tableName, entry.junction.relation, entry.junction.source,
                junctionSpecs, resolveCollection, triggerFunctionNeeded)
            : planCollectionTable(entry.collection, requireDescriptor(entry.collection), resolveCollection, triggerFunctionNeeded));
    }

    assertNoTruncationCollisions(tables, enums);

    // ── Extensions and functions ─────────────────────────────────────────────
    const extensions: string[] = [];
    const functions: string[] = [];
    const seenStatements = new Set<string>();
    const add = (into: string[], statement: string): void => {
        if (seenStatements.has(statement)) return;
        seenStatements.add(statement);
        into.push(statement);
    };
    for (const table of tables) {
        if (!table.search) continue;
        for (const statement of searchExtensionStatements(table.search)) add(extensions, statement);
    }
    // pgvector is a separate build behind an image, a grant and a provider
    // allow-list, so whether Rebase may install it is not Rebase's to decide.
    // See `DatabaseOptions.extensions`.
    if (vectorExtensionDeclared(options.databaseExtensions)
        && tables.some(t => t.vectorColumns.length > 0)) {
        add(extensions, vectorExtensionStatement());
    }
    for (const table of tables) {
        if (!table.search) continue;
        for (const statement of searchHelperFunctions(table.search)) add(functions, statement);
    }
    if (triggerFunctionNeeded.value) add(functions, setUpdatedAtFunction());
    if (tables.some(t => t.triggers.some(trigger => trigger.kind === "keep-tenant"))) add(functions, keepTenantFunction());

    return {
        schemas,
        declaredSchemas,
        enums,
        tables,
        views: planViews(relational),
        relations: planRelations(collections, tableEntries),
        extensions,
        functions,
        collections,
        options
    };
}

/**
 * The view collections' views, each after the views its query names.
 *
 * Which views a query reads is read off its text — a planned view's name as a
 * whole word — which is enough to order them: a name that appears in a string
 * literal only orders two views that did not need it, never the other way.
 */
export function planViews(collections: CollectionConfig[]): ViewPlan[] {
    const declared = collections.flatMap(collection => {
        if (!isPostgresCollectionConfig(collection) || !collection.view) return [];
        const schema = schemaOf(collection);
        const name = getTableName(collection);
        const idColumns = primaryKeyPropertyNames(collection)
            .map(key => resolveColumnName(key, collection.properties?.[key]));
        const materialized = collection.view.materialized === true;
        return [{
            schema, name, qualified: `${schema}.${name}`,
            query: collection.view.query.trim().replace(/;\s*$/, ""),
            materialized,
            roles: materialized ? [...(collection.view.roles ?? DEFAULT_VIEW_ROLES)] : [],
            idColumns,
            // A materialized view's own `indexes`, on its stored rows.
            indexes: materialized
                ? buildCollectionIndexSpecs(collection, resolveColumnName)
                    .map(spec => collectionIndexStatement({ ...spec, table: viewRowsName(name) }).replace(/;$/, ""))
                : []
        }];
    });
    const named = (query: string, view: { schema: string; name: string }) =>
        new RegExp(`(^|[^A-Za-z0-9_$"])"?${escapeRegExp(view.name)}"?([^A-Za-z0-9_$"]|$)`).test(query);
    const withDependencies = declared.map(view => ({
        ...view,
        dependsOn: declared.filter(other => other !== view && named(view.query, other)).map(other => other.qualified)
    }));

    // Depth-first, so every view lands after what it reads; a cycle is two
    // queries naming each other, which Postgres refuses to create anyway.
    const ordered: typeof withDependencies = [];
    const placed = new Set<string>();
    const visiting = new Set<string>();
    const place = (view: typeof withDependencies[number]): void => {
        if (placed.has(view.qualified)) return;
        if (visiting.has(view.qualified)) {
            throw new Error(`The views ${[...visiting].join(", ")} read each other; a view cannot be created before the view it reads.`);
        }
        visiting.add(view.qualified);
        for (const dependency of view.dependsOn) {
            const target = withDependencies.find(other => other.qualified === dependency);
            if (target) place(target);
        }
        visiting.delete(view.qualified);
        placed.add(view.qualified);
        ordered.push(view);
    };
    for (const view of withDependencies) place(view);

    return ordered.map(view => ({
        ...view,
        hash: createHash("sha256")
            // `gated`: a materialized view is its stored rows behind a view
            // that serves them to its roles (0.29.0 created the bare matview).
            .update(JSON.stringify([view.qualified, view.query, view.materialized, view.idColumns,
                ...(view.materialized ? ["gated", view.roles, view.indexes] : [])]))
            .digest("hex")
            .slice(0, 16)
    }));
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Refuse two relations — tables, junctions and enum types share one namespace
 * per schema, because every table owns a row type of its own name — that are
 * distinct in full but one name after Postgres keeps the first 63 bytes.
 *
 * `a_table_with_a_really_long_name_that_goes_on_and_on_and_on_forever` with an
 * enum column and a many-to-many truncated its table, its enum type and its
 * junction to the same identifier: the push failed with `type "…" already
 * exists` and no validator mentioned the length. A name that already works is
 * never touched — only a collision that cannot be created refuses.
 */
function assertNoTruncationCollisions(tables: TablePlan[], enums: EnumPlan[]): void {
    const owners = new Map<string, string>();
    const claim = (schema: string, name: string, what: string): void => {
        const key = `${schema}.${toPostgresIdentifier(name)}`;
        const first = owners.get(key);
        if (first === undefined) {
            owners.set(key, what);
            return;
        }
        throw new Error(
            `The ${what} and the ${first} both become "${schema}"."${toPostgresIdentifier(name)}" in Postgres, ` +
            "which keeps only the first 63 bytes of an identifier — and a table, a junction table and an enum " +
            "type share one namespace (every table owns a row type of its name). The push would fail with " +
            "\"already exists\". Give the collection a shorter `table`, or the enum's property a shorter " +
            "`columnName` (an enum type is named <table>_<column>)."
        );
    };
    for (const table of tables) {
        claim(table.schema, table.table, table.kind === "junction" ? `junction table "${table.table}"` : `table "${table.table}"`);
    }
    for (const e of enums) claim(e.schema, e.name, `enum type "${e.name}"`);
}

/**
 * Refuse two many-to-many relations that resolve to one junction table with
 * different key columns.
 *
 * A default `through` is named after the two tables, so `posts.tags` and
 * `posts.featuredTags` both resolve to `posts_tags` — one keyed by `tag_id`,
 * the other by `featured_tag_id`. One table is created, from whichever came
 * first, so the other relation read and wrote a column that was never there.
 * The two sides of one link (`posts.tags` and `tags.posts`) share a junction
 * legitimately, and they name the same two columns — so the comparison is of
 * the (column, endpoint) pairs, in either order.
 */
function assertOneJunctionShape(
    seen: Map<string, { keys: string; claim: string }>,
    junctionTable: string,
    collection: CollectionConfig,
    relationName: string,
    relation: ResolvedRelation
): void {
    if (!isManyToMany(relation)) return;
    // A target that does not resolve plans no junction here; `resolveJunctionSpecs` skips it the same way.
    const target: CollectionConfig | undefined = relation.target();
    if (!target) return;
    const sourceTable = getTableName(collection);
    const targetTable = getTableName(target);
    const { sourceColumn, targetColumn } = relation.through;
    const keys = JSON.stringify([[sourceColumn, sourceTable], [targetColumn, targetTable]].sort());
    const claim = `the relation "${relationName}" of collection "${describe(collection)}" ` +
        `("${sourceColumn}" → ${sourceTable}, "${targetColumn}" → ${targetTable})`;
    const first = seen.get(junctionTable);
    if (!first) {
        seen.set(junctionTable, { keys, claim });
        return;
    }
    if (first.keys === keys) return;
    throw new Error(
        `Two many-to-many relations resolve to the junction table "${junctionTable}" with different key ` +
        `columns: ${first.claim} and ${claim}. Only one table is created, so one of them would read ` +
        "and write columns that do not exist. Give the second its own junction — " +
        `\`through: { table: "${sourceTable}_${toSnakeCase(relationName)}" }\` — or, if both are meant to ` +
        "be one link, declare it once."
    );
}

// ── A collection's table ─────────────────────────────────────────────────────

function planCollectionTable(
    collection: CollectionConfig,
    descriptor: TableDescriptor,
    resolveCollection: ResolveCollection,
    triggerFunctionNeeded: { value: boolean }
): TablePlan {
    const { schema, table, slug } = descriptor;
    const auth = isAuthCollection(collection);
    const columns: ColumnPlan[] = [];
    const triggers: TriggerPlan[] = [];
    const relations = resolveCollectionRelations(collection);

    for (const [propName, rawProp] of Object.entries(collection.properties ?? {})) {
        const prop = rawProp as Property;

        if (prop.type === "relation") {
            const column = planRelationColumn(propName, prop as RelationProperty, collection, relations, schema, table);
            if (column) columns.push(column);
            continue;
        }
        if (prop.type === "reference") {
            columns.push(planReferenceColumn(propName, prop as ReferenceProperty, collection, resolveCollection, schema, table));
            continue;
        }

        columns.push(planPropertyColumn(propName, prop, {
            collection,
            resolveCollection,
            schema,
            table,
            auth,
            triggers,
            triggerFunctionNeeded
        }));
    }

    // ── Auth columns the collection file never mentions ──────────────────────
    // `db push` is declarative: Atlas diffs the database against exactly what
    // is emitted and drops anything else. The scaffold's users collection
    // describes 12 columns while auth needs 14, so `is_anonymous` and
    // `tokens_valid_after` read as unmanaged drift and a push run after the
    // server had started once planned to DROP them.
    if (auth) {
        const declared = new Set(columns.map(c => c.column));
        for (const spec of AUTH_USERS_COLUMNS) {
            if (declared.has(spec.column)) continue;
            columns.push({
                key: spec.column,
                column: spec.column,
                type: authColumnType(spec.type),
                nullable: spec.notNull !== true,
                primaryKey: false,
                unique: false,
                sqlDefinition: authUsersColumnSql(spec),
                source: { kind: "auth", slug: slug }
            });
        }
    }

    // ── The opt-in search column ─────────────────────────────────────────────
    // Last, so it reads as what it is: derived from the columns above it.
    // Postgres recomputes it on every write of a source column and rejects any
    // attempt to write it directly, which is what makes it impossible for the
    // index to drift from the row.
    const search = buildSearchColumnSpec(collection);
    if (search) {
        columns.push({
            key: search.column,
            column: search.column,
            type: { kind: "tsvector" },
            nullable: true,
            primaryKey: false,
            unique: false,
            generated: { expression: search.expression, stored: true },
            sqlDefinition: searchColumnTypeSql(search.expression, "tsvector"),
            source: { kind: "search", slug: slug }
        });
        if (search.fuzzy) {
            columns.push({
                key: search.fuzzy.column,
                column: search.fuzzy.column,
                type: { kind: "text" },
                nullable: true,
                primaryKey: false,
                unique: false,
                generated: { expression: search.fuzzy.expression, stored: true },
                sqlDefinition: searchColumnTypeSql(search.fuzzy.expression, "text"),
                source: { kind: "search", slug: slug }
            });
        }
    }

    const primaryKey = planPrimaryKey(descriptor, columns);

    const injected = new Set(getInjectedSecurityRules(collection).map(rule => rule.name));
    const policies = withoutLiveSupersededNames(getEffectiveSecurityRules(collection).flatMap((rule, index) =>
        compileSecurityRule(
            collection,
            rule,
            resolveCollection,
            Boolean(rule.name && injected.has(rule.name)),
            rule.name ?? `#${index}`
        )));

    // ── Tenancy ──────────────────────────────────────────────────────────────
    // The policy is already above — `getEffectiveSecurityRules` injects it, so
    // it compiles, names and renders like every other rule. What is left is the
    // half a rule cannot express: the column is NOT NULL, and it is indexed.
    const tenantIndexes = applyTenantColumnEffects(collection, columns, primaryKey, schema, table);
    const keepTenant = planKeepTenantTrigger(collection, columns, schema, table);
    if (keepTenant) triggers.push(keepTenant);

    // Last among the columns, because it reads a nullability the two passes
    // above can still change.
    settleDefaultOnDelete(collection, columns, relations);

    // After every other index, because the foreign-key ones defer to them: a
    // declared index or the tenant index that already leads with the column
    // serves the same lookups, and a second one would only cost writes.
    const indexes = [...buildCollectionIndexSpecs(collection, resolveColumnName), ...tenantIndexes];
    indexes.push(...planForeignKeyIndexes(schema, table, columns, primaryKey, indexes, column => {
        // A `belongsTo` whose author opted out keeps its constraint and loses
        // only the index. Asked of the relation, not the column: the column a
        // declared property owns carries no relation of its own.
        if (column.source.kind !== "relation" || !column.source.propName) return undefined;
        const prop = collection.properties?.[column.source.propName] as RelationProperty | undefined;
        const relation = findRelation(relations, prop?.relation?.relationName ?? column.source.propName);
        if (relation?.kind !== "belongsTo" || !relation.index) return undefined;
        // A link declared without its constraint is joined on all the same:
        // its column is indexed as a foreign key's would be.
        return column.foreignKey?.column ?? (isUnconstrainedLink(collection, column) ? column.column : undefined);
    }));

    return {
        schema,
        table,
        qualified: `${schema}.${table}`,
        declaredSchema: declaredSchemaOf(descriptor),
        varName: getTableVarName(table),
        kind: "collection",
        slug,
        columns,
        primaryKey,
        indexes,
        search,
        vector: buildVectorIndexPlan(collection, resolveColumnName),
        vectorColumns: buildVectorColumnSpecs(collection, resolveColumnName),
        policies,
        triggers,
        auth
    };
}

/**
 * The table's primary key, as the column names {@link TablePlan.primaryKey}
 * lists — and the columns adjusted to state it one way only.
 *
 * One `isId` property is a key column of its own, declared inline
 * (`"id" INTEGER PRIMARY KEY`, `.primaryKey()`), which is how
 * {@link planPropertyColumn} planned it. Several are one composite key, and a
 * composite key cannot be said column by column: two inline `PRIMARY KEY`
 * clauses are two primary keys, which Postgres refuses. So each member stops
 * being a key of its own, keeps NOT NULL (the constraint implies it, and every
 * emitter spells it on the column so the three read the same), and the table
 * gets one `PRIMARY KEY (a, b)` over the list returned here — the shape a
 * junction's key has always had.
 *
 * A table that declares no key gets an implicit `id TEXT PRIMARY KEY`,
 * which is what `getPrimaryKeys` reads back.
 */
function planPrimaryKey(descriptor: TableDescriptor, columns: ColumnPlan[]): string[] {
    const keyNames = descriptor.primaryKey;

    if (keyNames.length > 1) {
        return keyNames.map(name => {
            const column = columns.find(c => c.source.propName === name && !c.columnOwnedByProperty);
            if (!column) {
                throw new Error(
                    `Column "${name}" of table "${descriptor.slug}" is part of the primary key, and it puts ` +
                    "no column on this table, so it cannot be part of the table's primary key. Mark the " +
                    "column that holds it `.primaryKey()` instead."
                );
            }
            column.primaryKey = false;
            column.nullable = false;
            return column.column;
        });
    }

    // With a default the database fills. Nothing else can: the key is not a
    // property, so the admin form has no field for it, and REST, the SDK and
    // the socket send none. Without one, every insert into a collection that
    // declares no key — the quickstart's first one among them — was refused
    // as a missing `id`. The column stays TEXT so a table created before this
    // keeps its type, and boot's ensure adds the default to it: a DEFAULT binds
    // only future writes, so it is the one change it makes to an existing
    // column. A key the caller does supply still wins over the default.
    if (!columns.some(c => c.primaryKey)) {
        columns.unshift({
            key: "id",
            column: "id",
            type: { kind: "text" },
            nullable: false,
            primaryKey: true,
            unique: false,
            default: { kind: "sql", expression: IMPLICIT_ID_DEFAULT },
            source: { kind: "implicit-id", slug: descriptor.slug }
        });
    }
    return columns.filter(c => c.primaryKey).map(c => c.column);
}

/** What {@link planPropertyColumn} needs about the table the column lands on. */
interface PropertyColumnContext {
    /** The collection, or the synthetic one standing in for a junction. */
    collection: CollectionConfig;
    resolveCollection: ResolveCollection;
    schema: string;
    /** Bare table name — the trigger name is derived from it. */
    table: string;
    /** Whether `auth-users-columns` owns this table's columns. */
    auth: boolean;
    /** Collected `BEFORE UPDATE` triggers, appended to. */
    triggers: TriggerPlan[];
    triggerFunctionNeeded: { value: boolean };
}

/**
 * One declared, non-linking property, as a column.
 *
 * Extracted from {@link planCollectionTable} the moment a second table needed
 * it: a `manyToMany`'s `through.properties` are columns on the junction, and
 * "declared exactly like a collection's properties" has to mean the same code
 * reads them, or it is a promise the next `columnType` or `defaultValue` change
 * quietly breaks. A junction payload column therefore gets the type, the
 * nullability, the default, the UNIQUE and the `on_update` trigger a collection
 * column with the same declaration gets — because it is the same function
 * answering.
 *
 * `relation` and `reference` do not come through here; they own a foreign key
 * and are planned by {@link planRelationColumn} / {@link planReferenceColumn}.
 * A junction payload may not declare either (config validation refuses it), so
 * this is the whole of a payload column.
 */
function planPropertyColumn(
    propName: string,
    prop: Property,
    ctx: PropertyColumnContext
): ColumnPlan {
    const definition = tableColumnOf(prop);
    if (definition) return planDefinedColumn(propName, definition, ctx);
    const { collection, resolveCollection, schema, table, auth } = ctx;

    const isId = isIdProperty(propName, prop, collection);
    const column = resolveColumnName(propName, prop);
    const type = columnPgType(propName, prop, collection, resolveCollection);
    const required = prop.validation?.required === true;
    const defaultValue = columnDefault(propName, prop, collection, type);
    // On an auth collection, the columns auth itself reads and writes have
    // exactly one definition wherever the table is created from — see
    // `auth-users-columns`. Anything else there is an ordinary field.
    const authDefinition = auth && !isId ? authUsersColumnDefinition(column) : undefined;

    const plan: ColumnPlan = {
        key: propName,
        column,
        type,
        // A primary key is NOT NULL whether or not anyone writes it.
        nullable: !(isId || required),
        primaryKey: isId,
        // `validation.unique` holds for every type. The Drizzle generator
        // honoured it on `string` and `number` only, so a unique `date` or
        // `map` was UNIQUE in the database and not in the file drizzle-kit
        // plans from. A primary key gets neither UNIQUE nor NOT NULL —
        // both are implied, and emitting them made drizzle-kit plan an
        // extra constraint against a database `db push` built without one.
        unique: !isId && prop.validation?.unique === true,
        default: defaultValue,
        sqlDefinition: authDefinition,
        source: { kind: "property", propName, slug: collection.slug }
    };
    if (prop.type === "date" && (prop as DateProperty).autoValue === "on_update") {
        plan.touchOnUpdate = true;
        ctx.triggerFunctionNeeded.value = true;
        ctx.triggers.push({
            schema,
            table,
            column,
            name: toPostgresIdentifier(`${table}_${column}_touch`)
        });
    }
    return plan;
}

/**
 * The two schema effects a `tenant` declaration has that a policy cannot state.
 *
 * The policy itself is injected as an ordinary `SecurityRule`
 * (`buildTenantSecurityRule`) and compiled above with every other rule, so
 * nothing here touches `policies`. What is left is the column:
 *
 * - **`NOT NULL`.** A row whose tenant is NULL belongs to nobody, and the
 *   restrictive policy compares the column to the caller's tenant — a
 *   comparison against NULL is never true. Such a row is therefore invisible to
 *   every caller, forever, including the one who wrote it. The write path
 *   refuses to create one (`TENANT_REQUIRED`); this is the same statement made
 *   where a raw `INSERT`, a seed and a migration can also hear it.
 * - **An index.** The tenancy predicate is ANDed into *every* statement against
 *   the table, so an unindexed tenant column turns every read into a sequential
 *   scan filtered by tenant. It is the one index a tenant-scoped table cannot
 *   be without, and the one people most reliably forget — which is the whole
 *   argument for deriving it rather than documenting it.
 *
 * The index goes through `deriveIndexName` like every other index, so it is a
 * Rebase-managed name (`_ix_<fingerprint>`), it is in the Atlas diff, and the
 * doctor recognises it. Because that name is a fingerprint of the index's
 * semantics, an author who has *already* declared a plain btree index on the
 * tenant column derives byte-for-byte the same name — so the two are the same
 * object and this adds nothing rather than colliding.
 *
 * Throws when the field names no column. `planSchema` throws rather than
 * guessing, and the alternative here is a table with a tenancy policy over a
 * column that does not exist: `CREATE POLICY` fails, RLS stays enabled, and the
 * collection denies every row.
 */
function applyTenantColumnEffects(
    collection: CollectionConfig,
    columns: ColumnPlan[],
    primaryKey: string[],
    schema: string,
    table: string
): CollectionIndexSpec[] {
    const tenant = getTenantConfig(collection);
    if (!tenant) return [];

    const column = findTenantColumn(collection, columns, tenant.field);
    if (!column) {
        throw new Error(
            `Collection "${describe(collection)}" declares \`tenant: { field: "${tenant.field}" }\`, and ` +
            "no property of that name reaches a column. `tenant` says what a column means; it does not " +
            "create one. Declare the property, or name the one that holds the tenant id."
        );
    }

    // The leading column of the primary key is already NOT NULL and already
    // indexed by `<table>_pkey`. Saying either again would make `db push` plan
    // a constraint and an index the database has no reason to hold. A later
    // column of a composite key is NOT NULL too, but `<table>_pkey` cannot
    // serve a lookup on it alone, so it still gets its index.
    if (primaryKey[0] === column.column) return [];

    column.nullable = false;

    const withoutName = {
        schema,
        table,
        method: "btree" as const,
        unique: false,
        keys: [{ column: column.column, direction: "asc" as const, nulls: "last" as const }],
        include: [],
        predicate: null,
        reason: TENANT_INDEX_REASON
    };
    return [{ ...withoutName, indexName: deriveIndexName(withoutName) }];
}

/**
 * The trigger that keeps a row in its tenant, or nothing when the collection
 * declares no `tenant`. See `tenant-keep-trigger.ts` for why a policy cannot.
 */
function planKeepTenantTrigger(
    collection: CollectionConfig,
    columns: ColumnPlan[],
    schema: string,
    table: string
): TriggerPlan | undefined {
    const tenant = getTenantConfig(collection);
    if (!tenant) return undefined;
    const column = findTenantColumn(collection, columns, tenant.field);
    if (!column) return undefined;
    return {
        schema,
        table,
        column: column.column,
        name: toPostgresIdentifier(keepTenantTriggerName(table)),
        kind: "keep-tenant",
        bypassRoles: [...tenantBypassRoles(tenant)]
    };
}

/**
 * A btree on each foreign-key column of one table, where nothing already
 * serves the lookup — see `foreignKeyIndexSpec` for why the column needs one.
 * `linkColumn` names the column a planned column links by, or nothing for a
 * column that wants no such index (an opted-out link, a plain column).
 *
 * Skipped, so that no table ever carries two indexes doing one job, when the
 * column already leads:
 *
 * - the primary key — `<table>_pkey` is a btree over the key in key order, so
 *   its first column is indexed and the rest are not (a junction's
 *   `(post_id, tag_id)` key serves `post_id`, and `tag_id` gets an index);
 * - a UNIQUE on the column (`validation.unique`, on the relation or on the
 *   property that owns the column) — Postgres backs it with a btree;
 * - another planned index that leads with it ({@link leadsWithColumn}) — one
 *   the collection declares in `indexes:`, or the tenant index.
 *
 * Only the plan is consulted, never the catalogue: `db push` renders this from
 * the collections alone, and boot has to reach the same set with the same
 * names, or Atlas would plan to drop what boot built.
 */
function planForeignKeyIndexes(
    schema: string,
    table: string,
    columns: ColumnPlan[],
    primaryKey: string[],
    planned: readonly CollectionIndexSpec[],
    linkColumn: (column: ColumnPlan) => string | undefined
): CollectionIndexSpec[] {
    const created = columns.filter(c => !c.columnOwnedByProperty);
    const derived: CollectionIndexSpec[] = [];
    for (const column of columns) {
        const name = linkColumn(column);
        if (name === undefined) continue;
        if (primaryKey[0] === name) continue;
        if (created.some(c => c.column === name && c.unique)) continue;
        if ([...planned, ...derived].some(spec => leadsWithColumn(spec, name))) continue;
        derived.push(foreignKeyIndexSpec(schema, table, name));
    }
    return derived;
}

/**
 * The planned column a `tenant.field` names.
 *
 * Not simply `columns.find(c => c.key === field)`: a `belongsTo` relation
 * property emits its column under the *foreign key's* field name, so
 * `tenant: { field: "org" }` beside `org: { type: "relation", … }` has to
 * resolve through the relation to `org_id`. Matching only on `key` found
 * nothing there and the declaration would have been refused as naming no
 * column — for the shape the documentation recommends.
 */
function findTenantColumn(
    collection: CollectionConfig,
    columns: ColumnPlan[],
    field: string
): ColumnPlan | undefined {
    // Only columns that are created. A relation whose column a declared
    // property owns keeps an entry for its constraint alone, under the same key
    // and column; when the relation was declared first, NOT NULL landed on that
    // entry, nothing rendered it, and the tenant column stayed nullable.
    const created = columns.filter(c => !c.columnOwnedByProperty);
    const direct = created.find(c => c.key === field);
    if (direct) return direct;

    const prop = collection.properties?.[field] as Property | undefined;
    if (prop?.type === "relation") {
        const relations = resolveCollectionRelations(collection);
        const relation = findRelation(relations, (prop as RelationProperty).relation?.relationName ?? field);
        if (relation?.kind === "belongsTo" && relation.localKey) {
            return created.find(c => c.column === relation.localKey);
        }
        return undefined;
    }
    if (!prop) return undefined;
    const columnName = resolveColumnName(field, prop);
    return created.find(c => c.column === columnName);
}

/**
 * The `ON DELETE` a link gets when the author did not say, decided from the
 * column as it will be created.
 *
 * {@link planRelationColumn} and {@link planReferenceColumn} see only their own
 * property's `required`, and two later facts change the premise: `tenant` makes
 * its column NOT NULL, and a declared property that owns a relation's column
 * decides that column's nullability itself. Defaulting before either produced
 * `NOT NULL … ON DELETE SET NULL` — a parent's delete that can only fail, and
 * fails with 23502 naming the child's column rather than as the foreign-key
 * refusal it is. An `onDelete` the author wrote is theirs and is kept.
 */
function settleDefaultOnDelete(
    collection: CollectionConfig,
    columns: ColumnPlan[],
    relations: Record<string, ResolvedRelation>
): void {
    for (const column of columns) {
        const fk = column.foreignKey;
        if (!fk || declaresOnDelete(collection, relations, column)) continue;
        const created = columns.find(c => c.column === column.column && !c.columnOwnedByProperty) ?? column;
        const onDelete = defaultBelongsToOnDelete(!created.nullable);
        if (onDelete === fk.onDelete) continue;
        column.foreignKey = foreignKeyPlan({
            schema: fk.schema,
            table: fk.table,
            column: fk.column,
            targetSchema: fk.targetSchema,
            targetTable: fk.targetTable,
            targetColumn: fk.targetColumn,
            onDelete,
            onUpdate: fk.onUpdate
        });
    }
}

/** Whether the author wrote this link's `onDelete`. A `reference` has none to write. */
const declaresOnDelete = (
    collection: CollectionConfig,
    relations: Record<string, ResolvedRelation>,
    column: ColumnPlan
): boolean => {
    const propName = column.source.propName;
    if (column.source.kind !== "relation" || !propName) return false;
    const prop = collection.properties?.[propName] as RelationProperty | undefined;
    const relation = findRelation(relations, prop?.relation?.relationName ?? propName);
    return relation?.kind === "belongsTo" && relation.onDelete !== undefined;
};

/**
 * The column a `belongsTo` relation owns, or `undefined` when the relation puts
 * no column on this table.
 *
 * Every other kind is a column on the target, a junction row, or a join chain.
 */
function planRelationColumn(
    propName: string,
    prop: RelationProperty,
    collection: CollectionConfig,
    relations: Record<string, ResolvedRelation>,
    schema: string,
    table: string
): ColumnPlan | undefined {
    const relation = findRelation(relations, prop.relation?.relationName ?? propName);
    if (relation?.kind !== "belongsTo") return undefined;

    let target: CollectionConfig;
    try {
        target = relation.target();
    } catch {
        // A relation whose target is not in this bundle yields no column and no
        // constraint. Every emitter returned early here, and they must keep
        // agreeing: a column with no constraint down one path is a schema fork.
        return undefined;
    }
    if (!target) return undefined;

    // The relation and an explicit FK property can both be declared; the
    // explicit one owns the column, and the relation still owns the constraint.
    // Asked of the *field key* rather than the column — `properties["post_id"]`
    // is not where a property declared `postId: { columnName: "post_id" }`
    // lives, so this used to emit the column twice and `CREATE TABLE` failed
    // with "column specified more than once".
    const fkFieldKey = fieldKeyForColumn(collection, relation.localKey);
    const columnOwnedByProperty = Boolean(collection.properties?.[fkFieldKey]) && propName !== fkFieldKey;
    const owner = columnOwnedByProperty ? collection.properties?.[fkFieldKey] : undefined;
    const { required, unique, constrained } = linkColumnFacts(prop, owner);
    // A declared column that owns the link's column says what that column is:
    // the constraint-only entry beside it states the same type and
    // nullability, so one column never reads two ways in the plan (a key
    // column of a composite key is NOT NULL; an `integer` column pointing at a
    // `bigint` key stays `integer`, which Postgres's integer comparison holds).
    const ownerDefinition = owner?.type === "relation" ? undefined : tableColumnOf(owner);

    // Only a *derived* column name can be affected by the change to
    // `generateForeignKeyName`; one the author wrote is theirs.
    const relationName = prop.relation?.relationName ?? propName;
    const legacyKey = legacyForeignKeyName(relationName);
    const derived = relation.localKey === generateForeignKeyName(relationName);
    const via = linkLabel("relation", collection, propName);

    return {
        key: fkFieldKey,
        column: relation.localKey,
        type: ownerDefinition
            ? definedPgType(ownerDefinition, { collection, propName: fkFieldKey, column: relation.localKey })
            : primaryKeyPgType(target, via),
        nullable: ownerDefinition ? !(ownerDefinition.notNull || ownerDefinition.primaryKey) : !required,
        primaryKey: false,
        // `validation.unique` on a link is a one-to-one, and all three emitters
        // dropped it: the property said unique, the column was not, and a
        // second row could point at the same parent.
        unique,
        columnOwnedByProperty: columnOwnedByProperty || undefined,
        legacyColumn: derived && legacyKey !== relation.localKey ? legacyKey : undefined,
        foreignKey: servesView(target) || !constrained ? undefined : foreignKeyPlan({
            schema,
            table,
            column: relation.localKey,
            targetSchema: schemaOf(target),
            targetTable: bareTableName(getTableName(target)),
            targetColumn: getPrimaryKeyColumn(target, via),
            onDelete: relation.onDelete ?? defaultBelongsToOnDelete(required),
            onUpdate: relation.onUpdate
        }),
        source: { kind: "relation", propName, slug: collection.slug }
    };
}

/**
 * Whether a `belongsTo`'s column is NOT NULL and UNIQUE, and whether it gets a
 * `FOREIGN KEY` — from its definitions when the relation property carries
 * them, from the property's `validation` otherwise.
 *
 * Three forms, as `lowerTables` produces them: the relation absorbed its
 * column (the column's own definition says), a declared column owns it (that
 * column says whether it is NOT NULL; the relation's entry is the constraint
 * alone, UNIQUE on the column's side), or the relation derives it (the
 * relation's `notNull` and `unique` say). `constraint: false` keeps the column
 * and drops the constraint.
 */
function linkColumnFacts(
    prop: RelationProperty,
    owner: Property | undefined
): { required: boolean; unique: boolean; constrained: boolean } {
    const relation = tableBelongsToOf(prop);
    if (!relation) {
        return { required: prop.validation?.required === true, unique: prop.validation?.unique === true, constrained: true };
    }
    const constrained = relation.constraint !== false;
    const absorbed = tableColumnOf(prop);
    if (absorbed) return { required: absorbed.notNull && !absorbed.primaryKey, unique: absorbed.unique, constrained };
    const declared = tableColumnOf(owner);
    if (declared) return { required: declared.notNull && !declared.primaryKey, unique: false, constrained };
    return { required: relation.notNull === true, unique: relation.unique === true, constrained };
}

/**
 * Whether a planned `belongsTo` column is one its relation declared without a
 * `FOREIGN KEY` (`constraint: false`) — still a link, so still indexed.
 */
const isUnconstrainedLink = (collection: CollectionConfig, column: ColumnPlan): boolean => {
    if (column.source.kind !== "relation" || !column.source.propName) return false;
    return tableBelongsToOf(collection.properties?.[column.source.propName])?.constraint === false;
};

/** The column a `reference` property owns — a foreign key like any other. */
function planReferenceColumn(
    propName: string,
    prop: ReferenceProperty,
    collection: CollectionConfig,
    resolveCollection: ResolveCollection,
    schema: string,
    table: string
): ColumnPlan {
    // A `reference` with no `path` names no collection, so it keeps its column
    // (the id is still a string) and gets no constraint — the same shape as one
    // whose target is not in this bundle.
    const target = prop.path ? resolveCollection(prop.path) : undefined;
    const column = resolveColumnName(propName, prop as Property);
    const required = prop.validation?.required === true;
    const via = linkLabel("reference", collection, propName);

    return {
        key: propName,
        column,
        // A `reference` whose target is not in the bundle keeps its column (the
        // id is still a string) and gets no constraint.
        type: target ? primaryKeyPgType(target, via) : { kind: "text" },
        nullable: !required,
        primaryKey: false,
        unique: prop.validation?.unique === true,
        foreignKey: target && !servesView(target)
            ? foreignKeyPlan({
                schema,
                table,
                column,
                targetSchema: schemaOf(target),
                targetTable: bareTableName(getTableName(target)),
                targetColumn: getPrimaryKeyColumn(target, via),
                // The same rule as `belongsTo`, from the same function. A
                // `reference` carries no `onDelete` of its own to override it.
                onDelete: defaultBelongsToOnDelete(required)
            })
            : undefined,
        source: { kind: "reference", propName, slug: collection.slug }
    };
}

/**
 * An auth-owned column's declared SQL type, as a tag.
 *
 * `auth-users-columns` states these as SQL because that is the grammar its three
 * creators write in; the plan needs the tag so nothing downstream has to parse a
 * type back apart. Deliberately exhaustive rather than a fallback: a column auth
 * adds with a type nobody mapped should say so here, not turn into `TEXT` in a
 * table the login flow reads.
 */
const AUTH_COLUMN_TYPES: Record<string, PgType> = {
    "TEXT": { kind: "text" },
    "TEXT[]": { kind: "array", of: { kind: "text" } },
    "BOOLEAN": { kind: "boolean" },
    "JSONB": { kind: "jsonb" },
    "TIMESTAMP WITH TIME ZONE": { kind: "timestamptz" }
};

const authColumnType = (sqlType: string): PgType => {
    const mapped = AUTH_COLUMN_TYPES[sqlType];
    if (!mapped) {
        throw new Error(
            `\`auth-users-columns\` declares a column of type "${sqlType}", which the schema plan ` +
            "has no tag for. Add it to `AUTH_COLUMN_TYPES` in schema/plan/plan-schema.ts."
        );
    }
    return mapped;
};

// ── A junction table ─────────────────────────────────────────────────────────

/**
 * Which declaring side a junction is planned from.
 *
 * With one side, that side — as it always was, so a junction only one end
 * declares keeps the key every database already has. With both ends declaring
 * it, the planner used to take whichever it reached first, and the two doors
 * reach them in different orders: `db push` loads files by name, boot walks the
 * bundle's array. The same junction was keyed `(a_id, b_id)` by one and
 * `(b_id, a_id)` by the other, and a push against a boot-built database rebuilt
 * the key. Now the side whose table sorts first, which is the order `db push`
 * already used wherever a file is named after its table.
 */
function canonicalJunctionSide(
    table: string,
    relation: ResolvedRelation,
    source: CollectionConfig,
    spec: JunctionSpec | undefined
): { relation: ResolvedRelation; source: CollectionConfig } {
    if (!spec || spec.declaringSides.length < 2) return { relation, source };
    const ordered = [...spec.declaringSides].sort((a, b) => {
        const left = bareTableName(getTableName(a.collection));
        const right = bareTableName(getTableName(b.collection));
        if (left !== right) return left < right ? -1 : 1;
        return a.junctionColumn < b.junctionColumn ? -1 : a.junctionColumn > b.junctionColumn ? 1 : 0;
    });
    const chosen = ordered[0].collection;
    if (chosen === source) return { relation, source };
    const resolved = Object.values(resolveCollectionRelations(chosen))
        .find(r => isManyToMany(r) && bareTableName(r.through.table) === table);
    return resolved ? { relation: resolved, source: chosen } : { relation, source };
}

function planJunctionTable(
    tableName: string,
    reachedRelation: ResolvedRelation,
    reachedSource: CollectionConfig,
    junctionSpecs: ReturnType<typeof resolveJunctionSpecs>,
    resolveCollection: ResolveCollection,
    triggerFunctionNeeded: { value: boolean }
): TablePlan {
    const { relation, source } = canonicalJunctionSide(
        bareTableName(tableName), reachedRelation, reachedSource, junctionSpecs.get(bareTableName(tableName)));
    if (!isManyToMany(relation)) {
        throw new Error(`Internal: junction table "${tableName}" was reached from a ${relation.kind} relation.`);
    }
    const table = bareTableName(tableName);
    // Junctions live in `public`, full stop — `resolveJunctionSpecs` hardcodes
    // that, so it is where the tables are created and where the derived RLS
    // policies are applied. Inheriting the endpoint's schema put the junction
    // of any m2m onto `users` in `rebase` while its policies were still created
    // against `public.<junction>`: RLS enabled on one table, rows in another.
    const schema = "public";
    const target = relation.target();
    const { sourceColumn, targetColumn } = relation.through;
    // Every declaring side agrees on the edge's lifetime; the first one wins.
    const onDelete = relation.onDelete ?? "CASCADE";

    const spec = junctionSpecs.get(table);
    const legacyFor = (collection: CollectionConfig, column: string): string | undefined => {
        // A junction column's default name is derived from the endpoint
        // collection's slug — normally plural, so this is where the
        // singularization change lands: a `categories` endpoint used to give
        // `categorie_id` and now gives `category_id`. Recorded, not used.
        const slug = toSnakeCase(collection.slug ?? collection.name ?? "");
        const legacy = legacyForeignKeyName(slug);
        return column === generateForeignKeyName(slug) && legacy !== column ? legacy : undefined;
    };

    const via = linkLabel("relation", source, relation.relationName);
    const endpoint = (collection: CollectionConfig, column: string): ColumnPlan => ({
        key: column,
        column,
        type: primaryKeyPgType(collection, via),
        nullable: false,
        // Part of the composite key on {@link TablePlan.primaryKey}, not a
        // key of its own — an inline `PRIMARY KEY` here would be a second one.
        primaryKey: false,
        unique: false,
        legacyColumn: legacyFor(collection, column),
        foreignKey: servesView(collection) ? undefined : foreignKeyPlan({
            schema,
            table,
            column,
            targetSchema: schemaOf(collection),
            targetTable: bareTableName(getTableName(collection)),
            targetColumn: getPrimaryKeyColumn(collection, via),
            onDelete
        }),
        source: { kind: "junction-key" }
    });

    const columns = [endpoint(source, sourceColumn), endpoint(target, targetColumn)];

    // ── The junction's own columns ───────────────────────────────────────────
    // `through.properties`: the `role` on a membership, the `position` on a
    // tag. Planned by the same {@link planPropertyColumn} the collection tables
    // use, against the synthetic collection {@link getJunctionCollectionConfig}
    // builds — so a payload property gets exactly the type, nullability,
    // default, UNIQUE and enum type it would get on a table, and there is no
    // second `switch (prop.type)` anywhere to disagree with the first.
    //
    // Not supported here, and deliberately: `indexes` (declared per collection,
    // and no collection declares a junction), `search`, `vector`, and any
    // linking property — a payload cannot be a `relation`, a `reference` or a
    // `vector`. Config validation refuses those with the relation named; this
    // would otherwise reach `columnPgType` and produce a column no writer knows
    // how to fill.
    const triggers: TriggerPlan[] = [];
    if (spec && Object.keys(spec.properties).length > 0) {
        const junctionCollection = getJunctionCollectionConfig(spec);
        const keyColumns = new Set([sourceColumn, targetColumn]);
        for (const [propName, rawProp] of Object.entries(spec.properties)) {
            const prop = rawProp as Property;
            const plan = planPropertyColumn(propName, prop, {
                collection: junctionCollection,
                resolveCollection,
                schema,
                table,
                auth: false,
                triggers,
                triggerFunctionNeeded
            });
            // A payload column that resolves onto a key column would be a
            // second definition of it — refused by `checkJunctionPayload` at
            // boot, and skipped here so a config that got past it still
            // produces a table rather than a duplicate-column CREATE.
            if (keyColumns.has(plan.column)) continue;
            columns.push(plan);
        }
    }

    // Junction tables are generated tables like any other: locked by default,
    // with derived policies — reads follow the endpoints' visibility, writes
    // follow the declaring side's update rules. Without them they were the one
    // kind of generated table with no RLS at all.
    const policies = spec
        ? withoutLiveSupersededNames(getJunctionSecurityRules(spec).flatMap((rule, index) =>
            compileSecurityRule(
                getJunctionCollectionConfig(spec), rule, resolveCollection, false, rule.name ?? `#${index}`)))
        : [];

    return {
        schema,
        table,
        qualified: `${schema}.${table}`,
        varName: getTableVarName(tableName),
        kind: "junction",
        declaringSlugs: spec?.declaringSides.map(side => side.collection.slug) ?? [],
        columns,
        primaryKey: [sourceColumn, targetColumn],
        // Always, and with no opt-out: the junction is the platform's table,
        // not the author's. The key covers lookups by `sourceColumn`; the
        // reverse side of the link — `tags → posts` — filters on
        // `targetColumn`, which only this index serves.
        indexes: planForeignKeyIndexes(schema, table, columns, [sourceColumn, targetColumn], [],
            column => (column.source.kind === "junction-key" ? column.foreignKey?.column : undefined)),
        vectorColumns: [],
        policies,
        triggers,
        auth: false
    };
}

// ── Drizzle relations ────────────────────────────────────────────────────────

/**
 * The `relations(...)` entries the generated file carries.
 *
 * Both sides of a link must share a `relationName` or Drizzle cannot pair them;
 * `sharedRelationName` is the rule, and each side derives it independently.
 */
function planRelations(
    collections: CollectionConfig[],
    tableEntries: Map<string, { collection: CollectionConfig; junction?: { relation: ResolvedRelation; source: CollectionConfig } }>
): RelationPlan[] {
    const plans: RelationPlan[] = [];

    // Every relation whose foreign key lives on its target's table, grouped by
    // that target's slug, in the order the scan below used to meet them —
    // collections in declaration order, each one's relations in order. Built
    // once: the scan ran once per collection over every other collection's
    // relations, N² in the collection count (24 ms at 200, 204 ms at 1,000).
    const fkOnTargetBySlug = new Map<string, Array<{ other: CollectionConfig; otherRel: ResolvedForeignKeyOnTarget }>>();
    for (const other of collections) {
        for (const otherRel of Object.values(resolveCollectionRelations(other))) {
            if (!hasForeignKeyOnTarget(otherRel)) continue;
            let otherTarget: CollectionConfig;
            try {
                otherTarget = otherRel.target();
            } catch {
                continue;
            }
            const list = fkOnTargetBySlug.get(otherTarget.slug) ?? [];
            list.push({ other, otherRel });
            fkOnTargetBySlug.set(otherTarget.slug, list);
        }
    }

    for (const [tableName, entry] of tableEntries) {
        const tableVar = getTableVarName(tableName);

        if (entry.junction) {
            const { relation, source } = entry.junction;
            if (!isManyToMany(relation)) continue;
            const target = relation.target();
            const via = linkLabel("relation", source, relation.relationName);
            // Each `one()` here pairs with a `many(junction, { relationName })`
            // on its endpoint, so each takes the name that endpoint's own
            // relation derives — the rule `addJunctionSides` in
            // `config-relations.ts` builds the runtime's relations by.
            //
            // The far side is looked up as the target's many-to-many through
            // this same junction. It used to be matched on the *owning* side's
            // name, which `tags.posts` never carries, so the synthesized name
            // won and `tags`' `many(…, { relationName: "posts" })` had nothing
            // to pair with: `with: { posts: true }` threw. Only a junction
            // nothing points back through needs the synthesized name.
            const owningRelationName = sharedRelationName(relation, source);
            let inverse: ResolvedRelation | undefined;
            try {
                inverse = Object.values(resolveCollectionRelations(target)).find(r =>
                    r.kind === "manyToMany" && bareTableName(r.through.table) === bareTableName(tableName));
            } catch {
                // A target whose relations cannot be resolved declares no inverse.
            }
            const inverseRelationName = inverse
                ? sharedRelationName(inverse, target)
                : `${tableName}_${relation.through.targetColumn}`;
            plans.push({
                tableVar,
                key: relation.through.sourceColumn,
                kind: "one",
                targetVar: getTableVarName(getTableName(source)),
                relationName: owningRelationName,
                fields: [relation.through.sourceColumn],
                references: [getPrimaryKeyName(source, via)]
            });
            // A self-referencing link is its own inverse: one name, one
            // endpoint table, and drizzle refuses two relations named alike.
            if (inverseRelationName === owningRelationName) continue;
            // The file declares no variable for a view to pair with.
            if (servesView(target)) continue;
            plans.push({
                tableVar,
                key: relation.through.targetColumn,
                kind: "one",
                targetVar: getTableVarName(getTableName(target)),
                relationName: inverseRelationName,
                fields: [relation.through.targetColumn],
                references: [getPrimaryKeyName(target, via)]
            });
            continue;
        }

        const collection = entry.collection;
        // `resolveCollectionRelations` already deduplicates, but an alias entry
        // for the same foreign key would otherwise emit twice.
        const emitted = new Set<string>();
        for (const [key, relation] of Object.entries(resolveCollectionRelations(collection))) {
            let target: CollectionConfig;
            try {
                target = relation.target();
            } catch {
                // A link to a collection outside this bundle is not a relation
                // this file can describe.
                continue;
            }
            // Nor is a link into a view, which the file declares no table for.
            if (servesView(target)) continue;
            const targetVar = getTableVarName(getTableName(target));
            const relationName = sharedRelationName(relation, collection);
            const dedupe = `${relationName}::${relation.kind}`;
            if (emitted.has(dedupe)) continue;
            emitted.add(dedupe);

            switch (relation.kind) {
                case "belongsTo":
                    plans.push({
                        tableVar,
                        key,
                        kind: "one",
                        targetVar,
                        relationName,
                        // `localKey` is a COLUMN and the generated object is
                        // keyed by PROPERTY: `user_id` is exposed as `userId`,
                        // and emitting the column produces a file that does not
                        // compile.
                        fields: [fieldKeyForColumn(collection, relation.localKey)],
                        references: [getPrimaryKeyName(target, linkLabel("relation", collection, key))]
                    });
                    break;
                case "hasOne":
                    // The foreign key lives on the TARGET table, so this side
                    // states the join from its own end: its source key against
                    // the target's foreign key, under the owning side's name.
                    // Drizzle has no `one()` paired by `relationName` alone:
                    // `one(target, { relationName })` is not a `RelationConfig`
                    // (TS2345) and `createOne` reads `config.fields.reduce(...)`.
                    // A bare `one(target)` is paired by table, which throws once
                    // the target has two links back here or the link is to its
                    // own table.
                    plans.push({
                        tableVar,
                        key,
                        kind: "one",
                        targetVar,
                        relationName,
                        fields: [relation.sourceKey
                            ? fieldKeyForColumn(collection, relation.sourceKey)
                            : getPrimaryKeyName(collection, linkLabel("relation", collection, key))],
                        references: [fieldKeyForColumn(target, relation.foreignKeyOnTarget)],
                        nullable: true
                    });
                    break;
                case "hasMany":
                    plans.push({ tableVar, key, kind: "many", targetVar, relationName });
                    break;
                case "manyToMany":
                    plans.push({
                        tableVar,
                        key,
                        kind: "many",
                        targetVar: getTableVarName(relation.through.table),
                        relationName
                    });
                    break;
                case "via":
                    // A join chain is resolved at query time, not modelled as a
                    // Drizzle relation.
                    break;
            }
        }

        // Reciprocals the far side declares and this one does not. Drizzle
        // needs both halves of a pair to exist for a relational query to work.
        for (const { other, otherRel } of fkOnTargetBySlug.get(collection.slug) ?? []) {
            if (other.slug === collection.slug) continue;
            const relationName = sharedRelationName(otherRel, other);
            const dedupe = `${relationName}::belongsTo`;
            if (emitted.has(dedupe)) continue;
            emitted.add(dedupe);
            const otherVar = getTableVarName(getTableName(other));
            const fieldKey = fieldKeyForColumn(collection, otherRel.foreignKeyOnTarget);
            plans.push({
                tableVar,
                key: `_synth_${otherVar}_${fieldKey}`,
                kind: "one",
                targetVar: otherVar,
                relationName,
                fields: [fieldKey],
                // The column the far side points at: its primary key,
                // unless the link names another one with `sourceKey`.
                references: [otherRel.sourceKey
                    ? fieldKeyForColumn(other, otherRel.sourceKey)
                    : getPrimaryKeyName(other, linkLabel("relation", other, otherRel.relationName))]
            });
        }
    }

    return plans;
}

export { SET_UPDATED_AT_FN };
