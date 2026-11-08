import type { CollectionConfig, Properties, Property, ResolvedRelation } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import { fieldKeyForColumn, resolveCollectionRelations, rowToViewModel } from "@rebasepro/common";

/**
 * A record's values from the admin's view model (`entity.values`), as the
 * server sends the row — the shape `useRows`, `useRow`, `client.data` and
 * `context.data` hand an app, a collection's callbacks receive, and
 * `FieldValue` reads:
 *
 * - a date as the server serializes it: a date-only column (`columnType:
 *   "date"`) as `YYYY-MM-DD`, any other as an RFC 3339 timestamp;
 * - a belongsTo relation as its target's id, under its foreign key's own
 *   name (`customer` → `customerId`);
 * - a relation the admin loaded the target of, nested under the relation's
 *   name as that target's row — as REST's `include` returns it: one row for a
 *   to-one relation (its foreign key is there too), a list for a to-many;
 * - any other relation value as its target's id;
 * - a map's children by the same rules.
 *
 * Everything else is left as it is. The inverse of the conversion
 * `buildRebaseData` makes for the admin (`rowToViewModel`), for where the
 * admin hands a record to an app's code.
 *
 * @param options.included `false` leaves the loaded targets out — for a row
 * that is written, where a relation is its id and nothing more
 * @internal
 */
export function toWireRow(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    options?: { included?: boolean }
): Record<string, unknown> {
    const included = options?.included ?? true;
    const relations = relationsOf(collection);
    const foreignKeys = belongsToKeys(collection, relations);
    const row: Record<string, unknown> = {};
    const fromRelations: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        const relation = included ? relations[key] : undefined;
        const foreignKey = foreignKeys.get(key);
        if (foreignKey !== undefined) {
            fromRelations[foreignKey] = relationId(value);
            const target = relation && includedTarget(value, relation, options);
            if (target !== undefined) row[key] = target;
            continue;
        }
        if (relation) {
            const target = Array.isArray(value)
                ? includedTargets(value, relation, options)
                : includedTarget(value, relation, options);
            if (target !== undefined) {
                row[key] = target;
                continue;
            }
        }
        row[key] = toWireValue(value, collection.properties?.[key] as Property | undefined);
    }
    // The relation decides its key's value: the row carries both, and the
    // relation is what the record was drawn and edited by.
    return { ...row, ...fromRelations };
}

/** A relation's loaded target, as its own row: `undefined` where the admin holds only its id. */
function includedTarget(
    value: unknown,
    relation: ResolvedRelation,
    options: { included?: boolean } | undefined
): Record<string, unknown> | undefined {
    if (!(value instanceof EntityRelation) || !isPlainObject(value.data)) return undefined;
    const data = value.data;
    // Held as a record (`{ id, path, values }`) when the admin read it, as the
    // row itself when a socket delivered it.
    const values = isPlainObject(data.values) ? data.values : data;
    const id = typeof data.id === "string" || typeof data.id === "number" ? data.id : value.id;
    let target: CollectionConfig | undefined;
    try {
        target = relation.target();
    } catch {
        // A target not registered here: its row as it was read.
        target = undefined;
    }
    return { id, ...(target ? toWireRow(values, target, options) : toWireValues(values, undefined)) };
}

/** A to-many relation's targets: the loaded ones as rows, the rest as ids. `undefined` when none was loaded. */
function includedTargets(
    values: unknown[],
    relation: ResolvedRelation,
    options: { included?: boolean } | undefined
): unknown[] | undefined {
    let loaded = false;
    const out = values.map((item) => {
        const target = includedTarget(item, relation, options);
        if (target === undefined) return toWireValue(item, undefined);
        loaded = true;
        return target;
    });
    return loaded ? out : undefined;
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

/** A collection's relations by name; none where one names a target not registered here. */
function relationsOf(collection: CollectionConfig): Record<string, ResolvedRelation> {
    try {
        return resolveCollectionRelations(collection);
    } catch {
        return {};
    }
}

/** A collection's belongsTo relations, by the key the view model holds them under → their foreign key's. */
function belongsToKeys(collection: CollectionConfig, relations: Record<string, ResolvedRelation>): Map<string, string> {
    const keys = new Map<string, string>();
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

/**
 * A record's view-model `values` after app code was handed them as the row
 * `sent` (their {@link toWireRow}) and gave back the row `returned`.
 *
 * Only the keys `returned` changed or added are converted back
 * (`rowToViewModel`) and laid over `values`, and the keys it dropped are
 * dropped: what it left alone keeps the admin's own value, so a relation keeps
 * the target's columns it was read with and a date its instance. A row handed
 * back unchanged gives back `values` themselves.
 *
 * @internal
 */
export function fromWireRow(
    values: Record<string, unknown>,
    sent: Record<string, unknown>,
    returned: Record<string, unknown>,
    collection: CollectionConfig,
    path: string
): Record<string, unknown> {
    if (returned === sent) return values;
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(returned)) {
        if (!(key in sent) || !Object.is(sent[key], value)) changed[key] = value;
    }
    const dropped = Object.keys(sent).filter((key) => !(key in returned));
    if (Object.keys(changed).length === 0 && dropped.length === 0) return values;
    const out: Record<string, unknown> = {
        ...values,
        ...rowToViewModel(changed, path, (slug) => slug === path ? collection : undefined)
    };
    for (const key of dropped) delete out[key];
    return out;
}
