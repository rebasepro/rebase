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
 * an empty enum, two `isId` properties, `isId: "cuid"`, an unknown
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
    type Property,
    type ReferenceProperty,
    type RelationProperty,
    type ResolvedRelation,
    type SecurityRule,
    type StringProperty,
    type VectorProperty,
    hasForeignKeyOnTarget
} from "@rebasepro/types";
import {
    fieldKeyForColumn,
    findRelation,
    getEffectiveSecurityRules,
    getEnumVarName,
    getInjectedSecurityRules,
    getJunctionCollectionConfig,
    getJunctionSecurityRules,
    getTableName,
    getTableVarName,
    policyToPostgres,
    relationalCollections,
    resolveCollectionRelations,
    resolveJunctionSpecs,
    resolveStringColumnLength,
    securityRuleToConditions
} from "@rebasepro/common";
import {
    generateForeignKeyName,
    getPolicyNamesForRule,
    legacyForeignKeyName,
    toPostgresIdentifier,
    toSnakeCase
} from "@rebasepro/utils";
import {
    assertSinglePrimaryKey,
    declaresEnumType,
    enumLabelsOf,
    getPrimaryKeyName,
    getPrimaryKeyProp,
    idColumnDefault,
    isIdProperty,
    resolveColumnName
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
import { buildCollectionIndexSpecs } from "../collection-index";
import { sharedRelationName } from "../relation-names";
import { SET_UPDATED_AT_FN, setUpdatedAtFunction } from "./updated-at-trigger";
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
    TriggerPlan
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
 * One function because it was three: the ladder was spelled inline in
 * `generatePostgresDdl`, again in `planJunctionTables` and a third time in the
 * Drizzle generator.
 */
export const primaryKeyPgType = (collection: CollectionConfig): PgType => {
    const pk = getPrimaryKeyProp(collection);
    if (pk.type === "number") return { kind: "integer" };
    return pk.isUuid ? { kind: "uuid" } : { kind: "text" };
};

/** The `columnType`s a `number` property may name, and what each one is. */
const NUMBER_COLUMN_TYPES: Record<string, PgType> = {
    "integer": { kind: "integer" },
    "smallint": { kind: "smallint" },
    "bigint": { kind: "bigint" },
    "serial": { kind: "serial" },
    "bigserial": { kind: "bigserial" },
    "real": { kind: "real" },
    "double precision": { kind: "doublePrecision" },
    "numeric": { kind: "numeric" }
};

const numberType = (propName: string, prop: NumberProperty, collection: CollectionConfig, isId: boolean): PgType => {
    // An identity column is INTEGER, and `columnType` is not read beside it, on
    // purpose. Every column that points at a numeric primary key is INTEGER
    // (`primaryKeyPgType`), so a BIGINT identity would be referenced by int4
    // foreign keys — the int8/int4 truncation this repo has already been bitten
    // by. The Drizzle generator used to honour `columnType` here while the DDL
    // one ignored it, so the same property was int8 in `schema.generated.ts` and
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
const columnPgType = (
    propName: string,
    prop: Property,
    collection: CollectionConfig,
    resolveCollection: ResolveCollection
): PgType => {
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
            return target ? primaryKeyPgType(target) : { kind: "text" };
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
            const iso = value instanceof Date
                ? (Number.isNaN(value.getTime()) ? undefined : value.toISOString())
                : typeof value === "string" ? value : undefined;
            return iso === undefined ? undefined : { kind: "literal", value: iso, sql: quoteSqlLiteral(iso) };
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

/** The DEFAULT a column carries: id strategy, then `autoValue`, then `defaultValue`. */
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
    return literalDefault(prop, type);
};

// ── Policies ─────────────────────────────────────────────────────────────────

/**
 * One security rule, compiled to the clauses a policy is made of.
 *
 * The desugaring (`access` / `ownerField` / `roles` / structured condition /
 * raw SQL → `PolicyExpression`) and the SQL compilation are `@rebasepro/common`'s,
 * which is what the client-side evaluator uses too — so the UI, the DDL and the
 * database agree about who can read a row. What lives here is only the shape:
 * which operations a rule expands to, which clauses each operation takes, and
 * the deny-all fallback for a clause that compiled to nothing.
 */
export const compileSecurityRule = (
    collection: CollectionConfig,
    rule: SecurityRule,
    resolveCollection: ResolveCollection,
    injected: boolean
): PolicyPlan[] => {
    const tableName = getTableName(collection);
    const ops = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
    const policyNames = getPolicyNamesForRule(rule, tableName);
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);

    return ops.map((operation, index) => {
        const needsUsing = operation !== "insert";
        const needsWithCheck = operation !== "select" && operation !== "delete";
        let using = needsUsing && usingExpr ? policyToPostgres(usingExpr, collection, { resolveCollection }) : null;
        let withCheck = needsWithCheck && withCheckExpr ? policyToPostgres(withCheckExpr, collection, { resolveCollection }) : null;
        // A clause that compiled to nothing denies rather than opens.
        if (!using && needsUsing) using = "false";
        if (!withCheck && needsWithCheck) withCheck = "false";
        return {
            name: policyNames[index],
            operation,
            mode: rule.mode ?? "permissive",
            roles: rule.pgRoles ? [...rule.pgRoles].sort() : ["public"],
            using,
            withCheck,
            injected
        };
    });
};

// ── The planner ──────────────────────────────────────────────────────────────

export function planSchema(allCollections: CollectionConfig[], options: PlanOptions = {}): SchemaPlan {
    // Before the filter, deliberately: a `search` block on a collection this
    // engine does not store would otherwise be dropped without a word.
    assertSearchIsPostgresOnly(allCollections);

    // A Firestore or MongoDB collection has no table here, and generating one
    // is not merely wasted output: `db push` would create it, and the doctor
    // would then report the store the collection actually reads from as drift.
    const collections = relationalCollections(allCollections);
    collections.forEach(assertSinglePrimaryKey);

    const resolveCollection: ResolveCollection = (slug) =>
        collections.find(c => c.slug === slug || getTableName(c) === slug);

    const declaredSchemas = Array.from(new Set(
        collections.map(c => (isPostgresCollectionConfig(c) ? c.schema : undefined)).filter(Boolean) as string[]
    ));
    const schemas = Array.from(new Set([REBASE_SCHEMA, ...declaredSchemas]));

    // ── Enum types ───────────────────────────────────────────────────────────
    // The name is derived from table + column, so two collections mapped onto
    // the same table — or two properties whose `columnName` resolves to the
    // same column — land on the same type. `CREATE TYPE` has no IF NOT EXISTS,
    // so emitting it twice aborts the whole file; deduplicated by name here,
    // once, for every renderer.
    const enums: EnumPlan[] = [];
    const seenEnums = new Set<string>();
    for (const collection of collections) {
        for (const [propName, rawProp] of Object.entries(collection.properties ?? {})) {
            const prop = rawProp as Property;
            if (!("enum" in prop) || !prop.enum) continue;
            if (prop.type !== "string" && prop.type !== "number") continue;
            // Refuses an empty list whatever the property's type, then declares
            // a type only for the string ones: a `number` enum's column is
            // NUMERIC or INTEGER on every path, so the type used to be created
            // and referenced by nothing.
            const labels = enumLabelsOf(propName, prop, collection);
            if (!declaresEnumType(prop)) continue;
            const schema = schemaOf(collection);
            const name = `${getTableName(collection)}_${resolveColumnName(propName, prop)}`;
            const qualified = `${schema}.${name}`;
            if (seenEnums.has(qualified)) continue;
            seenEnums.add(qualified);
            enums.push({
                schema,
                name,
                qualified,
                declaredSchema: isPostgresCollectionConfig(collection) ? collection.schema : undefined,
                varName: getEnumVarName(getTableName(collection), propName),
                labels
            });
        }
    }

    // ── The table set ────────────────────────────────────────────────────────
    // Each collection's table, then any junction its relations imply, in the
    // order the collections arrive. `schema.sql` and `schema.generated.ts` are
    // compared against their committed copies, so this order is the file's.
    const tableEntries = new Map<string, {
        collection: CollectionConfig;
        junction?: { relation: ResolvedRelation; source: CollectionConfig };
    }>();
    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (tableName) tableEntries.set(tableName, { collection });
        for (const relation of Object.values(resolveCollectionRelations(collection))) {
            if (!isManyToMany(relation)) continue;
            const junctionTable = relation.through.table;
            if (tableEntries.has(junctionTable)) continue;
            tableEntries.set(junctionTable, {
                collection: { table: junctionTable, properties: {} } as CollectionConfig,
                junction: { relation, source: collection }
            });
        }
    }

    const junctionSpecs = resolveJunctionSpecs(collections);
    const triggerFunctionNeeded = { value: false };

    const tables: TablePlan[] = [];
    for (const [tableName, entry] of tableEntries) {
        tables.push(entry.junction
            ? planJunctionTable(tableName, entry.junction.relation, entry.junction.source, junctionSpecs, resolveCollection)
            : planCollectionTable(entry.collection, resolveCollection, triggerFunctionNeeded));
    }

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

    return {
        schemas,
        declaredSchemas,
        enums,
        tables,
        relations: planRelations(collections, tableEntries),
        extensions,
        functions,
        collections,
        options
    };
}

