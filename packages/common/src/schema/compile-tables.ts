import type {
    ColumnType,
    AnyTableDef,
    AnyViewDef,
    AuthTableDescriptor,
    ColumnDef,
    ColumnDescriptor,
    ColumnElementDescriptor,
    DefaultRls,
    OrderByTuple,
    RelationDef,
    RelationDescriptor,
    RlsDescriptor,
    SearchConfig,
    TableDescriptor,
    TableHookFlags,
    TableIndex,
    TableIndexKey,
    TableIndexPredicate,
    TenantDescriptor,
    TenantSource
} from "@rebasepro/types";
import {
    DEFAULT_DATA_SOURCE_KEY,
    columnTypeLabel,
    describeJsonShape,
    isAuthTableDef,
    isColumnBuilder,
    isRelationDef,
    isTableDef,
    isViewDef,
    resourceKeyOf
} from "@rebasepro/types";
import { toPostgresIdentifier } from "@rebasepro/utils";

import { authSecretsMissingExclusion } from "../collections/auth-secrets";
import { DEFAULT_SOFT_DELETE_FIELD } from "../collections/soft-delete";
import { SchemaDefinitionError, type SchemaDefinitionProblem } from "./errors";
import {
    JUNCTION_TABLE_SCHEMA,
    deriveBelongsToLocalKey,
    deriveColumnName,
    deriveEnumTypeName,
    deriveForeignKeyField,
    deriveJunctionSourceKey,
    deriveJunctionTable,
    deriveJunctionTargetKey,
    deriveReferencingType,
    deriveSchemaName,
    deriveSlug,
    deriveTableName,
    deriveTargetForeignKey,
    deriveViaWritable
} from "./derive-names";
import { resolveRls, ruleShapeProblems } from "./resolve-rls";
import { checkColumnDef, checkRuleFields, sameColumnType } from "./validate-tables";

/**
 * Options of {@link compileTables}.
 *
 * @group Schema
 */
export interface CompileTablesOptions {
    /**
     * The project's `defaultRls` (exported from `backend/schema/index.ts`):
     * what every `rls: "inherit"` table takes. Without it, `"inherit"` is
     * refused.
     */
    defaultRls?: DefaultRls;
}

/** A table or view definition, as `compileTables` takes them. */
export type AnySchemaDef = AnyTableDef | AnyViewDef;

/** One declared column, with the SQL name it resolves to. */
interface PreparedColumn {
    key: string;
    def: ColumnDef;
    column: string;
}

/** What every other table needs to know about one definition before any is compiled. */
interface PreparedDef {
    def: AnySchemaDef;
    kind: "table" | "view";
    name: string;
    slug: string;
    table: string;
    schema: string;
    columns: PreparedColumn[];
    relations: [string, RelationDef][];
}

/** The resolved target of a relation. */
type TargetResolution = { ok: true; target: PreparedDef } | { ok: false; message: string };

/** A junction table some relation claims, for the cross-table checks. */
interface JunctionClaim {
    keys: string;
    owner: string;
    table: string;
}

const TABLE_HOOKS = ["beforeQuery", "afterRead", "beforeSave", "afterSave", "afterSaveError", "beforeDelete", "afterDelete"] as const;
const VIEW_HOOKS = ["beforeQuery", "afterRead"] as const;
const TENANT_KINDS = new Set([
    "text", "varchar", "char", "uuid", "enum",
    "smallint", "integer", "bigint", "smallserial", "serial", "bigserial", "numeric"
]);
const TEMPORAL_KINDS = new Set(["timestamptz", "date", "time"]);
/**
 * Integer widths. A foreign key holds between any two of them — Postgres
 * compares `integer` with `bigint` in one operator family — so a bound column
 * keeps its declared width when it points at a key of another one (the shape
 * a database grown over years holds: an `integer` column into a `bigint` key).
 */
const INTEGER_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["smallint", "integer", "bigint", "smallserial", "serial", "bigserial"]);

/**
 * Compile table and view definitions into the descriptors the backend runs on
 * and `GET /api/schema/tables` serves.
 *
 * Every default is applied and every name derived exactly as today's
 * collection pipeline derives it (see `derive-names.ts`), every relation is
 * resolved to its target's slug, and `rls` is resolved against `defaultRls`.
 *
 * Fails closed: every problem in every definition is collected, and one
 * {@link SchemaDefinitionError} carrying all of them is thrown — a table with
 * no primary key, no usable `rls`, a relation that points outside the list,
 * modifiers that contradict each other, and the rest listed in the error's
 * documentation.
 *
 * Pure and deterministic: no environment, no I/O; tables come out in input
 * order and columns in physical order (declared columns, then the foreign-key
 * columns `belongsTo` relations derive, in relation order).
 *
 * @group Schema
 */
export function compileTables(defs: readonly AnySchemaDef[], options: CompileTablesOptions = {}): TableDescriptor[] {
    const problems: SchemaDefinitionProblem[] = [];
    const prepared: PreparedDef[] = [];
    defs.forEach((def, index) => {
        const result = prepareDef(def, index);
        if ("problem" in result) problems.push(result.problem);
        else prepared.push(result);
    });

    problems.push(...checkTablesTogether(prepared));

    const byDef = new Map<unknown, PreparedDef>(prepared.map(entry => [entry.def, entry]));
    const resolve = (thunk: () => unknown): TargetResolution => resolveTarget(thunk, byDef);
    const junctions = new Map<string, JunctionClaim>();
    const descriptors: TableDescriptor[] = [];
    for (const entry of prepared) {
        const { descriptor, problems: found } = compileOne(entry, resolve, options, junctions);
        problems.push(...found);
        descriptors.push(descriptor);
    }

    problems.push(...checkStoredIdentifiers(descriptors, prepared));

    if (problems.length > 0) throw new SchemaDefinitionError(problems);
    return descriptors;
}

