/**
 * The bridge from the table model to the collection shape today's planner and
 * runtime read.
 *
 * Stage A of the Postgres-first refactor (docs/plans/POSTGRES-FIRST.md, Part II
 * D) makes `defineTable` the front door while `planSchema`, the collection
 * registry and the drivers keep reading `PostgresCollectionConfig`. This module
 * is that seam: it rewrites a `defineTable` / `defineAuthTable` / `defineView`
 * into the legacy object such that, for an equivalent schema, the planner's
 * output is byte-identical. It is temporary — Stage B moves those consumers
 * onto `TableDescriptor` and deletes this file — so it adds nothing to the
 * legacy model and invents no shim: what the legacy shape cannot say is listed
 * in {@link PENDING_TABLE_FEATURES} and refused by name.
 *
 * The shape it produces, so that every reader of a lowered collection can rely
 * on it:
 *
 * - every relation is an entry of `relations`, its key pinned as
 *   `relationName`, in the order the table declares them — which is the order
 *   `resolveCollectionRelations` (and so the Drizzle `relations()` block and the
 *   junction planning) walks;
 * - every relation is also a `type: "relation"` property addressing that entry
 *   by name. A `belongsTo` bound to a column in `columns` that is nothing but
 *   the foreign key (same key as the relation would derive, the target's key
 *   type, no rule of its own) takes that column's place, so its foreign key is
 *   planned where the column was declared;
 * - a bound column that carries more (its own type, a key, a default, rules…)
 *   stays a property of its own, and a relation property carrying only the
 *   constraint joins the other relation properties — the legacy "explicit FK
 *   property" form. Those, and the derived foreign keys, sit next to the
 *   relation property before or after them in relation order (the legacy shape
 *   lists relation properties together), or after the declared columns; the
 *   other kinds come last;
 * - `rel.belongsTo({ constraint: false })` keeps its column — bound (the
 *   column stays a property, the relation property beside it) or derived —
 *   and the planner, reading the relation's definition, plans no `FOREIGN KEY`
 *   for it while still indexing it unless `index: false`;
 * - an `id` column that is exactly the planner's implicit key
 *   (`id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text`, declared first) is
 *   left out, and the planner adds it back as it always has.
 */
import {
    columnTypeLabel,
    isTableDef,
    isViewDef,
    resourceKeyOf,
    Vector,
    type AnyTableDef,
    type AnyViewDef,
    type ArrayProperty,
    type CollectionCallbacks,
    type CollectionIndex,
    type ColumnDef,
    type ColumnTransform,
    type ColumnType,
    type DateProperty,
    type DefaultRls,
    type FieldAccess,
    type IndexKey,
    type IndexPredicate,
    type JsonShapeDef,
    type MapProperty,
    type NumberProperty,
    type PostgresCollectionConfig,
    type PostgresProperties,
    type PostgresProperty,
    type Properties,
    type Property,
    type PropertyCallbacks,
    type Relation,
    type RelationDef,
    type RelationProperty,
    type SecurityRule,
    type StorageConfig,
    type StringProperty,
    type TableDescriptor,
    type TableHooks,
    type TableIndex,
    type TableIndexKey,
    type TableIndexPredicate,
    type VectorDistance,
    type VectorIndexConfig,
    type VectorIndexOptions,
    type VectorMetric,
    type ColumnStorage,
    type ColumnValidation,
    type AuthCollectionConfig,
    type AuthTableOptions,
    type PropertyValidationSchema,
    type StringPropertyValidationSchema,
    type NumberPropertyValidationSchema,
    type DatePropertyValidationSchema,
    type ArrayPropertyValidationSchema,
    type EnumValueConfig
} from "@rebasepro/types";
import { generateForeignKeyName, labelFromIdentifier, singularLabel, toSnakeCase, toWireKey } from "@rebasepro/utils";

import { SchemaDefinitionError, type SchemaDefinitionProblem } from "./errors";

// ── What the legacy shape cannot say ─────────────────────────────────────────

/**
 * One thing the table model can say that the legacy collection shape cannot.
 *
 * @group Schema
 */
export interface PendingTableFeature {
    /** Stable id, quoted in the refusal. */
    readonly id: string;
    /** What the definition said, and why it cannot be lowered yet. */
    readonly description: string;
}

/**
 * Everything `lowerTables` refuses because the legacy collection shape — and so
 * today's planner and runtime — has no way to say it.
 *
 * Each one is a capability of `defineTable` that is not yet implemented end to
 * end: a definition using it is refused with a `SchemaDefinitionError` naming
 * the table, the column or relation, and the id below, rather than lowered to
 * something that means less. The planner already plans a lowered column from
 * its own definition; what is left here waits on the request-time side —
 * write validation and the relation service moving onto descriptors — which
 * implements each natively and deletes its entry.
 *
 * @group Schema
 */
export const PENDING_TABLE_FEATURES = [
    {
        id: "array-element-modifiers",
        description: "An array element declaring more than `.validate()`, `.oneOf()`, storage or `.transform()` (a default, `.notNull()`, `.unique()`, access…). Those apply to a column, not to the items of one."
    },
    {
        id: "text-one-of",
        description: "`.oneOf([...])` on a text column outside an array. The planner plans the column as TEXT from its definition, but the runtime reads a closed set of strings only as a legacy `enum`, which its other readers (search, the doctor, enum label upkeep) take for a Postgres enum type; use `col.enum()` until write validation reads the descriptor."
    },
    {
        id: "has-many-order-by",
        description: "`rel.hasMany(target, { orderBy })`. Related rows come back in the caller's order only."
    },
    {
        id: "json-document-shape",
        description: "A `json`/`jsonb` column whose shape is a scalar or a `json.oneOf()` at the top. A document is an object or an array today."
    },
    {
        id: "json-one-of-placement",
        description: "`json.oneOf()` anywhere but as the item of a `json.array()`. Typed blocks exist only as array items today."
    },
    {
        id: "json-unknown-field",
        description: "`json.unknown()` as a field of a `json.object()` or a variant of a `json.oneOf()`. Only an array item may be left untyped today."
    },
    {
        id: "array-unique-items",
        description: "`.validate({ uniqueItems: true })` on an array. The API does not check it yet."
    }
] as const satisfies readonly PendingTableFeature[];

/** The id of a {@link PendingTableFeature}. */
export type PendingTableFeatureId = (typeof PENDING_TABLE_FEATURES)[number]["id"];

// ── A custom type, as DDL may name it ────────────────────────────────────────

/** One token of a type name: a word, a quoted identifier, `.`, a modifier list, `[]`. */
const CUSTOM_TYPE_TOKEN = /\s*(?:([A-Za-z_][A-Za-z0-9_$]*)|("(?:[^"]|"")+")|(\.)|(\(\s*[A-Za-z0-9_+\-.]+\s*(?:,\s*[A-Za-z0-9_+\-.]+\s*)*\))|(\[\d*\]))/y;

/**
 * Why a `col.custom(sqlType)` type cannot be written into DDL, or `undefined`
 * when it can.
 *
 * The type is written verbatim — into `CREATE TABLE`, `ADD COLUMN` and the
 * Drizzle file — so only the shape of a Postgres type name is accepted, and
 * nothing in it can end the statement or open a string:
 *
 * - words, separated by spaces (`timestamp without time zone`,
 *   `double precision`), or double-quoted identifiers (`"My Type"`);
 * - one schema qualifier (`public.citext`, `"geo"."point3"`);
 * - a modifier list after a word, of words, numbers and signs separated by
 *   commas (`geometry(Point, 4326)`, `numeric(10, 2)`, `timestamp(3)`);
 * - array brackets at the end (`inet[]`, `int4range[][]`, `text[3]`).
 *
 * Anything else is refused: a single quote, a semicolon, a comment, an
 * operator, an unbalanced bracket, more than 200 characters. A column clause
 * written after the name (`inet DEFAULT x`, `inet NOT NULL`) has the shape of
 * more words, so the words that begin one are refused by name.
 *
 * @group Schema
 */
export function customSqlTypeProblem(sqlType: string): string | undefined {
    const text = sqlType.trim();
    if (text.length === 0) return "is empty";
    if (text.length > 200) return "is longer than 200 characters";
    let state: "start" | "name" | "dot" | "modified" | "array" = "start";
    const words: string[] = [];
    CUSTOM_TYPE_TOKEN.lastIndex = 0;
    let position = 0;
    while (position < text.length) {
        CUSTOM_TYPE_TOKEN.lastIndex = position;
        const match = CUSTOM_TYPE_TOKEN.exec(text);
        if (!match || match[0].length === 0) return `cannot be read as a type name at "${text.slice(position)}"`;
        position = CUSTOM_TYPE_TOKEN.lastIndex;
        const [, word, quoted, dot, modifiers, brackets] = match;
        if (word !== undefined || quoted !== undefined) {
            if (state === "array") return "has a word after its array brackets";
            if (word !== undefined) words.push(word.toLowerCase());
            state = "name";
        } else if (dot !== undefined) {
            if (state !== "name") return "has a `.` that does not separate a schema from a type";
            state = "dot";
        } else if (modifiers !== undefined) {
            if (state !== "name") return "has a modifier list that follows no type name";
            state = "modified";
        } else if (brackets !== undefined) {
            if (state === "start" || state === "dot") return "has array brackets that follow no type name";
            state = "array";
        }
    }
    if (state === "start" || state === "dot") return "ends without a type name";
    const clause = words.find(word => CLAUSE_WORDS.has(word));
    if (clause !== undefined) return `holds \`${clause}\`, which starts a column clause, not a type`;
    return undefined;
}

