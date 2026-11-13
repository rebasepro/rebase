/**
 * Row identity: the address of a row, and how to derive it.
 *
 * Postgres has no `id`. A row is identified by its primary key — one or more
 * columns, with any names and any types. `id` is something we synthesize on top
 * of that: a single string token, because the admin needs *one* value it can put
 * in a URL (`/products/1:::2`), use as a cache key, and hang a relation ref off.
 *
 * That token is an address, not data. It is derived from the row's columns and
 * never stored in them — a row is exactly its columns, with their real types.
 * Writing the address back into the row is what used to rename primary keys
 * (`sku` → `id`) and restringify them (`42` → `"42"`) on the way out.
 *
 * These live in `common` because both sides need them and must agree exactly:
 * the driver parses an incoming address back into key columns, and the admin
 * derives the address from a row it was served.
 */

/**
 * A primary-key column: its name, the type it round-trips as, and whether it is
 * a UUID (which is a string despite sometimes being described as an id "number").
 */
export interface PrimaryKeyInfo {
    fieldName: string;
    type: "string" | "number";
    isUUID?: boolean;
    /** A calendar day (`date` property, `date` column): addressed as `YYYY-MM-DD`. */
    isDay?: boolean;
}

/**
 * A key part as an address spells it. A day key's value may reach here as a
 * `Date` — the admin's view model holds dates as `Date`s, parsed from the
 * `YYYY-MM-DD` the wire carries, which is midnight UTC — and is written back
 * as that day, never as the `Date`'s text.
 */
function keyPart(value: unknown, key: PrimaryKeyInfo): string {
    if (key.isDay && value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value ?? "");
}

/** Separator between the parts of a composite address. */
export const COMPOSITE_ID_SEPARATOR = ":::";

/** An integer as an address spells it: an optional minus and digits, nothing else. */
const INTEGER_PATTERN = /^-?\d+$/;

/**
 * The value of one numeric key part, or `undefined` when the text is not an
 * integer.
 *
 * Whole-string, not `parseInt`: `parseInt` reads the leading digits and stops,
 * so it reads `"12abc"` and `"12.9"` as 12, an address of a row the caller did
 * not name. An integer past what a double holds exactly stays the digits it
 * was written with, because as a number it rounds to a neighbour
 * (`9007199254740993` becomes …992), which is another row; Postgres reads the
 * text into the `bigint` column exactly.
 */
export function numericKeyPart(part: string | number): string | number | undefined {
    if (typeof part === "number") return Number.isFinite(part) ? part : undefined;
    if (!INTEGER_PATTERN.test(part)) return undefined;
    const value = Number(part);
    return Number.isSafeInteger(value) ? value : part;
}

/**
 * Derive a row's address from its key columns.
 *
 * Single key → the value as a string. Composite → each part joined by
 * {@link COMPOSITE_ID_SEPARATOR}, in primary-key order, which is what
 * {@link parseIdValues} expects to invert.
 */
export function buildCompositeId(values: Record<string, unknown>, primaryKeys: PrimaryKeyInfo[]): string {
    if (primaryKeys.length === 0) {
        return "";
    }
    if (primaryKeys.length === 1) {
        return keyPart(values[primaryKeys[0].fieldName], primaryKeys[0]);
    }
    return primaryKeys.map(pk => keyPart(values[pk.fieldName], pk)).join(COMPOSITE_ID_SEPARATOR);
}

/**
 * Invert {@link buildCompositeId}: turn an address back into key columns, each
 * coerced to the type its column actually round-trips as.
 *
 * This is the boundary where a URL segment becomes a query parameter, so a
 * malformed address must throw rather than silently produce a query that
 * matches the wrong row (or none).
 */
export function parseIdValues(idValue: string | number, primaryKeys: PrimaryKeyInfo[]): Record<string, string | number> {
    const result: Record<string, string | number> = {};

    if (primaryKeys.length === 0) {
        return result;
    }

    if (primaryKeys.length === 1) {
        const pk = primaryKeys[0];
        if (pk.type === "number" && !pk.isUUID) {
            const parsed = numericKeyPart(idValue);
            if (parsed === undefined) {
                throw new Error(`Invalid numeric ID: ${idValue}`);
            }
            result[pk.fieldName] = parsed;
        } else {
            result[pk.fieldName] = String(idValue);
        }
        return result;
    }

    // Composite key
    const parts = String(idValue).split(COMPOSITE_ID_SEPARATOR);
    if (parts.length !== primaryKeys.length) {
        throw new Error(`Composite ID parts mismatch. Expected ${primaryKeys.length}, got ${parts.length} for ID: ${idValue}`);
    }

    for (let i = 0; i < primaryKeys.length; i++) {
        const pk = primaryKeys[i];
        const val = parts[i];
        if (pk.type === "number" && !pk.isUUID) {
            const parsed = numericKeyPart(val);
            if (parsed === undefined) {
                throw new Error(`Invalid numeric ID component: ${val}`);
            }
            result[pk.fieldName] = parsed;
        } else {
            result[pk.fieldName] = val;
        }
    }

    return result;
}

