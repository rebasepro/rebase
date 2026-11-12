/**
 * Running `schema introspect`'s generator over a captured schema, evaluating
 * what it wrote, and planning it — so a test can hold the generated project
 * to what the database holds.
 */
import { lowerTables } from "@rebasepro/common";
import { col, defineAuthTable, defineTable, defineView, isColumnBuilder, isTableDef, isViewDef, json, rel } from "@rebasepro/types";
import type { AnyTableDef, AnyViewDef } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

import { generateSchemaModules, type SchemaGeneration } from "../../src/schema/introspect-db-logic";
import { classifyTables } from "../../src/schema/introspect-db-structure";
import { parseCheckConstraints } from "../../src/schema/introspect-db-constraints";
import { loadRealSchema, type RealSchemaName } from "./schema-metadata";
import { renderAllOutputs } from "./plan-corpus";

/** The whole pipeline over a captured schema, as the CLI runs it, for a project with a frontend. */
export function generateRealSchema(name: RealSchemaName, options: { pgSchema?: string; cms?: boolean } = {}): SchemaGeneration {
    const { metadata: captured, tables } = loadRealSchema(name);
    const metadata = options.pgSchema ? { ...captured, schema: options.pgSchema } : captured;
    return generateSchemaModules({
        metadata,
        classifications: classifyTables(metadata, tables),
        checkFacts: parseCheckConstraints(metadata.checks),
        ...(options.cms === false ? {} : { cms: { tableImport: (table: string) => `../../../backend/schema/${table}` } })
    });
}

const BUILDER_NAMES = ["col", "rel", "json", "defineTable", "defineAuthTable", "defineView"];
const BUILDERS: unknown[] = [col, rel, json, defineTable, defineAuthTable, defineView];

/**
 * Evaluate generated `backend/schema/*.ts` modules together, the way they
 * import each other: the imports are dropped and every module runs in one
 * function body with the real builders, so relation thunks resolve across
 * modules. Returns the definitions, in module order.
 */
export function evaluateSchemaModules(modules: readonly string[]): (AnyTableDef | AnyViewDef)[] {
    const identifiers: string[] = [];
    const bodies = modules.map(code => code
        .split("\n")
        .filter(line => !line.startsWith("import "))
        .join("\n")
        .replace(/^export const ([A-Za-z_$][\w$]*) = /gm, (_match, identifier: string) => {
            identifiers.push(identifier);
            return `const ${identifier} = `;
        }));
    const run = new Function(...BUILDER_NAMES, `${bodies.join("\n")}\nreturn [${identifiers.join(", ")}];`);
    const result: unknown = Reflect.apply(run, undefined, BUILDERS);
    if (!Array.isArray(result)) throw new Error("generated modules evaluated to nothing");
    return result.filter((def): def is AnyTableDef | AnyViewDef => isTableDef(def) || isViewDef(def));
}

/** One `col.custom()` column, which the planner cannot plan yet (`custom-sql-type`). */
export interface CustomColumn {
    table: string;
    column: string;
    sqlType: string;
}

/**
 * The definitions without their `col.custom()` columns — which `lowerTables`
 * refuses until the planner has a type to plan them as — and the list of what
 * was taken out, so a comparison states it rather than hides it.
 */
export function withoutCustomColumns(defs: readonly (AnyTableDef | AnyViewDef)[]): { defs: (AnyTableDef | AnyViewDef)[]; removed: CustomColumn[] } {
    const removed: CustomColumn[] = [];
    const out = defs.map(def => {
        const columns: Record<string, unknown> = {};
        for (const [key, builder] of Object.entries(def.config.columns)) {
            if (isColumnBuilder(builder) && builder.def.type.kind === "other") {
                removed.push({ table: def.name, column: builder.def.column ?? toSnakeCase(key), sqlType: builder.def.type.sqlType });
                continue;
            }
            columns[key] = builder;
        }
        // Mutated in place: the relation thunks of the other definitions return these very objects.
        Reflect.set(def.config, "columns", columns);
        return def;
    });
    return { defs: out, removed };
}

/** What a column plan says about the database, without the planner's bookkeeping. */
export interface PlannedColumn {
    type: unknown;
    nullable: unknown;
    primaryKey: unknown;
    unique: unknown;
    default?: unknown;
    generated?: unknown;
    foreignKey?: unknown;
}

/** A plan reduced to what the database holds, by qualified table and SQL column. */
export interface PlannedSchema {
    tables: Map<string, { kind: string; primaryKey: unknown; columns: Map<string, PlannedColumn>; policies: Map<string, unknown>; indexes: string[] }>;
    enums: Map<string, unknown>;
}

const stripVarName = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripVarName);
    if (typeof value !== "object" || value === null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (key === "varName") continue;
        out[key] = stripVarName(item);
    }
    return out;
};

