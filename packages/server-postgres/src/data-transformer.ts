import { eq } from "drizzle-orm";
import { AnyPgColumn } from "drizzle-orm/pg-core";
import { CollectionConfig, Properties, ResolvedRelation, Vector, hasForeignKeyOnTarget, type ResolvedVia } from "@rebasepro/types";
import { resolveCollectionRelations, findRelation, createRelationRef } from "@rebasepro/common";
import { isPrototypePollutingKey } from "@rebasepro/utils";
import { PostgresTableRegistry } from "./model/PostgresTableRegistry";
import { buildCompositeId, rowIdentityCondition, tableKeys } from "./services/collection-helpers";
import { applyDynamicJoin, joinStepCondition } from "./services/RelationService";
import { ApiError, logger } from "@rebasepro/server";
import type { DrizzleClient } from "./interfaces";
import type { ColumnDescriptor, ColumnType, JsonShape, RelationDescriptor } from "@rebasepro/types";
import { columnTypeLabel } from "@rebasepro/types";
import { valueCodecOf, valueCodecOfType, type ValueCodec } from "@rebasepro/common";
import type { RuntimeTable } from "./model/runtime-table";
import { columnKeyOf } from "./services/relation-tables";

/**
 * Data transformation utilities for converting between frontend and database formats.
 */

/**
 * Typed result from `serializeDataToServer`.
 * Replaces the hidden `__inverseRelationUpdates` / `__joinPathRelationUpdates`
 * dunder-property mutation pattern with explicit, typed state management.
 */
export interface SerializedEntityData {
    /** Scalar column values ready for INSERT/UPDATE. */
    scalarData: Record<string, unknown>;
    /**
     * Inverse relation updates that must be applied to target tables.
     *
     * No address here: the row being written does not know its own. These are
     * applied by `PersistService`, which addresses them with the id it holds —
     * the one it was given for an update, or the one the INSERT returned — and
     * that is the authority. This item used to carry a `currentId` derived from
     * the *input* values, which nothing ever read.
     */
    inverseRelationUpdates: Array<{
        relationKey: string;
        relation: ResolvedRelation;
        newValue: unknown;
    }>;
    /** JoinPath relation updates that require multi-hop writes. */
    joinPathRelationUpdates: Array<{
        relationKey: string;
        relation: ResolvedVia;
        newTargetId: string | number | null;
    }>;
}
/**
 * The last pass over a row before it is written: `undefined` and `NaN` become
 * `null`, a `Date` becomes its ISO string, recursively through arrays and
 * objects.
 *
 * Strings are left as they came. This pass knows no property types, and a
 * string is text unless its property says otherwise: reading `"Nan"` as a
 * failed number nulled a person's name, and re-printing anything shaped like
 * an ISO timestamp cut the microseconds out of text that happened to hold one.
 * The coercions a string *does* need are made by its property, in
 * {@link serializePropertyToServer}: `"NaN"` on a `number`, a date's text on a
 * `date`.
 */
export function sanitizeAndConvertDates(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return null;
    }

    if (typeof obj === "number" && isNaN(obj)) {
        return null;
    }

    if (Array.isArray(obj)) {
        return obj.map(v => sanitizeAndConvertDates(v));
    }

    if (obj instanceof Date) {
        return obj.toISOString();
    }

    // A Buffer or Uint8Array is a bytea value, not a record to walk: copied key
    // by key it became `{"0":1,"1":2,…}`, which the driver then JSON-encoded
    // into the column.
    if (ArrayBuffer.isView(obj)) {
        return obj;
    }
    // A bare ArrayBuffer has no own keys at all, so the walk made it `{}`; the
    // driver takes bytes as a Buffer.
    if (obj instanceof ArrayBuffer) {
        return Buffer.from(obj);
    }

    if (typeof obj === "object") {
        const newObj: Record<string, unknown> = {};
        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            // `JSON.parse` creates `__proto__` as an *own* property, so it gets
            // past the check above — and `newObj[key] = …` then invokes the
            // prototype setter instead of creating a property. The row's
            // prototype becomes whatever the request body supplied, so
            // `row.isAdmin` answers `true` while `Object.keys(row)` shows
            // nothing of the sort. No column can be reached by these names.
            if (isPrototypePollutingKey(key)) continue;
            newObj[key] = sanitizeAndConvertDates((obj as Record<string, unknown>)[key]);
        }
        return newObj;
    }

    return obj;
}

