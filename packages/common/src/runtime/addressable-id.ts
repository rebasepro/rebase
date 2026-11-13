import { COMPOSITE_ID_SEPARATOR, numericKeyPart, type PrimaryKeyInfo } from "../util/identity";

/** The eight-four-four-four-twelve shape of a UUID, any version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether one address part can be a value of the column it addresses. */
function partIsAddressable(part: string | number, pk: PrimaryKeyInfo): boolean {
    if (pk.isUUID) return UUID_PATTERN.test(String(part));
    if (pk.type === "number") return numericKeyPart(part) !== undefined;
    return true;
}

/**
 * Whether an address could name a row at all, before asking the database.
 *
 * A `uuid` column cannot hold `"new"`, and an `integer` column cannot hold
 * `"abc"` — so the answer to "which row is this" is "none", and that is a 404,
 * not a failure. Postgres cannot say so politely: the comparison never runs, it
 * raises `22P02` and aborts the enclosing transaction, after which every
 * further statement returns the far less helpful `25P02`.
 *
 * `isUUID` must come from the column, not from a declaration: a declaration
 * is a claim about a key, and a `text` column that holds ids of some other
 * shape is a working app this must not start rejecting.
 *
 * @group Data
 */
export function isAddressableId(idValue: string | number, primaryKeys: PrimaryKeyInfo[]): boolean {
    if (primaryKeys.length === 0) return false;
    if (primaryKeys.length === 1) return partIsAddressable(idValue, primaryKeys[0]);

    const parts = String(idValue).split(COMPOSITE_ID_SEPARATOR);
    if (parts.length !== primaryKeys.length) return false;
    return parts.every((part, i) => partIsAddressable(part, primaryKeys[i]));
}
