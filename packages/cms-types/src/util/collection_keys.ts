/**
 * The key a collection's rows are addressed by, read off its property view
 * model (`isId`).
 *
 * @module
 */
import type { PrimaryKeyInfo } from "@rebasepro/common";

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
            isUUID: prop.isId === "uuid",
            ...(prop.type === "date" ? { isDay: true } : {})
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