/** Words that begin a column clause after a type — never part of a type name. */
const CLAUSE_WORDS: ReadonlySet<string> = new Set([
    "default", "not", "null", "constraint", "references", "check", "unique", "primary", "generated", "collate", "using"
]);

// ── What a lowered collection carries for the planner ────────────────────────

/**
 * The definitions a lowered property was made from, carried on it.
 *
 * The planner plans a column from its own definition when it has one —
 * `ColumnType` to Postgres type directly, nullability, keys, defaults,
 * `generatedAs` and stamps read off the {@link ColumnDef} — and re-derives
 * nothing from the document-shaped property beside it. The legacy fields stay
 * for the runtime, which still reads them until it moves onto descriptors.
 *
 * - `tableColumn` — on a property lowered from a column, that column; on a
 *   `belongsTo` relation property that absorbed its bound column, that column.
 * - `tableRelation` — on a relation property, the `rel.*` definition.
 *
 * Neither is part of the legacy `Property` type: they exist only on what
 * `lowerTables` returns, and are deleted with it.
 *
 * @group Schema
 */
export interface LoweredDefinitions {
    /** The column this property was lowered from. */
    tableColumn?: ColumnDef;
    /** The relation this property addresses. */
    tableRelation?: RelationDef;
}

/**
 * A property as `lowerTables` produces it: the legacy property, and the
 * definitions it was lowered from.
 *
 * @group Schema
 */
export type LoweredProperty = PostgresProperty & LoweredDefinitions;

/**
 * An index as `lowerTables` produces it: the legacy entry, and the table index
 * it was lowered from (whose `reason` is optional).
 *
 * @group Schema
 */
export type LoweredIndex = CollectionIndex & { tableIndex?: TableIndex };

/**
 * A collection as `lowerTables` produces it.
 *
 * @group Schema
 */
export type LoweredCollection = PostgresCollectionConfig & {
    properties: Record<string, LoweredProperty>;
    indexes?: LoweredIndex[];
};

/** A property, carrying the column it was lowered from. */
const fromColumn = <P extends PostgresProperty>(property: P, column: ColumnDef): P & LoweredDefinitions =>
    Object.assign(property, { tableColumn: column });

/** A relation property, carrying the relation it addresses. */
const fromRelation = <P extends PostgresProperty>(property: P, relation: RelationDef): P & LoweredDefinitions =>
    Object.assign(property, { tableRelation: relation });

const pendingDescription = (id: PendingTableFeatureId): string =>
    PENDING_TABLE_FEATURES.find(feature => feature.id === id)?.description ?? id;

// ── Options ──────────────────────────────────────────────────────────────────

/**
 * What `lowerTables` needs besides the definitions.
 *
 * @group Schema
 */
export interface LowerTablesOptions {
    /** The `defaultRls` exported from `backend/schema/index.ts`: what `rls: "inherit"` resolves to. */
    defaultRls?: DefaultRls;
    /**
     * The compiled descriptor of a table, by slug. Hooks receive it as
     * `table`; without it a hook that runs throws, naming what is missing.
     */
    describe?: (slug: string) => TableDescriptor | undefined;
    /**
     * The definitions describe tables the database already holds, lowered only
     * to be served — what introspection hands the runtime, which plans nothing.
     * A table with no primary key is then lowered rather than refused.
     */
    introspected?: boolean;
}

type AnyDef = AnyTableDef | AnyViewDef;

/** Where a problem is: the table, and the column or relation. */
interface Where {
    table: string;
    key?: string;
}

/** A problem that stops one definition from lowering. Collected, then thrown together. */
class LoweringProblem extends Error {
    constructor(readonly problem: SchemaDefinitionProblem) {
        super(problem.message);
    }
}

const refuse = (where: Where, message: string): never => {
    throw new LoweringProblem({ table: where.table, key: where.key, message });
};

const pending = (where: Where, id: PendingTableFeatureId): never =>
    refuse(where, `uses a feature that cannot be lowered to the collection model yet [${id}]: ${pendingDescription(id)}`);

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Lower table and view definitions into the `PostgresCollectionConfig` objects
 * the planner, the registry and the drivers read today.
 *
 * One collection per definition, in the order given. A relation's target is
 * lowered through the same cache, so the target thunk of every relation into a
 * table returns the very object that table lowered to — `planSchema` compares
 * collections by identity and caches per object. A target that is not in
 * `defs` is lowered on first use.
 *
 * Throws a {@link SchemaDefinitionError} listing every problem found: a
 * definition this module cannot express (see {@link PENDING_TABLE_FEATURES}),
 * `rls: "inherit"` without `options.defaultRls`, `defaultPolicies: false`
 * beside an admin-only posture.
 *
 * @group Schema
 */
export function lowerTables(
    defs: readonly AnyDef[],
    options: LowerTablesOptions = {}
): LoweredCollection[] {
    const lowered = new Map<AnyDef, LoweredCollection>();
    const problems: SchemaDefinitionProblem[] = [];

    const lowerDef = (def: AnyDef): LoweredCollection => {
        const cached = lowered.get(def);
        if (cached) return cached;
        // Registered before its properties are built, so a relation that points
        // back at this table (or at itself) finds the same object.
        // A table has no labels; the legacy readers that print one (OpenAPI
        // component names, tags, summaries) get the defaults a collection
        // declaring none was given: "order_items" → "Order Items" / "Order Item".
        const name = labelFromIdentifier(slugOf(def));
        const collection: LoweredCollection = { slug: slugOf(def), name, singularName: singularLabel(name), properties: {} };
        lowered.set(def, collection);
        fillCollection(collection, def, { lowerDef, options });
        return collection;
    };

    const out: LoweredCollection[] = [];
    for (const def of defs) {
        if (!isTableDef(def) && !isViewDef(def)) {
            problems.push({ table: describeUnknown(def), message: "is not a `defineTable`, `defineAuthTable` or `defineView` result." });
            continue;
        }
        try {
            out.push(lowerDef(def));
        } catch (error) {
            if (error instanceof LoweringProblem) {
                lowered.delete(def);
                problems.push(error.problem);
                continue;
            }
            throw error;
        }
    }
    if (problems.length > 0) throw new SchemaDefinitionError(problems);
    return out;
}

const describeUnknown = (value: unknown): string => {
    if (typeof value === "object" && value !== null && "name" in value && typeof value.name === "string") return value.name;
    return "(unknown)";
};

const slugOf = (def: AnyDef): string => def.config.slug ?? def.name;
const tableNameOf = (def: AnyDef): string => def.config.table ?? def.name;
const sqlNameOf = (key: string, def: ColumnDef): string => def.column ?? toSnakeCase(key);

interface LowerContext {
    lowerDef: (def: AnyDef) => LoweredCollection;
    options: LowerTablesOptions;
}

// ── One definition ───────────────────────────────────────────────────────────

/** A relation, with what lowering decided about it. */
interface PlannedRelation {
    key: string;
    def: RelationDef;
    /** For a `belongsTo`: the column key it binds to, when one is declared. */
    boundColumn?: string;
    /** The bound column stays a property of its own (the explicit-FK form). */
    keepsColumn?: boolean;
}

