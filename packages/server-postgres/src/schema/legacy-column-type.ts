/**
 * TRANSITIONAL (Postgres-first Stage B): the legacy collection readings the
 * schema planner no longer makes, kept for the consumers outside the planner
 * that still decide from lowered collections — `doctor.ts` (`columnPgType`)
 * and `generate-postgres-ddl-logic.ts` (`compileSecurityRule`). The planner
 * (`plan/**`) reads descriptors only; it must never import this file. The next
 * slice moves those consumers onto descriptors and deletes it.
 */
import {
    isPostgresCollectionConfig,
    type ArrayProperty,
    type CollectionConfig,
    type ColumnDef,
    type DateProperty,
    type MapProperty,
    type NumberProperty,
    type Property,
    type ReferenceProperty,
    type RelationProperty,
    type SecurityRule,
    type StringProperty,
    type VectorProperty
} from "@rebasepro/types";
import {
    findRelation,
    getEnumVarName,
    getTableName,
    legacyTableResolver,
    policyTableFromCollection,
    resolveCollectionRelations,
    resolveStringColumnLength
} from "@rebasepro/common";
import { toSnakeCase } from "@rebasepro/utils";
import {
    enumLabelsOf,
    getPrimaryKeyProp,
    isIdProperty,
    resolveColumnName,
    tableColumnOf
} from "./column-plan-helpers";
import { compileTableSecurityRule, pgTypeOf, type DefinedColumnSite } from "./plan/plan-schema";
import type { PgType, PolicyPlan } from "./plan/types";

type ResolveCollection = (slug: string) => CollectionConfig | undefined;

const schemaOf = (collection: CollectionConfig): string =>
    isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";


const describe = (collection: CollectionConfig): string =>
    collection.slug ?? collection.name ?? "(unnamed)";

/** A link, as a refusal names it: `relation "posts.author"`. */
const linkLabel = (kind: string, collection: CollectionConfig, key: string): string =>
    `${kind} "${describe(collection)}.${key}"`;


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
        return withoutSequence(definedPgType(definition, collectionSite(collection, name, definedColumnName(name, definition))));
    }
    if (prop?.type === "number") {
        return withoutSequence(numberType(name, prop as NumberProperty, collection, true));
    }
    if (prop?.type === "string") return stringType(name, prop as StringProperty, collection);
    // The implicit `id TEXT PRIMARY KEY` of a collection that declares no key.
    return { kind: "text" };
};

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
    if (definition) return definedPgType(definition, collectionSite(collection, propName, definedColumnName(propName, definition)));
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
                "Add a case to `columnPgType` in schema/legacy-column-type.ts."
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


/** The site of a column on a lowered collection (or a junction's synthetic one). */
const collectionSite = (collection: CollectionConfig, propName: string, column: string): DefinedColumnSite => ({
    schema: schemaOf(collection),
    table: getTableName(collection),
    owner: describe(collection),
    propName,
    column
});

/** A defined column's SQL name: the one it states, or the snake_case of its key. */
const definedColumnName = (propName: string, definition: ColumnDef): string =>
    definition.column ?? toSnakeCase(propName);


/**
 * The Postgres type a column definition states.
 *
 * One arm per {@link ColumnType} member: the two type unions are kept 1:1, so
 * this is a renaming, not a derivation. An enum is the one member that needs
 * the site — its type is named after the table and column it is declared on,
 * unless the definition names a shared type.
 */
const definedPgType = (definition: ColumnDef, site: DefinedColumnSite): PgType =>
    pgTypeOf(definition.type, site);

/**
 * One security rule of a collection, compiled to its policies: the collection
 * read as a `PolicyTable` (`policyTableFromCollection`) and compiled by
 * {@link compileTableSecurityRule}, the planner's own compiler.
 */
export const compileSecurityRule = (
    collection: CollectionConfig,
    rule: SecurityRule,
    resolveCollection: ResolveCollection,
    injected: boolean,
    ruleKey = rule.name ?? "(unnamed)"
): PolicyPlan[] =>
    compileTableSecurityRule(
        policyTableFromCollection(collection, resolveCollection),
        rule,
        legacyTableResolver(resolveCollection),
        injected,
        ruleKey);