/** A UTC ISO timestamp, as `Date.prototype.toISOString` and most clients write one. */
const ISO_DATE_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** `Date.prototype.toString()`'s form, which Postgres cannot parse. */
const JS_DATE_TEXT = /^\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4} \(.+\)$/;

/** A date property's text in the ISO form Postgres reads; anything else as it came. */
function normalizeDateText(value: unknown): unknown {
    if (typeof value !== "string" || !(ISO_DATE_TEXT.test(value) || JS_DATE_TEXT.test(value))) return value;
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * A row as it is written: every column's value through its codec
 * ({@link serializeColumnToServer}), and every relation's value split off —
 * a `belongsTo` becomes its foreign key, a relation whose foreign key is on
 * the target (or a `via` chain) is returned for `PersistService` to write.
 *
 * Read from the table: which keys are columns, which are relations, and what
 * each column's Postgres type is. A key the table does not declare is kept as
 * sent; the catalogue check (`assertWritableColumns`) refuses it later.
 *
 * `collection` is read for one thing only: the resolved relation an inverse or
 * `via` update hands `PersistService`, which still takes the legacy shape.
 */
export function serializeDataToServer<M extends Record<string, unknown>>(
    row: M,
    table: RuntimeTable,
    collection?: CollectionConfig
): SerializedEntityData {
    if (!row) return { scalarData: {},
inverseRelationUpdates: [],
joinPathRelationUpdates: [] };

    const result: Record<string, unknown> = {};
    const resolvedRelations = collection ? resolveCollectionRelations(collection) : {};

    // Track inverse relations that need to be handled separately
    const inverseRelationUpdates: SerializedEntityData["inverseRelationUpdates"] = [];
    const joinPathRelationUpdates: SerializedEntityData["joinPathRelationUpdates"] = [];

    // The keys of every foreign key a `belongsTo` writes: what a client knows
    // the field as (`authorId`), never the `author_id` column behind it.
    const foreignKeys = new Set<string>();
    for (const relation of table.relations.values()) {
        if (relation.kind === "belongsTo") foreignKeys.add(relation.localField);
    }

    for (const [key, value] of Object.entries(row)) {
        // Same reasoning as `sanitizeAndConvertDates`: these keys come from the
        // request body, and no column answers to them.
        if (isPrototypePollutingKey(key)) continue;

        // `{ subtitle: undefined }` means "I have no value for this", not "set
        // this column to NULL" — it is what spreading an optional field
        // produces, and what Drizzle itself skips. The key used to survive with
        // `undefined` and `sanitizeAndConvertDates` then turned it into `null`,
        // so `update(id, { title, subtitle: payload.subtitle })` wiped
        // `subtitle` whenever the payload happened not to carry one. Unreachable
        // over HTTP (JSON has no `undefined`); the in-process data API passes
        // the caller's object straight through, so it is reachable there.
        if (value === undefined) continue;

        // Coerce empty strings to null for any field that acts as a foreign key
        const effectiveValue = (foreignKeys.has(key) && value === "") ? null : value;

        const relation = table.relations.get(key);
        if (relation) {
            if (relation.kind === "belongsTo") {
                // Owning relation: the relation object becomes the foreign key,
                // under its key — Drizzle maps it back to the column.
                const serializedValue = serializeRelationValue(effectiveValue);
                if (serializedValue !== undefined) result[relation.localField] = serializedValue;
                continue;
            }
            const resolved = findRelation(resolvedRelations, key);
            if (resolved && hasForeignKeyOnTarget(resolved)) {
                // Inverse relation: the target table's foreign key is updated.
                inverseRelationUpdates.push({
                    relationKey: key,
                    relation: resolved,
                    newValue: serializeRelationValue(effectiveValue)
                });
                continue;
            }
            if (resolved && resolved.kind === "via") {
                // A join chain is written through its own machinery, one row at
                // a time for a to-one and as a set for a to-many.
                const serializedValue = serializeRelationValue(effectiveValue);
                if (resolved.cardinality === "one") {
                    // Ordering matters: PersistService applies these BEFORE
                    // the main UPDATE, so the mapping reads the pre-update
                    // foreign key rather than a value the same save changed.
                    joinPathRelationUpdates.push({
                        relationKey: key,
                        relation: resolved,
                        newTargetId: relationTargetId(serializedValue)
                    });
                } else {
                    inverseRelationUpdates.push({
                        relationKey: key,
                        relation: resolved,
                        newValue: serializedValue
                    });
                }
                continue;
            }
            result[key] = serializeRelationValue(effectiveValue);
            continue;
        }

        const column = table.columnsByKey.get(key);
        result[key] = column ? serializeColumnToServer(effectiveValue, column, key) : effectiveValue;
    }

    return {
        scalarData: result,
        inverseRelationUpdates,
        joinPathRelationUpdates
    };
}

/** The id a to-one `via` link is written to: a key, or `null` to unlink. */
function relationTargetId(value: unknown): string | number | null {
    return typeof value === "string" || typeof value === "number" ? value : null;
}

/**
 * How to name a rejected value in an error, without quoting it back.
 *
 * The value may be anything the caller sent, including a secret in the wrong
 * field, so the message describes its shape rather than echoing it — an echoed
 * value ends up in logs and in error-reporting services.
 */
function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (value instanceof Date) return "a date";
    const type = typeof value;
    return type === "object" ? "an object" : `a ${type}`;
}