function fillCollection(collection: LoweredCollection, def: AnyDef, ctx: LowerContext): void {
    const config = def.config;
    const tableName = tableNameOf(def);
    const where: Where = { table: def.name };
    const columns = Object.entries(config.columns).map(([key, builder]) => ({ key, def: builder.def }));

    const primaryKeys = columns.filter(c => c.def.primaryKey).map(c => c.key);
    // An introspected table may have no key: it is served as the database
    // holds it (read, and written by filter), as it always has been.
    if (primaryKeys.length === 0 && isTableDef(def) && ctx.options.introspected !== true) {
        refuse(where, "declares no primary key. Mark the column (or columns) that identify a row with `.primaryKey()`.");
    }

    // ── Relations: which column each `belongsTo` binds ──────────────────────
    const relationEntries = Object.entries(config.relations ?? {});
    const relationKeys = new Set(relationEntries.map(([key]) => key));
    const planned: PlannedRelation[] = [];
    const boundBy = new Map<string, PlannedRelation>();
    for (const [key, relation] of relationEntries) {
        const entry: PlannedRelation = { key, def: relation };
        planned.push(entry);
        if (relation.kind !== "belongsTo") {
            if (relation.kind === "hasMany" && relation.orderBy !== undefined) pending({ table: def.name, key }, "has-many-order-by");
            continue;
        }
        const localKey = relation.localKey ?? generateForeignKeyName(key);
        const bound = columns.find(c => sqlNameOf(c.key, c.def) === localKey);
        if (!bound) continue;
        const previous = boundBy.get(bound.key);
        if (previous) {
            refuse({ table: def.name, key }, `binds the column "${bound.key}", which the relation "${previous.key}" already binds. One column holds one link.`);
        }
        entry.boundColumn = bound.key;
        entry.keepsColumn = relation.constraint === false
            || !isPlainForeignKey(bound.key, bound.def, localKey, relationKeys, relation, ctx);
        boundBy.set(bound.key, entry);
    }

    // ── Properties, in physical order ───────────────────────────────────────
    /** The properties in order, each with the index of the relation it stands for. */
    const ordered: { key: string; property: LoweredProperty; relation?: number }[] = [];
    /** A column key absorbed into a relation property, and the relation's key. */
    const absorbed = new Map<string, string>();
    const implicitId = isImplicitIdColumn(columns, primaryKeys);
    columns.forEach((column, position) => {
        if (position === 0 && implicitId) return;
        const at: Where = { table: def.name, key: column.key };
        const binding = boundBy.get(column.key);
        if (binding && !binding.keepsColumn) {
            const property: RelationProperty = {
                ...relationProperty(column.def, true),
                ...relationFieldAccess(binding.def, { table: def.name, key: binding.key })
            };
            ordered.push({
                key: binding.key,
                property: fromColumn(fromRelation(property, binding.def), column.def),
                relation: planned.indexOf(binding)
            });
            absorbed.set(column.key, binding.key);
            return;
        }
        ordered.push({
            key: column.key,
            property: fromColumn(lowerColumn(column.key, column.def, {
                at,
                primaryKey: column.def.primaryKey,
                describe: ctx.options.describe,
                slug: slugOf(def)
            }), column.def)
        });
    });
    // The relation properties that carry only a constraint (their column is a
    // property above) or derive their column. The legacy shape lists relation
    // properties together, in relation order, so each goes right after the
    // relation property that precedes it in that order, or else just before
    // the one that follows it, or else after the declared columns.
    planned.forEach((entry, index) => {
        if (entry.def.kind !== "belongsTo") return;
        const relation = entry.def;
        let property: RelationProperty | undefined;
        if (entry.boundColumn === undefined) {
            property = {
                type: "relation",
                ...validationOf({ required: relation.notNull === true, unique: relation.unique === true })
            };
        } else {
            const bound = columns.find(column => column.key === entry.boundColumn);
            if (bound && entry.keepsColumn) property = relationProperty(bound.def, false);
        }
        // An absorbed column's relation property is placed above, with its
        // field rules.
        if (!property) return;
        Object.assign(property, relationFieldAccess(relation, { table: def.name, key: entry.key }));
        const item = { key: entry.key, property: fromRelation(property, relation), relation: index };
        // The last relation property before this one in relation order. A
        // loop rather than `findLastIndex`, which is ES2023: this source is
        // compiled by consumers whose `lib` stops at ES2022.
        let after = -1;
        for (let position = ordered.length - 1; position >= 0; position--) {
            const other = ordered[position].relation;
            if (other !== undefined && other < index) {
                after = position;
                break;
            }
        }
        const before = ordered.findIndex(other => other.relation !== undefined && other.relation > index);
        if (after !== -1) ordered.splice(after + 1, 0, item);
        else if (before !== -1) ordered.splice(before, 0, item);
        else ordered.push(item);
    });
    for (const entry of planned) {
        if (entry.def.kind === "belongsTo") continue;
        const property: RelationProperty = { type: "relation", ...relationFieldAccess(entry.def, { table: def.name, key: entry.key }) };
        ordered.push({ key: entry.key, property: fromRelation(property, entry.def) });
    }
    const properties: Record<string, LoweredProperty> = {};
    for (const item of ordered) properties[item.key] = item.property;
    collection.properties = properties;

    // ── Relations ───────────────────────────────────────────────────────────
    if (planned.length > 0) {
        collection.relations = planned.map(entry => lowerRelation(entry, def, ctx));
    }

    // ── Table keys ──────────────────────────────────────────────────────────
    collection.table = tableName;
    if (config.schema !== undefined) collection.schema = config.schema;
    if (config.database !== undefined) collection.dataSource = resourceKeyOf(config.database);
    if (config.description !== undefined) collection.description = config.description;
    if (config.metadata !== undefined) collection.metadata = config.metadata;
    if (config.indexes !== undefined) {
        collection.indexes = config.indexes.map((index): LoweredIndex =>
            Object.assign(lowerIndex(index, absorbed), { tableIndex: index }));
    }

    if (isViewDef(def)) {
        const view = def.config;
        collection.view = {
            query: view.query,
            ...(view.materialized !== undefined ? { materialized: view.materialized } : {}),
            ...(view.roles !== undefined ? { roles: [...view.roles] } : {})
        };
        const callbacks = lowerHooks(view.hooks, slugOf(def), ctx.options.describe);
        if (callbacks) Object.assign(collection, { callbacks });
        return;
    }

    const table = def.config;
    const rls = lowerRls(table.rls, table.defaultPolicies, where, ctx.options.defaultRls);
    if (rls.securityRules) collection.securityRules = rls.securityRules;
    if (rls.disableDefaultPolicies) collection.disableDefaultPolicies = true;
    if (def.auth) collection.auth = lowerAuth(def.auth);
    if (table.tenant !== undefined) {
        collection.tenant = {
            field: table.tenant.field,
            from: table.tenant.from,
            ...(table.tenant.bypassRoles !== undefined ? { bypassRoles: table.tenant.bypassRoles } : {})
        };
    }
    if (table.softDelete !== undefined) {
        collection.softDelete = typeof table.softDelete === "boolean"
            ? table.softDelete
            : { ...(table.softDelete.field !== undefined ? { field: table.softDelete.field } : {}) };
    }
    if (table.history !== undefined) collection.history = table.history;
    if (table.search !== undefined) collection.search = table.search;
    if (table.strictWrites === false) collection.strictWrites = false;
    const callbacks = lowerHooks(table.hooks, slugOf(def), ctx.options.describe);
    if (callbacks) Object.assign(collection, { callbacks });
}

/**
 * Whether a bound column is nothing but the foreign key the relation would
 * have derived: same key, same type as the target's key, and no rule of its
 * own. Such a column is the legacy "relation property" form — planned once, at
 * the column's position, typed from the target. Anything more and it stays a
 * property, with the relation carrying only its constraint.
 */
function isPlainForeignKey(
    key: string,
    def: ColumnDef,
    localKey: string,
    relationKeys: ReadonlySet<string>,
    relation: RelationDef,
    ctx: LowerContext
): boolean {
    // The key a relation-derived column is served under (`fieldKeyForColumn`
    // with no declared property owning the column): a relation property whose
    // key names the column wins, otherwise the column in camelCase.
    for (const relationKey of relationKeys) {
        if (relationKey === localKey || toSnakeCase(relationKey) === localKey) return false;
    }
    if (toWireKey(localKey) !== key) return false;
    if (def.primaryKey || def.default !== undefined || def.generatedAs !== undefined || def.readOnly || def.private) return false;
    if (def.access !== undefined || def.stamp !== undefined || def.validate !== undefined || def.oneOf !== undefined) return false;
    if (def.description !== undefined || def.storage !== undefined || def.semantic !== undefined) return false;
    if (def.vectorIndex !== undefined || def.json !== undefined || def.element !== undefined || def.transform !== undefined) return false;
    const targetType = targetKeyType(relation);
    return targetType !== undefined && sameColumnType(def.type, targetType);
}

/**
 * The type a column pointing at the relation's target must have: the target's
 * key type, a serial read as its plain integer. `undefined` when the target
 * cannot be read here (its thunk throws) or is keyed by more than one column.
 */
function targetKeyType(relation: RelationDef): ColumnType | undefined {
    let target: unknown;
    try {
        target = relation.target();
    } catch {
        return undefined;
    }
    if (!isTableDef(target) && !isViewDef(target)) return undefined;
    const keys = Object.values(target.config.columns).filter(column => column.def.primaryKey);
    if (keys.length === 0) return { kind: "text" };
    if (keys.length > 1) return undefined;
    const type = keys[0].def.type;
    switch (type.kind) {
        case "smallserial": return { kind: "smallint" };
        case "serial": return { kind: "integer" };
        case "bigserial": return { kind: "bigint" };
        default: return type;
    }
}

