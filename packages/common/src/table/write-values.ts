import type { ColumnDescriptor, ColumnStamp, JsonShape, TableDescriptor } from "@rebasepro/types";

/**
 * What the server writes into a row on its own: stamps and defaults.
 *
 * @module
 */

/**
 * The stamp a column carries, or `undefined`.
 *
 * Replaces the `autoValue` reads: `on_create` is `{ on: "create", value: "now" }`,
 * `on_update` is `{ on: "update", value: "now" }`, `user_on_create` and
 * `user_on_update` the same with `value: "user"`.
 *
 * @group Table
 */
export function stampOf(column: ColumnDescriptor): ColumnStamp | undefined {
    return column.stamp;
}

/**
 * The keys of the top-level columns stamped once, when the row is created
 * (`.onCreateNow()`, `.onCreateUser()`).
 *
 * What they hold is a fact about the row's creation, so an update — and the
 * conflict-update of an upsert that met a stored row — leaves them alone.
 * Replaces `createStampKeys(properties)` (PersistService), which read
 * `autoValue: "on_create" | "user_on_create"`. Top level only: a stamp inside a
 * JSON document is part of that document's value (see `walkJsonShape`).
 *
 * @group Table
 */
export function createStampKeys(table: TableDescriptor): string[] {
    return table.columns.filter(column => column.stamp?.on === "create").map(column => column.key);
}

/**
 * The keys of the top-level columns stamped on every write
 * (`.onUpdateNow()`, `.onUpdateUser()`).
 *
 * Replaces the `autoValue: "on_update" | "user_on_update"` reads of
 * `updateDateAutoValues` / `updateUserAutoValues`.
 *
 * @group Table
 */
export function updateStampKeys(table: TableDescriptor): string[] {
    return table.columns.filter(column => column.stamp?.on === "update").map(column => column.key);
}

/**
 * The value the driver writes into a column a create leaves out, or
 * `undefined` when it writes none.
 *
 * Only a literal `.default(value)` is applied by the driver — so every writer
 * (REST, in-process, batch) produces the same row as the DDL default would.
 * A `random-uuid`, `identity`, `sql` or `database` default is the database's
 * to fill; the driver leaves the column out of the INSERT. Returned wrapped,
 * so a literal default of `null` is told apart from none.
 *
 * Replaces the column half of `applyDefaultValuesOnCreate` (common's
 * `util/entities`), which read `defaultValue`. Its other half — dropping a
 * `null` sent for a `databaseDefault` column so the database fills it — is
 * {@link databaseOwnsDefault}.
 *
 * @group Table
 */
export function defaultOnCreate(column: ColumnDescriptor): { value: unknown } | undefined {
    return column.default?.kind === "literal" ? { value: column.default.value } : undefined;
}

/**
 * Whether the database owns this column's default without Rebase stating it
 * (`.dbDefault()`): a create that sends `null` for it means "nothing given",
 * so the column is left out of the INSERT for the database to fill rather
 * than stored as NULL.
 *
 * Replaces the `databaseDefault` read of `applyDefaultValuesOnCreate`.
 *
 * @group Table
 */
export function databaseOwnsDefault(column: ColumnDescriptor): boolean {
    return column.default?.kind === "database";
}

/**
 * The modifier that declares a stamp, as an author writes it — for messages:
 * `.onCreateNow()`, `.onUpdateNow()`, `.onCreateUser()`, `.onUpdateUser()`.
 *
 * @group Table
 *
 * @internal Shared with @rebasepro/server-postgres's driver; not part of the public API.
 */
export function stampModifier(stamp: ColumnStamp): string {
    const on = stamp.on === "create" ? "Create" : "Update";
    return stamp.value === "now" ? `.on${on}Now()` : `.on${on}User()`;
}

