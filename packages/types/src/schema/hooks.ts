import type { RebaseCallContext } from "../call_context";
import type { GeneratedDatabase } from "../types/register";
import type { User } from "../users";
import type { EntityStatus } from "../types/entities";
import type { QueryNarrowing, ReadOperation, ReadQuery } from "../types/entity_callbacks";
import type { TableDescriptor } from "./descriptor";

/** A row, keyed by column key. */
export type TableRow = Record<string, unknown>;

/**
 * What every table hook receives.
 *
 * @group Schema
 */
export interface TableHookProps<USER extends User = User> {
    /** The table the hook runs for, as the server knows it. */
    table: TableDescriptor;
    /** The path the request addressed: the slug, or a nested path. */
    path: string;
    /**
     * The caller, and `context.data` scoped to them — typed from a registered
     * generated `Database` (`Register.database`). Not from `Register.tables`:
     * a schema's own hooks typed from that same schema is a cycle TypeScript
     * refuses.
     */
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * Props of `hooks.beforeQuery`: runs before every read, and may narrow it.
 *
 * @group Schema
 */
export interface TableBeforeQueryProps<Row extends TableRow = TableRow, USER extends User = User>
    extends TableHookProps<USER> {
    /** Which kind of read is about to run. */
    operation: ReadOperation;
    /** The query as the caller sent it. */
    query: ReadQuery<Row>;
}

/**
 * Props of `hooks.afterRead`: runs on every row leaving the server — REST,
 * realtime and MCP alike — and returns the row to serve.
 *
 * @group Schema
 */
export interface TableAfterReadProps<Row extends TableRow = TableRow, USER extends User = User>
    extends TableHookProps<USER> {
    /** The row as stored, after field-level access has been applied. */
    values: Row;
}

/**
 * Props of `hooks.beforeSave`: runs before a create or an update, and returns
 * the values to write.
 *
 * @group Schema
 */
export interface TableBeforeSaveProps<
    Row extends TableRow = TableRow,
    Insert extends TableRow = Row,
    USER extends User = User
> extends TableHookProps<USER> {
    /** The row's id. Absent on a create whose id the database generates. */
    id?: string | number;
    /** The values being written: all of them on a create, the changed ones on an update. */
    values: Partial<Insert>;
    /** The row as it was, on an update. */
    previousValues?: Partial<Row>;
    /** Whether the row is new, existing, or a copy. */
    status: EntityStatus;
}

/**
 * Props of `hooks.afterSave`: runs after the write committed.
 *
 * @group Schema
 */
export interface TableAfterSaveProps<Row extends TableRow = TableRow, USER extends User = User>
    extends TableHookProps<USER> {
    id: string | number;
    /** The values that were written. */
    values: Partial<Row>;
    /** The row as it was, on an update. */
    previousValues?: Partial<Row>;
    status: EntityStatus;
}

/**
 * Props of `hooks.afterSaveError`: runs when the write failed.
 *
 * @group Schema
 */
export interface TableAfterSaveErrorProps<Row extends TableRow = TableRow, USER extends User = User>
    extends TableHookProps<USER> {
    id?: string | number;
    values: Partial<Row>;
    previousValues?: Partial<Row>;
    status: EntityStatus;
    /** What the write failed with. */
    error: unknown;
}

/**
 * Props of `hooks.beforeDelete` and `hooks.afterDelete`.
 *
 * @group Schema
 */
export interface TableDeleteProps<Row extends TableRow = TableRow, USER extends User = User>
    extends TableHookProps<USER> {
    id: string | number;
    /** The row being deleted. */
    values: Row;
}

/**
 * The server-side lifecycle hooks of a table.
 *
 * They run in the backend only, for every door into the table. Their code is
 * never serialized: the wire says which hooks exist, not what they do.
 *
 * @group Schema
 */
export interface TableHooks<
    Row extends TableRow = TableRow,
    Insert extends TableRow = Row,
    USER extends User = User
> {
    /** Narrow a read before it runs. Return a filter to AND into the query. */
    beforeQuery?(props: TableBeforeQueryProps<Row, USER>):
        QueryNarrowing<Row> | void | Promise<QueryNarrowing<Row> | void>;
    /** Shape a row on its way out: mask, redact, derive. Return the row to serve. */
    afterRead?(props: TableAfterReadProps<Row, USER>): TableRow | Promise<TableRow>;
    /** Validate or complete a write. Return the values to store; throw to refuse. */
    beforeSave?(props: TableBeforeSaveProps<Row, Insert, USER>): Partial<Insert> | Promise<Partial<Insert>>;
    /** React to a committed write. */
    afterSave?(props: TableAfterSaveProps<Row, USER>): void | Promise<void>;
    /** React to a failed write. */
    afterSaveError?(props: TableAfterSaveErrorProps<Row, USER>): void | Promise<void>;
    /** Runs before a delete. Return `false` or throw to refuse it. */
    beforeDelete?(props: TableDeleteProps<Row, USER>): boolean | void | Promise<boolean | void>;
    /** React to a committed delete. */
    afterDelete?(props: TableDeleteProps<Row, USER>): void | Promise<void>;
}

/**
 * Props of a column's `transform.beforeSave`.
 *
 * @group Schema
 */
export interface ColumnBeforeSaveProps<T = unknown, USER extends User = User> extends TableHookProps<USER> {
    /** The value being written to this column. */
    value: T;
    /** The value the column held, on an update. */
    previousValue: T | undefined;
    /** Every value being written. */
    values: TableRow;
    /** The row as it was, on an update. */
    previousValues?: TableRow;
    id?: string | number;
    status: EntityStatus;
}

/**
 * Props of a column's `transform.afterRead`.
 *
 * @group Schema
 */
export interface ColumnAfterReadProps<T = unknown, USER extends User = User> extends TableHookProps<USER> {
    /** The stored value of this column. */
    value: T;
    /** The row being read. */
    values: TableRow;
}

/**
 * Field-level hooks: `col.text().transform({ beforeSave, afterRead })`.
 *
 * @group Schema
 */
export interface ColumnTransform<T = unknown, USER extends User = User> {
    /** Returns the value to store. */
    beforeSave?(props: ColumnBeforeSaveProps<T, USER>): T | Promise<T>;
    /** Returns the value to serve. */
    afterRead?(props: ColumnAfterReadProps<T, USER>): T | Promise<T>;
}