/** `HH:MM[:SS[.fff]]`, the text Postgres reads and writes for a `time` column. */
const TIME_OF_DAY = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/;

/**
 * A `time` column's text as the date it is served as: that time of day, UTC,
 * on 1970-01-01. `undefined` for text that is not a time of day.
 */
function timeOfDayToDate(text: string): Date | undefined {
    const match = TIME_OF_DAY.exec(text.trim());
    if (!match) return undefined;
    const [, hh, mm, ss = "00", fraction = ""] = match;
    const date = new Date(`1970-01-01T${hh}:${mm}:${ss}${fraction ? fraction.slice(0, 4) : ""}Z`);
    return isNaN(date.getTime()) ? undefined : date;
}

/**
 * What a `time` column is written: the UTC time of day of a date, so neither
 * the server's zone nor the caller's moves it. Text already shaped as a time of
 * day is kept as written.
 */
function dateToTimeOfDay(value: unknown): unknown {
    if (typeof value === "string" && TIME_OF_DAY.test(value.trim())) return value.trim();
    const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
    if (!date || isNaN(date.getTime())) return value;
    return date.toISOString().slice(11, 23);
}

/**
 * A relation's value as it is written: a relation object (`{ id, … }`) becomes
 * its id, a list becomes a list of ids, an empty string becomes `null`.
 */
export function serializeRelationValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(serializeRelationValue);
    if (typeof value === "object" && "id" in value) return value.id;
    if (value === "") return null;
    return value;
}

/** How a column is named in a write error: its key, or its type. */
function writeLabel(type: ColumnType, key: string | undefined): string {
    return key ? `'${key}'` : `a ${columnTypeLabel(type)} column`;
}

/** The 400 a value that is not a list gets, on a column or a JSON field that holds one. */
function notAnArray(label: string, value: unknown): ApiError {
    // A non-array value used to become `[]` here — the caller's value
    // destroyed, answered 200/201, and the row reading back as an empty list
    // on every later fetch. `POST /posts {"tags":"news"}` from a client that
    // sent a single tag as a scalar, or a CSV import that did not split a
    // column, was unrecoverable data loss on a `text[]` column. Refusing the
    // value at the boundary is what a 400 is for.
    //
    // The read-side twin (`parseColumnFromServer`) still coerces, and should:
    // a row already in the database is not this caller's fault.
    return ApiError.badRequest(
        `${label} expects an array, but received ${describeValue(value)}.`,
        "VALIDATION_INVALID_VALUE"
    );
}

/**
 * A point as it is stored: the `{ latitude, longitude }` shape the OpenAPI
 * schema and the generated TS type both promise, or a 400.
 */
function serializeGeopoint(value: unknown, label: string): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw ApiError.badRequest(
            `${label} expects a geopoint object with \`latitude\` and \`longitude\`, ` +
            `but received ${describeValue(value)}.`,
            "VALIDATION_INVALID_VALUE"
        );
    }
    const latitude = "latitude" in value ? value.latitude : undefined;
    const longitude = "longitude" in value ? value.longitude : undefined;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
        throw ApiError.badRequest(
            `${label} expects a geopoint object with numeric \`latitude\` and \`longitude\`.`,
            "VALIDATION_INVALID_VALUE"
        );
    }
    return { latitude, longitude };
}