/**
 * Fill in the defaults a create left unset, and drop what the database fills.
 *
 * Per column, in physical order:
 * - a `.dbDefault()` column sent as `null` is taken out of the create, so the
 *   INSERT leaves it to the database's own DEFAULT (an absent key stays absent);
 * - a literal `.default(value)` fills a key the caller did not send. An
 *   explicit `null` is a value ("no value"), never replaced;
 * - a JSON object column without a default of its own whose fields declare
 *   `.default()`s (at any depth) is filled from them: absent, it gets the
 *   whole default document; sent as an object, the default document is merged
 *   under it one level deep, so `{ notify: false }` keeps `notify` and still
 *   gains the siblings it did not mention. In that default document a field
 *   with no default of its own holds its kind's empty value (`null`; `false`
 *   for a boolean; `[]` for an array; an object's own fields recursively).
 *
 * Exactly what `applyDefaultValuesOnCreate` (common's `util/entities`) did with
 * `defaultValue`, `databaseDefault` and map defaults, read off the descriptor.
 * A `sql`, `random-uuid` or `identity` default is the database's: nothing is
 * written for it. Returns a new object; `values` is not changed.
 *
 * @group Table
 */
export function applyCreateDefaults(
    table: TableDescriptor,
    values: Record<string, unknown> | undefined
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...(values ?? {}) };
    for (const column of table.columns) {
        const key = column.key;
        if (databaseOwnsDefault(column)) {
            if (result[key] === null) delete result[key];
            continue;
        }
        const own = defaultOnCreate(column)
            ?? (column.json?.default !== undefined ? { value: column.json.default } : undefined);
        if (own) {
            if (result[key] === undefined) result[key] = cloneDefault(own.value);
            continue;
        }
        const shape = column.json;
        if (!shape || shape.kind !== "object" || !fieldsDeclareDefault(shape)) continue;
        const document = objectDefault(shape);
        if (result[key] === undefined) {
            if (document !== undefined) result[key] = document;
        } else if (isPlainObject(result[key])) {
            result[key] = { ...(document ?? {}), ...result[key] };
        }
    }
    return result;
}

/** How a write stamps: whether it creates the row, the instant, the caller. */
export interface StampContext {
    /** A create (or a copy): create stamps apply too. An update takes update stamps only. */
    creating: boolean;
    /** The value an `.onCreateNow()` / `.onUpdateNow()` position receives. */
    now: unknown;
    /** The acting user's id; `undefined` for an anonymous or in-process write, stamped as `null`. */
    uid: string | undefined;
}

/**
 * Write the stamps a write takes into its values: the time and the acting
 * user, on columns and on fields inside JSON documents.
 *
 * - A column with `.onUpdateNow()` / `.onUpdateUser()` is stamped on every
 *   write; one with `.onCreateNow()` / `.onCreateUser()` on a create only (an
 *   update leaves the value the write carries; dropping a create stamp from an
 *   update is the caller's — see {@link createStampKeys}). The stamp replaces
 *   whatever the write sent. A user stamp with nobody acting is an explicit
 *   `null`, so an anonymous edit is not recorded as the previous editor's.
 * - Inside a JSON document (`json.date().onUpdateNow()`,
 *   `json.string().onCreateUser()`, …) the same rule applies at every depth:
 *   object fields, each item of an array, the value of a `oneOf` item whose
 *   type names the variant. Objects missing on the way to a stamp are created;
 *   a `null` or non-object value is left as it is. A document the write does
 *   not carry is created only on a create: an update that does not send it
 *   leaves the stored document alone.
 *
 * The column half is what `updateDateAutoValues` / `updateUserAutoValues`
 * (common's `util/entities`) did with `autoValue`; nested user stamps had no
 * runtime effect before. Returns a new object.
 *
 * @group Table
 */
export function applyStamps(
    table: TableDescriptor,
    values: Record<string, unknown>,
    context: StampContext
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...values };
    for (const column of table.columns) {
        const stamp = column.stamp;
        if (stamp && (context.creating || stamp.on === "update")) {
            result[column.key] = stamp.value === "now" ? context.now : context.uid ?? null;
            continue;
        }
        if (!column.json) continue;
        const current = result[column.key];
        if (current === undefined && !context.creating) continue;
        const stamped = stampNode(column.json, current, context);
        if (stamped) result[column.key] = stamped.value;
    }
    return result;
}

