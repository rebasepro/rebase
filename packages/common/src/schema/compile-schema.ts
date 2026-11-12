/**
 * From table definitions to what the server runs on: `CompiledTable[]`.
 *
 * `compileTables` produces the wire-safe descriptors; this adds, per table,
 * the server-only parts the descriptor cannot carry — the table's hooks, its
 * columns' field-level hooks (addressed by column key and nested path) and the
 * auth table's lifecycle hooks — collected from the very definitions that were
 * compiled, so the two halves cannot describe different tables.
 *
 * @module
 */
import type {
    AnyTableDef,
    AnyViewDef,
    ColumnDef,
    CompiledAuthHooks,
    CompiledTable,
    CompiledTransform,
    DefaultRls,
    JsonShapeDef,
    TableDescriptor,
    TableHooks,
    TransformNode,
    JsonPathStep
} from "@rebasepro/types";
import { isAuthTableDef, isColumnBuilder } from "@rebasepro/types";

import { compileTables } from "./compile-tables";
import { tableDefsFromDescriptors, type TableDefsFromDescriptorsOptions } from "./descriptor-to-def";

/**
 * Options of {@link compileSchema}.
 *
 * @group Schema
 */
export interface CompileSchemaOptions {
    /**
     * The project's `defaultRls` (exported from `backend/schema/index.ts`):
     * what every `rls: "inherit"` table takes. Without it, `"inherit"` is
     * refused.
     */
    defaultRls?: DefaultRls;
}

/**
 * Compile table and view definitions into the tables the server runs on.
 *
 * The descriptors are exactly `compileTables(defs, options)` — same order,
 * same errors: every problem in every definition is collected into one
 * `SchemaDefinitionError`. Each comes back with the definition it was compiled
 * from and the server-only parts of that definition: `hooks`, the field-level
 * hooks of its columns as {@link TransformNode} trees by column key, and, for
 * a `defineAuthTable`, `onCreateUser` / `onResetPassword`.
 *
 * Pure: nothing is registered, nothing is called.
 *
 * @group Schema
 */
export function compileSchema(
    defs: readonly (AnyTableDef | AnyViewDef)[],
    options: CompileSchemaOptions = {}
): CompiledTable[] {
    const descriptors = compileTables(defs, options.defaultRls !== undefined ? { defaultRls: options.defaultRls } : {});
    // `compileTables` throws unless every definition compiled, and returns them
    // in input order: descriptor i is definition i.
    return descriptors.map((descriptor, index) => compiledTableOf(defs[index], descriptor));
}

/**
 * Tables the server runs on for descriptors nobody authored — what
 * introspection reads from a database no project declared.
 *
 * Each descriptor is kept exactly as given (its row-level security is the
 * catalogue's, its key what the database holds, possibly none); the
 * definition beside it is the one {@link tableDefsFromDescriptors} states for
 * it, so a reader of `def` sees the same table. Such a table declares no hooks.
 *
 * @param options Passed to {@link tableDefsFromDescriptors}: introspection
 *   replaces each `rls` with `"admin-only"`, because Rebase generates no policy
 *   for a table it did not declare.
 *
 * @group Schema
 */
export function compileDescribedTables(
    descriptors: readonly TableDescriptor[],
    options: TableDefsFromDescriptorsOptions = {}
): CompiledTable[] {
    const defs = tableDefsFromDescriptors(descriptors, options);
    return descriptors.map((descriptor, index) => ({ descriptor, def: defs[index] }));
}

/**
 * Every field-level hook of a compiled table, flattened: one entry per hook,
 * with its column key and the path inside the column's value. Columns in the
 * table's physical order; inside a column, the column's own hook first, then
 * its nested ones depth first.
 *
 * @group Schema
 */