/**
 * Compile one definition, given how to resolve a relation's target.
 *
 * The building block of {@link compileTables}, exported for callers that hold
 * a resolver of their own. Returns the descriptor together with the problems
 * found in that one definition rather than throwing, so the caller decides how
 * to report them; checks that need every table at once (duplicate names,
 * identifiers that collide once Postgres truncates them, one junction claimed
 * with two shapes) are only made by {@link compileTables}.
 *
 * @param resolveTarget Called with a relation's target thunk; returns the
 *   definition it points at, or why it does not resolve.
 *
 * @group Schema
 */
export function compileTable(
    def: AnySchemaDef,
    resolveTarget: (thunk: () => unknown) => { ok: true; target: AnySchemaDef } | { ok: false; message: string },
    options: CompileTablesOptions = {}
): { descriptor: TableDescriptor | undefined; problems: SchemaDefinitionProblem[] } {
    const entry = prepareDef(def, 0);
    if ("problem" in entry) return { descriptor: undefined, problems: [entry.problem] };
    const cache = new Map<unknown, PreparedDef>([[def, entry]]);
    const resolve = (thunk: () => unknown): TargetResolution => {
        const result = resolveTarget(thunk);
        if (!result.ok) return result;
        let target = cache.get(result.target);
        if (!target) {
            const preparedTarget = prepareDef(result.target, 0);
            if ("problem" in preparedTarget) return { ok: false, message: preparedTarget.problem.message };
            target = preparedTarget;
            cache.set(result.target, target);
        }
        return { ok: true, target };
    };
    return compileOne(entry, resolve, options, new Map());
}

/**
 * The descriptor of one declared column: its key, its SQL name and every flag
 * that is set. Flags that are false or absent are left out, so a descriptor
 * stays small and stable as options are added.
 *
 * @param key The column's key in `columns`.
 * @param column The SQL column name (`.column()`, or the snake_case of the key).
 *
 * @group Schema
 */
export function describeColumn(key: string, def: ColumnDef, column: string): ColumnDescriptor {
    const out: ColumnDescriptor = {
        key,
        column,
        type: def.type,
        nullable: !(def.notNull || def.primaryKey)
    };
    if (def.primaryKey) out.primaryKey = true;
    // A key column is unique by being the key; today's planner never writes a
    // second UNIQUE on it, so neither does the descriptor.
    if (def.unique && !def.primaryKey) out.unique = true;
    if (def.default !== undefined) out.default = def.default;
    if (def.generatedAs !== undefined) out.generated = { expression: def.generatedAs };
    if (def.readOnly || def.generatedAs !== undefined) out.readOnly = true;
    if (def.private) out.private = true;
    if (def.access !== undefined) out.access = def.access;
    if (def.stamp !== undefined) out.stamp = def.stamp;
    if (def.validate !== undefined && Object.keys(def.validate).length > 0) out.validate = def.validate;
    if (def.oneOf !== undefined) out.oneOf = def.oneOf;
    if (def.description !== undefined) out.description = def.description;
    if (def.storage !== undefined) out.storage = def.storage;
    if (def.semantic !== undefined) out.semantic = def.semantic;
    if (def.vectorIndex !== undefined) out.vectorIndex = def.vectorIndex;
    if (def.json !== undefined) out.json = describeJsonShape(def.json);
    if (def.element !== undefined) {
        const element: ColumnElementDescriptor = {};
        if (def.element.validate !== undefined && Object.keys(def.element.validate).length > 0) element.validate = def.element.validate;
        if (def.element.oneOf !== undefined) element.oneOf = def.element.oneOf;
        if (def.element.storage !== undefined) element.storage = def.element.storage;
        if (def.element.semantic === "user") element.semantic = "user";
        if (Object.keys(element).length > 0) out.element = element;
    }
    if (def.transform !== undefined) {
        const transforms: { beforeSave?: true; afterRead?: true } = {};
        if (typeof def.transform.beforeSave === "function") transforms.beforeSave = true;
        if (typeof def.transform.afterRead === "function") transforms.afterRead = true;
        if (Object.keys(transforms).length > 0) out.transforms = transforms;
    }
    return out;
}

// ── Preparation ──────────────────────────────────────────────────────────────

function prepareDef(def: unknown, index: number): PreparedDef | { problem: SchemaDefinitionProblem } {
    const view = isViewDef(def);
    if (!view && !isTableDef(def)) {
        return {
            problem: {
                table: `#${index}`,
                message: "is not a `defineTable(...)`, `defineAuthTable(...)` or `defineView(...)` result. Export only table and view definitions from backend/schema/index.ts."
            }
        };
    }
    const name = def.name;
    const config = def.config;
    const rawColumns: unknown = config.columns;
    if (typeof rawColumns !== "object" || rawColumns === null) {
        return { problem: { table: name, message: "declares no `columns`." } };
    }
    const columns: PreparedColumn[] = [];
    for (const [key, builder] of Object.entries(rawColumns)) {
        if (!isColumnBuilder(builder)) {
            return { problem: { table: name, key, message: "is not a `col.*` builder." } };
        }
        columns.push({ key, def: builder.def, column: deriveColumnName(key, builder.def) });
    }
    const relations: [string, RelationDef][] = [];
    const rawRelations: unknown = config.relations;
    if (rawRelations !== undefined && rawRelations !== null) {
        if (typeof rawRelations !== "object") {
            return { problem: { table: name, message: "`relations` must be an object of `rel.*` results." } };
        }
        for (const [key, relation] of Object.entries(rawRelations)) {
            if (!isRelationDef(relation)) {
                return { problem: { table: name, key, message: "is not a `rel.*` result." } };
            }
            relations.push([key, relation]);
        }
    }
    const table = deriveTableName(name, def.config.table);
    return {
        def,
        kind: view ? "view" : "table",
        name,
        slug: deriveSlug(name, config.slug),
        table,
        schema: deriveSchemaName(config.schema),
        columns,
        relations
    };
}

