import { CollectionConfig, JUNCTION_PIVOT_KEY, isManyToMany, type EnumValues, type Property, type ResolvedBelongsTo } from "@rebasepro/types";
import {
    type FieldViewer,
    canWriteField,
    effectiveAccess,
    enumToObjectEntries,
    fieldKeyForColumn,
    getJunctionConfigForRelation,
    resolveCollectionRelations,
    resolvePrimaryKeys,
    restrictedFieldNames
} from "@rebasepro/common";
import { hydrateRegExp } from "@rebasepro/utils";
import { ApiError } from "../errors";

/**
 * The relations of `collection` that reach through a junction carrying its own
 * columns, each with the synthetic collection those columns are declared on.
 *
 * Keyed by the relation's wire name, which is what a membership write names
 * (`{ tags: [...] }`). A junction with no `through.properties` is not here at
 * all: there is nothing a `_pivot` could legally say about it, and the write
 * path refuses one with the relation named.
 */
function junctionsWithPayload(collection: CollectionConfig): Array<[string, CollectionConfig]> {
    const out: Array<[string, CollectionConfig]> = [];
    for (const [key, relation] of Object.entries(resolveCollectionRelations(collection))) {
        if (!isManyToMany(relation)) continue;
        if (Object.keys(relation.through.properties).length === 0) continue;
        out.push([key, getJunctionConfigForRelation(relation.through)]);
    }
    return out;
}

/**
 * The `_pivot` objects in a membership value, with the index each came from.
 *
 * Tolerant on purpose: a value that is not an array, an element that is a bare
 * id, and a `_pivot` that is not an object are all *someone else's* error to
 * report — `relationLinkElements` in the driver refuses an element with no id,
 * and a non-object `_pivot` is refused where it is serialized. Reporting them
 * twice, differently, is how two layers come to disagree about what a request
 * meant.
 */
function pivotsIn(value: unknown): Array<{ index: number; pivot: Record<string, unknown> }> {
    if (!Array.isArray(value)) return [];
    const out: Array<{ index: number; pivot: Record<string, unknown> }> = [];
    value.forEach((element, index) => {
        if (!element || typeof element !== "object" || Array.isArray(element)) return;
        const pivot = (element as Record<string, unknown>)[JUNCTION_PIVOT_KEY];
        if (!pivot || typeof pivot !== "object" || Array.isArray(pivot)) return;
        out.push({ index, pivot: pivot as Record<string, unknown> });
    });
    return out;
}

/**
 * The two ways a field can be closed to a write, told apart.
 *
 * `excluded` is `access.write: []` — the server's own column, closed to every
 * caller at every privilege, which is what `excludeFromApi` expands to.
 * `unwritable` is a non-empty role list this caller does not satisfy. They are
 * one rule and two answers: the first is a property of the *collection* and the
 * same for everybody, the second is a property of the *caller* and would be a
 * 200 for their colleague. A client that retries after acquiring a role should
 * be able to tell which it hit without parsing English.
 */
function closedWriteNames(
    collection: CollectionConfig,
    viewer: FieldViewer | undefined
): { excluded: Set<string>; unwritable: Map<string, string>; declared: string[] } {
    const excluded = new Set<string>();
    const unwritable = new Map<string, string>();
    const declared: string[] = [];

    for (const [name, property] of Object.entries(collection.properties ?? {})) {
        const access = effectiveAccess(property as Property);
        if (!access || access.write === undefined) continue;
        if (canWriteField(property as Property, viewer)) continue;

        declared.push(name);
        const columnName = (property as Property).columnName;
        const spellings = columnName ? [name, columnName] : [name];
        if (access.write.length === 0) {
            for (const spelling of spellings) excluded.add(spelling);
        } else {
            for (const spelling of spellings) unwritable.set(spelling, name);
        }
    }
    return { excluded, unwritable, declared };
}