/** A vector as pgvector takes it: a list of numbers, from a `Vector`, a `{ value }` envelope or a list. */
function serializeVector(value: unknown): unknown {
    if (value instanceof Vector) return value.value;
    if (typeof value === "object" && value !== null && "value" in value && Array.isArray(value.value)) {
        return value.value.map(Number);
    }
    if (Array.isArray(value)) return value.map(Number);
    return value;
}

/**
 * A value of one codec family as it is written, for the families that need no
 * shape: a column's own value or a native array's item.
 */
function serializeScalar(value: unknown, codec: ValueCodec, label: string): unknown {
    switch (codec) {
        case "timestamp":
        case "date":
            return normalizeDateText(value);
        case "time":
            return dateToTimeOfDay(value);
        case "number":
            // A number that did not parse, as some clients print one. Postgres
            // reads `'NaN'` as a valid `numeric`, and rejects it outright on an
            // integer column, so neither is what was meant.
            return typeof value === "string" && value.trim().toLowerCase() === "nan" ? null : value;
        case "geopoint":
            return serializeGeopoint(value, label);
        case "vector":
            return serializeVector(value);
        case "bytea": {
            const decoded = tryDecodeBase64DataUrl(value);
            return decoded ?? value;
        }
        case "text": {
            const decoded = tryDecodeBase64DataUrl(value);
            return decoded ?? value;
        }
        default:
            return value;
    }
}

/**
 * One block of a `json.oneOf` (`{ type, value }`) as it is written: its value
 * through the variant's shape. A block whose type names no variant, or that is
 * not an object, is kept as sent.
 */
function serializeOneOfBlock(block: unknown, shape: Extract<JsonShape, { kind: "oneOf" }>, label: string): unknown {
    if (block === null || typeof block !== "object" || Array.isArray(block)) return block;
    const record: Record<string, unknown> = { ...block };
    const variantName = record[shape.typeField];
    const variant = typeof variantName === "string" ? shape.variants[variantName] : undefined;
    if (!variant || typeof variantName !== "string") return block;
    return {
        [shape.typeField]: variantName,
        [shape.valueField]: serializeJsonValue(record[shape.valueField], variant, label)
    };
}

/**
 * A value inside a JSON document as it is written, walked by the document's
 * shape: a date's text normalised, a number's `"NaN"` nulled, a point checked,
 * a list checked to be one, an object's declared fields walked. A field the
 * shape does not declare is kept as sent.
 */
function serializeJsonValue(value: unknown, shape: JsonShape, label: string): unknown {
    if (value === null || value === undefined) return value;
    switch (shape.kind) {
        case "string":
            return serializeScalar(value, "text", label);
        case "number":
            return serializeScalar(value, "number", label);
        case "date":
            return serializeScalar(value, "timestamp", label);
        case "geopoint":
            return serializeGeopoint(value, label);
        case "object": {
            if (typeof value !== "object") return value;
            const result: Record<string, unknown> = {};
            for (const [field, fieldValue] of Object.entries(value)) {
                const fieldShape = shape.fields[field];
                result[field] = fieldShape ? serializeJsonValue(fieldValue, fieldShape, `${label}.${field}`) : fieldValue;
            }
            return result;
        }
        case "array": {
            if (!Array.isArray(value)) throw notAnArray(label, value);
            const items = shape.of;
            return items.kind === "oneOf"
                ? value.map(item => serializeOneOfBlock(item, items, label))
                : value.map(item => serializeJsonValue(item, items, label));
        }
        case "oneOf":
            return serializeOneOfBlock(value, shape, label);
        default:
            return value;
    }
}

/**
 * One column's value as it is written, by the column's Postgres type
 * (`valueCodecOf`):
 *
 * - a temporal value's text in the ISO form Postgres reads; a `time` column's
 *   value as the UTC time of day;
 * - a number's `"NaN"` as `null`;
 * - a geopoint checked to be `{ latitude, longitude }` (400 otherwise);
 * - a native array checked to be a list (400 otherwise), each item by the
 *   array's element type;
 * - a JSON document walked by its shape (`serializeJsonValue`);
 * - a vector unwrapped to a list of numbers;
 * - a `data:application/octet-stream;base64,` URL on `bytea` or text decoded
 *   to bytes.
 *
 * `key` is only used to phrase errors. Without it the one trace a bad value
 * left in the log of a thousand-row import named nothing at all.
 */