function sameColumnType(a: ColumnType, b: ColumnType): boolean {
    // An enum key is typed by the *target's* enum type, which a column declared
    // here would not share.
    if (a.kind === "enum" || b.kind === "enum") return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The implicit `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text` of a collection that declares no key. */
const IMPLICIT_ID_DEFAULT = "gen_random_uuid()::text";

/**
 * Whether the first column is exactly the key the planner gives a collection
 * that declares none: then it is left out, and the planner adds it back the
 * way it always has (first in SQL, last in the Drizzle file, its default
 * converged at boot).
 */
function isImplicitIdColumn(columns: readonly { key: string; def: ColumnDef }[], primaryKeys: readonly string[]): boolean {
    const first = columns[0];
    if (!first || primaryKeys.length !== 1 || primaryKeys[0] !== first.key || first.key !== "id") return false;
    const def = first.def;
    if (def.column !== undefined && def.column !== "id") return false;
    if (def.type.kind !== "text") return false;
    if (def.default?.kind !== "sql" || def.default.expression !== IMPLICIT_ID_DEFAULT) return false;
    return !def.unique && !def.readOnly && !def.private && def.access === undefined && def.stamp === undefined
        && def.validate === undefined && def.oneOf === undefined && def.description === undefined
        && def.storage === undefined && def.generatedAs === undefined && def.transform === undefined;
}

/**
 * A relation's field rules as its property carries them: `private: true` is
 * `excludeFromApi`, `access` is the property's `access` — what
 * `canReadRelation`, the include refusal and nested-write access read.
 */
function relationFieldAccess(relation: RelationDef, at: Where): Pick<RelationProperty, "access" | "excludeFromApi"> {
    if (relation.private === true) {
        if (relation.access !== undefined) {
            refuse(at, "is `private: true` and declares `access`. A private relation is never served to or written by a client, so access rules say nothing; drop one of the two.");
        }
        return { excludeFromApi: true };
    }
    if (relation.access === undefined) return {};
    const access: FieldAccess = {};
    if (relation.access.read !== undefined) access.read = [...relation.access.read];
    if (relation.access.write !== undefined) access.write = [...relation.access.write];
    return { access };
}

/** The property a relation is addressed by. */
function relationProperty(column: ColumnDef, absorbsColumn: boolean): RelationProperty {
    const required = column.notNull && !column.primaryKey;
    return {
        type: "relation",
        ...validationOf({ required, unique: absorbsColumn && column.unique })
    };
}

const validationOf = (flags: { required: boolean; unique: boolean }): { validation?: { required?: true; unique?: true } } => {
    if (!flags.required && !flags.unique) return {};
    return {
        validation: {
            ...(flags.required ? { required: true } : {}),
            ...(flags.unique ? { unique: true } : {})
        }
    };
};

// ── Relations ────────────────────────────────────────────────────────────────

function lowerRelation(entry: PlannedRelation, owner: AnyDef, ctx: LowerContext): Relation {
    const relation = entry.def;
    const at: Where = { table: owner.name, key: entry.key };
    // Called by the planner long after `lowerTables` returned, so a problem
    // here is thrown as the schema error it is rather than collected.
    const target = (): PostgresCollectionConfig => {
        const value: unknown = relation.target();
        if (!isTableDef(value) && !isViewDef(value)) {
            throw new SchemaDefinitionError([{ ...at, message: "has a target thunk that does not return a `defineTable` or `defineView` result." }]);
        }
        try {
            return ctx.lowerDef(value);
        } catch (error) {
            if (error instanceof LoweringProblem) throw new SchemaDefinitionError([error.problem]);
            throw error;
        }
    };
    switch (relation.kind) {
        case "belongsTo":
            return {
                kind: "belongsTo",
                relationName: entry.key,
                target,
                ...(relation.localKey !== undefined ? { localKey: relation.localKey } : {}),
                ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {}),
                ...(relation.onUpdate !== undefined ? { onUpdate: relation.onUpdate } : {}),
                ...(relation.index === false ? { index: false } : {})
            };
        case "hasOne":
        case "hasMany":
            return {
                kind: relation.kind,
                relationName: entry.key,
                target,
                ...(relation.foreignKey !== undefined ? { foreignKeyOnTarget: relation.foreignKey } : {}),
                ...(relation.sourceKey !== undefined ? { sourceKey: relation.sourceKey } : {})
            };
        case "manyToMany": {
            const through: NonNullable<Extract<Relation, { kind: "manyToMany" }>["through"]> = {};
            if (relation.through !== undefined) through.table = relation.through;
            if (relation.sourceKey !== undefined) through.sourceColumn = relation.sourceKey;
            if (relation.targetKey !== undefined) through.targetColumn = relation.targetKey;
            if (relation.pivot !== undefined) {
                const pivot: Properties = {};
                for (const [key, builder] of Object.entries(relation.pivot)) {
                    const pivotAt: Where = { table: owner.name, key: `${entry.key}.pivot.${key}` };
                    if (builder.def.primaryKey) refuse(pivotAt, "is a pivot column marked `.primaryKey()`. The junction's key is its two link columns.");
                    pivot[key] = fromColumn(lowerColumn(key, builder.def, {
                        at: pivotAt,
                        primaryKey: false,
                        describe: ctx.options.describe,
                        slug: slugOf(owner)
                    }), builder.def);
                }
                through.properties = pivot;
            }
            return {
                kind: "manyToMany",
                relationName: entry.key,
                target,
                ...(Object.keys(through).length > 0 ? { through } : {}),
                ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {})
            };
        }
        case "via":
            return {
                kind: "via",
                relationName: entry.key,
                target,
                cardinality: relation.cardinality ?? "many",
                joinPath: [...relation.steps]
            };
    }
}

// ── Columns ──────────────────────────────────────────────────────────────────

interface ColumnContext {
    at: Where;
    primaryKey: boolean;
    slug: string;
    describe: LowerTablesOptions["describe"];
}

/** `.notNull()` and `.unique()`, as the planner reads them off `validation`. */
interface Flags {
    required: boolean;
    unique: boolean;
}

const flagsOf = (def: ColumnDef): Flags => ({ required: def.notNull && !def.primaryKey, unique: def.unique });

const NO_FLAGS: Flags = { required: false, unique: false };

/**
 * One column, as the property the planner reads.
 *
 * The forms are the ones the planner maps back to the same column (the
 * Property → plan table the equivalence test holds this module to).
 */
function lowerColumn(key: string, def: ColumnDef, ctx: ColumnContext): PostgresProperty {
    const { at } = ctx;
    // A `col.custom()` scalar is addressed as the string the driver returns.
    const passThroughKey = def.type.kind === "other" && !isCustomArrayType(def.type.sqlType);
    if (def.primaryKey && ((!KEY_KINDS.has(def.type.kind) && !passThroughKey) || def.semantic === "geopoint")) {
        refuse(
            at,
            `is \`.primaryKey()\` on a ${def.semantic === "geopoint" ? "geopoint" : `\`${columnTypeLabel(def.type)}\``} column. A row is ` +
            "addressed by its key — in every URL, filter, cursor and foreign key — so a key is a scalar: text, varchar, " +
            "char, uuid, an enum, a number, a boolean or a date/time. Key the table by such a column (several make a " +
            "composite key) and keep this one as an ordinary column."
        );
    }
    if (def.transform !== undefined && def.json?.transform !== undefined) {
        refuse(at, "declares a `.transform()` on the column and another on its JSON shape. Keep one: they are the same hook.");
    }
    const base = baseFields(key, def, ctx);
    const literal = def.default?.kind === "literal" ? def.default.value : undefined;

    if (def.semantic === "geopoint") {
        const property: PostgresProperty = { type: "geopoint", ...base, ...baseValidation(flagsOf(def), def.validate, at) };
        if (isGeoPoint(literal)) property.defaultValue = literal;
        return property;
    }

    const type = def.type;
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "uuid":
        case "enum":
            return lowerStringColumn(key, def, type, base, ctx);
        case "smallint":
        case "integer":
        case "bigint":
        case "smallserial":
        case "serial":
        case "bigserial":
        case "real":
        case "doublePrecision":
        case "numeric":
            return lowerNumberColumn(def, type, base, ctx);
        case "boolean": {
            const property: PostgresProperty = { type: "boolean", ...base, ...baseValidation(flagsOf(def), def.validate, at), ...idFields(def, ctx) };
            if (typeof literal === "boolean") property.defaultValue = literal;
            return property;
        }
        case "timestamptz":
        case "date":
        case "time": {
            const property: DateProperty = { type: "date", ...base };
            if (type.kind !== "timestamptz") property.columnType = type.kind;
            const validation = dateValidation(flagsOf(def), def.validate, at);
            if (validation) property.validation = validation;
            if (def.stamp?.value === "now") property.autoValue = def.stamp.on === "create" ? "on_create" : "on_update";
            if (ctx.primaryKey) property.isId = true;
            if (literal !== undefined) setDateDefault(property, literal);
            return property;
        }
        case "json":
        case "jsonb":
            return lowerDocumentColumn(def, type.kind, base, ctx);
        case "vector": {
            const property: PostgresProperty = {
                type: "vector",
                dimensions: type.dimensions,
                ...base,
                ...baseValidation(flagsOf(def), def.validate, at),
                ...(def.vectorIndex !== undefined ? { index: lowerVectorIndex(def.vectorIndex) } : {})
            };
            if (Array.isArray(literal)) property.defaultValue = new Vector(literal.filter((n): n is number => typeof n === "number"));
            return property;
        }
        case "bytea": {
            const property: PostgresProperty = { type: "binary", ...base, ...baseValidation(flagsOf(def), def.validate, at) };
            if (typeof literal === "string") property.defaultValue = literal;
            return property;
        }
        case "array":
            return lowerArrayColumn(def, type.of, base, ctx);
        case "other": {
            const problem = customSqlTypeProblem(type.sqlType);
            if (problem !== undefined) {
                return refuse(
                    at,
                    `is \`col.custom(${JSON.stringify(type.sqlType)})\`, and that type name ${problem}. It is written into DDL ` +
                    "verbatim, so it must be a Postgres type as `format_type` prints it — `inet`, `timestamp(3) without time " +
                    "zone`, `geometry(Point, 4326)`, `inet[]` — and nothing after it."
                );
            }
            // Planned from the definition (the planner names the type
            // verbatim). Served as the driver returns it: no codec, no
            // coercion. A list type arrives as an array; everything else
            // (inet, citext, money, interval, a range…) as the driver renders it.
            if (isCustomArrayType(type.sqlType)) {
                return { type: "array", ...base, ...baseValidation(flagsOf(def), def.validate, at) };
            }
            return { type: "string", ...base, ...baseValidation(flagsOf(def), def.validate, at), ...idFields(def, ctx) };
        }
    }
}