function resolveTarget(thunk: () => unknown, byDef: ReadonlyMap<unknown, PreparedDef>): TargetResolution {
    let value: unknown;
    try {
        value = thunk();
    } catch (error) {
        if (error instanceof ReferenceError) {
            return {
                ok: false,
                message:
                    "its target is not initialized yet — almost always an import cycle between the two schema " +
                    "files. Break the cycle (move the shared piece into a third module) so the target's module " +
                    "finishes evaluating before the schema is compiled."
            };
        }
        return { ok: false, message: `its target thunk threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    // A cycle transpiled to CommonJS hands the thunk the module namespace,
    // whose `default` slot holds the definition by the time the thunk runs.
    if (!isTableDef(value) && !isViewDef(value) && typeof value === "object" && value !== null && "default" in value) {
        const inner: unknown = value.default;
        if (isTableDef(inner) || isViewDef(inner)) value = inner;
    }
    if (!isTableDef(value) && !isViewDef(value)) {
        return {
            ok: false,
            message:
                `its target resolved to ${value === undefined ? "`undefined`" : "something that is not a table"}. ` +
                "The thunk must return the `defineTable` / `defineView` result itself: `() => users`."
        };
    }
    const target = byDef.get(value);
    if (!target) {
        return {
            ok: false,
            message:
                `its target "${value.name}" is not one of the tables being compiled. Export it from ` +
                "backend/schema/index.ts beside this one."
        };
    }
    return { ok: true, target };
}

// ── One table ────────────────────────────────────────────────────────────────

function compileOne(
    entry: PreparedDef,
    resolve: (thunk: () => unknown) => TargetResolution,
    options: CompileTablesOptions,
    junctions: Map<string, JunctionClaim>
): { descriptor: TableDescriptor; problems: SchemaDefinitionProblem[] } {
    const problems: SchemaDefinitionProblem[] = [];
    const refuse = (message: string, key?: string): void => {
        problems.push(key === undefined ? { table: entry.name, message } : { table: entry.name, key, message });
    };
    const { def, name } = entry;
    const config = def.config;
    const auth = entry.kind === "table" && isAuthTableDef(def);

    // ── Columns ──────────────────────────────────────────────────────────────
    const secrets = auth ? new Set(authSecretsMissingExclusion({
        auth: true,
        properties: Object.fromEntries(entry.columns.map(c => [c.key, { excludeFromApi: c.def.private, columnName: c.column }]))
    })) : new Set<string>();
    const columns: ColumnDescriptor[] = [];
    for (const column of entry.columns) {
        problems.push(...checkColumnDef(name, column.key, column.def, column.column));
        const described = describeColumn(column.key, column.def, column.column);
        // The user store's secrets never leave the server, whatever the
        // declaration says: a redeclared users table is where the flag goes
        // missing unnoticed.
        if (secrets.has(column.key)) described.private = true;
        columns.push(described);
    }
    const primaryKey = entry.columns.filter(c => c.def.primaryKey).map(c => c.key);
    if (primaryKey.length === 0) {
        refuse(
            entry.kind === "view"
                ? "the view has no primary key: mark the column(s) that identify a row `.primaryKey()`."
                : "the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order."
        );
    }
    const keyOwners = new Map<string, string>();
    for (const column of entry.columns) keyOwners.set(column.key, `column "${column.key}"`);
    for (const [relationName] of entry.relations) {
        if (keyOwners.has(relationName)) {
            refuse(
                `the table has both a column and a relation named "${relationName}". A relation's key is what ` +
                "`include` names; give the foreign-key column its own key.",
                relationName
            );
        } else {
            keyOwners.set(relationName, `relation "${relationName}"`);
        }
    }

    // ── Relations ────────────────────────────────────────────────────────────
    const relations: RelationDescriptor[] = [];
    const derivedColumns: ColumnDescriptor[] = [];
    const boundBy = new Map<string, string>();
    for (const [relationName, relation] of entry.relations) {
        const resolved = resolve(relation.target);
        if (!resolved.ok) {
            refuse(`the relation ${resolved.message}`, relationName);
            continue;
        }
        const target = resolved.target;
        const targetKeys = target.columns.filter(c => c.def.primaryKey);
        const sourceKeys = entry.columns.filter(c => c.def.primaryKey);
        const compositeRefusal = (side: PreparedDef, count: number, link: string, fix: string): void => refuse(
            `${link} is one column, and \`${side.name}\` is keyed on ${count} columns together — one column ` +
            `cannot reference a composite key. ${fix}`,
            relationName
        );
        const viaFix = "or express the link as `rel.via(...)`, whose steps compare every key column.";
        const before = relations.length;
        switch (relation.kind) {
            case "belongsTo": {
                const localKey = deriveBelongsToLocalKey(relationName, relation.localKey);
                const bound = entry.columns.find(c => c.column === localKey);
                if (targetKeys.length > 1) {
                    compositeRefusal(target, targetKeys.length, `\`localKey: "${localKey}"\``, `Point the relation at a table with a single-column key, ${viaFix}`);
                }
                const targetKey = targetKeys.length === 1 ? targetKeys[0] : undefined;
                const referencing = targetKey ? deriveReferencingType(targetKey.def.type, target.table, targetKey.column) : undefined;
                let localField: string;
                if (bound) {
                    localField = bound.key;
                    const previous = boundBy.get(bound.key);
                    if (previous !== undefined) {
                        refuse(`the relations "${previous}" and "${relationName}" both use the column "${localKey}" as their foreign key. One column holds one link; give one of them its own \`localKey\`.`, relationName);
                    }
                    boundBy.set(bound.key, relationName);
                    if (targetKey && referencing
                        && !sameColumnType(bound.def.type, entry.table, bound.column, referencing, target.table, targetKey.column)
                        && !(INTEGER_KINDS.has(bound.def.type.kind) && INTEGER_KINDS.has(referencing.kind))) {
                        refuse(
                            `the relation binds the column "${bound.key}" (\`${columnTypeLabel(bound.def.type)}\`) as its foreign key, ` +
                            `and \`${target.name}\`'s key "${targetKey.key}" is \`${columnTypeLabel(referencing)}\`. A foreign key ` +
                            "only holds between columns of one type. Declare the column with the key's type, or drop it and let " +
                            "the relation derive it.",
                            relationName
                        );
                    }
                    if (relation.notNull === true && !(bound.def.notNull || bound.def.primaryKey)) {
                        refuse(
                            `\`notNull: true\` applies to a derived foreign key, and this relation binds the declared column "${bound.key}", ` +
                            "which is nullable. A bound column says so itself: write `.notNull()` on it and drop `notNull` here.",
                            relationName
                        );
                    }
                    if (relation.unique === true && !(bound.def.unique || bound.def.primaryKey)) {
                        refuse(
                            `\`unique: true\` applies to a derived foreign key, and this relation binds the declared column "${bound.key}", ` +
                            "which is not unique. Write `.unique()` on the column and drop `unique` here.",
                            relationName
                        );
                    }
                    const index = columns.findIndex(c => c.key === bound.key);
                    if (index >= 0) columns[index] = { ...columns[index], foreignKeyOf: relationName };
                } else {
                    localField = deriveForeignKeyField(localKey);
                    const owner = keyOwners.get(localField);
                    if (owner !== undefined) {
                        refuse(
                            `the relation derives the foreign-key column "${localKey}", served as "${localField}", and the ${owner} ` +
                            `already has that key. Declare the column yourself (\`${localField}: col…\` with \`.column("${localKey}")\` ` +
                            "binds it), or give the relation another `localKey`.",
                            relationName
                        );
                    } else if (entry.columns.some(c => c.column === localKey) || derivedColumns.some(c => c.column === localKey)) {
                        refuse(`the relation derives the column "${localKey}", which another relation already derives. Give one of them its own \`localKey\`.`, relationName);
                    } else {
                        keyOwners.set(localField, `foreign key of relation "${relationName}"`);
                        const column: ColumnDescriptor = {
                            key: localField,
                            column: localKey,
                            type: referencing ?? { kind: "text" },
                            nullable: relation.notNull !== true,
                            foreignKeyOf: relationName,
                            derived: true
                        };
                        if (relation.unique === true) column.unique = true;
                        derivedColumns.push(column);
                    }
                }
                const descriptor: RelationDescriptor = {
                    name: relationName,
                    kind: "belongsTo",
                    target: target.slug,
                    cardinality: "one",
                    localKey,
                    localField,
                    index: relation.index !== false,
                    constraint: relation.constraint !== false && entry.kind === "table" && target.kind === "table"
                };
                if (relation.onDelete !== undefined) descriptor.onDelete = relation.onDelete;
                if (relation.onUpdate !== undefined) descriptor.onUpdate = relation.onUpdate;
                relations.push(descriptor);
                break;
            }
            case "hasOne":
            case "hasMany": {
                const foreignKey = deriveTargetForeignKey(entry.slug, relation.foreignKey);
                if (relation.sourceKey === undefined && sourceKeys.length > 1) {
                    compositeRefusal(entry, sourceKeys.length, `\`foreignKey: "${foreignKey}"\``,
                        `Give the relation a \`sourceKey\` naming a single unique column of \`${entry.name}\` to point at, ${viaFix}`);
                }
                const base = { name: relationName, target: target.slug, foreignKey };
                const withSource = relation.sourceKey !== undefined ? { ...base, sourceKey: relation.sourceKey } : base;
                if (relation.kind === "hasOne") {
                    relations.push({ ...withSource, kind: "hasOne", cardinality: "one" });
                } else {
                    const orderBy = normalizeOrderBy(relation.orderBy);
                    relations.push(orderBy
                        ? { ...withSource, kind: "hasMany", cardinality: "many", orderBy }
                        : { ...withSource, kind: "hasMany", cardinality: "many" });
                }
                break;
            }
            case "manyToMany": {
                if (sourceKeys.length > 1 || targetKeys.length > 1) {
                    const side = sourceKeys.length > 1 ? entry : target;
                    compositeRefusal(side, Math.max(sourceKeys.length, targetKeys.length), "A junction column",
                        `A junction column points at a single-column key; ${viaFix}`);
                }
                const through = deriveJunctionTable(entry.table, target.table, relation.through);
                const sourceKey = deriveJunctionSourceKey(entry.slug, relation.sourceKey);
                const targetKey = deriveJunctionTargetKey(relationName, relation.targetKey);
                const pivot: ColumnDescriptor[] = [];
                for (const [key, builder] of Object.entries(relation.pivot ?? {})) {
                    if (!isColumnBuilder(builder)) {
                        refuse(`the pivot column "${key}" is not a \`col.*\` builder.`, relationName);
                        continue;
                    }
                    const column = deriveColumnName(key, builder.def);
                    // A payload column on a key column is not planned today; it
                    // is not described either.
                    if (column === sourceKey || column === targetKey) continue;
                    for (const problem of checkColumnDef(name, `${relationName}.pivot.${key}`, builder.def, column)) problems.push(problem);
                    pivot.push(describeColumn(key, builder.def, column));
                }
                claimJunction(junctions, through, entry, relationName, sourceKey, targetKey, target, refuse);
                const descriptor: RelationDescriptor = {
                    name: relationName,
                    kind: "manyToMany",
                    target: target.slug,
                    cardinality: "many",
                    through: { table: through, sourceKey, targetKey, pivot }
                };
                if (relation.onDelete !== undefined) descriptor.onDelete = relation.onDelete;
                relations.push(descriptor);
                break;
            }
            case "via": {
                const steps = Array.isArray(relation.steps) ? relation.steps : [];
                if (steps.length === 0) {
                    refuse("`rel.via(target, { steps })` needs at least one join step.", relationName);
                }
                const cardinality = relation.cardinality ?? "many";
                relations.push({
                    name: relationName,
                    kind: "via",
                    target: target.slug,
                    cardinality,
                    steps: steps.map(step => ({ ...step })),
                    writable: steps.length > 0 && deriveViaWritable(cardinality, steps)
                });
                break;
            }
            default: {
                const exhaustive: never = relation;
                refuse(`unknown relation kind ${JSON.stringify(exhaustive)}.`);
            }
        }
        if (relations.length > before) {
            const described = relations[relations.length - 1];
            if (relation.private === true && relation.access !== undefined) {
                refuse(
                    "the relation is `private: true` and declares `access`. A private relation is never served to or " +
                    "written by a client, so access rules say nothing; drop one of the two.",
                    relationName
                );
            }
            if (relation.private === true) described.private = true;
            else if (relation.access !== undefined) described.access = relation.access;
        }
    }
    const allColumns = [...columns, ...derivedColumns];

    // ── Names a table-level option may use ───────────────────────────────────
    const byKey = new Map(allColumns.map(c => [c.key, c]));
    const belongsToField = new Map<string, string>();
    for (const relation of relations) {
        if (relation.kind === "belongsTo") belongsToField.set(relation.name, relation.localField);
    }
    /** A column key, or a `belongsTo` relation name standing for its foreign-key column. */
    const columnOf = (key: string): ColumnDescriptor | undefined => byKey.get(key) ?? byKey.get(belongsToField.get(key) ?? "");

    const descriptor: TableDescriptor = {
        name,
        slug: entry.slug,
        table: entry.table,
        schema: entry.schema,
        kind: entry.kind,
        columns: allColumns,
        primaryKey,
        relations,
        rls: { posture: "admin-only", rules: [], defaultPolicies: true }
    };
    const database = config.database !== undefined ? resourceKeyOf(config.database) : undefined;
    if (database !== undefined && database !== DEFAULT_DATA_SOURCE_KEY) descriptor.database = database;
    if (config.description !== undefined) descriptor.description = config.description;
    if (config.metadata !== undefined) descriptor.metadata = { ...config.metadata };

    // ── Indexes ──────────────────────────────────────────────────────────────
    const indexes: unknown = config.indexes;
    if (indexes !== undefined) {
        if (!Array.isArray(indexes)) {
            refuse("`indexes` must be a list of `{ columns, … }`.");
        } else {
            if (entry.kind === "view" && !isMaterialized(def)) {
                refuse("only a materialized view stores rows to index; a plain view reads the indexes of its tables. Drop `indexes`, or make the view `materialized: true`.");
            }
            const list: TableIndex[] = [];
            indexes.forEach((index: TableIndex, position: number) => {
                for (const key of indexKeysOf(index)) {
                    if (!columnOf(key)) {
                        refuse(`\`indexes[${position}]\` names "${key}", which is no column key or \`belongsTo\` relation of the table. Name a key from \`columns\`.`);
                    }
                }
                list.push(index);
            });
            descriptor.indexes = list;
        }
    }

    // ── Views and tables part ways ───────────────────────────────────────────
    if (isViewDef(def)) {
        const viewConfig = def.config;
        if (typeof viewConfig.query !== "string" || viewConfig.query.trim().length === 0) {
            refuse("the view needs a `query`: the SELECT that defines it.");
        }
        if (viewConfig.roles !== undefined && !viewConfig.materialized) {
            refuse(
                "the view lists `roles` but is not materialized. A plain view is governed by the row-level security " +
                "of the tables it reads; `roles` gates a materialized view only. Drop `roles`, or add `materialized: true`."
            );
        }
        for (const key of ["tenant", "softDelete", "history", "search", "rls"] as const) {
            if (key in viewConfig && Reflect.get(viewConfig, key) !== undefined && Reflect.get(viewConfig, key) !== false) {
                refuse(`\`${key}\` cannot be declared on a view: a view is never written and has no policies of its own; declare it on the tables the view reads.`);
            }
        }
        const materialized = viewConfig.materialized === true;
        descriptor.view = materialized
            ? { materialized: true, roles: [...(viewConfig.roles ?? ["admin"])], query: viewConfig.query }
            : { materialized: false, query: viewConfig.query };
        // A view carries no policies: a plain one runs as the caller, a
        // materialized one is gated by `view.roles`. Neither grants through
        // `rls`, which says so with its own posture, no rules and no baseline.
        descriptor.rls = { posture: "view", rules: [], defaultPolicies: false };
        const hooks = hookFlags(viewConfig.hooks, VIEW_HOOKS);
        if (hooks) descriptor.hooks = hooks;
        return { descriptor, problems };
    }

    const tableConfig = def.config;

    // ── rls ──────────────────────────────────────────────────────────────────
    const rls = resolveRls(tableConfig.rls, tableConfig.defaultPolicies, options.defaultRls);
    if (!rls.ok) {
        refuse(rls.message);
    } else {
        descriptor.rls = rls.rls;
        problems.push(...checkRules(name, rls.rls, allColumns, relations, auth));
    }

    // ── tenant ───────────────────────────────────────────────────────────────
    if (tableConfig.tenant !== undefined) {
        const tenant = compileTenant(tableConfig.tenant, columnOf, refuse);
        if (tenant) {
            descriptor.tenant = tenant;
            // The planner makes the tenant column NOT NULL whatever it was declared.
            const index = allColumns.findIndex(c => c.key === tenant.field);
            if (index >= 0) allColumns[index] = { ...allColumns[index], nullable: false };
        }
    }

    // ── softDelete ───────────────────────────────────────────────────────────
    const softDelete: unknown = tableConfig.softDelete;
    if (softDelete !== undefined && softDelete !== false) {
        let field: string | undefined;
        if (softDelete === true) field = DEFAULT_SOFT_DELETE_FIELD;
        else if (typeof softDelete === "object" && softDelete !== null) {
            const named: unknown = "field" in softDelete ? softDelete.field : undefined;
            field = typeof named === "string" && named.length > 0 ? named : DEFAULT_SOFT_DELETE_FIELD;
        } else {
            refuse("`softDelete` must be `true` or `{ field }`.");
        }
        if (field !== undefined) {
            const column = byKey.get(field);
            if (!column) {
                refuse(
                    `\`softDelete\` records the deletion in "${field}", and the table has no such column. Declare it — ` +
                    `\`${field}: col.timestamptz()\` — or name an existing timestamp column with \`softDelete: { field: "…" }\`. ` +
                    "The flag says what a column means; it does not add one."
                );
            } else if (!TEMPORAL_KINDS.has(column.type.kind)) {
                refuse(`\`softDelete\` stamps "${field}" with the time of the deletion, and that column is \`${columnTypeLabel(column.type)}\`. Make it \`col.timestamptz()\`.`);
            } else {
                descriptor.softDelete = { field };
            }
        }
    }

    if (tableConfig.history === true) descriptor.history = true;

    // ── search ───────────────────────────────────────────────────────────────
    if (tableConfig.search !== undefined) {
        problems.push(...checkSearch(name, tableConfig.search, byKey));
        descriptor.search = { ...tableConfig.search, fields: [...tableConfig.search.fields] };
    }

    // ── auth ─────────────────────────────────────────────────────────────────
    if (auth && def.auth) {
        const authDescriptor: AuthTableDescriptor = {};
        if (def.auth.roles !== undefined) authDescriptor.roles = def.auth.roles;
        if (def.auth.scopes !== undefined) authDescriptor.scopes = def.auth.scopes;
        if (def.auth.personalKeys !== undefined) authDescriptor.personalKeys = def.auth.personalKeys;
        const authHooks: { onCreateUser?: true; onResetPassword?: true } = {};
        if (typeof def.auth.onCreateUser === "function") authHooks.onCreateUser = true;
        if (typeof def.auth.onResetPassword === "function") authHooks.onResetPassword = true;
        if (Object.keys(authHooks).length > 0) authDescriptor.hooks = authHooks;
        descriptor.auth = authDescriptor;
    }

    const hooks = hookFlags(tableConfig.hooks, TABLE_HOOKS);
    if (hooks) descriptor.hooks = hooks;
    if (tableConfig.strictWrites === false) descriptor.strictWrites = false;

    return { descriptor, problems };
}