export function serializeColumnToServer(value: unknown, column: ColumnDescriptor, key?: string): unknown {
    if (value === null || value === undefined) return value;
    const label = writeLabel(column.type, key ?? column.key);
    const codec = valueCodecOf(column);
    switch (codec) {
        case "array": {
            if (!Array.isArray(value)) throw notAnArray(label, value);
            const element = column.type.kind === "array" ? valueCodecOfType(column.type.of) : "passthrough";
            return value.map(item => item === null || item === undefined ? item : serializeScalar(item, element, label));
        }
        case "json":
            return column.json ? serializeJsonValue(value, column.json, label) : value;
        default:
            return serializeScalar(value, codec, label);
    }
}

/**
 * Transform IDs back to relation objects for frontend
 */
export async function parseDataFromServer<M extends Record<string, unknown>>(
    data: M,
    table: RuntimeTable,
    collection: CollectionConfig,
    db?: DrizzleClient,
    registry?: PostgresTableRegistry
): Promise<M> {
    const properties = collection.properties;
    if (!data || !properties) return data;

    // Get the normalized relations once
    const resolvedRelations = resolveCollectionRelations(collection);

    // Shared scalar + relation value normalization
    const result = normalizeScalarValues(data, table, { skipRelations: false });

    // The relation properties the row does not carry yet: a ref from the
    // row's own foreign key, or one read from the target (`db`, `registry`).
    if (registry) {
        const owner = registry.getTable(collection.slug);
        if (owner) await loadRelationRefs(data, result, properties, owner, registry, db);
    }

    return result as M;
}

/**
 * The admin view model's relation refs for one row, read from the owning
 * table's relation descriptors: every relation property the row does not
 * already carry gets a `{ __type: "relation" }` ref — from the row's own
 * foreign key for a `belongsTo` (no query), and, when `db` is given, from the
 * target for a `hasOne`/`hasMany` (the rows whose foreign key holds this row's
 * id or `sourceKey`) and a `via` (the chain joined from this row). One query
 * per such relation, capped at 1 row for a to-one and 100 for a to-many.
 */
