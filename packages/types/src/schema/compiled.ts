import type { AnyTableDef, AnyViewDef, AuthTableOptions } from "./table";
import type { ColumnTransform, TableHooks } from "./hooks";
import type { TableDescriptor } from "./descriptor";

/**
 * Where a field-level hook sits inside one column, and what runs there.
 *
 * A tree that mirrors the column's value: the node for a column holds the
 * column's own `.transform()`, and its branches lead to the nested positions
 * that declare one — a field of a `json.object`, the items of an array (a
 * native array column's element, or a `json.array`), the value of one variant
 * of a `json.oneOf`. Only branches that lead to a hook are present, so a row
 * pipeline walks the value and the node side by side and stops as soon as the
 * node has nothing below — it never re-reads the definition, and it costs
 * nothing on a column without hooks (which has no node at all).
 *
 * Server only: hooks are code, and never reach the wire. The descriptor says
 * which exist (`ColumnDescriptor.transforms`); this says what they do.
 *
 * @group Schema
 */
export interface TransformNode {
    /** The hook declared on the value at this position. */
    transform?: ColumnTransform;
    /** The fields of a `json.object` that lead to a hook, by field key. */
    fields?: Record<string, TransformNode>;
    /** Each item of an array — a native array column's element, or a `json.array`. */
    items?: TransformNode;
    /**
     * The variants of a `json.oneOf` that lead to a hook, by variant name. The
     * node is for the variant's value: what sits under the block's
     * `valueField` when its `typeField` names that variant.
     */
    variants?: Record<string, TransformNode>;
}

/**
 * One step from a column's value to a nested position: a field of a
 * `json.object`, every item of an array (a native array's element or a
 * `json.array`), or the value of one variant of a `json.oneOf`.
 *
 * - `{ field }` — a key of an object;
 * - `{ items: true }` — every item of an array;
 * - `{ variant }` — the value of a `oneOf` block of that variant (what sits
 *   under its `valueField` when its `typeField` names the variant).
 *
 * @group Schema
 */
export type JsonPathStep =
    | { field: string }
    | { items: true }
    | { variant: string };

/**
 * One field-level hook with its full address: the column key and the path
 * inside the column's value (`[]` for the column itself). The flat view of a
 * table's {@link TransformNode} trees, for a reader that wants a list — a
 * report, a check, a test — rather than a walk.
 *
 * @group Schema
 */
export interface CompiledTransform {
    /** The key of the column. */
    column: string;
    /** From the column's value to the position the hook is declared on. */
    path: JsonPathStep[];
    /** The hook. */
    transform: ColumnTransform;
}

/**
 * The server-only half of `defineAuthTable`'s `auth` options: its
 * user-lifecycle hooks. Roles, scopes and `personalKeys` are data, and live on
 * the descriptor (`TableDescriptor.auth`).
 *
 * @group Schema
 */
export interface CompiledAuthHooks {
    /** Runs when an admin creates a user. */
    onCreateUser?: NonNullable<AuthTableOptions["onCreateUser"]>;
    /** Runs when an admin resets a user's password. */
    onResetPassword?: NonNullable<AuthTableOptions["onResetPassword"]>;
}

/**
 * A table (or view) compiled for the backend: what the server runs on.
 *
 * The {@link TableDescriptor} is the wire-safe half — plain JSON, the only
 * thing a client ever sees, and every fact about columns, relations and table
 * options. Beside it, the server-only half the descriptor cannot carry: the
 * table's hooks, its columns' field-level hooks, the auth table's lifecycle
 * hooks, and the definition it was compiled from (for the planner, which reads
 * relation thunks and index predicates).
 *
 * Produced by `compileSchema` (`@rebasepro/common`) and handed by server boot
 * to the data driver, which wraps each in its own runtime record. Nothing here
 * is ever serialized: serve `descriptor`, never the compiled table.
 *
 * @group Schema
 */
export interface CompiledTable {
    /** The table as the backend and the wire know it. */
    descriptor: TableDescriptor;
    /** The definition it was compiled from: `defineTable`, `defineAuthTable` or `defineView`. */
    def: AnyTableDef | AnyViewDef;
    /** The table's own lifecycle hooks, when it declares any. A view declares read hooks only. */
    hooks?: TableHooks;
    /**
     * The field-level hooks, by column key: one {@link TransformNode} tree per
     * column that declares a hook on itself or anywhere inside its value.
     * Absent when no column does.
     */
    transforms?: Record<string, TransformNode>;
    /** `defineAuthTable`'s `onCreateUser` / `onResetPassword`, when declared. */
    auth?: CompiledAuthHooks;
}