/** Whether a `col.custom()` type is an array type (`inet[]`, `text[3]`). */
const isCustomArrayType = (sqlType: string): boolean => /\]\s*$/.test(sqlType);

/**
 * The column types a key may have: the scalars a row can be addressed by (and
 * the legacy shape marks with `isId`). A document, a vector, binary data and a
 * list are refused as keys.
 */
const KEY_KINDS: ReadonlySet<ColumnType["kind"]> = new Set([
    "text", "varchar", "char", "uuid", "enum",
    "smallint", "integer", "bigint", "smallserial", "serial", "bigserial", "real", "doublePrecision", "numeric",
    "boolean", "timestamptz", "date", "time"
]);

type BaseFields = Partial<Pick<Property, "columnName" | "excludeFromApi" | "access" | "description" | "callbacks" | "databaseDefault">>;

/** What every property carries, whatever its type. */
function baseFields(key: string, def: ColumnDef, ctx: ColumnContext): BaseFields {
    const out: BaseFields = {};
    if (def.column !== undefined && def.column !== toSnakeCase(key)) out.columnName = def.column;
    if (def.private) {
        if (def.access !== undefined) {
            refuse(ctx.at, "is `.private()` and declares `.access()`. A private column is never served to or written by a client, so access rules say nothing; drop one of the two.");
        }
        out.excludeFromApi = true;
    } else if (def.readOnly || def.access !== undefined) {
        const access: FieldAccess = {};
        if (def.access?.read !== undefined) access.read = [...def.access.read];
        if (def.readOnly) access.write = [];
        else if (def.access?.write !== undefined) access.write = [...def.access.write];
        out.access = access;
    }
    if (def.description !== undefined) out.description = def.description;
    if (def.transform !== undefined) out.callbacks = lowerTransform(def.transform, ctx.slug, ctx.describe);
    // The database fills a generated column on every write, and an identity
    // column that is not the key (a key's `isId` already says so): a create
    // may omit either however NOT NULL it is, which is what the runtime reads
    // off `databaseDefault: true`. The planner plans both from the definition.
    if (def.default?.kind === "database" || def.generatedAs !== undefined || (def.default?.kind === "identity" && !def.primaryKey)) {
        out.databaseDefault = true;
    } else if (!def.primaryKey) {
        if (def.default?.kind === "sql") out.databaseDefault = `sql\`${def.default.expression}\``;
        else if (def.default?.kind === "random-uuid") out.databaseDefault = "sql`gen_random_uuid()`";
    }
    return out;
}

/** The `isId` of a key column: its generation strategy, or `true` for a value the caller supplies. */
function idFields(def: ColumnDef, ctx: ColumnContext): { isId?: true | string } {
    if (!ctx.primaryKey) return {};
    switch (def.default?.kind) {
        case "random-uuid": return { isId: "uuid" };
        case "identity": return { isId: "increment" };
        case "sql": return { isId: `sql\`${def.default.expression}\`` };
        default: return { isId: true };
    }
}

// ── Validation ───────────────────────────────────────────────────────────────

/** The rules each kind of property keeps, besides `required` and `unique`. */
const STRING_RULES = new Set(["requiredMessage", "min", "max", "length", "matches", "matchesFlags", "matchesMessage", "email", "url", "trim", "lowercase", "uppercase"]);
const NUMBER_RULES = new Set(["requiredMessage", "min", "max", "lessThan", "moreThan", "positive", "negative", "integer"]);
const DATE_RULES = new Set(["requiredMessage", "min", "max"]);
const ARRAY_RULES = new Set(["requiredMessage", "minItems", "maxItems", "uniqueItems"]);
const BASE_RULES = new Set(["requiredMessage"]);

/** Refuses a rule this kind of column does not check — `.validate()` is typed per kind, so this is a definition built by hand. */
function assertRules(rules: ColumnValidation | undefined, allowed: ReadonlySet<string>, at: Where): void {
    for (const [rule, value] of Object.entries(rules ?? {})) {
        if (value === undefined || allowed.has(rule)) continue;
        refuse(at, `declares the validation rule \`${rule}\`, which this kind of column does not check.`);
    }
}

function baseValidation(flags: Flags, rules: ColumnValidation | undefined, at: Where): { validation?: PropertyValidationSchema } {
    assertRules(rules, BASE_RULES, at);
    const out: PropertyValidationSchema = {};
    if (flags.required) out.required = true;
    if (flags.unique) out.unique = true;
    if (rules?.requiredMessage !== undefined) out.requiredMessage = rules.requiredMessage;
    return Object.keys(out).length > 0 ? { validation: out } : {};
}

/** A string's rules; `email` and `url` are flags on the property, returned beside. */
function stringValidation(
    flags: Flags,
    rules: ColumnValidation | undefined,
    at: Where
): { validation?: StringPropertyValidationSchema; email?: true; url?: true } {
    assertRules(rules, STRING_RULES, at);
    const out: StringPropertyValidationSchema = {};
    if (flags.required) out.required = true;
    if (flags.unique) out.unique = true;
    const r = rules ?? {};
    if (r.requiredMessage !== undefined) out.requiredMessage = r.requiredMessage;
    if (typeof r.min === "number") out.min = r.min;
    if (typeof r.max === "number") out.max = r.max;
    if (r.length !== undefined) out.length = r.length;
    if (r.matches !== undefined) out.matches = r.matchesFlags ? new RegExp(r.matches, r.matchesFlags) : r.matches;
    if (r.matchesMessage !== undefined) out.matchesMessage = r.matchesMessage;
    if (r.trim !== undefined) out.trim = r.trim;
    if (r.lowercase !== undefined) out.lowercase = r.lowercase;
    if (r.uppercase !== undefined) out.uppercase = r.uppercase;
    return {
        ...(Object.keys(out).length > 0 ? { validation: out } : {}),
        ...(r.email ? { email: true } : {}),
        ...(r.url ? { url: true } : {})
    };
}

function numberValidation(flags: Flags, rules: ColumnValidation | undefined, at: Where): NumberPropertyValidationSchema | undefined {
    assertRules(rules, NUMBER_RULES, at);
    const out: NumberPropertyValidationSchema = {};
    if (flags.required) out.required = true;
    if (flags.unique) out.unique = true;
    const r = rules ?? {};
    if (r.requiredMessage !== undefined) out.requiredMessage = r.requiredMessage;
    if (typeof r.min === "number") out.min = r.min;
    if (typeof r.max === "number") out.max = r.max;
    if (r.lessThan !== undefined) out.lessThan = r.lessThan;
    if (r.moreThan !== undefined) out.moreThan = r.moreThan;
    if (r.positive !== undefined) out.positive = r.positive;
    if (r.negative !== undefined) out.negative = r.negative;
    if (r.integer !== undefined) out.integer = r.integer;
    return Object.keys(out).length > 0 ? out : undefined;
}

function dateValidation(flags: Flags, rules: ColumnValidation | undefined, at: Where): DatePropertyValidationSchema | undefined {
    assertRules(rules, DATE_RULES, at);
    const out: DatePropertyValidationSchema = {};
    if (flags.required) out.required = true;
    if (flags.unique) out.unique = true;
    const r = rules ?? {};
    if (r.requiredMessage !== undefined) out.requiredMessage = r.requiredMessage;
    if (r.min !== undefined) out.min = new Date(r.min);
    if (r.max !== undefined) out.max = new Date(r.max);
    return Object.keys(out).length > 0 ? out : undefined;
}