/**
 * Refuse a write naming a field this caller may not set.
 *
 * `excludeFromApi` means what the generated SDK already says it means: "absent
 * from Row, Insert and Update — the API surface does not mention it, in either
 * direction". The server only ever enforced the read half, so the column a
 * collection had declared unservable was still writable by anyone whose
 * policies let them write the row.
 *
 * On the user store that is the sharp one. `users_write_own` lets you update
 * your own row, `password_hash` is a column on it, and setting it directly is a
 * password change that does not need the old password — so a stolen access
 * token, which expires within the hour, becomes a password the attacker chose.
 * Everything else the flag protects is the same shape: a verification token, a
 * rotation counter, a secret the server owns.
 *
 * `access.write: ["editor"]` is the same rule with a role list instead of an
 * empty one, and answers `FIELD_NOT_WRITABLE` rather than
 * `VALIDATION_EXCLUDED_FIELDS`. Both refuse rather than dropping the key: a
 * write that silently discards a field reports success for an edit that did not
 * happen, which is the one outcome a form cannot recover from.
 *
 * The empty-list half is refused for every caller, not only unprivileged ones,
 * and regardless of `strictWrites`. The framework's own auth paths do not come
 * through here — `prepareUserCreation` builds the row itself — so what is left
 * is callers the rule was written to exclude.
 */
