/**
 * How the Postgres driver runs a table's hooks: the global ones, the table's
 * own (`defineTable({ hooks })`, or `setTableHooks`), and its columns'
 * field-level `.transform()`s — native `TableHooks`, read off the compiled
 * table the registry holds, with their real props (`table` is the descriptor).
 *
 * The order, everywhere: **global, then the table's, then its columns'**. A
 * column transform has only `beforeSave` and `afterRead`, so the other five
 * hooks run global then table.
 *
 * `afterRead` masks what a caller must not see, so every path a row leaves
 * the server by runs it exactly once, through {@link afterReadOnRows}: the
 * driver's fetches, the REST/SDK fetch service, the realtime initial fetch and
 * refetches, a write's own response. That one function also masks a row's
 * embedded relations one level deep with the TARGET table's hooks, so
 * `post.author.email` is the authors table's to mask, never served raw.
 *
 * @module
 */
import {
    RebaseApiError,
    isColumnBuilder,
    type ColumnDef,
    type ColumnTransform,
    type EntityStatus,
    type JsonShape,
    type RebaseCallContext,
    type TableDescriptor,
    type TableHooks,
    type TableRow,
    type TransformNode
} from "@rebasepro/types";
import type { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { RuntimeTable } from "../model/runtime-table";

/**
 * The hooks that apply to one table, resolved once per operation.
 *
 * `table` is `undefined` when the path names no table this driver serves;
 * then only global hooks can be present, and running one is refused (see
 * {@link requireHookTable}) — a hook with no table to be told about cannot run,
 * and one that does not run on a masked read is a leak.
 */
export interface TableHookSet {
    /** The table the hooks run for. */
    readonly table: RuntimeTable | undefined;
    /** The global hooks, which run for every table (`initializeRebaseBackend({ hooks })`, `openRebase({ hooks })`). */
    readonly global: TableHooks | undefined;
    /** The table's own hooks. */
    readonly own: TableHooks | undefined;
    /** The table's field-level hooks, one tree per column key. */
    readonly transforms: Record<string, TransformNode> | undefined;
}

/** A hook set with nothing in it. */
export const NO_HOOKS: TableHookSet = { table: undefined, global: undefined, own: undefined, transforms: undefined };

/**
 * The hooks for the table a path addresses.
 *
 * The path is resolved through the registry (a slug, or a nested path such as
 * `posts/1/comments`, which addresses `comments`); `slug`, when given, is the
 * table the caller already holds, used when the path does not resolve.
 */
export function resolveTableHooks(
    registry: PostgresTableRegistry | undefined,
    path: string,
    slug?: string
): TableHookSet {
    if (!registry) return NO_HOOKS;
    const atPath = path ? registry.getCollectionByPath(path) : undefined;
    const tableSlug = atPath?.slug ?? slug;
    const table = tableSlug ? registry.requireTable(tableSlug) : undefined;
    return hookSetOf(registry, table);
}

/** The hooks of a runtime table already in hand (a relation's target). */
export function hookSetOf(registry: PostgresTableRegistry | undefined, table: RuntimeTable | undefined): TableHookSet {
    return {
        table,
        global: registry?.globalHooks(),
        own: table?.compiled.hooks,
        transforms: table?.compiled.transforms
    };
}

/** Whether a transform tree declares `hook` anywhere. */
function treeDeclares(node: TransformNode, hook: keyof ColumnTransform): boolean {
    if (node.transform?.[hook]) return true;
    if (node.items && treeDeclares(node.items, hook)) return true;
    if (node.fields && Object.values(node.fields).some(child => treeDeclares(child, hook))) return true;
    if (node.variants && Object.values(node.variants).some(child => treeDeclares(child, hook))) return true;
    return false;
}

/** Whether any column of the set declares the field-level `hook`. */
export function transformsDeclare(set: TableHookSet, hook: keyof ColumnTransform): boolean {
    return set.transforms !== undefined && Object.values(set.transforms).some(node => treeDeclares(node, hook));
}

/** Whether `afterRead` runs for this table, on any tier. */
export function hasAfterRead(set: TableHookSet): boolean {
    return Boolean(set.global?.afterRead || set.own?.afterRead || transformsDeclare(set, "afterRead"));
}

/** Whether `beforeSave` runs for this table, on any tier. */
export function hasBeforeSave(set: TableHookSet): boolean {
    return Boolean(set.global?.beforeSave || set.own?.beforeSave || transformsDeclare(set, "beforeSave"));
}

/** Whether `beforeQuery` runs for this table (global or the table's: a column has none). */
export function hasBeforeQueryHook(set: TableHookSet): boolean {
    return Boolean(set.global?.beforeQuery || set.own?.beforeQuery);
}

/** Whether a hook of this name runs for this table, global or the table's. */
export function hasRowHook(set: TableHookSet, hook: keyof TableHooks): boolean {
    return Boolean(set.global?.[hook] || set.own?.[hook]);
}

/** Whether any application code at all runs for this table: a hook on any tier, or a transform. */
export function declaresAnyHook(set: TableHookSet): boolean {
    const declares = (hooks: TableHooks | undefined): boolean =>
        hooks !== undefined && Object.values(hooks).some(value => typeof value === "function");
    return declares(set.global) || declares(set.own)
        || transformsDeclare(set, "beforeSave") || transformsDeclare(set, "afterRead");
}

/**
 * The descriptor every hook of the set is told about. Throws a 404 naming the
 * path when there is no table — only a global hook can bring a call here
 * without one, and it cannot be run for a table that is not there.
 */
export function requireHookTable(set: TableHookSet, path: string): TableDescriptor {
    if (set.table) return set.table.descriptor;
    throw new RebaseApiError(`Table not found: ${path}`, {
        status: 404,
        code: "NOT_FOUND",
        details: { path }
    });
}

// ── Column transforms ──────────────────────────────────────────────────────

/** Calls one position's transform with its value; `undefined` keeps the value. */
type TransformRunner = (transform: ColumnTransform, value: unknown, previousValue: unknown) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * The shape a column's value has, as its definition declares it: the JSON
 * shape of a `jsonb` column, or an array of its element for a native array
 * column. Read from the definition, which — unlike the descriptor — carries a
 * native array element's own JSON shape.
 */
function columnShape(table: RuntimeTable, key: string): JsonShape | undefined {
    const builder: unknown = table.compiled.def.config.columns[key];
    const def: ColumnDef | undefined = isColumnBuilder(builder) ? builder.def : undefined;
    if (def?.element) return { kind: "array", of: def.element.json ?? { kind: "unknown" } };
    return def?.json ?? table.columnsByKey.get(key)?.json;
}

/**
 * Walk one value beside its transform tree: the fields of a `json.object`,
 * each item of an array, the value of the `json.oneOf` variant the value
 * names — at any depth — then the position's own transform. Children first,
 * so a transform on an object sees its fields already transformed. A key the
 * value does not carry is left absent; a transform that returns `undefined`
 * keeps the value.
 */
async function walkTransforms(
    value: unknown,
    previous: unknown,
    node: TransformNode,
    shape: JsonShape | undefined,
    run: TransformRunner
): Promise<unknown> {
    let current = value;
    if (node.fields && isRecord(current)) {
        const fieldShapes = shape?.kind === "object" ? shape.fields : undefined;
        const previousFields = isRecord(previous) ? previous : undefined;
        const out: Record<string, unknown> = { ...current };
        for (const [field, child] of Object.entries(node.fields)) {
            if (out[field] === undefined) continue;
            out[field] = await walkTransforms(out[field], previousFields?.[field], child, fieldShapes?.[field], run);
        }
        current = out;
    }
    if (node.items && Array.isArray(current)) {
        const items = node.items;
        const itemShape = shape?.kind === "array" ? shape.of : undefined;
        const previousItems = Array.isArray(previous) ? previous : undefined;
        current = await Promise.all(current.map((item, index) =>
            walkTransforms(item, previousItems?.[index], items, itemShape, run)));
    }
    if (node.variants && isRecord(current) && shape?.kind === "oneOf") {
        const variant = current[shape.typeField];
        const child = typeof variant === "string" ? node.variants[variant] : undefined;
        if (child && typeof variant === "string" && current[shape.valueField] !== undefined) {
            const previousValue = isRecord(previous) && previous[shape.typeField] === variant
                ? previous[shape.valueField]
                : undefined;
            current = {
                ...current,
                [shape.valueField]: await walkTransforms(
                    current[shape.valueField], previousValue, child, shape.variants[variant], run
                )
            };
        }
    }
    if (node.transform) {
        const result = await run(node.transform, current, previous);
        if (result !== undefined) current = result;
    }
    return current;
}

/** Every column's transforms over one row; the keys the row does not carry are left alone. */
async function transformRow(
    table: RuntimeTable,
    transforms: Record<string, TransformNode>,
    row: TableRow,
    previousRow: TableRow | undefined,
    run: TransformRunner
): Promise<TableRow> {
    const out: TableRow = { ...row };
    for (const [key, node] of Object.entries(transforms)) {
        if (out[key] === undefined) continue;
        out[key] = await walkTransforms(out[key], previousRow?.[key], node, columnShape(table, key), run);
    }
    return out;
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * `afterRead` on one row of the set's table: global, then the table's, then
 * its columns' transforms. Each tier sees the row the previous one returned;
 * a tier that returns nothing leaves it as it was.
 */
export async function afterReadOnRow(
    set: TableHookSet,
    row: TableRow,
    path: string,
    context: RebaseCallContext
): Promise<TableRow> {
    if (!hasAfterRead(set)) return row;
    const table = requireHookTable(set, path);
    let out = row;
    if (set.global?.afterRead) {
        out = await set.global.afterRead({ table, path, context, values: out }) ?? out;
    }
    if (set.own?.afterRead) {
        out = await set.own.afterRead({ table, path, context, values: out }) ?? out;
    }
    if (set.table && set.transforms && transformsDeclare(set, "afterRead")) {
        const values = out;
        out = await transformRow(set.table, set.transforms, out, undefined, (transform, value) =>
            transform.afterRead?.({ table, path, context, value, values }));
    }
    return out;
}

/**
 * The tables a row's embedded relations are masked with: by relation name,
 * the target's hooks — kept only when the target runs an `afterRead`.
 */
function embeddedTargets(registry: PostgresTableRegistry | undefined, set: TableHookSet): Map<string, TableHookSet> {
    const targets = new Map<string, TableHookSet>();
    if (!registry || !set.table) return targets;
    for (const relation of set.table.relations.values()) {
        // `getTable`: a relation whose target another data source serves is
        // not this driver's to load, nor to mask.
        const target = hookSetOf(registry, registry.getTable(relation.target));
        if (target.table && hasAfterRead(target)) targets.set(relation.name, target);
    }
    return targets;
}

/**
 * Whether {@link afterReadOnRows} would run anything for rows of this table:
 * its own `afterRead` on any tier, or an embedded relation's target's.
 */
export function afterReadApplies(registry: PostgresTableRegistry | undefined, set: TableHookSet): boolean {
    return hasAfterRead(set) || embeddedTargets(registry, set).size > 0;
}

/**
 * `afterRead` on rows leaving the server — THE read chain, for every path.
 *
 * Runs {@link afterReadOnRow} on each row, then masks each embedded relation
 * (an `include`d row or list, a `{ __type: "relation", data }` payload) one
 * level deep with the target table's `afterRead`. `context` is asked for only
 * when a hook will run, so a table without hooks costs a map lookup.
 *
 * `onHookRun` is called once, before the first hook runs: the driver notes
 * application code on the write scope there.
 */
export async function afterReadOnRows(
    registry: PostgresTableRegistry | undefined,
    set: TableHookSet,
    rows: TableRow[],
    path: string,
    context: () => RebaseCallContext,
    onHookRun?: () => void
): Promise<TableRow[]> {
    if (!rows || rows.length === 0) return rows;
    const own = hasAfterRead(set);
    const targets = embeddedTargets(registry, set);
    if (!own && targets.size === 0) return rows;
    onHookRun?.();
    const ctx = context();

    const maskEmbedded = async (value: unknown, target: TableHookSet): Promise<unknown> => {
        if (Array.isArray(value)) return Promise.all(value.map(item => maskEmbedded(item, target)));
        if (!isRecord(value)) return value;
        const targetPath = target.table?.slug ?? path;
        // A relation ref (the admin's rendering, and every realtime frame's)
        // nests the row under `.data` — as `{ id, path, values }`, so the
        // row the target's hooks mask is `data.values`. Handed the envelope,
        // a hook masking `email` masked a key the envelope does not have,
        // and `data.values.email` went out as stored.
        if (value.__type === "relation") {
            const data = value.data;
            if (!isRecord(data)) return value;
            if (isRecord(data.values)) {
                return { ...value, data: { ...data, values: await afterReadOnRow(target, data.values, targetPath, ctx) } };
            }
            return { ...value, data: await afterReadOnRow(target, data, targetPath, ctx) };
        }
        // A bare reference carries no row to mask.
        if (value.__type === "reference") return value;
        return afterReadOnRow(target, value, targetPath, ctx);
    };

    return Promise.all(rows.map(async row => {
        let out = own ? await afterReadOnRow(set, row, path, ctx) : row;
        for (const [name, target] of targets) {
            if (out[name] === undefined || out[name] === null) continue;
            out = { ...out, [name]: await maskEmbedded(out[name], target) };
        }
        return out;
    }));
}

// ── Write ──────────────────────────────────────────────────────────────────

/** What a write's hooks are told about it. */
export interface WriteHookCall {
    path: string;
    id: string | number | undefined;
    previousValues: TableRow | undefined;
    status: EntityStatus;
    context: RebaseCallContext;
}

/**
 * `beforeSave`: global, then the table's, then its columns' transforms. A
 * tier's returned object is shallow-merged over the values; a tier that
 * returns nothing changes nothing. A throw propagates (the driver answers it
 * as `CALLBACK_REJECTED`).
 */
export async function beforeSave<V extends TableRow>(set: TableHookSet, values: V, call: WriteHookCall): Promise<V> {
    if (!hasBeforeSave(set)) return values;
    const table = requireHookTable(set, call.path);
    const { path, id, previousValues, status, context } = call;
    const common = {
        table, path, context, status,
        ...(id !== undefined ? { id } : {}),
        ...(previousValues !== undefined ? { previousValues } : {})
    };
    let out: V = values;
    for (const hooks of [set.global, set.own]) {
        if (!hooks?.beforeSave) continue;
        const result: TableRow | undefined = await hooks.beforeSave({ ...common, values: out });
        if (result) out = { ...out, ...result };
    }
    if (set.table && set.transforms && transformsDeclare(set, "beforeSave")) {
        const current = out;
        const transformed = await transformRow(set.table, set.transforms, current, previousValues, (transform, value, previousValue) =>
            transform.beforeSave?.({ ...common, value, previousValue, values: current }));
        out = { ...out, ...transformed };
    }
    return out;
}

/** `afterSave`: global, then the table's, each awaited. */
export async function afterSave(set: TableHookSet, savedId: string | number, values: TableRow, call: WriteHookCall): Promise<void> {
    if (!hasRowHook(set, "afterSave")) return;
    const table = requireHookTable(set, call.path);
    const { path, previousValues, status, context } = call;
    for (const hooks of [set.global, set.own]) {
        await hooks?.afterSave?.({
            table, path, context, status, id: savedId, values,
            ...(previousValues !== undefined ? { previousValues } : {})
        });
    }
}

/**
 * `afterSaveError`: global, then the table's — each on its own, guarded: a
 * hook that throws is handed to `onThrow` and the next still runs, so it can
 * never replace the failure the caller is owed.
 */
export async function afterSaveError(
    set: TableHookSet,
    values: TableRow,
    error: unknown,
    call: WriteHookCall,
    onThrow: (tier: "global" | "table", hookError: unknown) => void
): Promise<void> {
    if (!hasRowHook(set, "afterSaveError")) return;
    const table = requireHookTable(set, call.path);
    const { path, id, previousValues, status, context } = call;
    const props = {
        table, path, context, status, values, error,
        ...(id !== undefined ? { id } : {}),
        ...(previousValues !== undefined ? { previousValues } : {})
    };
    for (const [tier, hooks] of [["global", set.global], ["table", set.own]] as const) {
        if (!hooks?.afterSaveError) continue;
        try {
            await hooks.afterSaveError(props);
        } catch (hookError) {
            onThrow(tier, hookError);
        }
    }
}

/** What a delete's hooks are told about it. */
export interface DeleteHookCall {
    path: string;
    id: string | number;
    /** The row being deleted, as stored. */
    values: TableRow;
    context: RebaseCallContext;
}

/**
 * `beforeDelete`: global, then the table's. Every tier runs; `true` back when
 * any returned `false` (a veto). A throw propagates.
 */
export async function beforeDeleteVetoes(set: TableHookSet, call: DeleteHookCall): Promise<boolean> {
    if (!hasRowHook(set, "beforeDelete")) return false;
    const table = requireHookTable(set, call.path);
    let vetoed = false;
    for (const hooks of [set.global, set.own]) {
        if (!hooks?.beforeDelete) continue;
        if (await hooks.beforeDelete({ table, ...call }) === false) vetoed = true;
    }
    return vetoed;
}

/** `afterDelete`: global, then the table's, each awaited. */
export async function afterDelete(set: TableHookSet, call: DeleteHookCall): Promise<void> {
    if (!hasRowHook(set, "afterDelete")) return;
    const table = requireHookTable(set, call.path);
    for (const hooks of [set.global, set.own]) {
        await hooks?.afterDelete?.({ table, ...call });
    }
}
