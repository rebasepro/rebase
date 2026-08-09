import { CollectionConfig, type Property, type ResolvedBelongsTo } from "@rebasepro/types";
import { fieldKeyForColumn, resolveCollectionRelations, resolvePrimaryKeys } from "@rebasepro/common";
import { ApiError } from "../errors";

/**
 * Reject a write naming a field the collection does not have.
 *
 * An unknown key does *not* reach the INSERT and come back as `column "titel"
 * does not exist`, which is what this comment used to claim. Drizzle builds
 * INSERT and UPDATE from the table's own column list, so a key the table does
 * not carry is left out of the statement: the write answers 201 having stored
 * nothing under that name. A typo is a request problem, it belongs in a 400,
 * and nothing below this was ever going to raise one.
 *
 * This is the config-level check and it is skipped on several paths (see the
 * `strictWrites` bail below, and the auth-adapter contract at the call site).
 * `assertWritableColumns` in the Postgres driver is the backstop every write
 * passes through, including in-process `rebase.data` writes that never come
 * near this layer.
 *
 * What counts as known:
 * - a declared property (for an introspected BaaS collection these *are* the
 *   columns, so the set is exact);
 * - the foreign-key column behind an owning relation, which callers may write
 *   directly instead of through the relation property;
 * - anything named in `options.extraKnownFields` — for an auth collection the
 *   credential keys the auth adapter consumes before a row is ever built;
 * - nothing else. `id` in particular is not automatically known — see below.
 */
export function assertKnownWriteFields(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    options?: { rowIndex?: number; extraKnownFields?: readonly string[] }
): void {
    // The opt-out lets a key through that this config does not describe; the
    // driver still requires a real column behind it.
    if (collection.strictWrites === false) return;

    // A collection that declares no properties describes nothing, so there is
    // nothing to check against — "no declared fields" is not the same claim as
    // "no fields are allowed", and reading it as the latter would turn every
    // write to such a collection into a 400. The driver's column check has the
    // last word.
    if (!collection.properties || Object.keys(collection.properties).length === 0) return;

    const known = new Set<string>(Object.keys(collection.properties));

    // An owning relation stores its target in a local FK column that usually
    // has no property of its own; writing it directly is legitimate. Under its
    // *wire* name — `authorId` — which is the key the row is served under and
    // therefore the only one a caller can be expected to send back.
    for (const relation of Object.values(resolveCollectionRelations(collection))) {
        if (relation.kind === "belongsTo") {
            known.add(fieldKeyForColumn(collection, (relation as ResolvedBelongsTo).localKey));
        }
    }

    for (const field of options?.extraKnownFields ?? []) known.add(field);

    const unknown = Object.keys(values).filter(key => !known.has(key));
    if (unknown.length === 0) return;

    const where = options?.rowIndex !== undefined ? `Row ${options.rowIndex}: ` : "";

    // The `id` case is worth its own sentence, because the caller almost
    // certainly did not choose to send it — `create(data, id)` puts it there,
    // which is right for a table keyed on `id` and meaningless for any other.
    if (unknown.includes("id") && !known.has("id")) {
        const keys = Object.entries(collection.properties ?? {})
            .filter(([, prop]) => "isId" in (prop as object) && Boolean((prop as { isId?: unknown }).isId))
            .map(([name]) => `'${name}'`);
        const keyDesc = keys.length > 0 ? keys.join(" + ") : "its own key column";
        throw ApiError.badRequest(
            `${where}'${collection.slug}' has no 'id' column — it is keyed on ${keyDesc}. ` +
            `The \`id\` argument of \`create(data, id)\` is written as an \`id\` column, so for this ` +
            `collection put the key in \`data\` instead.`,
            "VALIDATION_UNKNOWN_FIELDS"
        );
    }

    throw ApiError.badRequest(
        `${where}'${collection.slug}' has no field${unknown.length > 1 ? "s" : ""} ` +
        `${unknown.map(f => `'${f}'`).join(", ")}. ` +
        `Known fields: ${[...known].sort().map(f => `'${f}'`).join(", ")}.`,
        "VALIDATION_UNKNOWN_FIELDS"
    );
}

/**
 * The number a constraint should judge, or `undefined` if the value is not one.
 *
 * A JSON body may carry `"5"` for a number column and Postgres accepts it, so
 * the string form is judged too — refusing to look at it would leave the exact
 * bypass this function exists to close.
 */