function isMaterialized(def: AnySchemaDef): boolean {
    return isViewDef(def) && def.config.materialized === true;
}

function normalizeOrderBy(orderBy: OrderByTuple | readonly OrderByTuple[] | undefined): OrderByTuple[] | undefined {
    if (orderBy === undefined || orderBy.length === 0) return undefined;
    const tuples: OrderByTuple[] = [];
    if (isOrderByTuple(orderBy)) {
        tuples.push([...orderBy]);
    } else {
        for (const tuple of orderBy) tuples.push([...tuple]);
    }
    return tuples;
}

function isOrderByTuple(value: OrderByTuple | readonly OrderByTuple[]): value is OrderByTuple {
    return typeof value[0] === "string";
}

function hookFlags(hooks: object | undefined, names: readonly (keyof TableHookFlags)[]): TableHookFlags | undefined {
    if (!hooks) return undefined;
    const flags: TableHookFlags = {};
    for (const name of names) {
        if (typeof Reflect.get(hooks, name) === "function") flags[name] = true;
    }
    return Object.keys(flags).length > 0 ? flags : undefined;
}

function indexKeysOf(index: TableIndex): string[] {
    const keys: string[] = [];
    const keyOf = (entry: string | TableIndexKey): string => typeof entry === "string" ? entry : entry.column;
    for (const entry of index.columns ?? []) keys.push(keyOf(entry));
    for (const entry of index.include ?? []) keys.push(entry);
    const walk = (predicate: TableIndexPredicate | undefined): void => {
        if (!predicate) return;
        if ("and" in predicate) {
            for (const inner of predicate.and) walk(inner);
            return;
        }
        keys.push(predicate.column);
    };
    walk(index.where);
    return keys;
}

