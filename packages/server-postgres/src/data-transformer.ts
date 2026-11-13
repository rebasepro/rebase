import { isPrototypePollutingKey } from "@rebasepro/utils";
import { ApiError } from "@rebasepro/server";
import type { ColumnDescriptor, ColumnType, JsonShape } from "@rebasepro/types";
import { columnTypeLabel } from "@rebasepro/types";
import { valueCodecOf, valueCodecOfType, type ValueCodec } from "@rebasepro/common";
import type { RuntimeTable } from "./model/runtime-table";

/**
 * The write codec: a row on its way into Postgres. (The read side is
 * `services/row-pipeline.ts` `toRestRow` — the one row shape every read serves.)
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
        /** The relation's name on the written table. */
        relationKey: string;
        newValue: unknown;
    }>;
    /** JoinPath relation updates that require multi-hop writes. */
    joinPathRelationUpdates: Array<{
        /** The `via` relation's name on the written table. */
        relationKey: string;
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
 * A to-one link is written as the related row's key (or `null`); a value
 * of any other shape is a 400 ({@link linkKey}).
 *
 * Read from the table: which keys are columns, which are relations, and what
 * each column's Postgres type is. A key the table does not declare is kept as
 * sent; the catalogue check (`assertWritableColumns`) refuses it later.
 */
export function serializeDataToServer<M extends Record<string, unknown>>(
    row: M,
    table: RuntimeTable
): SerializedEntityData {
    if (!row) return { scalarData: {},
inverseRelationUpdates: [],
joinPathRelationUpdates: [] };

    const result: Record<string, unknown> = {};

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
            const label = `'${table.slug}.${key}'`;
            if (relation.kind === "belongsTo") {
                // Owning relation: the related row's key becomes the foreign
                // key, under its key — Drizzle maps it back to the column.
                result[relation.localField] = linkKey(effectiveValue, label, relation.target);
                continue;
            }
            if (relation.kind === "hasOne") {
                // Inverse relation: the target table's foreign key is updated.
                inverseRelationUpdates.push({ relationKey: key, newValue: linkKey(effectiveValue, label, relation.target) });
                continue;
            }
            if (relation.kind === "via" && relation.cardinality === "one") {
                // Ordering matters: PersistService applies these BEFORE the
                // main UPDATE, so the mapping reads the pre-update foreign key
                // rather than a value the same save changed.
                joinPathRelationUpdates.push({ relationKey: key, newTargetId: linkKey(effectiveValue, label, relation.target) });
                continue;
            }
            // A membership (`hasMany`, `manyToMany`, a to-many `via`): its
            // elements — keys, or `{ id, _pivot }` — are read where it is
            // written (`RelationWriteService`).
            inverseRelationUpdates.push({ relationKey: key, newValue: effectiveValue });
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

/**
 * A to-one link as it is written: the related row's key, or `null` to unlink
 * (`""` too, as a cleared form field sends it). Anything else is a 400 — a
 * relation object (`{ id }`, the admin panel's view model of a row) is not
 * what the API takes, and writing it would hand Postgres an object as a key.
 */
function linkKey(value: unknown, label: string, target: string): string | number | null {
    if (value === null || value === "") return null;
    if (typeof value === "string" || typeof value === "number") return value;
    throw ApiError.badRequest(
        `${label} links one '${target}' row: write that row's key (a string or a number), or null to unlink — ` +
        `not ${describeValue(value)}.`,
        "VALIDATION_INVALID_VALUE"
    );
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
    // A read serves a stored row as the database holds it (`toRestRow`): a
    // row already in the database is not this caller's fault.
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

/** A vector as pgvector takes it: a list of numbers, or a 400. */
function serializeVector(value: unknown, label: string): number[] {
    if (!Array.isArray(value)) {
        throw ApiError.badRequest(
            `${label} expects a vector as a list of numbers, but received ${describeValue(value)}.`,
            "VALIDATION_INVALID_VALUE"
        );
    }
    return value.map(Number);
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
            return serializeVector(value, label);
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
 * - a vector checked to be a list of numbers (400 otherwise);
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
 * Try to decode a `data:application/octet-stream;base64,...` data URL string
 * into a Buffer. Returns null if the value is not a matching data URL.
 */
function tryDecodeBase64DataUrl(value: unknown): Buffer | null {
    if (typeof value !== "string") return null;
    if (!value.startsWith("data:application/octet-stream;base64,")) return null;
    const base64Data = value.split(",")[1];
    return base64Data ? Buffer.from(base64Data, "base64") : null;
}