/** An array's rules: `minItems`/`maxItems` are the legacy `min`/`max`. */
function arrayValidation(flags: Flags, rules: ColumnValidation | undefined, at: Where): ArrayPropertyValidationSchema | undefined {
    assertRules(rules, ARRAY_RULES, at);
    const out: ArrayPropertyValidationSchema = {};
    if (flags.required) out.required = true;
    if (flags.unique) out.unique = true;
    const r = rules ?? {};
    if (r.requiredMessage !== undefined) out.requiredMessage = r.requiredMessage;
    if (r.minItems !== undefined) out.min = r.minItems;
    if (r.maxItems !== undefined) out.max = r.maxItems;
    if (r.uniqueItems === true) pending(at, "array-unique-items");
    return Object.keys(out).length > 0 ? out : undefined;
}

// ── Column kinds ─────────────────────────────────────────────────────────────

function lowerStringColumn(
    key: string,
    def: ColumnDef,
    type: Extract<ColumnType, { kind: "text" | "varchar" | "char" | "uuid" | "enum" }>,
    base: BaseFields,
    ctx: ColumnContext
): StringProperty {
    const { at } = ctx;
    const property: StringProperty = { type: "string", ...base };
    let rules: ColumnValidation | undefined = def.validate;

    switch (type.kind) {
        case "uuid":
            // `isId: "uuid"` is a uuid column on its own.
            if (!(ctx.primaryKey && def.default?.kind === "random-uuid")) property.columnType = "uuid";
            break;
        case "varchar":
        case "char":
            // The column's length is the builder's `n`, which the planner
            // reads off the definition. `.validate({ max })` is the API's own
            // rule and is kept as written; without one, the API checks `n`.
            property.columnType = type.kind;
            if (rules?.max === undefined && type.length !== 255) rules = { ...rules, max: type.length };
            break;
        case "enum":
            // A shared type (`name`) is planned from the definition; the
            // runtime reads the values.
            property.enum = enumValues(type.values);
            break;
        case "text":
            break;
    }
    if (def.oneOf !== undefined) pending(at, "text-one-of");
    if (def.storage !== undefined) property.storage = lowerStorage(def.storage);
    if (def.stamp?.value === "user") property.autoValue = def.stamp.on === "create" ? "user_on_create" : "user_on_update";
    if (def.semantic === "user") property.userSelect = true;

    const { validation, email, url } = stringValidation(flagsOf(def), rules, at);
    if (email) property.email = true;
    if (url) property.url = true;
    if (validation) property.validation = validation;
    Object.assign(property, idFields(def, ctx));
    if (def.default?.kind === "literal" && typeof def.default.value === "string") property.defaultValue = def.default.value;
    return property;
}

/** A number column's `columnType`, when the planner would not arrive at the type without it. */
const NUMBER_COLUMN_TYPES: Partial<Record<ColumnType["kind"], string>> = {
    smallint: "smallint",
    integer: "integer",
    bigint: "bigint",
    smallserial: "smallserial",
    serial: "serial",
    bigserial: "bigserial",
    real: "real",
    doublePrecision: "double precision",
    numeric: "numeric"
};

function lowerNumberColumn(
    def: ColumnDef,
    type: Extract<ColumnType, { kind: "smallint" | "integer" | "bigint" | "smallserial" | "serial" | "bigserial" | "real" | "doublePrecision" | "numeric" }>,
    base: BaseFields,
    ctx: ColumnContext
): NumberProperty {
    const property: NumberProperty = { type: "number", ...base };
    const integerRule = def.validate?.integer === true;
    // The planner arrives at INTEGER from `validation.integer` or a key, and at
    // NUMERIC from a plain number; every other type is named. An identity key
    // is INTEGER whatever `columnType` says, and must not say one.
    const inferred = type.kind === "integer"
        ? integerRule || ctx.primaryKey
        : type.kind === "numeric" && !integerRule && !ctx.primaryKey;
    if (!inferred) setNumberColumnType(property, NUMBER_COLUMN_TYPES[type.kind] ?? type.kind);
    if (type.kind === "numeric") {
        if (type.precision !== undefined) property.precision = type.precision;
        if (type.scale !== undefined) property.scale = type.scale;
    }
    if (def.oneOf !== undefined) property.enum = enumValues(def.oneOf);
    const validation = numberValidation(flagsOf(def), def.validate, ctx.at);
    if (validation) property.validation = validation;
    Object.assign(property, idFields(def, ctx));
    if (def.default?.kind === "literal" && typeof def.default.value === "number") property.defaultValue = def.default.value;
    return property;
}

/**
 * `columnType` on a number property.
 *
 * `smallint` and `smallserial` are columns the planner has always emitted
 * (its own `NUMBER_COLUMN_TYPES` lists them) and the legacy
 * `NumberProperty["columnType"]` union never named. The value is written
 * through `Reflect.set` rather than asserted into the union: this bridge
 * targets what the planner reads, and is deleted with the legacy type.
 */
function setNumberColumnType(property: NumberProperty, columnType: string): void {
    Reflect.set(property, "columnType", columnType);
}

/**
 * A date column's literal default, as written.
 *
 * The planner reads a string default in the column's own shape (`"2024-12-25"`
 * for a `date`, `"09:00"` for a `time`, a timestamp with its offset) exactly
 * as written, while the legacy `DateProperty["defaultValue"]` is typed `Date` —
 * and a `time` default cannot be a `Date` at all. `.default()` stores the
 * string, so it is passed through unchanged (through `Reflect.set`, for the
 * reason {@link setNumberColumnType} gives).
 */
function setDateDefault(property: DateProperty, value: unknown): void {
    if (typeof value === "string") Reflect.set(property, "defaultValue", value);
}

function lowerDocumentColumn(def: ColumnDef, kind: "json" | "jsonb", base: BaseFields, ctx: ColumnContext): PostgresProperty {
    const shape = def.json;
    const literal = def.default?.kind === "literal" ? def.default.value : undefined;
    if (shape === undefined || shape.kind === "object" || shape.kind === "unknown") {
        const property: MapProperty = { type: "map", ...base, ...baseValidation(flagsOf(def), def.validate, ctx.at) };
        if (kind === "json") property.columnType = "json";
        if (shape?.kind === "object") applyObjectShape(property, shape, ctx);
        if (shape?.transform !== undefined) property.callbacks = lowerTransform(shape.transform, ctx.slug, ctx.describe);
        if (isRecord(literal)) property.defaultValue = literal;
        return property;
    }
    if (shape.kind === "array") {
        // Named whatever the item is: an array of strings that is a document
        // would otherwise be planned as `text[]`.
        const property: ArrayProperty = { type: "array", ...base, columnType: kind };
        applyArrayShape(property, shape, ctx);
        if (shape.transform !== undefined) property.callbacks = lowerTransform(shape.transform, ctx.slug, ctx.describe);
        const validation = arrayValidation(flagsOf(def), { ...shape.validate, ...def.validate }, ctx.at);
        if (validation) property.validation = validation;
        if (Array.isArray(literal)) property.defaultValue = literal;
        return property;
    }
    return pending(ctx.at, "json-document-shape");
}

/**
 * The legacy `columnType` of the array columns the legacy shape names. Every
 * other scalar element (`uuid[]`, `bigint[]`, an enum array, `varchar(n)[]`,
 * `date[]`, …) is planned from the definition and has no legacy name; its
 * items are described by `of` for the runtime's codec.
 */
const ARRAY_COLUMN_TYPES: Partial<Record<ColumnType["kind"], NonNullable<ArrayProperty["columnType"]>>> = {
    text: "text[]",
    integer: "integer[]",
    boolean: "boolean[]",
    numeric: "numeric[]"
};

/**
 * Element types an array column does not take: a JSON document or a vector is
 * a list already (a list of documents is `col.jsonb(json.array(…))`), and a
 * `bytea` item would need a binary codec per element that nothing implements.
 */
const NON_ELEMENT_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["json", "jsonb", "vector", "bytea", "array", "other"]);