function assertNoClosedFields(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    where: string,
    viewer: FieldViewer | undefined
): void {
    const { excluded, unwritable } = closedWriteNames(collection, viewer);
    if (excluded.size === 0 && unwritable.size === 0) return;

    const named = Object.keys(values).filter(key => excluded.has(key));
    if (named.length > 0) {
        // Named separately from "no such field", because it is a different fact
        // and the generic message would send the reader looking for a typo in a
        // name that is spelled correctly.
        throw ApiError.badRequest(
            `${where}${named.map(f => `'${f}'`).join(", ")} ` +
            `${named.length > 1 ? "are" : "is"} excluded from the API on '${collection.slug}' ` +
            `and cannot be written through it. ${named.length > 1 ? "These columns are" : "This column is"} ` +
            "the server's to set.",
            "VALIDATION_EXCLUDED_FIELDS",
            { collection: collection.slug, fields: named }
        );
    }

    const refused = Object.keys(values).filter(key => unwritable.has(key));
    if (refused.length === 0) return;

    // The wire name the caller sent, in `field`, so a form can mark the input it
    // owns rather than the property key it may never have seen.
    const violations: WriteViolation[] = refused.map(field => ({
        field,
        code: "access",
        message: `'${field}' on '${collection.slug}' is not writable with your roles.`
    }));
    throw ApiError.badRequest(
        `${where}${violations.map(v => v.message).join(" ")}`,
        "FIELD_NOT_WRITABLE",
        {
            collection: collection.slug,
            fields: refused,
            violations,
            messages: violations.map(v => v.message)
        }
    );
}

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
    options?: { rowIndex?: number; extraKnownFields?: readonly string[]; viewer?: FieldViewer }
): void {
    // A collection that declares no properties describes nothing, so there is
    // nothing to check against — "no declared fields" is not the same claim as
    // "no fields are allowed", and reading it as the latter would turn every
    // write to such a collection into a 400. The driver's column check has the
    // last word.
    if (!collection.properties || Object.keys(collection.properties).length === 0) return;

    const where = options?.rowIndex !== undefined ? `Row ${options.rowIndex}: ` : "";

    // Checked BEFORE the `strictWrites` opt-out, and that ordering is the whole
    // point of hoisting it.
    //
    // `strictWrites: false` says one thing: "this config does not list every
    // column, so do not reject a key merely because I did not declare it". It
    // is a convenience flag, set on introspected and hand-written configs all
    // the time. It was also the single early return standing above every other
    // rule in this function, so switching it off also switched off the refusal
    // below — and that refusal is a *security* rule, not a typo check. A
    // convenience flag must not be able to turn off a security rule; the two
    // facts are unrelated.
    assertNoClosedFields(values, collection, where, options?.viewer);

    // The opt-out lets a key through that this config does not describe; the
    // driver still requires a real column behind it.
    if (collection.strictWrites === false) return;

    const known = new Set<string>(Object.keys(collection.properties));

    // A field this caller cannot write is not among the fields they may name,
    // so it is absent from the "Known fields:" list the error prints. That list
    // is an offer, and offering a field the next request would refuse is worse
    // than saying nothing.
    for (const name of restrictedFieldNames(collection, options?.viewer, "write").declared) {
        known.delete(name);
    }

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

    // A membership element may name the link's own columns under `_pivot`. They
    // belong to the junction, not to this collection, so they are checked
    // against the junction's properties — by the same function, so a payload
    // column with `access.write: ["admin"]` or `excludeFromApi` is refused on
    // exactly the terms a collection column with the same declaration is.
    for (const [key, junction] of junctionsWithPayload(collection)) {
        for (const { pivot } of pivotsIn(values[key])) {
            assertKnownWriteFields(pivot, junction, { viewer: options?.viewer });
        }
    }

    const unknown = Object.keys(values).filter(key => !known.has(key));
    if (unknown.length === 0) return;

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
 *
 * A *string* `matches` is hydrated with the same `hydrateRegExp` the admin form
 * uses, so `"/^[A-Z]{2}$/i"` means one thing on both sides. `new RegExp(str)`
 * read that serialized form literally: the leading and trailing slashes became
 * characters the value had to contain, and the `i` became a letter — so a
 * pattern the form accepted `US` under was one the server rejected `US` under,
 * and the only value that passed was the impossible `/us/i`-shaped literal. The
 * serialized spelling is not exotic: `serializeRegExp` in `@rebasepro/utils`
 * produces exactly it, and every config that round-trips through the Studio's
 * collection editor stores `matches` that way.
 */
function toPattern(matches: string | RegExp): RegExp | undefined {
    try {
        if (typeof matches === "string") {
            const hydrated = hydrateRegExp(matches);
            if (!hydrated) return undefined;
            // Same flag strip as below: hydration preserves whatever flags were
            // serialized, `g` and `y` included.
            return new RegExp(hydrated.source, hydrated.flags.replace(/[gy]/g, ""));
        }
        return new RegExp(matches.source, matches.flags.replace(/[gy]/g, ""));
    } catch {
        // A pattern the config author wrote wrong is their bug, not the
        // caller's; refusing every write over it would be the wrong blame.
        //
        // Which leaves the rule silently not running, so this is no longer
        // where the problem is caught: `checkValidationPattern` in
        // `collections/validate-config.ts` compiles every `matches` at boot and
        // refuses to start on one that will not. A booted server does not reach
        // this branch, and it stays lenient for the paths that build a config
        // by hand.
        return undefined;
    }
}

/**
 * One broken rule, in the shape a client can branch on.
 *
 * `field` is the **wire** name — the property key, dotted through maps and
 * indexed through arrays (`address.zip`, `tags[2]`) — because that is the name
 * the caller sent and the only one they can map back onto their form. `code` is
 * stable and machine-readable; `message` is the sentence a human reads. A form
 * that has to regex-match an English sentence to find out which input to mark
 * red is a form that will break on the first wording change.
 */
export interface WriteViolation {
    field: string;
    code: string;
    message: string;
}

/** The ids an `EnumValues` accepts, compared as strings. */
function enumIds(values: EnumValues): string[] {
    return enumToObjectEntries(values)
        .filter(entry => entry && (entry.id || entry.id === 0))
        .map(entry => String(entry.id));
}

/**
 * A deliberately plain email shape: something, `@`, something with a dot.
 *
 * Not RFC 5322 — that grammar accepts addresses no mail server will deliver to
 * and is not what `format: "email"` in the published OpenAPI leads anyone to
 * expect. This rejects the mistakes people actually make (a missing `@`, a bare
 * hostname, whitespace) and accepts everything deliverable.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Is this an absolute URL — the thing `format: "uri"` promises? */
function isAbsoluteUrl(value: string): boolean {
    try {
        // Rejects `/images/a.png` and `example.com`, which is the point: a
        // relative reference is not a URL a consumer of the row can fetch.
        return Boolean(new URL(value).protocol);
    } catch {
        return false;
    }
}

function collectViolations(
    key: string,
    property: Property,
    value: unknown,
    into: WriteViolation[]
): void {
    // `null` states a value's absence, and whether that is allowed is
    // `required`'s question — which the database answers with NOT NULL. A range
    // has nothing to say about a value that is not there.
    if (value === null || value === undefined) return;

    switch (property.type) {
        case "string": {
            if (typeof value !== "string") return;

            // Enum membership. Postgres does enforce it for a real `enum`
            // column — as `22P02`, which aborts the transaction and is rendered
            // to the caller as `Invalid data format in "posts".` with no field
            // named. Where the column is plain `text` (an introspected table, a
            // `text[]` of enum values) nothing enforced it at all and the row
            // stored a label the collection does not define. Checked here so
            // both spellings answer the same 400, naming the field and the
            // labels it accepts.
            if (property.enum) {
                const ids = enumIds(property.enum);
                if (ids.length > 0 && !ids.includes(value)) {
                    into.push({
                        field: key,
                        code: "enum",
                        // The value is echoed because an enum label is a
                        // *declared* constant, not caller data: it is already
                        // in the config, the OpenAPI and the generated SDK.
                        message: `'${key}' must be one of ${ids.map(id => `'${id}'`).join(", ")} (received '${value}').`
                    });
                }
            }

            // `email` and `url` are published as `format: "email"` / `"uri"` in
            // the generated OpenAPI, so every client and gateway built from that
            // spec believed the server was checking. It was not.
            if (property.email && value !== "" && !EMAIL_SHAPE.test(value)) {
                into.push({ field: key, code: "email", message: `'${key}' must be an email address.` });
            }
            if (property.url && value !== "" && !isAbsoluteUrl(value)) {
                into.push({ field: key, code: "url", message: `'${key}' must be an absolute URL, including the scheme (e.g. https://).` });
            }

            const rules = property.validation;
            if (!rules) return;
            if (rules.length !== undefined && value.length !== rules.length) {
                into.push({ field: key, code: "length", message: `'${key}' must be exactly ${rules.length} character${rules.length === 1 ? "" : "s"} long (received ${value.length}).` });
            }
            if (rules.min !== undefined && value.length < rules.min) {
                into.push({ field: key, code: "min_length", message: `'${key}' must be at least ${rules.min} character${rules.min === 1 ? "" : "s"} long (received ${value.length}).` });
            }
            if (rules.max !== undefined && value.length > rules.max) {
                into.push({ field: key, code: "max_length", message: `'${key}' must be at most ${rules.max} character${rules.max === 1 ? "" : "s"} long (received ${value.length}).` });
            }
            if (rules.matches !== undefined) {
                const pattern = toPattern(rules.matches);
                // The value is not echoed: a pattern usually guards an
                // identifier, a token or a phone number, and the message ends
                // up in logs.
                if (pattern && !pattern.test(value)) {
                    into.push({ field: key, code: "pattern", message: rules.matchesMessage ?? `'${key}' does not match the required pattern ${pattern}.` });
                }
            }
            return;
        }

        case "number": {
            const num = asNumber(value);
            if (num === undefined) return;

            // Same rule as the string case. A number enum is stored in an
            // ordinary integer column, so nothing anywhere rejected `99` for a
            // property whose declared ids are 1, 2 and 3.
            if (property.enum) {
                const ids = enumIds(property.enum);
                if (ids.length > 0 && !ids.includes(String(num))) {
                    into.push({
                        field: key,
                        code: "enum",
                        message: `'${key}' must be one of ${ids.join(", ")} (received ${num}).`
                    });
                }
            }

            const rules = property.validation;
            if (!rules) return;
            if (rules.integer && !Number.isInteger(num)) into.push({ field: key, code: "integer", message: `'${key}' must be a whole number (received ${num}).` });
            if (rules.positive && !(num > 0)) into.push({ field: key, code: "positive", message: `'${key}' must be positive (received ${num}).` });
            if (rules.negative && !(num < 0)) into.push({ field: key, code: "negative", message: `'${key}' must be negative (received ${num}).` });
            if (rules.min !== undefined && num < rules.min) into.push({ field: key, code: "min", message: `'${key}' must be at least ${rules.min} (received ${num}).` });
            if (rules.max !== undefined && num > rules.max) into.push({ field: key, code: "max", message: `'${key}' must be at most ${rules.max} (received ${num}).` });
            if (rules.moreThan !== undefined && !(num > rules.moreThan)) into.push({ field: key, code: "more_than", message: `'${key}' must be greater than ${rules.moreThan} (received ${num}).` });
            if (rules.lessThan !== undefined && !(num < rules.lessThan)) into.push({ field: key, code: "less_than", message: `'${key}' must be less than ${rules.lessThan} (received ${num}).` });
            return;
        }

        case "date": {
            const rules = property.validation;
            if (!rules) return;
            const date = asDate(value);
            if (date === undefined) return;
            const min = rules.min !== undefined ? asDate(rules.min) : undefined;
            const max = rules.max !== undefined ? asDate(rules.max) : undefined;
            if (min && date.getTime() < min.getTime()) into.push({ field: key, code: "date_min", message: `'${key}' must not be before ${min.toISOString()}.` });
            if (max && date.getTime() > max.getTime()) into.push({ field: key, code: "date_max", message: `'${key}' must not be after ${max.toISOString()}.` });
            return;
        }

        case "array": {
            if (!Array.isArray(value)) return;
            const rules = property.validation;
            if (rules?.min !== undefined && value.length < rules.min) {
                into.push({ field: key, code: "min_items", message: `'${key}' must have at least ${rules.min} item${rules.min === 1 ? "" : "s"} (received ${value.length}).` });
            }
            if (rules?.max !== undefined && value.length > rules.max) {
                into.push({ field: key, code: "max_items", message: `'${key}' must have at most ${rules.max} item${rules.max === 1 ? "" : "s"} (received ${value.length}).` });
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
 * Does the write itself supply this property, or does something else?
 *
 * `required` on create is only a real requirement for keys the *caller* has to
 * send. A key column the database generates, a `defaultValue` the create path
 * fills in, an `autoValue` timestamp the driver stamps, and a column
 * `excludeFromApi` reserves for the server are all values that exist by the
 * time the INSERT runs — demanding them in the request would refuse writes that
 * are entirely correct.
 */
function isCallerSupplied(property: Property): boolean {
    const p = property as Property & {
        isId?: unknown;
        autoValue?: unknown;
        excludeFromApi?: boolean;
        defaultValue?: unknown;
    };
    if (p.isId) return false;
    if (p.autoValue) return false;
    if (p.excludeFromApi) return false;
    if (p.defaultValue !== undefined) return false;
    return true;
}

/**
 * Collect the `required` properties a create leaves unset.
 *
 * `required` used to be left entirely to the database's NOT NULL, and that is
 * two problems rather than one. The 400 names the *column* (`author_id`), not
 * the field the caller sent (`authorId`); and it arrives only after every
 * `beforeSave` hook has run, so a hook that charged a card or sent a mail did so
 * for a write that was never going to land. `23502` is still the backstop for
 * everything this cannot see — a hook that nulls a column, a concurrent schema
 * change — and it now carries a field too (see the pg error renderer).
 *
 * A `belongsTo` relation is satisfied by either spelling: the relation property
 * (`author`) or the foreign-key column under its wire name (`authorId`). Both
 * put the same value in the same column.
 */
function collectMissingRequired(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    into: WriteViolation[],
    /** Prefix for the reported field path, for values nested under a `_pivot`. */
    at?: string
): void {
    // A `beforeSave` can supply a required field, and this runs before it. The
    // canonical case is a slug derived from a title — the reference app's own
    // `posts` does exactly that — and demanding `slug` in the request refuses a
    // write that was always going to be complete by the time it reached the
    // INSERT.
    //
    // There is no way to know *which* fields a hook fills, so the whole check
    // steps aside for a collection that declares one and `NOT NULL` is the
    // backstop — which is what this function's own docblock already says for
    // the symmetric case of a hook that *nulls* a column. A collection with no
    // hook, which is the majority, keeps the boundary error that names the
    // field rather than the column.
    if ((collection as { callbacks?: { beforeSave?: unknown } }).callbacks?.beforeSave) return;

    const properties = (collection.properties ?? {}) as Record<string, Property>;

    /** Relation property name → the FK wire key that also satisfies it. */
    const relationAlias = new Map<string, string>();
    for (const [name, relation] of Object.entries(resolveCollectionRelations(collection))) {
        if (relation.kind === "belongsTo") {
            relationAlias.set(name, fieldKeyForColumn(collection, (relation as ResolvedBelongsTo).localKey));
        }
    }

    const supplied = (key: string): boolean => {
        const value = values[key];
        return value !== undefined && value !== null;
    };

    for (const [key, property] of Object.entries(properties)) {
        if (!property?.validation?.required) continue;
        if (!isCallerSupplied(property)) continue;
        if (supplied(key)) continue;
        const alias = relationAlias.get(key);
        if (alias && supplied(alias)) continue;

        const field = at ? `${at}.${key}` : key;
        into.push({
            field,
            code: "required",
            message: property.validation.requiredMessage ?? `'${field}' is required.`
        });
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
 * from that spec believed the server was checking. Enum membership, `email` and
 * `url` were published the same way and enforced the same amount.
 *
 * `required` is checked only when `options.status` says this write creates a
 * row. A `PATCH` legitimately omits keys — this function sees one request's
 * values, not the row they land on — so demanding them there would refuse every
 * partial update. Callers that do not pass a status get the old behaviour and
 * leave `required` to the database's NOT NULL.
 *
 * A value of the wrong *type* is not this function's business — that reaches
 * Postgres, which types every column and gives a 400 through the driver's
 * SQLSTATE mapping. Constraints are checked against values of the right type,
 * plus the numeric-string form a JSON body may carry for a number column.
 *
 * Every failing field is reported at once, as a message list *and* as
 * `details.violations` — `{ field, code, message }` per rule. A form that fixes
 * one field per round trip is the reason validation errors get ignored, and a
 * form that has to parse English to find the field is the reason they get
 * shown on the wrong input.
 *
 * ## In-process writes are exempt, by design
 *
 * This runs at the request boundary, on what a *caller sent*, before
 * `beforeSave` gets a chance to fill in or rewrite anything. Server code
 * writing through `rebase.data` is trusted and does not come through here: a
 * hook that stamps a moderation flag, a migration that backfills a column, a
 * seed script — none of them are a caller, and none of them should be judged
 * against rules written to describe a public API. The database's own
 * constraints (NOT NULL, the enum type, a CHECK) are what hold for those, and
 * they hold for every path. Moving this into the driver would change that
 * contract, which is why it has not moved.
 */
export function assertWriteValuesValid(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    options?: { rowIndex?: number; status?: "new" | "existing" | "copy" }
): void {
    const properties = collection.properties;
    if (!properties || !values) return;

    const violations: WriteViolation[] = [];
    for (const [key, value] of Object.entries(values)) {
        const property = (properties as Record<string, Property>)[key];
        if (property) collectViolations(key, property, value, violations);
    }

    // The link's own columns, on a membership element that names them. Judged
    // by the same `collectViolations` — `enum`, `min`, `max`, `matches`,
    // `email`, `url` — because "declared exactly like collection properties" is
    // a claim about what the server enforces, not only about what it creates.
    //
    // `required` is checked only where it is knowable. A membership array is a
    // set operation: an element may be adding a link (nothing has a value yet)
    // or restating one that already exists (everything does), and this function
    // sees one request, not the rows it lands on. On a `status: "new"` write the
    // parent row does not exist, so neither does any of its links, and every
    // element is an insert — that is the one case where a missing required
    // payload column is certainly missing. Everywhere else the database's NOT
    // NULL has the last word, exactly as it does for a `PATCH` of a row.
    for (const [key, junction] of junctionsWithPayload(collection)) {
        for (const { index, pivot } of pivotsIn(values[key])) {
            const at = `${key}[${index}].${JUNCTION_PIVOT_KEY}`;
            for (const [pivotKey, pivotValue] of Object.entries(pivot)) {
                const property = (junction.properties as Record<string, Property>)?.[pivotKey];
                if (property) collectViolations(`${at}.${pivotKey}`, property, pivotValue, violations);
            }
            if (options?.status === "new" || options?.status === "copy") {
                collectMissingRequired(pivot, junction, violations, at);
            }
        }
    }

    if (options?.status === "new" || options?.status === "copy") {
        collectMissingRequired(values, collection, violations);
    }

    if (violations.length === 0) return;

    const where = options?.rowIndex !== undefined ? `Row ${options.rowIndex}: ` : "";
    const messages = violations.map(v => v.message);
    throw ApiError.badRequest(
        `${where}${messages.join(" ")}`,
        "VALIDATION_CONSTRAINT",
        {
            collection: collection.slug,
            violations,
            messages
        }
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

/**
 * Both write checks, as one call, for a transport that is not the REST router.
 *
 * The REST routes run `assertKnownWriteFields` and `assertWriteValuesValid`
 * back to back on the caller's body, seven times over — and they were the only
 * place either ran. The WebSocket `SAVE` handler took a client payload straight
 * to `driver.save`, so the same write arrived validated through one door and
 * unvalidated through the other: `PATCH /api/data/users/1 { age: 999 }` was a
 * 400, and the socket wrote it.
 *
 * Exported for the sockets in `@rebasepro/server-postgres` and
 * `@rebasepro/server-mongo`, which are the other request boundaries. Not the
 * route builder — `index.ts` keeps that internal, and this is a rule rather
 * than wiring.
 *
 * It stays at the boundary rather than moving into the driver deliberately: it
 * validates what a *caller sent*, before `beforeSave` gets a chance to fill in
 * or rewrite anything. In-process writes through `rebase.data` are trusted
 * server code and are not run through it, which is the placement the REST layer
 * already chose — and which is why `excludeFromApi` and `access.write` are
 * enforceable at all: something has to be able to store the password hash.
 *
 * @param values     the caller's payload, exactly as it arrived
 * @param collection resolved from the registry by path — never the copy the
 *                   client sent, or the rules would be the caller's to pick
 * @param options.viewer the caller's roles, for per-field `access.write`.
 *                   Omitted is the trusted plane, which satisfies every
 *                   non-empty role list; an API boundary always has one.
 */
export function assertWriteRequestValid(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    options?: { status?: "new" | "existing" | "copy"; viewer?: FieldViewer }
): void {
    assertKnownWriteFields(values, collection, { viewer: options?.viewer });
    assertWriteValuesValid(values, collection, options);
}