/**
 * The key of the first column a write by nobody cannot fill: a `.notNull()`
 * column stamped with the acting user that this write stamps (on a create,
 * `.onCreateUser()` and `.onUpdateUser()`; on an update, `.onUpdateUser()`
 * only — the creator is already recorded). `undefined` when there is none.
 *
 * Declaring the column not null means "a row must record who wrote it", so a
 * write with no caller is refused with this key named, before any statement,
 * rather than failing on the NOT NULL. Replaces the `validation.required` +
 * `autoValue: "user_on_*"` read.
 *
 * @group Table
 */
export function anonymousWriteRefusedBy(table: TableDescriptor, creating: boolean): string | undefined {
    return table.columns.find(column => column.stamp?.value === "user"
        && !column.nullable
        && (creating || column.stamp.on === "update"))?.key;
}

/** One position of a document, stamped; `undefined` when nothing there changes. */
function stampNode(node: JsonShape, value: unknown, context: StampContext): { value: unknown } | undefined {
    switch (node.kind) {
        case "date":
            return node.stamp !== undefined && (context.creating || node.stamp === "update")
                ? { value: context.now }
                : undefined;
        case "string":
            return node.stamp !== undefined && (context.creating || node.stamp === "updateUser")
                ? { value: context.uid ?? null }
                : undefined;
        case "object": {
            if (value !== undefined && !isPlainObject(value)) return undefined;
            const next: Record<string, unknown> = { ...(value ?? {}) };
            let changed = false;
            for (const [field, child] of Object.entries(node.fields)) {
                const stamped = stampNode(child, next[field], context);
                if (!stamped) continue;
                next[field] = stamped.value;
                changed = true;
            }
            return changed ? { value: next } : undefined;
        }
        case "array": {
            if (!Array.isArray(value)) return undefined;
            let changed = false;
            const items = value.map(item => {
                if (item === undefined || item === null) return item;
                const stamped = stampNode(node.of, item, context);
                if (!stamped) return item;
                changed = true;
                return stamped.value;
            });
            return changed ? { value: items } : undefined;
        }
        case "oneOf": {
            if (!isPlainObject(value)) return undefined;
            const type = value[node.typeField];
            if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(node.variants, type)) return undefined;
            const stamped = stampNode(node.variants[type], value[node.valueField], context);
            return stamped ? { value: { ...value, [node.valueField]: stamped.value } } : undefined;
        }
        default:
            return undefined;
    }
}

/** Does any field of this object, at any depth through objects, declare a default? */
function fieldsDeclareDefault(node: Extract<JsonShape, { kind: "object" }>): boolean {
    return Object.values(node.fields).some(child =>
        child.default !== undefined || (child.kind === "object" && fieldsDeclareDefault(child)));
}

/** The default document of an object node: each field's default, `undefined` when it has no field. */
function objectDefault(node: Extract<JsonShape, { kind: "object" }>): Record<string, unknown> | undefined {
    const document: Record<string, unknown> = {};
    for (const [field, child] of Object.entries(node.fields)) {
        const value = nodeDefault(child);
        if (value !== undefined) document[field] = value;
    }
    return Object.keys(document).length > 0 ? document : undefined;
}

/** A field's value in its parent's default document. */
function nodeDefault(node: JsonShape): unknown {
    if (node.default !== undefined) return cloneDefault(node.default);
    switch (node.kind) {
        case "boolean":
            return false;
        case "array":
            return [];
        case "object":
            return Object.keys(node.fields).length > 0 ? objectDefault(node) : {};
        default:
            return null;
    }
}

/** A default as a value of its own: the descriptor's copy is shared by every write. */
function cloneDefault(value: unknown): unknown {
    return typeof value === "object" && value !== null ? structuredClone(value) : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