// ── A collection's table ─────────────────────────────────────────────────────

function planCollectionTable(
    collection: CollectionConfig,
    resolveCollection: ResolveCollection,
    triggerFunctionNeeded: { value: boolean }
): TablePlan {
    const schema = schemaOf(collection);
    const table = bareTableName(getTableName(collection));
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
            triggerFunctionNeeded.value = true;
            triggers.push({
                schema,
                table,
                column,
                name: toPostgresIdentifier(`${table}_${column}_touch`)
            });
        }
        columns.push(plan);
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
                type: { kind: "text" },
                nullable: spec.notNull !== true,
                primaryKey: false,
                unique: false,
                sqlDefinition: authUsersColumnSql(spec),
                source: { kind: "auth", slug: collection.slug }
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
            source: { kind: "search", slug: collection.slug }
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
                source: { kind: "search", slug: collection.slug }
            });
        }
    }

    // A collection that declares no primary key gets an implicit `id TEXT
    // PRIMARY KEY`, which is what `derivePrimaryKeys` reads back.
    if (!columns.some(c => c.primaryKey)) {
        columns.unshift({
            key: "id",
            column: "id",
            type: { kind: "text" },
            nullable: false,
            primaryKey: true,
            unique: false,
            source: { kind: "implicit-id", slug: collection.slug }
        });
    }

    const injected = new Set(getInjectedSecurityRules(collection).map(rule => rule.name));
    const policies = getEffectiveSecurityRules(collection).flatMap(rule =>
        compileSecurityRule(collection, rule, resolveCollection, Boolean(rule.name && injected.has(rule.name))));

    return {
        schema,
        table,
        qualified: `${schema}.${table}`,
        declaredSchema: isPostgresCollectionConfig(collection) ? collection.schema : undefined,
        varName: getTableVarName(getTableName(collection)),
        kind: "collection",
        slug: collection.slug,
        columns,
        primaryKey: columns.filter(c => c.primaryKey).map(c => c.column),
        indexes: buildCollectionIndexSpecs(collection, resolveColumnName),
        search,
        vector: buildVectorIndexPlan(collection, resolveColumnName),
        vectorColumns: buildVectorColumnSpecs(collection, resolveColumnName),
        policies,
        triggers,
        auth
    };
}

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

    const required = prop.validation?.required === true;
    // The relation and an explicit FK property can both be declared; the
    // explicit one owns the column, and the relation still owns the constraint.
    // Asked of the *field key* rather than the column — `properties["post_id"]`
    // is not where a property declared `postId: { columnName: "post_id" }`
    // lives, so this used to emit the column twice and `CREATE TABLE` failed
    // with "column specified more than once".
    const fkFieldKey = fieldKeyForColumn(collection, relation.localKey);
    const columnOwnedByProperty = Boolean(collection.properties?.[fkFieldKey]) && propName !== fkFieldKey;

    // Only a *derived* column name can be affected by the change to
    // `generateForeignKeyName`; one the author wrote is theirs.
    const relationName = prop.relation?.relationName ?? propName;
    const legacyKey = legacyForeignKeyName(relationName);
    const derived = relation.localKey === generateForeignKeyName(relationName);

    return {
        key: fkFieldKey,
        column: relation.localKey,
        type: primaryKeyPgType(target),
        nullable: !required,
        primaryKey: false,
        // `validation.unique` on a link is a one-to-one, and all three emitters
        // dropped it: the property said unique, the column was not, and a
        // second row could point at the same parent.
        unique: prop.validation?.unique === true,
        columnOwnedByProperty: columnOwnedByProperty || undefined,
        legacyColumn: derived && legacyKey !== relation.localKey ? legacyKey : undefined,
        foreignKey: foreignKeyPlan({
            schema,
            table,
            column: relation.localKey,
            targetSchema: schemaOf(target),
            targetTable: bareTableName(getTableName(target)),
            targetColumn: getPrimaryKeyName(target),
            onDelete: relation.onDelete ?? defaultBelongsToOnDelete(required),
            onUpdate: relation.onUpdate
        }),
        source: { kind: "relation", propName, slug: collection.slug }
    };
}

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
    const column = resolveColumnName(propName, prop as unknown as Property);
    const required = prop.validation?.required === true;

    return {
        key: propName,
        column,
        // A `reference` whose target is not in the bundle keeps its column (the
        // id is still a string) and gets no constraint.
        type: target ? primaryKeyPgType(target) : { kind: "text" },
        nullable: !required,
        primaryKey: false,
        unique: prop.validation?.unique === true,
        foreignKey: target
            ? foreignKeyPlan({
                schema,
                table,
                column,
                targetSchema: schemaOf(target),
                targetTable: bareTableName(getTableName(target)),
                targetColumn: getPrimaryKeyName(target),
                // The same rule as `belongsTo`, from the same function. A
                // `reference` carries no `onDelete` of its own to override it.
                onDelete: defaultBelongsToOnDelete(required)
            })
            : undefined,
        source: { kind: "reference", propName, slug: collection.slug }
    };
}

