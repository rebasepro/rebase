import type { TableDescriptor, TableIndexKey } from "@rebasepro/types";
import { ApiError } from "../errors";

/**
 * Which columns an upsert may name as its `ON CONFLICT` target.
 *
 * Postgres will only match a conflict against a column set backed by a unique
 * index. Ask it to match on anything else and it answers *there is no unique or
 * exclusion constraint matching the ON CONFLICT specification* — a 42P10 raised
 * from inside a transaction that, in a batch, has already written other rows.
 * The caller sees a 500 naming a constraint they never wrote, after work has
 * been rolled back.
 *
 * So the target is checked against the table's own declarations before the
 * statement is built, and the error says which columns *are* available. The
 * declarations are the source of truth on purpose: a unique index that exists
 * in the database but in no definition is one `db push` away from being dropped,
 * and an upsert that silently depends on it would break at that moment rather
 * than at the moment it was written.
 *
 * @module
 */

/**
 * Normalised so `["a","b"]` and `["b","a"]` are the same target.
 *
 * Joined on a character no column name can contain, rather than on a space or a
 * comma: `["a b"]` and `["a", "b"]` are different targets and must not collapse
 * onto one key, and a quoted identifier may legally contain either.
 */
const KEY_SEPARATOR = "\u0000";

function key(columns: readonly string[]): string {
    return [...columns].map(c => c.trim()).sort().join(KEY_SEPARATOR);
}

/** The column key an index key names. */
const indexKeyColumn = (key: string | TableIndexKey): string => (typeof key === "string" ? key : key.column);

/**
 * Every column set this table declares a uniqueness guarantee over.
 *
 * Three sources, and they are not interchangeable:
 * - the primary key, which is always there and is the default target;
 * - `.unique()` on a column, which compiles to an inline `UNIQUE`;
 * - a `unique: true` index, which is the *only* way to declare a composite
 *   guarantee.
 */
export function declaredUniqueTargets(table: TableDescriptor): string[][] {
    const targets: string[][] = [];

    if (table.primaryKey.length > 0) targets.push([...table.primaryKey]);

    for (const column of table.columns) {
        if (column.unique) targets.push([column.key]);
    }

    for (const index of table.indexes ?? []) {
        if (!index.unique) continue;
        // An index key may be an object (`{ column, direction }`) rather than
        // a bare key; the guarantee is over the columns either way.
        const columns = index.columns.map(indexKeyColumn);
        if (columns.length > 0 && columns.every(Boolean)) targets.push(columns);
    }

    return targets;
}

/**
 * Parse and check the columns an upsert wants to match on.
 *
 * Returns `undefined` when the caller named none, which means the primary key —
 * the behaviour bulk `upsert: true` has always had.
 */
export function resolveConflictTarget(
    raw: unknown,
    table: TableDescriptor,
    options?: { where?: string }
): string[] | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;

    const columns = (Array.isArray(raw) ? raw : String(raw).split(","))
        .map((entry) => String(entry).trim())
        .filter(Boolean);

    const where = options?.where ? `${options.where}: ` : "";

    if (columns.length === 0) {
        throw ApiError.badRequest(
            `${where}\`onConflict\` names no columns. Leave it out to upsert on the primary key.`,
            "INVALID_CONFLICT_TARGET"
        );
    }

    const declared = new Set(table.columns.map(column => column.key));
    const unknownColumn = columns.find((column) => !declared.has(column));
    if (unknownColumn) {
        throw ApiError.badRequest(
            `${where}'${unknownColumn}' is not a column of table '${table.slug}', so it cannot be an upsert target.`,
            "INVALID_CONFLICT_TARGET",
            { collection: table.slug }
        );
    }

    const available = declaredUniqueTargets(table);
    if (!available.some((candidate) => key(candidate) === key(columns))) {
        throw ApiError.badRequest(
            `${where}[${columns.join(", ")}] carries no uniqueness guarantee on table '${table.slug}', ` +
            "so an upsert has nothing to match a conflict against. Declare `.unique()` on the column, " +
            "or a `unique: true` index over the columns. " +
            (available.length > 0
                ? `Targets available today: ${available.map(t => `[${t.join(", ")}]`).join(", ")}.`
                : "This table declares none."),
            "INVALID_CONFLICT_TARGET",
            { collection: table.slug, requested: columns, available }
        );
    }

    return columns;
}