const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `plan.json` (as the goldens record it) reduced to a {@link PlannedSchema}. */
export function plannedSchemaOf(planJson: string): PlannedSchema {
    const plan = record(JSON.parse(planJson));
    const tables: PlannedSchema["tables"] = new Map();
    for (const rawTable of list(plan.tables)) {
        const table = record(rawTable);
        const columns = new Map<string, PlannedColumn>();
        for (const rawColumn of list(table.columns)) {
            const c = record(rawColumn);
            const fk = c.foreignKey === undefined ? undefined : record(c.foreignKey);
            // The explicit-foreign-key form plans a column twice: once from the
            // property (its type, nullability, key, default) and once from the
            // relation carrying only the constraint. The database holds one
            // column: the property's facts and the constraint.
            const previous = columns.get(String(c.column));
            const fromRelation = record(c.source).kind === "relation";
            if (previous && fromRelation) {
                if (fk) previous.foreignKey = { targetTable: fk.targetTable, targetColumn: fk.targetColumn, onDelete: fk.onDelete, constraintName: fk.constraintName };
                continue;
            }
            columns.set(String(c.column), {
                ...(previous?.foreignKey !== undefined ? { foreignKey: previous.foreignKey } : {}),
                type: stripVarName(c.type),
                nullable: c.nullable,
                primaryKey: c.primaryKey,
                unique: c.unique,
                ...(c.default !== undefined ? { default: c.default } : {}),
                ...(c.generated !== undefined ? { generated: c.generated } : {}),
                ...(fk ? { foreignKey: { targetTable: fk.targetTable, targetColumn: fk.targetColumn, onDelete: fk.onDelete, constraintName: fk.constraintName } } : {})
            });
        }
        const policies = new Map<string, unknown>();
        for (const rawPolicy of list(table.policies)) {
            const p = record(rawPolicy);
            policies.set(String(p.name), { operation: p.operation, mode: p.mode, roles: p.roles, using: p.using, withCheck: p.withCheck });
        }
        const indexes = list(table.indexes).map(index => String(record(index).indexName ?? record(index).name)).sort();
        tables.set(String(table.qualified), { kind: String(table.kind), primaryKey: table.primaryKey, columns, policies, indexes });
    }
    const enums = new Map<string, unknown>();
    for (const rawEnum of list(plan.enums)) {
        const e = record(rawEnum);
        enums.set(`${String(e.schema)}.${String(e.name)}`, e.labels);
    }
    return { tables, enums };
}

/** Plan definitions through the pipeline `db generate` runs, reduced. */
export function planDefinitions(defs: readonly (AnyTableDef | AnyViewDef)[]): PlannedSchema {
    const outputs = renderAllOutputs(lowerTables(defs));
    const plan = outputs["plan.json"];
    if (plan.startsWith("THROWS:")) throw new Error(plan);
    return plannedSchemaOf(plan);
}

/** Every way two planned schemas differ, one line each, sorted. */
export function planDifferences(legacy: PlannedSchema, generated: PlannedSchema): string[] {
    const out: string[] = [];
    const show = (value: unknown): string => JSON.stringify(value);
    for (const name of new Set([...legacy.tables.keys(), ...generated.tables.keys()])) {
        const a = legacy.tables.get(name);
        const b = generated.tables.get(name);
        if (!a) { out.push(`${name}: table only in the new generation`); continue; }
        if (!b) { out.push(`${name}: table only in the legacy generation`); continue; }
        if (show(a.primaryKey) !== show(b.primaryKey)) out.push(`${name}: primary key ${show(a.primaryKey)} → ${show(b.primaryKey)}`);
        for (const column of new Set([...a.columns.keys(), ...b.columns.keys()])) {
            const x = a.columns.get(column);
            const y = b.columns.get(column);
            if (!x) { out.push(`${name}.${column}: column only in the new generation`); continue; }
            if (!y) { out.push(`${name}.${column}: column only in the legacy generation`); continue; }
            for (const field of ["type", "nullable", "primaryKey", "unique", "default", "generated", "foreignKey"] as const) {
                if (show(x[field]) !== show(y[field])) out.push(`${name}.${column}: ${field} ${show(x[field])} → ${show(y[field])}`);
            }
        }
        for (const policy of new Set([...a.policies.keys(), ...b.policies.keys()])) {
            const x = a.policies.get(policy);
            const y = b.policies.get(policy);
            if (show(x) !== show(y)) out.push(`${name}: policy ${policy} ${x ? (y ? "differs" : "only in the legacy generation") : "only in the new generation"}`);
        }
        if (show(a.indexes) !== show(b.indexes)) out.push(`${name}: indexes ${show(a.indexes)} → ${show(b.indexes)}`);
    }
    for (const name of new Set([...legacy.enums.keys(), ...generated.enums.keys()])) {
        if (show(legacy.enums.get(name)) !== show(generated.enums.get(name))) {
            out.push(`enum ${name}: ${show(legacy.enums.get(name))} → ${show(generated.enums.get(name))}`);
        }
    }
    return out.sort();
}