function compileTenant(
    tenant: { field: string; from: TenantSource; bypassRoles?: readonly string[] },
    columnOf: (key: string) => ColumnDescriptor | undefined,
    refuse: (message: string) => void
): TenantDescriptor | undefined {
    const column = columnOf(tenant.field);
    if (!column) {
        refuse(
            `\`tenant\` scopes rows by "${tenant.field}", and the table has no such column or \`belongsTo\` relation. ` +
            `Declare it — \`${tenant.field}: col.uuid().notNull()\` — or name the column that already holds the tenant id. ` +
            "The flag says what a column means; it does not add one."
        );
        return undefined;
    }
    let ok = true;
    if (!TENANT_KINDS.has(column.type.kind)) {
        refuse(`"${tenant.field}" is \`${columnTypeLabel(column.type)}\`, which cannot hold a tenant id. Use a text, \`uuid\` or integer column, or a \`belongsTo\` the tenants table.`);
        ok = false;
    }
    if (column.private || column.access?.read !== undefined) {
        refuse(
            `"${tenant.field}" is the tenant every row belongs to, and it is also hidden from callers ` +
            `(\`${column.private ? ".private()" : "access.read"}\`), so a client could never see which tenant a row it ` +
            "just wrote is in. Drop the restriction, or drop `tenant`."
        );
        ok = false;
    }
    if (!ok) return undefined;
    const out: TenantDescriptor = { field: column.key, from: tenant.from };
    if (tenant.bypassRoles !== undefined) out.bypassRoles = [...tenant.bypassRoles];
    return out;
}