async function loadRelationRefs(
    data: Record<string, unknown>,
    result: Record<string, unknown>,
    properties: Properties,
    owner: RuntimeTable,
    registry: PostgresTableRegistry,
    db: DrizzleClient | undefined
): Promise<void> {
    for (const [propKey, property] of Object.entries(properties)) {
        if (property.type !== "relation" || propKey in result) continue;
        const relation = owner.relations.get(propKey);
        if (!relation) continue;
        const target = registry.getTable(relation.target);
        if (!target) {
            logger.warn(`Could not resolve the target table '${relation.target}' of relation property: ${propKey}`);
            continue;
        }

        if (relation.kind === "belongsTo") {
            // Owning relation: the foreign key is on this row, under its key.
            if (!(relation.localField in data)) continue;
            const fkValue = data[relation.localField];
            if (fkValue !== null && fkValue !== undefined) {
                result[propKey] = createRelationRef(String(fkValue), target.slug);
            }
            continue;
        }

        if (!db) continue;

        if (relation.kind === "hasOne" || relation.kind === "hasMany") {
            // Inverse relation: the foreign key is on the target table.
            try {
                const targetTable = registry.getPgTable(target.descriptor.table);
                // What the target's foreign key holds. Ordinarily this row's
                // id; for a link on a natural key, the value of the column it
                // points at — which is on the row already, so this costs
                // nothing extra.
                const currentId = relation.sourceKey
                    ? data[columnKeyOf(owner, relation.sourceKey)] as string | number | undefined
                    : buildCompositeId(data, tableKeys(owner));

                if (targetTable && currentId !== undefined && currentId !== null && currentId !== "") {
                    const foreignKeyColumn = targetTable[columnKeyOf(target, relation.foreignKey) as keyof typeof targetTable] as AnyPgColumn;
                    if (foreignKeyColumn) {
                        const relatedRows = await db
                            .select()
                            .from(targetTable)
                            .where(eq(foreignKeyColumn, currentId))
                            .limit(relation.cardinality === "one" ? 1 : 100);

                        if (relatedRows.length > 0) {
                            const targetPks = tableKeys(target);
                            if (relation.cardinality === "one") {
                                result[propKey] = createRelationRef(buildCompositeId(relatedRows[0] as Record<string, unknown>, targetPks), target.slug);
                            } else {
                                result[propKey] = relatedRows.map((row: Record<string, unknown>) =>
                                    createRelationRef(buildCompositeId(row, targetPks), target.slug)
                                );
                            }
                        }
                    }
                }
            } catch (e) {
                logger.warn(`Could not resolve inverse relation property: ${propKey}`, { error: e });
            }
            continue;
        }

        if (relation.kind === "via") {
            // A `via` chain, joined from this row.
            try {
                const pks = tableKeys(owner);
                const currentId = buildCompositeId(data, pks);
                if (!currentId) continue;

                const sourceTable = registry.getPgTable(owner.descriptor.table);
                if (!sourceTable) {
                    logger.warn(`Source table not found for table: ${owner.slug}`);
                    continue;
                }

                let query = db.select().from(sourceTable);
                let currentTable = sourceTable;
                for (const join of relation.steps) {
                    const joinTable = registry.getPgTable(join.table);
                    if (!joinTable) {
                        logger.warn(`Join table not found: ${join.table}`);
                        break;
                    }

                    // Every column pair of the step, for a step that joins on a tuple.
                    const step = joinStepCondition(currentTable, joinTable, join);
                    if ("missing" in step) {
                        logger.warn(`Join columns not found: ${step.missing}`);
                        break;
                    }

                    query = applyDynamicJoin(query, joinTable, step.condition);
                    currentTable = joinTable;
                }

                // The current row, by every key column. Without a condition on
                // each of them the join reads the related rows of every row
                // sharing the first one — or, with none at all, of the whole table.
                const currentRow = rowIdentityCondition(sourceTable, pks, currentId, owner.slug);
                const joinResults = await query.where(currentRow).limit(relation.cardinality === "one" ? 1 : 100);

                if (joinResults.length > 0) {
                    const targetPks = tableKeys(target);
                    const targetTableName = relation.steps[relation.steps.length - 1].table;
                    const targetRowOf = (joinResult: Record<string, unknown>) =>
                        (joinResult[targetTableName] || joinResult) as Record<string, unknown>;

                    if (relation.cardinality === "one") {
                        result[propKey] = createRelationRef(buildCompositeId(targetRowOf(joinResults[0] as Record<string, unknown>), targetPks), target.slug);
                    } else {
                        result[propKey] = joinResults.map((joinResult: Record<string, unknown>) =>
                            createRelationRef(buildCompositeId(targetRowOf(joinResult), targetPks), target.slug)
                        );
                    }
                }
            } catch (e) {
                logger.warn(`Could not resolve \`via\` relation property: ${propKey}`, { error: e });
            }
        }
    }
}

/**
 * Try to decode a `data:application/octet-stream;base64,...` data URL string
 * into a Buffer. Returns null if the value is not a matching data URL.
 */
function tryDecodeBase64DataUrl(value: unknown): Buffer | null {
    if (typeof value !== "string") return null;
    if (!value.startsWith("data:application/octet-stream;base64,")) return null;
    const base64Data = value.split(",")[1];
    return base64Data ? Buffer.from(base64Data, "base64") : null;
}

/**
 * Try to resolve an unknown value into a Buffer.
 * Handles native Buffers and `{ type: "Buffer", data: number[] }` objects (from JSON deserialization).
 * Returns null if the value is not a buffer.
 */
function tryResolveBuffer(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === "object" && value !== null) {
        const rawVal = value as Record<string, unknown>;
        if (rawVal.type === "Buffer" && Array.isArray(rawVal.data)) {
            return Buffer.from(rawVal.data as number[]);
        }
    }
    return null;
}

/**
 * Convert a Buffer to a UTF-8 string if all bytes are printable ASCII,
 * otherwise return a base64 data URL.
 */