function lowerArrayColumn(def: ColumnDef, of: ColumnType, base: BaseFields, ctx: ColumnContext): ArrayProperty {
    const { at } = ctx;
    const element = def.element;
    if (NON_ELEMENT_KINDS.has(of.kind) || element?.semantic === "geopoint") {
        return refuse(
            at,
            `is \`col.array()\` of ${element?.semantic === "geopoint" ? "geopoints" : `\`${columnTypeLabel(of)}\``}, which is not an ` +
            "element type of a Postgres array column here. An array column holds scalars — text, uuid, numbers, " +
            "booleans, dates, enums; a list of documents, points or vectors is `col.jsonb(json.array(…))`."
        );
    }
    const legacyName = of.kind === "numeric" && (of.precision !== undefined || of.scale !== undefined) ? undefined : ARRAY_COLUMN_TYPES[of.kind];
    if (element && (element.notNull || element.unique || element.primaryKey || element.default !== undefined
        || element.generatedAs !== undefined || element.readOnly || element.private || element.access !== undefined
        || element.stamp !== undefined || element.json !== undefined || element.vectorIndex !== undefined)) {
        pending(at, "array-element-modifiers");
    }
    const property: ArrayProperty = { type: "array", ...base, ...(legacyName !== undefined ? { columnType: legacyName } : {}) };
    property.of = arrayElementProperty(of, element, def.storage, ctx);
    const validation = arrayValidation(flagsOf(def), def.validate, at);
    if (validation) property.validation = validation;
    if (def.default?.kind === "literal" && Array.isArray(def.default.value)) property.defaultValue = def.default.value;
    return property;
}

/** The `of` of a native array column: the element's rules, choices, storage and transform. */
function arrayElementProperty(of: ColumnType, element: ColumnDef | undefined, storage: ColumnStorage | undefined, ctx: ColumnContext): Property {
    const at: Where = { table: ctx.at.table, key: `${ctx.at.key ?? ""}[]` };
    const common: { description?: string; callbacks?: PropertyCallbacks } = {};
    if (element?.description !== undefined) common.description = element.description;
    if (element?.transform !== undefined) common.callbacks = lowerTransform(element.transform, ctx.slug, ctx.describe);
    if (of.kind === "text" || of.kind === "varchar" || of.kind === "char" || of.kind === "uuid" || of.kind === "enum") {
        const property: StringProperty = { type: "string", ...common };
        if (of.kind !== "text" && of.kind !== "enum") property.columnType = of.kind;
        if (of.kind === "enum") property.enum = enumValues(of.values);
        const elementStorage = element?.storage ?? storage;
        if (elementStorage !== undefined) property.storage = lowerStorage(elementStorage);
        if (element?.oneOf !== undefined) property.enum = enumValues(element.oneOf.map(String));
        if (element?.semantic === "user") property.userSelect = true;
        const { validation, email, url } = stringValidation(NO_FLAGS, element?.validate, at);
        if (email) property.email = true;
        if (url) property.url = true;
        if (validation) property.validation = validation;
        return property;
    }
    if (of.kind === "boolean") return { type: "boolean", ...common, ...baseValidation(NO_FLAGS, element?.validate, at) };
    if (of.kind === "timestamptz" || of.kind === "date" || of.kind === "time") {
        // Each item read and written as a date column of that type is.
        const property: DateProperty = { type: "date", ...common };
        if (of.kind !== "timestamptz") property.columnType = of.kind;
        const validation = dateValidation(NO_FLAGS, element?.validate, at);
        if (validation) property.validation = validation;
        return property;
    }
    const property: NumberProperty = { type: "number", ...common };
    if (element?.oneOf !== undefined) property.enum = enumValues(element.oneOf);
    const validation = numberValidation(NO_FLAGS, element?.validate, at);
    if (validation) property.validation = validation;
    return property;
}

// ── JSON shapes ──────────────────────────────────────────────────────────────

const nestedAt = (ctx: ColumnContext, suffix: string): ColumnContext => ({
    ...ctx,
    at: { table: ctx.at.table, key: `${ctx.at.key ?? ""}${suffix}` }
});

function applyObjectShape(property: MapProperty, shape: Extract<JsonShapeDef, { kind: "object" }>, ctx: ColumnContext): void {
    const fields: Properties = {};
    for (const [key, field] of Object.entries(shape.fields)) {
        if (field.kind === "unknown") pending(nestedAt(ctx, `.${key}`).at, "json-unknown-field");
        fields[key] = jsonFieldProperty(field, nestedAt(ctx, `.${key}`));
    }
    // A shape with no fields is a map that declares none (a key-value map
    // when it takes any key).
    if (Object.keys(fields).length > 0) property.properties = fields;
    if (shape.additional) property.keyValue = true;
}

function applyArrayShape(property: ArrayProperty, shape: Extract<JsonShapeDef, { kind: "array" }>, ctx: ColumnContext): void {
    const item = shape.of;
    // An untyped item is an array without `of`.
    if (item.kind === "unknown") return;
    if (item.kind === "oneOf") {
        const variants: Properties = {};
        for (const [key, variant] of Object.entries(item.variants)) {
            if (variant.kind === "unknown") pending(nestedAt(ctx, `[${key}]`).at, "json-unknown-field");
            variants[key] = jsonFieldProperty(variant, nestedAt(ctx, `[${key}]`));
        }
        property.oneOf = {
            properties: variants,
            ...(item.typeField !== "type" ? { typeField: item.typeField } : {}),
            ...(item.valueField !== "value" ? { valueField: item.valueField } : {})
        };
        return;
    }
    property.of = jsonFieldProperty(item, nestedAt(ctx, "[]"));
}

/** One node of a JSON shape, as the nested property the legacy model keeps for it. */
function jsonFieldProperty(node: JsonShapeDef, ctx: ColumnContext): Property {
    const at = ctx.at;
    const flags: Flags = { required: node.required === true, unique: false };
    const common: { description?: string; callbacks?: PropertyCallbacks } = {};
    if (node.description !== undefined) common.description = node.description;
    if (node.transform !== undefined) common.callbacks = lowerTransform(node.transform, ctx.slug, ctx.describe);
    switch (node.kind) {
        case "string": {
            const property: StringProperty = { type: "string", ...common };
            const { validation, email, url } = stringValidation(flags, node.validate, at);
            if (email) property.email = true;
            if (url) property.url = true;
            if (validation) property.validation = validation;
            if (node.oneOf !== undefined) property.enum = enumValues(node.oneOf);
            if (node.storage !== undefined) property.storage = lowerStorage(node.storage);
            if (node.stamp !== undefined) property.autoValue = node.stamp === "createUser" ? "user_on_create" : "user_on_update";
            if (node.semantic === "user") property.userSelect = true;
            if (typeof node.default === "string") property.defaultValue = node.default;
            return property;
        }
        case "number": {
            const property: NumberProperty = { type: "number", ...common };
            const validation = numberValidation(flags, node.validate, at);
            if (validation) property.validation = validation;
            if (node.oneOf !== undefined) property.enum = enumValues(node.oneOf);
            if (typeof node.default === "number") property.defaultValue = node.default;
            return property;
        }
        case "boolean": {
            const property: Property = { type: "boolean", ...common, ...baseValidation(flags, undefined, at) };
            if (typeof node.default === "boolean") property.defaultValue = node.default;
            return property;
        }
        case "date": {
            const property: DateProperty = { type: "date", ...common };
            const validation = dateValidation(flags, node.validate, at);
            if (validation) property.validation = validation;
            if (node.stamp !== undefined) property.autoValue = node.stamp === "create" ? "on_create" : "on_update";
            if (node.default !== undefined) setDateDefault(property, node.default);
            return property;
        }
        case "geopoint": {
            const property: Property = { type: "geopoint", ...common, ...baseValidation(flags, undefined, at) };
            if (isGeoPoint(node.default)) property.defaultValue = node.default;
            return property;
        }
        case "object": {
            const property: MapProperty = { type: "map", ...common, ...baseValidation(flags, undefined, at) };
            applyObjectShape(property, node, ctx);
            if (isRecord(node.default)) property.defaultValue = node.default;
            return property;
        }
        case "array": {
            const property: ArrayProperty = { type: "array", ...common };
            applyArrayShape(property, node, ctx);
            const validation = arrayValidation(flags, node.validate, at);
            if (validation) property.validation = validation;
            if (Array.isArray(node.default)) property.defaultValue = node.default;
            return property;
        }
        case "oneOf":
            return pending(at, "json-one-of-placement");
        case "unknown":
            return pending(at, "json-unknown-field");
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isGeoPoint = (value: unknown): value is { latitude: number; longitude: number } =>
    isRecord(value) && typeof value.latitude === "number" && typeof value.longitude === "number";

// ── Storage, vectors ─────────────────────────────────────────────────────────

/** A column's storage rules under the legacy names. */
function lowerStorage(storage: ColumnStorage): StorageConfig {
    const out: StorageConfig = { storagePath: storage.path };
    if (storage.source !== undefined) out.storageSource = storage.source;
    if (storage.accept !== undefined) out.acceptedFiles = [...storage.accept];
    if (storage.maxBytes !== undefined) out.maxSize = storage.maxBytes;
    if (storage.imageResize !== undefined) out.imageResize = { ...storage.imageResize };
    if (storage.public !== undefined) out.public = storage.public;
    if (storage.fileName !== undefined) out.fileName = storage.fileName;
    if (storage.metadata !== undefined) out.metadata = { ...storage.metadata };
    if (storage.includeBucketUrl !== undefined) out.includeBucketUrl = storage.includeBucketUrl;
    if (storage.storeUrl !== undefined) out.storeUrl = storage.storeUrl;
    return out;
}

const DISTANCE_OF: Record<VectorMetric, VectorDistance> = { cosine: "cosine", l2: "l2", ip: "inner_product" };

function lowerVectorIndex(index: VectorIndexOptions | false): VectorIndexConfig | false {
    if (index === false) return false;
    const out: VectorIndexConfig = {};
    if (index.method !== undefined) out.method = index.method;
    if (index.metric !== undefined) {
        out.distance = typeof index.metric === "string"
            ? DISTANCE_OF[index.metric]
            : index.metric.map(metric => DISTANCE_OF[metric]);
    }
    if (index.m !== undefined) out.m = index.m;
    if (index.efConstruction !== undefined) out.efConstruction = index.efConstruction;
    if (index.lists !== undefined) out.lists = index.lists;
    return out;
}

// ── Indexes ──────────────────────────────────────────────────────────────────

/**
 * An index under the legacy names (`columns` → `on`, `column` → `prop`). A
 * column absorbed into a relation property is named by the relation, which
 * the planner resolves to the same column.
 */
function lowerIndex(index: TableIndex, absorbed: ReadonlyMap<string, string>): CollectionIndex {
    const keyOf = (key: string): string => absorbed.get(key) ?? key;
    const on = index.columns.map((entry): string | IndexKey => {
        if (typeof entry === "string") return keyOf(entry);
        return lowerIndexKey(entry, keyOf);
    });
    const [first, ...rest] = on;
    // `reason` is optional on a table's index; the legacy entry needs a
    // string, and the planner reads an empty one off a table index (see
    // `LoweredIndex.tableIndex`) as none.
    const reason = index.reason ?? "";
    const where = index.where !== undefined ? { where: lowerPredicate(index.where, keyOf) } : {};
    if (index.using === "gin" || index.using === "brin") {
        return { using: index.using, on: [first, ...rest], reason, ...where };
    }
    return {
        ...(index.using !== undefined ? { using: index.using } : {}),
        on: [first, ...rest],
        ...(index.unique !== undefined ? { unique: index.unique } : {}),
        ...(index.include !== undefined ? { include: index.include.map(keyOf) } : {}),
        ...where,
        reason
    };
}

function lowerIndexKey(key: TableIndexKey, keyOf: (key: string) => string): IndexKey {
    return {
        prop: keyOf(key.column),
        ...(key.direction !== undefined ? { direction: key.direction } : {}),
        ...(key.nulls !== undefined ? { nulls: key.nulls } : {})
    };
}

function lowerPredicate(predicate: TableIndexPredicate, keyOf: (key: string) => string): IndexPredicate {
    if ("and" in predicate) {
        const [first, ...rest] = predicate.and.map(inner => lowerPredicate(inner, keyOf));
        return { and: [first, ...rest] };
    }
    switch (predicate.op) {
        case "=": return { prop: keyOf(predicate.column), op: "=", value: predicate.value };
        case "is null":
        case "is not null": return { prop: keyOf(predicate.column), op: predicate.op };
        case "in": return { prop: keyOf(predicate.column), op: "in", value: predicate.value };
        default: return { prop: keyOf(predicate.column), op: predicate.op, value: predicate.value };
    }
}

// ── Row-level security, auth ─────────────────────────────────────────────────

/**
 * `rls` as `securityRules` and `disableDefaultPolicies`.
 *
 * Rules pass through as the very objects written: a policy's name is a hash
 * of the rule's shape, key order included, so a rule rebuilt here would rename
 * every unnamed policy in the field.
 */
function lowerRls(
    rls: AnyTableDef["config"]["rls"],
    defaultPolicies: false | undefined,
    where: Where,
    defaultRls: DefaultRls | undefined
): { securityRules?: SecurityRule[]; disableDefaultPolicies?: true } {
    let posture: DefaultRls;
    if (rls === "inherit") {
        if (defaultRls === undefined) {
            return refuse(where, "says `rls: \"inherit\"`, and no `defaultRls` was given. Export `defaultRls` from backend/schema/index.ts, or give this table its own `rls`.");
        }
        posture = defaultRls;
    } else {
        posture = rls;
    }
    if (posture === "admin-only") {
        if (defaultPolicies === false) {
            return refuse(where, "combines an admin-only posture with `defaultPolicies: false`, which leaves no policy at all: every caller, admins included, would be denied. Drop `defaultPolicies: false`, or list the rules that grant access.");
        }
        return {};
    }
    return {
        securityRules: [...posture],
        ...(defaultPolicies === false ? { disableDefaultPolicies: true } : {})
    };
}