export function listTransforms(table: CompiledTable): CompiledTransform[] {
    const out: CompiledTransform[] = [];
    if (!table.transforms) return out;
    const visit = (column: string, node: TransformNode, path: JsonPathStep[]): void => {
        if (node.transform) out.push({ column, path, transform: node.transform });
        for (const [field, child] of Object.entries(node.fields ?? {})) visit(column, child, [...path, { field }]);
        if (node.items) visit(column, node.items, [...path, { items: true }]);
        for (const [variant, child] of Object.entries(node.variants ?? {})) visit(column, child, [...path, { variant }]);
    };
    const transforms = table.transforms;
    for (const column of table.descriptor.columns) {
        const node = transforms[column.key];
        if (node) visit(column.key, node, []);
    }
    return out;
}

// ── One table ────────────────────────────────────────────────────────────────

function compiledTableOf(def: AnyTableDef | AnyViewDef, descriptor: TableDescriptor): CompiledTable {
    const compiled: CompiledTable = { descriptor, def };
    const hooks = hooksOf(def);
    if (hooks) compiled.hooks = hooks;
    const transforms = transformsOf(def);
    if (transforms) compiled.transforms = transforms;
    if (isAuthTableDef(def)) {
        const auth: CompiledAuthHooks = {};
        if (typeof def.auth.onCreateUser === "function") auth.onCreateUser = def.auth.onCreateUser;
        if (typeof def.auth.onResetPassword === "function") auth.onResetPassword = def.auth.onResetPassword;
        if (auth.onCreateUser || auth.onResetPassword) compiled.auth = auth;
    }
    return compiled;
}

/** The table's hooks, or `undefined` when it declares none. A view has read hooks only. */
function hooksOf(def: AnyTableDef | AnyViewDef): TableHooks | undefined {
    const declared: TableHooks | undefined = def.config.hooks;
    if (!declared) return undefined;
    const hooks: TableHooks = { ...declared };
    return Object.values(hooks).some(hook => typeof hook === "function") ? hooks : undefined;
}

/** The transform tree of every column that declares a field-level hook, by column key. */
function transformsOf(def: AnyTableDef | AnyViewDef): Record<string, TransformNode> | undefined {
    const out: Record<string, TransformNode> = {};
    for (const [key, builder] of Object.entries(def.config.columns)) {
        if (!isColumnBuilder(builder)) continue;
        const node = columnNode(builder.def);
        if (node) out[key] = node;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** The node for one column: its own hook, its JSON shape's and its array element's. */
function columnNode(def: ColumnDef): TransformNode | undefined {
    const node: TransformNode = {};
    if (hasHook(def.transform)) node.transform = def.transform;
    if (def.json) {
        const shape = shapeNode(def.json);
        if (shape) Object.assign(node, shape);
    }
    if (def.element) {
        const items = columnNode(def.element);
        if (items) node.items = items;
    }
    return isEmpty(node) ? undefined : node;
}

/** The node for one position of a JSON shape. */
function shapeNode(shape: JsonShapeDef): TransformNode | undefined {
    const node: TransformNode = {};
    if (hasHook(shape.transform)) node.transform = shape.transform;
    switch (shape.kind) {
        case "object": {
            const fields: Record<string, TransformNode> = {};
            for (const [key, field] of Object.entries(shape.fields)) {
                const child = shapeNode(field);
                if (child) fields[key] = child;
            }
            if (Object.keys(fields).length > 0) node.fields = fields;
            break;
        }
        case "array": {
            const items = shapeNode(shape.of);
            if (items) node.items = items;
            break;
        }
        case "oneOf": {
            const variants: Record<string, TransformNode> = {};
            for (const [name, variant] of Object.entries(shape.variants)) {
                const child = shapeNode(variant);
                if (child) variants[name] = child;
            }
            if (Object.keys(variants).length > 0) node.variants = variants;
            break;
        }
        default:
            break;
    }
    return isEmpty(node) ? undefined : node;
}

function hasHook(transform: ColumnDef["transform"]): transform is NonNullable<ColumnDef["transform"]> {
    return transform !== undefined && (typeof transform.beforeSave === "function" || typeof transform.afterRead === "function");
}

function isEmpty(node: TransformNode): boolean {
    return !node.transform && !node.fields && !node.items && !node.variants;
}
