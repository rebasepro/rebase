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
}

/** Separator between the parts of a composite address. */
export const COMPOSITE_ID_SEPARATOR = ":::";

/** The eight-four-four-four-twelve shape of a UUID, any version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether one address part can be a value of the column it addresses. */
function partIsAddressable(part: string | number, pk: PrimaryKeyInfo): boolean {
    if (pk.isUUID) return UUID_PATTERN.test(String(part));
    if (pk.type === "number") {
        return typeof part === "number"
            ? Number.isFinite(part)
            : !isNaN(parseInt(String(part), 10));
    }
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
 * `isUUID` must come from the column, not from `isId: "uuid"` in a config: the
 * config is a claim about a key, and a `text` column that holds ids of some
 * other shape is a working app this must not start rejecting.
 */
export function isAddressableId(idValue: string | number, primaryKeys: PrimaryKeyInfo[]): boolean {
    if (primaryKeys.length === 0) return false;
    if (primaryKeys.length === 1) return partIsAddressable(idValue, primaryKeys[0]);

    const parts = String(idValue).split(COMPOSITE_ID_SEPARATOR);
    if (parts.length !== primaryKeys.length) return false;
    return parts.every((part, i) => partIsAddressable(part, primaryKeys[i]));
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
        return String(values[primaryKeys[0].fieldName] ?? "");
    }
    return primaryKeys.map(pk => String(values[pk.fieldName] ?? "")).join(COMPOSITE_ID_SEPARATOR);
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
            const parsed = typeof idValue === "number" ? idValue : parseInt(String(idValue), 10);
            if (isNaN(parsed)) {
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
            const parsed = parseInt(val, 10);
            if (isNaN(parsed)) {
                throw new Error(`Invalid numeric ID component: ${val}`);
            }
            result[pk.fieldName] = parsed;
        } else {
            result[pk.fieldName] = val;
        }
    }

    return result;
}

/**
 * The primary keys of a collection, as declared by its properties.
 *
 * This is the only tier both sides can read, because it is the only one written
 * in the config: the postgres driver can also infer keys from the Drizzle
 * schema, which the browser never sees and is never sent — the admin compiles
 * the collection files into its own bundle rather than being served them. A key
 * that lives only in the Drizzle schema is therefore invisible here, and the
 * server says so at boot (`warnOnKeysTheAdminCannotResolve`) naming the `isId`
 * to add.
 *
 * Returns an empty array when a collection declares none, which callers must
 * treat as "not addressable" rather than defaulting to `id`: guessing a key
 * that is not the real one produces confidently wrong addresses.
 */
export function getDeclaredPrimaryKeys(collection: {
    properties?: Record<string, unknown>;
}): PrimaryKeyInfo[] {
    const properties = collection.properties;
    if (!properties) return [];

    const keys: PrimaryKeyInfo[] = [];
    for (const [fieldName, propRaw] of Object.entries(properties)) {
        const prop = propRaw as { type?: string; isId?: unknown } | undefined;
        if (!prop || typeof prop !== "object") continue;
        if (!("isId" in prop) || !prop.isId) continue;
        keys.push({
            fieldName,
            type: prop.type === "number" ? "number" : "string",
            isUUID: prop.isId === "uuid"
        });
    }
    return keys;
}

/**
 * The keys to address a collection's rows with, resolved the way the driver
 * resolves them — minus the tier the browser cannot reach.
 *
 * The postgres driver tries, in order: properties marked `isId`; the primary
 * keys of the Drizzle schema; and finally a column literally named `id`. Only
 * the first and last are visible in a `CollectionConfig`, which is what both
 * sides share.
 *
 * So the two agree except on a collection that declares no `isId` and whose key
 * is known only to Drizzle. There, the driver reads the real key, and this
 * either resolves nothing (reported to the console by the caller) or — if the
 * table happens to have an unrelated `id` property — resolves `id`, which is
 * the wrong key and cannot be detected from here: the addresses look right and
 * route wrong. Only the config can settle it, so the server names both cases
 * at boot (`warnOnKeysTheAdminCannotResolve`) with the `isId` to add.
 */
export function resolvePrimaryKeys(collection: {
    properties?: Record<string, unknown>;
}): PrimaryKeyInfo[] {
    const declared = getDeclaredPrimaryKeys(collection);
    if (declared.length > 0) return declared;

    const idProp = collection.properties?.id as { type?: string } | undefined;
    if (idProp && typeof idProp === "object") {
        return [{ fieldName: "id",
type: idProp.type === "number" ? "number" : "string" }];
    }

    return [];
}