function lowerAuth(auth: AuthTableOptions): AuthCollectionConfig {
    const out: AuthCollectionConfig = { enabled: true };
    if (auth.roles !== undefined) out.roles = auth.roles;
    if (auth.scopes !== undefined) out.scopes = auth.scopes;
    if (auth.personalKeys !== undefined) out.personalKeys = auth.personalKeys;
    if (auth.onCreateUser !== undefined) out.onCreateUser = auth.onCreateUser;
    if (auth.onResetPassword !== undefined) out.onResetPassword = auth.onResetPassword;
    return out;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** The descriptor a hook receives, or a refusal naming what the caller must pass. */
function tableFor(slug: string, describe: LowerTablesOptions["describe"], hook: string): TableDescriptor {
    const descriptor = describe?.(slug);
    if (descriptor) return descriptor;
    throw new SchemaDefinitionError([{
        table: slug,
        key: hook,
        message: describe
            ? `ran, and \`describe("${slug}")\` returned no descriptor for the table it belongs to.`
            : "ran on a table lowered without a `describe` option. Hooks receive the table's descriptor as `table`: pass `describe` (the compiled descriptors, by slug) to `lowerTables`."
    }]);
}

/**
 * Table hooks as legacy `callbacks`: the legacy runtime calls them with
 * `{ collection, row, … }`, the hooks take `{ table, values, … }`.
 *
 * Exported for the server, which adapts its global hooks (`backend/hooks.ts`)
 * and `setTableHooks(slug, hooks)` through this same adapter.
 *
 * @group Schema
 */
export function lowerHooks(hooks: TableHooks | undefined, slug: string, describe: LowerTablesOptions["describe"]): CollectionCallbacks | undefined {
    if (!hooks) return undefined;
    const out: CollectionCallbacks = {};
    const { beforeQuery, afterRead, beforeSave, afterSave, afterSaveError, beforeDelete, afterDelete } = hooks;
    if (beforeQuery) {
        out.beforeQuery = props => beforeQuery({
            table: tableFor(slug, describe, "hooks.beforeQuery"),
            path: props.path,
            context: props.context,
            operation: props.operation,
            query: props.query
        });
    }
    if (afterRead) {
        out.afterRead = props => afterRead({
            table: tableFor(slug, describe, "hooks.afterRead"),
            path: props.path,
            context: props.context,
            values: props.row
        });
    }
    if (beforeSave) {
        out.beforeSave = props => beforeSave({
            table: tableFor(slug, describe, "hooks.beforeSave"),
            path: props.path,
            context: props.context,
            ...(props.id !== undefined ? { id: props.id } : {}),
            values: props.values,
            ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
            status: props.status
        });
    }
    if (afterSave) {
        out.afterSave = props => afterSave({
            table: tableFor(slug, describe, "hooks.afterSave"),
            path: props.path,
            context: props.context,
            id: props.id,
            values: props.values,
            ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
            status: props.status
        });
    }
    if (afterSaveError) {
        out.afterSaveError = props => afterSaveError({
            table: tableFor(slug, describe, "hooks.afterSaveError"),
            path: props.path,
            context: props.context,
            ...(props.id !== undefined ? { id: props.id } : {}),
            values: props.values,
            ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
            status: props.status,
            error: props.error
        });
    }
    if (beforeDelete) {
        out.beforeDelete = props => beforeDelete({
            table: tableFor(slug, describe, "hooks.beforeDelete"),
            path: props.path,
            context: props.context,
            id: props.id,
            values: props.row
        });
    }
    if (afterDelete) {
        out.afterDelete = props => afterDelete({
            table: tableFor(slug, describe, "hooks.afterDelete"),
            path: props.path,
            context: props.context,
            id: props.id,
            values: props.row
        });
    }
    return out;
}

/** A column's `.transform()` as legacy property `callbacks`. */
function lowerTransform(transform: ColumnTransform, slug: string, describe: LowerTablesOptions["describe"]): PropertyCallbacks {
    const out: PropertyCallbacks = {};
    const { beforeSave, afterRead } = transform;
    if (beforeSave) {
        out.beforeSave = props => beforeSave({
            table: tableFor(slug, describe, "transform.beforeSave"),
            path: props.path,
            context: props.context,
            value: props.value,
            previousValue: props.previousValue,
            values: props.values,
            ...(props.previousValues !== undefined ? { previousValues: props.previousValues } : {}),
            ...(props.id !== undefined ? { id: props.id } : {}),
            status: props.status
        });
    }
    if (afterRead) {
        out.afterRead = props => afterRead({
            table: tableFor(slug, describe, "transform.afterRead"),
            path: props.path,
            context: props.context,
            value: props.value,
            values: props.row
        });
    }
    return out;
}

/**
 * A closed value set as legacy `enum` entries, in declaration order. The label
 * is the id: labels are the panel's, and it derives one when it is not told.
 */
function enumValues(values: readonly (string | number)[]): EnumValueConfig[] {
    return values.map(id => ({ id, label: String(id) }));
}