function asNumber(value: unknown): number | undefined {
    if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

/** The instant a constraint should judge, or `undefined` if the value is not one. */
function asDate(value: unknown): Date | undefined {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
}

/**
 * `validation.matches` as a regex that can be tested repeatedly.
 *
 * A `RegExp` carrying `g` or `y` keeps `lastIndex` between calls, so the same
 * pattern would accept and reject the same value on alternate rows of a bulk
 * write. Rebuilt without those flags.
 */
function toPattern(matches: string | RegExp): RegExp | undefined {
    try {
        if (typeof matches === "string") return new RegExp(matches);
        return new RegExp(matches.source, matches.flags.replace(/[gy]/g, ""));
    } catch {
        // A pattern the config author wrote wrong is their bug, not the
        // caller's; refusing every write over it would be the wrong blame.
        return undefined;
    }
}

function collectViolations(
    key: string,
    property: Property,
    value: unknown,
    into: string[]
): void {
    // `null` states a value's absence, and whether that is allowed is
    // `required`'s question — which the database answers with NOT NULL. A range
    // has nothing to say about a value that is not there.
    if (value === null || value === undefined) return;

    switch (property.type) {
        case "string": {
            const rules = property.validation;
            if (!rules || typeof value !== "string") return;
            if (rules.length !== undefined && value.length !== rules.length) {
                into.push(`'${key}' must be exactly ${rules.length} character${rules.length === 1 ? "" : "s"} long (received ${value.length}).`);
            }
            if (rules.min !== undefined && value.length < rules.min) {
                into.push(`'${key}' must be at least ${rules.min} character${rules.min === 1 ? "" : "s"} long (received ${value.length}).`);
            }
            if (rules.max !== undefined && value.length > rules.max) {
                into.push(`'${key}' must be at most ${rules.max} character${rules.max === 1 ? "" : "s"} long (received ${value.length}).`);
            }
            if (rules.matches !== undefined) {
                const pattern = toPattern(rules.matches);
                // The value is not echoed: a pattern usually guards an
                // identifier, a token or a phone number, and the message ends
                // up in logs.
                if (pattern && !pattern.test(value)) {
                    into.push(rules.matchesMessage ?? `'${key}' does not match the required pattern ${pattern}.`);
                }
            }
            return;
        }

        case "number": {
            const rules = property.validation;
            if (!rules) return;
            const num = asNumber(value);
            if (num === undefined) return;
            if (rules.integer && !Number.isInteger(num)) into.push(`'${key}' must be a whole number (received ${num}).`);
            if (rules.positive && !(num > 0)) into.push(`'${key}' must be positive (received ${num}).`);
            if (rules.negative && !(num < 0)) into.push(`'${key}' must be negative (received ${num}).`);
            if (rules.min !== undefined && num < rules.min) into.push(`'${key}' must be at least ${rules.min} (received ${num}).`);
            if (rules.max !== undefined && num > rules.max) into.push(`'${key}' must be at most ${rules.max} (received ${num}).`);
            if (rules.moreThan !== undefined && !(num > rules.moreThan)) into.push(`'${key}' must be greater than ${rules.moreThan} (received ${num}).`);
            if (rules.lessThan !== undefined && !(num < rules.lessThan)) into.push(`'${key}' must be less than ${rules.lessThan} (received ${num}).`);
            return;
        }

        case "date": {
            const rules = property.validation;
            if (!rules) return;
            const date = asDate(value);
            if (date === undefined) return;
            const min = rules.min !== undefined ? asDate(rules.min) : undefined;
            const max = rules.max !== undefined ? asDate(rules.max) : undefined;
            if (min && date.getTime() < min.getTime()) into.push(`'${key}' must not be before ${min.toISOString()}.`);
            if (max && date.getTime() > max.getTime()) into.push(`'${key}' must not be after ${max.toISOString()}.`);
            return;
        }

        case "array": {
            if (!Array.isArray(value)) return;
            const rules = property.validation;
            if (rules?.min !== undefined && value.length < rules.min) {
                into.push(`'${key}' must have at least ${rules.min} item${rules.min === 1 ? "" : "s"} (received ${value.length}).`);
            }
            if (rules?.max !== undefined && value.length > rules.max) {
                into.push(`'${key}' must have at most ${rules.max} item${rules.max === 1 ? "" : "s"} (received ${value.length}).`);
            }
            // The generated OpenAPI puts the element schema in `items`, so the
            // element rules are published too and have to hold.
            const of = property.of;
            if (of && !Array.isArray(of)) {
                value.forEach((item, index) => collectViolations(`${key}[${index}]`, of as Property, item, into));
            }
            return;
        }

        case "map": {
            if (typeof value !== "object" || value === null || Array.isArray(value)) return;
            const properties = property.properties;
            if (!properties) return;
            for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
                const subProperty = (properties as Record<string, Property>)[subKey];
                if (subProperty) collectViolations(`${key}.${subKey}`, subProperty, subValue, into);
            }
            return;
        }

        default:
            // boolean, geopoint, relation, reference, vector, binary carry only
            // `required`/`unique`, both of which the database enforces.
    }
}