function bufferToStringOrBase64(buf: Buffer): string {
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        // Allow standard printable ASCII + common whitespace (\r, \n, \t)
        if ((b < 32 || b > 126) && b !== 9 && b !== 10 && b !== 13) {
            return `data:application/octet-stream;base64,${buf.toString("base64")}`;
        }
    }
    return buf.toString("utf8");
}

/**
 * A list read back where a list belongs, whatever the database held: a
 * non-array value from the database is coerced rather than refused, because a
 * row already stored is not this caller's fault.
 */
function readList(value: unknown): unknown[] | undefined {
    if (Array.isArray(value)) return undefined;
    logger.warn(`Expected array value from DB for an array column, got ${typeof value}. Coercing to array.`);
    return typeof value === "string" ? [value] : [];
}

/** A temporal value as the view model's `{ __type: "date" }` envelope, or `null` when it is not one. */
function dateEnvelope(value: unknown, timeOfDay: boolean): unknown {
    let date: Date | undefined;
    if (timeOfDay && typeof value === "string") {
        // A time of day, served like a date-only column: on a fixed day, in
        // UTC. `new Date("09:30:00")` is Invalid, which read every time column
        // as null.
        date = timeOfDayToDate(value);
    } else if (value instanceof Date) {
        date = value;
    } else if (typeof value === "string" || typeof value === "number") {
        const parsedDate = new Date(value);
        if (!isNaN(parsedDate.getTime())) date = parsedDate;
    }
    return date ? { __type: "date", value: date.toISOString() } : null;
}

/** A vector as the view model's `{ __type: "Vector" }` envelope. */
function vectorEnvelope(value: unknown): unknown {
    let nums: number[] = [];
    if (typeof value === "string") {
        nums = value.slice(1, -1).split(",").map(Number);
    } else if (Array.isArray(value)) {
        nums = value.map(Number);
    } else if (value instanceof Vector) {
        nums = value.value;
    } else if (typeof value === "object" && value !== null && "value" in value && Array.isArray(value.value)) {
        nums = value.value.map(Number);
    }
    return { __type: "Vector", value: nums };
}