function checkSearch(table: string, search: SearchConfig, byKey: ReadonlyMap<string, ColumnDescriptor>): SchemaDefinitionProblem[] {
    const problems: SchemaDefinitionProblem[] = [];
    const refuse = (message: string) => problems.push({ table, key: "search", message });
    if (!Array.isArray(search.fields) || search.fields.length === 0) {
        refuse("`search.fields` lists no field. Name the text columns to index, e.g. `search: { fields: [\"title\"] }`.");
        return problems;
    }
    for (const entry of search.fields) {
        const path = typeof entry === "string" ? entry : entry.path;
        const [head, ...rest] = path.split(".");
        const column = byKey.get(head);
        if (!column) {
            refuse(`\`search.fields\` names "${path}", and "${head}" is no column key of the table. Name a column from \`columns\`.`);
            continue;
        }
        if (rest.length > 0 && column.type.kind !== "json" && column.type.kind !== "jsonb") {
            refuse(`\`search.fields\` names the path "${path}", and "${head}" is \`${columnTypeLabel(column.type)}\`, not a JSON column. A dotted path reads into a \`col.jsonb()\` document.`);
        }
        if (column.private || column.access?.read !== undefined) {
            refuse(
                `"${path}" is named in \`search.fields\` and also restricted by \`${column.private ? ".private()" : "access.read"}\`. ` +
                "The search index is one generated column shared by every caller, so the field would stay matchable " +
                "to callers who can never see its value — recoverable a term at a time. Remove it from " +
                "`search.fields`, or drop the read restriction."
            );
        }
    }
    return problems;
}

