import type { CollectionConfig, Properties, Property, ResolvedRelation } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import { fieldKeyForColumn, resolveCollectionRelations } from "@rebasepro/common";

/**
 * A record's values from the admin's view model (`entity.values`), as the
 * server sends the row — the shape `useRows`, `useRow`, `client.data` and a
 * callback's `context.data` hand an app, and `FieldValue` reads:
 *
 * - a date as the server serializes it: a date-only column (`columnType:
 *   "date"`) as `YYYY-MM-DD`, any other as an RFC 3339 timestamp;
 * - a belongsTo relation as its target's id, under its foreign key's own
 *   name (`customer` → `customerId`), and not under the relation's;
 * - any other relation value as its target's id;
 * - a map's children by the same rules.
 *
 * Everything else is left as it is. The inverse of the conversion
 * `buildRebaseData` makes for the admin, for the one place the admin hands a
 * row back to an app.
 */
export function toWireRow(values: Record<string, unknown>, collection: CollectionConfig): Record<string, unknown> {
    const foreignKeys = belongsToKeys(collection);
    const row: Record<string, unknown> = {};
    const fromRelations: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        const foreignKey = foreignKeys.get(key);
        if (foreignKey !== undefined) {
            fromRelations[foreignKey] = relationId(value);
            continue;
        }
        row[key] = toWireValue(value, collection.properties?.[key] as Property | undefined);
    }
    // The relation decides its key's value: the row carries both, and the
    // relation is what the record was drawn and edited by.
    return { ...row, ...fromRelations };
}

function toWireValues(values: Record<string, unknown>, properties: Properties | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        out[key] = toWireValue(value, properties?.[key] as Property | undefined);
    }
    return out;
}

function toWireValue(value: unknown, property: Property | undefined): unknown {
    if (value instanceof Date) return toWireDate(value, property);
    if (value instanceof EntityRelation) return value.id;
    if (Array.isArray(value)) {
        const of = property?.type === "array" && !Array.isArray(property.of) ? property.of : undefined;
        return value.map((item) => toWireValue(item, of));
    }
    if (property?.type === "map" && isPlainObject(value)) {
        return toWireValues(value, property.properties);
    }
    return value;
}

function toWireDate(date: Date, property: Property | undefined): string | null {
    if (Number.isNaN(date.getTime())) return null;
    const iso = date.toISOString();
    // A date-only column is read as UTC midnight (`new Date("2026-11-08")`),
    // so its UTC calendar day is the day the column holds.
    return property?.type === "date" && property.columnType === "date" ? iso.slice(0, 10) : iso;
}

function relationId(value: unknown): unknown {
    if (value instanceof EntityRelation) return value.id;
    if (isPlainObject(value) && (typeof value.id === "string" || typeof value.id === "number")) return value.id;
    return value ?? null;
}

/** A collection's belongsTo relations, by the key the view model holds them under → their foreign key's. */
function belongsToKeys(collection: CollectionConfig): Map<string, string> {
    const keys = new Map<string, string>();
    let relations: Record<string, ResolvedRelation>;
    try {
        relations = resolveCollectionRelations(collection);
    } catch {
        // A relation whose target is not registered here: nothing to rename.
        return keys;
    }
    for (const [name, relation] of Object.entries(relations)) {
        if (relation.kind !== "belongsTo") continue;
        const foreignKey = fieldKeyForColumn(collection, relation.localKey);
        if (foreignKey !== name) keys.set(name, foreignKey);
    }
    return keys;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