// ── A junction table ─────────────────────────────────────────────────────────

function planJunctionTable(
    tableName: string,
    relation: ResolvedRelation,
    source: CollectionConfig,
    junctionSpecs: ReturnType<typeof resolveJunctionSpecs>,
    resolveCollection: ResolveCollection
): TablePlan {
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

    const endpoint = (collection: CollectionConfig, column: string): ColumnPlan => ({
        key: column,
        column,
        type: primaryKeyPgType(collection),
        nullable: false,
        // Part of the composite key on {@link TablePlan.primaryKey}, not a
        // key of its own — an inline `PRIMARY KEY` here would be a second one.
        primaryKey: false,
        unique: false,
        legacyColumn: legacyFor(collection, column),
        foreignKey: foreignKeyPlan({
            schema,
            table,
            column,
            targetSchema: schemaOf(collection),
            targetTable: bareTableName(getTableName(collection)),
            targetColumn: getPrimaryKeyName(collection),
            onDelete
        }),
        source: { kind: "junction-key" }
    });

    const columns = [endpoint(source, sourceColumn), endpoint(target, targetColumn)];

    // Junction tables are generated tables like any other: locked by default,
    // with derived policies — reads follow the endpoints' visibility, writes
    // follow the declaring side's update rules. Without them they were the one
    // kind of generated table with no RLS at all.
    const policies = spec
        ? getJunctionSecurityRules(spec).flatMap(rule =>
            compileSecurityRule(getJunctionCollectionConfig(spec), rule, resolveCollection, false))
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
        indexes: [],
        vectorColumns: [],
        policies,
        triggers: [],
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

    for (const [tableName, entry] of tableEntries) {
        const tableVar = getTableVarName(tableName);

        if (entry.junction) {
            const { relation, source } = entry.junction;
            if (!isManyToMany(relation)) continue;
            const target = relation.target();
            // The owning relation's name, shared with the source table's
            // `many(junction, { relationName })`.
            const owningRelationName = relation.relationName ?? toSnakeCase(getTableName(target));
            let inverseRelationName: string | undefined;
            try {
                for (const targetRel of Object.values(resolveCollectionRelations(target))) {
                    if (targetRel.kind !== "belongsTo"
                        && targetRel.cardinality === "many"
                        && targetRel.relationName === owningRelationName) {
                        inverseRelationName = targetRel.relationName;
                        break;
                    }
                }
            } catch {
                // The inverse side may not exist; the synthesized name below is
                // then what keeps the two `one()`s from colliding.
            }
            plans.push({
                tableVar,
                key: relation.through.sourceColumn,
                kind: "one",
                targetVar: getTableVarName(getTableName(source)),
                relationName: owningRelationName,
                fields: [relation.through.sourceColumn],
                references: [getPrimaryKeyName(source)]
            });
            plans.push({
                tableVar,
                key: relation.through.targetColumn,
                kind: "one",
                targetVar: getTableVarName(getTableName(target)),
                relationName: inverseRelationName ?? `${tableName}_${relation.through.targetColumn}`,
                fields: [relation.through.targetColumn],
                references: [getPrimaryKeyName(target)]
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
                        references: [getPrimaryKeyName(target)]
                    });
                    break;
                case "hasOne":
                    // The foreign key lives on the TARGET table, so this side
                    // has no `fields`/`references` to give — and Drizzle has no
                    // third form. `one(target, { relationName })` is not a
                    // `RelationConfig` (TS2345) *and* not something the runtime
                    // survives: `createOne` reads `config.fields.reduce(...)`
                    // unconditionally. A bare `one(target)` is the documented
                    // FK-less form.
                    plans.push({ tableVar, key, kind: "one", targetVar });
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
        for (const other of collections) {
            if (other.slug === collection.slug) continue;
            for (const otherRel of Object.values(resolveCollectionRelations(other))) {
                if (!hasForeignKeyOnTarget(otherRel)) continue;
                let otherTarget: CollectionConfig;
                try {
                    otherTarget = otherRel.target();
                } catch {
                    continue;
                }
                if (otherTarget.slug !== collection.slug) continue;
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
                        : getPrimaryKeyName(other)]
                });
            }
        }
    }

    return plans;
}

export { SET_UPDATED_AT_FN };