/** The columns every auth table has whether it declares them or not, by key and SQL name. */
const AUTH_TABLE_NAMES = [
    "id", "email", "displayName", "display_name", "photoURL", "photo_url", "roles", "passwordHash", "password_hash",
    "emailVerified", "email_verified", "emailVerificationToken", "email_verification_token",
    "emailVerificationSentAt", "email_verification_sent_at", "metadata", "createdAt", "created_at", "updatedAt", "updated_at",
    "isAnonymous", "is_anonymous", "tokensValidAfter", "tokens_valid_after"
];

function checkRules(
    table: string,
    rls: RlsDescriptor,
    columns: readonly ColumnDescriptor[],
    relations: readonly RelationDescriptor[],
    auth: boolean
): SchemaDefinitionProblem[] {
    const names = new Set<string>();
    for (const column of columns) {
        names.add(column.key);
        names.add(column.column);
    }
    for (const relation of relations) {
        if (relation.kind === "belongsTo") names.add(relation.name);
    }
    if (auth) for (const name of AUTH_TABLE_NAMES) names.add(name);
    return rls.rules.flatMap((rule, index) => [
        ...ruleShapeProblems(rule, rule.name ? `rule "${rule.name}"` : `rule #${index}`)
            .map(message => ({ table, key: `rls[${index}]`, message })),
        ...checkRuleFields(table, rule, index, { names })
    ]);
}

// ── Across tables ────────────────────────────────────────────────────────────

function checkTablesTogether(prepared: readonly PreparedDef[]): SchemaDefinitionProblem[] {
    const problems: SchemaDefinitionProblem[] = [];
    const names = new Map<string, PreparedDef>();
    const slugs = new Map<string, PreparedDef>();
    const tables = new Map<string, PreparedDef>();
    let authTable: PreparedDef | undefined;
    for (const entry of prepared) {
        const sameName = names.get(entry.name);
        if (sameName) {
            problems.push({ table: entry.name, message: `two definitions are named "${entry.name}". Each table and view needs its own name.` });
        } else {
            names.set(entry.name, entry);
        }
        const sameSlug = slugs.get(entry.slug);
        if (sameSlug && sameSlug !== sameName) {
            problems.push({
                table: entry.name,
                message:
                    `its slug "${entry.slug}" is also the slug of "${sameSlug.name}". The slug is the table's API path, ` +
                    "its SDK accessor and what scopes name. Give one of them its own `slug`."
            });
        } else if (!sameSlug) {
            slugs.set(entry.slug, entry);
        }
        const qualified = `${entry.schema}.${entry.table}`;
        const sameTable = tables.get(qualified);
        if (sameTable && sameTable !== sameName && sameTable !== sameSlug) {
            problems.push({
                table: entry.name,
                message:
                    `it resolves to the SQL table \`${qualified}\`, which "${sameTable.name}" resolves to too. A table has ` +
                    "one owner. Give one of them another `table` or `schema`."
            });
        } else if (!sameTable) {
            tables.set(qualified, entry);
        }
        if (entry.kind === "table" && isAuthTableDef(entry.def)) {
            if (authTable) {
                problems.push({
                    table: entry.name,
                    message:
                        `is a second \`defineAuthTable\` — "${authTable.name}" is already the table users are stored in. ` +
                        "A project has one user store; make this one a `defineTable`."
                });
            } else {
                authTable = entry;
            }
        }
    }
    return problems;
}