/**
 * Reject a write whose values break the constraints the collection declares.
 *
 * `validation.min`, `max`, `matches`, `positive`, `integer` and the date and
 * array bounds were read by exactly three things: the DDL generators (for
 * `integer` and for a `varchar` width), and the admin's client-side form. No
 * layer on the write path looked at them, no `CHECK` constraint was emitted,
 * and the generated OpenAPI published every one of them as `minimum`,
 * `maximum`, `minLength`, `maxLength` and `pattern`. So the docs' own example —
 * `price: { type: "number", validation: { min: 0 } }` — accepted `-5000` with a
 * 201 while the spec said it would not, and any client or gateway generated
 * from that spec believed the server was checking.
 *
 * Only `required` is left to the database, where it is a NOT NULL: a partial
 * update legitimately omits keys, and this function sees one request's values,
 * not the row they land on.
 *
 * A value of the wrong *type* is not this function's business — that reaches
 * Postgres, which types every column and gives a 400 through the driver's
 * SQLSTATE mapping. Constraints are checked against values of the right type,
 * plus the numeric-string form a JSON body may carry for a number column.
 *
 * Every failing field is reported at once. A form that fixes one field per
 * round trip is the reason validation errors get ignored.
 */
export function assertWriteValuesValid(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    options?: { rowIndex?: number }
): void {
    const properties = collection.properties;
    if (!properties || !values) return;

    const violations: string[] = [];
    for (const [key, value] of Object.entries(values)) {
        const property = (properties as Record<string, Property>)[key];
        if (property) collectViolations(key, property, value, violations);
    }

    if (violations.length === 0) return;

    const where = options?.rowIndex !== undefined ? `Row ${options.rowIndex}: ` : "";
    throw ApiError.badRequest(
        `${where}${violations.join(" ")}`,
        "VALIDATION_CONSTRAINT",
        { collection: collection.slug,
violations }
    );
}

/**
 * Narrow response rows to the fields the caller asked for.
 *
 * `?fields=id,title` is documented in the generated OpenAPI — "Comma-separated
 * list of fields to return (field selection)" — and it is the first thing shown
 * on every endpoint in the API Explorer. It was parsed into `options.fields`
 * and then read by nothing at all: no driver referenced it, and every request
 * came back with every column. A caller asking for two fields of a `posts` row
 * still received its whole `content`.
 *
 * This shapes the *response*, which is what the parameter says it does; it is
 * not a column pushdown, so it saves bandwidth rather than database work.
 *
 * The collection's key always survives. Rows are addressed by it everywhere
 * above this layer — the admin table, realtime reconciliation, the offline
 * cache — and a row that arrives without one is not a smaller row, it is an
 * unusable one. Asking for `fields=title` and being unable to open the record
 * you clicked is a worse answer than one extra key.
 *
 * That is a statement about the key, not about the name `id`: a collection
 * keyed on `slug`, or on `user_id + role_id`, was projected down to the fields
 * asked for and nothing else, which is the very outcome the paragraph above
 * describes. `assertKnownWriteFields` one function up already has a dedicated
 * error for collections with no `id` column, so this layer had no excuse for
 * assuming one.
 */
export function projectResponseFields<T extends Record<string, unknown>>(
    rows: T[],
    fields: readonly string[] | undefined,
    collection: CollectionConfig,
    options?: { include?: readonly string[] }
): T[] {
    if (!fields || fields.length === 0) return rows;

    const declared = new Set<string>(Object.keys(collection.properties ?? {}));
    // The record is keyed by the property name the relation is reached under,
    // which is the name a caller would put in `fields`.
    for (const [key, relation] of Object.entries(resolveCollectionRelations(collection))) {
        declared.add(key);
        if (relation.kind === "belongsTo") {
            declared.add(fieldKeyForColumn(collection, (relation as ResolvedBelongsTo).localKey));
        }
    }
    // `include` decides what is *loaded*; `fields` decides what is *returned*.
    // So `include=author&fields=title,author` yields both, and naming the
    // relation in `fields` without including it yields nothing for it — there
    // was nothing fetched to return. Included names are accepted here so that
    // a relation reached only through `include` (one the collection does not
    // declare as a property) is not rejected as unknown.
    for (const included of options?.include ?? []) declared.add(included);
    declared.add("id");

    // A collection that declares nothing describes nothing to check against —
    // the same reasoning `assertKnownWriteFields` applies one function up.
    if (declared.size > 1) {
        const unknown = fields.filter(field => !declared.has(field));
        if (unknown.length > 0) {
            throw ApiError.badRequest(
                `'${collection.slug}' has no field${unknown.length > 1 ? "s" : ""} ` +
                `${unknown.map(f => `'${f}'`).join(", ")} to return. ` +
                `Known fields: ${[...declared].sort().map(f => `'${f}'`).join(", ")}.`,
                "UNKNOWN_RESPONSE_FIELD",
                { fields: unknown, collection: collection.slug }
            );
        }
    }

    // Whatever addresses a row here. `resolvePrimaryKeys` returns nothing when
    // a collection declares no key at all; drivers other than Postgres still
    // serve rows with a literal `id`, so that stays the fallback.
    const primaryKeys = resolvePrimaryKeys(collection).map(key => key.fieldName);
    const keep = new Set<string>([...fields, ...(primaryKeys.length > 0 ? primaryKeys : ["id"])]);
    return rows.map(row => {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(row)) {
            if (keep.has(key)) projected[key] = row[key];
        }
        return projected as T;
    });
}
