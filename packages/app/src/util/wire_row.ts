import type { CollectionConfig, Properties, Property, ResolvedRelation } from "@rebasepro/cms-types";
import { rowToViewModel, fieldKeyForColumn, resolveCollectionRelations, EntityRelation } from "@rebasepro/cms-types";

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

/**
 * A relation's loaded target, as its own row — exactly its columns, as REST's
 * `include` nests it: its `id` is its own `id` column where its table has
 * one, never the id the admin addresses it by. `undefined` where the admin
 * holds only its id.
 */
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
    let target: CollectionConfig | undefined;
    try {
        target = relation.target();
    } catch {
        // A target not registered here: its row as it was read.
        target = undefined;
    }
    return target ? toWireRow(values, target, options) : toWireValues(values, undefined);
}

/**
 * A to-many relation's targets as rows — `undefined` unless every one of them
 * was loaded, so the list is all rows or all ids, never a mix: REST's
 * `include` answers with a row for each target.
 */
function includedTargets(
    values: unknown[],
    relation: ResolvedRelation,
    options: { included?: boolean } | undefined
): Record<string, unknown>[] | undefined {
    if (values.length === 0) return undefined;
    const out: Record<string, unknown>[] = [];
    for (const item of values) {
        const target = includedTarget(item, relation, options);
        if (target === undefined) return undefined;
        out.push(target);
    }
    return out;
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
 * A copy of a row deep enough that nothing app code does to it reaches the
 * row it was copied from: every plain object and array is a new one, every
 * other value is shared. What a callback is handed, so the row
 * {@link fromWireRow} compares its answer against is still the one it was
 * handed.
 *
 * @internal
 */
export function copyRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = copyWireValue(value);
    return out;
}

function copyWireValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(copyWireValue);
    if (isPlainRecord(value)) return copyRow(value);
    return value;
}

/** Whether two wire values hold the same data, plain objects and arrays compared by what they hold. */
function sameWireValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, i) => sameWireValue(item, b[i]));
    }
    if (isPlainRecord(a) && isPlainRecord(b)) {
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length
            && keys.every((key) => key in b && sameWireValue(a[key], b[key]));
    }
    return false;
}

/** An object literal's kind of object, not a class instance (a `Date`, a `GeoPoint`). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** A loaded target's row, or a list holding one: what was read, never what is written. */
function holdsIncludedRows(value: unknown): boolean {
    return isPlainRecord(value) || (Array.isArray(value) && value.some(isPlainRecord));
}

/**
 * A record's view-model `values` after app code was handed a copy
 * ({@link copyRow}) of the row `sent` (their {@link toWireRow}) and gave back
 * the row `returned` — that copy edited in place, or a new object.
 *
 * Only the keys `returned` changed or added are converted back
 * (`rowToViewModel`) and laid over `values`, and the keys it dropped are
 * dropped: what it left alone keeps the admin's own value, so a relation keeps
 * the target's columns it was read with and a date its instance. A row handed
 * back unchanged gives back `values` themselves.
 *
 * A relation's loaded targets are what was read, not what is written: a
 * belongsTo is its foreign key — changed, cleared or dropped there — and a
 * relation's included rows edited or removed leave the relation as it was. A
 * relation is written from the row as ids.
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
    const relations = relationsOf(collection);
    const foreignKeys = belongsToKeys(collection, relations);
    const relationOfForeignKey = new Map<string, string>();
    for (const [name, foreignKey] of foreignKeys) relationOfForeignKey.set(foreignKey, name);
    // A belongsTo's own key holds only its loaded target; any other
    // relation's holds its target ids or its loaded rows.
    const isReadData = (key: string, value: unknown) =>
        key in relations && (foreignKeys.has(key) || holdsIncludedRows(value));

    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(returned)) {
        if (key in sent && sameWireValue(sent[key], value)) continue;
        if (isReadData(key, value)) continue;
        changed[key] = value;
    }
    const dropped = Object.keys(sent).filter((key) => !(key in returned) && !isReadData(key, sent[key]));
    if (Object.keys(changed).length === 0 && dropped.length === 0) return values;
    const out: Record<string, unknown> = {
        ...values,
        ...rowToViewModel(changed, path, (slug) => slug === path ? collection : undefined)
    };
    for (const [key, value] of Object.entries(changed)) {
        // A cleared foreign key unlinks: there is no id left to turn back
        // into the relation the view model holds under its own name.
        const relation = relationOfForeignKey.get(key);
        if (relation !== undefined && (value === null || value === undefined)) out[relation] = null;
    }
    for (const key of dropped) {
        delete out[key];
        const relation = relationOfForeignKey.get(key);
        if (relation !== undefined) delete out[relation];
    }
    return out;
}