/** Text as the view model reads it: bytes as text or a data URL, a document as JSON. */
function textFromServer(value: unknown): unknown {
    if (typeof value === "string") return value;
    const buf = tryResolveBuffer(value);
    if (buf) return bufferToStringOrBase64(buf);
    if (typeof value === "object" && value !== null) {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

/** A value of one codec family as the view model reads it, for the families that need no shape. */
function parseScalar(value: unknown, codec: ValueCodec): unknown {
    switch (codec) {
        case "bytea": {
            const buf = tryResolveBuffer(value);
            return buf ? `data:application/octet-stream;base64,${buf.toString("base64")}` : value;
        }
        case "text":
            return textFromServer(value);
        case "number":
            if (typeof value === "string") {
                const parsed = parseFloat(value);
                return isNaN(parsed) ? null : parsed;
            }
            return value;
        case "vector":
            return vectorEnvelope(value);
        case "timestamp":
        case "date":
            return dateEnvelope(value, false);
        case "time":
            return dateEnvelope(value, true);
        default:
            // A `jsonb` geopoint arrives as the object already; a boolean and
            // a type Rebase does not create are served as the driver returns them.
            return value;
    }
}

/** One block of a `json.oneOf` as the view model reads it: its value through the variant's shape. */
function parseOneOfBlock(block: unknown, shape: Extract<JsonShape, { kind: "oneOf" }>): unknown {
    if (block === null || typeof block !== "object" || Array.isArray(block)) return block;
    const record: Record<string, unknown> = { ...block };
    const variantName = record[shape.typeField];
    const variant = typeof variantName === "string" ? shape.variants[variantName] : undefined;
    if (!variant || typeof variantName !== "string") return block;
    return {
        [shape.typeField]: variantName,
        [shape.valueField]: parseJsonValue(record[shape.valueField], variant)
    };
}

/**
 * A value inside a JSON document as the view model reads it, walked by the
 * document's shape: a date as a `{ __type: "date" }` envelope, a number's text
 * as a number, a list coerced to one. A field the shape does not declare is
 * served as stored.
 */
function parseJsonValue(value: unknown, shape: JsonShape): unknown {
    if (value === null || value === undefined) return value;
    switch (shape.kind) {
        case "string":
            return textFromServer(value);
        case "number":
            return parseScalar(value, "number");
        case "date":
            return dateEnvelope(value, false);
        case "object": {
            if (typeof value !== "object") return value;
            const result: Record<string, unknown> = {};
            for (const [field, fieldValue] of Object.entries(value)) {
                const fieldShape = shape.fields[field];
                result[field] = fieldShape ? parseJsonValue(fieldValue, fieldShape) : fieldValue;
            }
            return result;
        }
        case "array": {
            const coerced = readList(value);
            if (coerced) return coerced;
            if (!Array.isArray(value)) return value;
            const items = shape.of;
            return items.kind === "oneOf"
                ? value.map(item => parseOneOfBlock(item, items))
                : value.map(item => parseJsonValue(item, items));
        }
        case "oneOf":
            return parseOneOfBlock(value, shape);
        default:
            return value;
    }
}

/**
 * One column's value as the admin's view model reads it, by the column's
 * Postgres type (`valueCodecOf`): a temporal value as `{ __type: "date" }`
 * (a `time` on 1970-01-01, UTC), a vector as `{ __type: "Vector" }`, `bytea`
 * as a `data:` URL, a number's text as a number, text as text, a native array
 * item by item, a JSON document walked by its shape. A `col.custom()` or
 * introspected type is served as the driver returns it.
 */
export function parseColumnFromServer(value: unknown, column: ColumnDescriptor): unknown {
    if (value === null || value === undefined) return value;
    const codec = valueCodecOf(column);
    switch (codec) {
        case "array": {
            const coerced = readList(value);
            if (coerced) return coerced;
            if (!Array.isArray(value)) return value;
            const element = column.type.kind === "array" ? valueCodecOfType(column.type.of) : "passthrough";
            return value.map(item => item === null || item === undefined ? item : parseScalar(item, element));
        }
        case "json":
            return column.json ? parseJsonValue(value, column.json) : value;
        default:
            return parseScalar(value, codec);
    }
}

/** A relation's stored key as the view model's relation ref; any other value as stored. */
function relationRefFromServer(value: unknown, relation: RelationDescriptor): unknown {
    if (typeof value === "string" || typeof value === "number") return createRelationRef(String(value), relation.target);
    return value;
}

/**
 * Shared internal helper: normalizes a DB row's values into the view model,
 * keyed on the table — each column through {@link parseColumnFromServer},
 * each relation key as a ref, query metadata as computed, anything the table
 * does not declare dropped.
 *
 * @param skipRelations  When `true`, relation keys are omitted from the result
 *                       (used by `normalizeDbValues` where Drizzle's
 *                       relational API already hydrates them).
 */
/**
 * Keys a query computes and attaches to a row, rather than reads from a column.
 *
 * An explicit set rather than a `_` prefix rule: a user's column may perfectly
 * well be called `_internal`, and passing it through here would put a value on
 * the row that no property describes and nothing downstream knows how to type.
 */
const QUERY_METADATA_KEYS = new Set(["_score", "_distance", "_matches"]);

function normalizeScalarValues<M extends Record<string, unknown>>(
    data: M,
    table: RuntimeTable,
    options: { skipRelations: boolean }
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
        // Query-computed metadata, which by definition is not a column. Dropped
        // here until now — which meant `_distance` was computed for every
        // vector search on this path and then discarded before the caller
        // ever saw it.
        if (QUERY_METADATA_KEYS.has(key)) {
            result[key] = value;
            continue;
        }

        const column = table.columnsByKey.get(key);
        if (column) {
            result[key] = parseColumnFromServer(value, column);
            continue;
        }

        const relation = table.relations.get(key);
        if (relation && !options.skipRelations) result[key] = relationRefFromServer(value, relation);
        // Anything else is not a column of the table: skipped.
    }

    return result;
}

/**
 * Lightweight value normalization for db.query results.
 * Only handles type coercion (dates, numbers, NaN) and property filtering.
 * Does NOT query the database for relations — those are already resolved
 * by Drizzle's relational query API.
 *
 * Use this instead of `parseDataFromServer` when processing results from
 * `db.query.findFirst/findMany` which return pre-hydrated relation data.
 */
export function normalizeDbValues<M extends Record<string, unknown>>(
    data: M,
    table: RuntimeTable
): M {
    if (!data) return data;
    return normalizeScalarValues(data, table, { skipRelations: true }) as M;
}