function claimJunction(
    junctions: Map<string, JunctionClaim>,
    through: string,
    source: PreparedDef,
    relationName: string,
    sourceKey: string,
    targetKey: string,
    target: PreparedDef,
    refuse: (message: string, key?: string) => void
): void {
    const keys = JSON.stringify([[sourceKey, source.table], [targetKey, target.table]].sort());
    const owner = `the relation "${relationName}" of "${source.name}" ("${sourceKey}" → ${source.table}, "${targetKey}" → ${target.table})`;
    const first = junctions.get(through);
    if (!first) {
        junctions.set(through, { keys, owner, table: source.table });
        return;
    }
    if (first.keys === keys) return;
    refuse(
        `two many-to-many relations resolve to the junction table "${through}" with different key columns: ` +
        `${first.owner} and ${owner}. Only one table is created, so one of them would read and write columns ` +
        `that do not exist. Give this one its own junction — \`through: "${source.table}_${relationName}"\` — or, if ` +
        "both are meant to be one link, declare it once.",
        relationName
    );
}

/**
 * Identifiers that are distinct as written and one name once Postgres keeps
 * their first 63 bytes: tables, views, junction tables and enum types share a
 * namespace per schema (every table owns a row type of its name), and the
 * columns of one table share another. Also: one enum type name given two
 * different lists of values.
 */
function checkStoredIdentifiers(descriptors: readonly TableDescriptor[], prepared: readonly PreparedDef[]): SchemaDefinitionProblem[] {
    const problems: SchemaDefinitionProblem[] = [];
    interface Claim { full: string; what: string; table: string; values?: readonly string[] }
    const relationsClaims = new Map<string, Claim>();
    const claim = (schema: string, full: string, what: string, table: string, values?: readonly string[], key?: string): void => {
        const stored = `${schema}.${toPostgresIdentifier(full)}`;
        const first = relationsClaims.get(stored);
        if (!first) {
            relationsClaims.set(stored, { full, what, table, values });
            return;
        }
        if (first.full === full) {
            const bothEnums = first.values !== undefined && values !== undefined;
            if (bothEnums && first.values && values && (first.values.length !== values.length || first.values.some((v, i) => v !== values[i]))) {
                problems.push({
                    table,
                    key,
                    message:
                        `the enum type "${schema}"."${full}" is given the values (${values.join(", ")}) here and ` +
                        `(${first.values.join(", ")}) by ${first.what}. Columns sharing a named enum type must list the ` +
                        "same values, in the same order. Make them agree, or give one column its own type `name`."
                });
            }
            // A junction both sides declare, an enum type two columns share,
            // and a duplicate table (refused on its own) are one name on purpose.
            if (bothEnums || first.values === undefined && values === undefined) return;
        }
        problems.push({
            table,
            key,
            message:
                `${what} and ${first.what} both become "${schema}"."${toPostgresIdentifier(full)}" in Postgres, which keeps ` +
                "only the first 63 bytes of an identifier — and tables, views, junction tables and enum types share " +
                "one namespace. The push would fail with \"already exists\". Give one of them a shorter name (a " +
                "`table`, a `.column()`, or an enum `name`)."
        });
    };
    descriptors.forEach((descriptor, index) => {
        const entry = prepared[index];
        claim(descriptor.schema, descriptor.table, `${descriptor.kind} "${descriptor.table}"`, entry.name);
    });
    descriptors.forEach((descriptor, index) => {
        const entry = prepared[index];
        for (const relation of descriptor.relations) {
            if (relation.kind !== "manyToMany") continue;
            claim(JUNCTION_TABLE_SCHEMA, relation.through.table, `junction table "${relation.through.table}"`, entry.name, undefined, relation.name);
        }
    });
    descriptors.forEach((descriptor, index) => {
        const entry = prepared[index];
        if (descriptor.kind !== "table") return;
        const enumOf = (column: ColumnDescriptor, table: string, schema: string, key: string): void => {
            const type = column.type.kind === "array" ? column.type.of : column.type;
            if (type.kind !== "enum") return;
            // A column referencing an enum key uses the key table's type.
            if (column.derived) return;
            const name = deriveEnumTypeName(type, table, column.column);
            claim(schema, name, `the enum type of "${entry.name}.${key}"`, entry.name, type.values, key);
        };
        for (const column of descriptor.columns) enumOf(column, descriptor.table, descriptor.schema, column.key);
        for (const relation of descriptor.relations) {
            if (relation.kind !== "manyToMany") continue;
            for (const column of relation.through.pivot) enumOf(column, relation.through.table, JUNCTION_TABLE_SCHEMA, `${relation.name}.pivot.${column.key}`);
        }
    });
    descriptors.forEach((descriptor, index) => {
        const entry = prepared[index];
        const seen = new Map<string, ColumnDescriptor>();
        for (const column of descriptor.columns) {
            const stored = toPostgresIdentifier(column.column);
            const first = seen.get(stored);
            if (!first) {
                seen.set(stored, column);
                continue;
            }
            problems.push({
                table: entry.name,
                key: column.key,
                message: first.column === column.column
                    ? `"${column.key}" and "${first.key}" both resolve to the SQL column "${column.column}" (a column is its ` +
                      "`.column()`, or its key in snake_case), so the table would declare it twice. Rename one, or give " +
                      "it its own `.column(\"…\")`."
                    : `"${column.key}" and "${first.key}" resolve to the columns "${column.column}" and "${first.column}", ` +
                      `which are one name — "${stored}" — once Postgres keeps the first 63 bytes. Give one a shorter \`.column()\`.`
            });
        }
    });
    return problems;
}
