import {
    INCLUDE_COUNT_KEY,
    JUNCTION_PIVOT_KEY,
    isNumericColumnType,
    isTemporalColumnType,
    isTextColumnType,
    type ColumnDescriptor,
    type ColumnType,
    type ColumnValidation,
    type IncludeSpec,
    type JoinStep,
    type JsonShape,
    type TableDescriptor
} from "@rebasepro/types";
import {
    type FieldViewer,
    type RelationOfKind,
    fieldOperationKind,
    firstDuplicate,
    isColumnFieldOperation,
    isIntegerFamilyType,
    keyForColumn,
    normalizeInclude,
    pivotTable,
    relationsOfKind,
    restrictedKeys,
    textMaxLength,
    validationPattern
} from "@rebasepro/common";
import { ApiError } from "../errors";

/**
 * What the API checks of a write before it reaches the data driver, read from
 * the table's descriptor: which columns a body may name, and what each value
 * must satisfy.
 *
 * Every rule is a fact of a {@link ColumnDescriptor}: `nullable: false` (and no
 * default, stamp or generation) is required on create; `validate` is checked
 * per column type; `oneOf` and an enum type's values are a closed set;
 * `readOnly`, `generated` and `private` close a column to every caller, and
 * `access.write` to the callers without a listed role; a `json` shape is
 * walked field by field. A key the table does not declare is refused unless
 * the table says `strictWrites: false`.
 *
 * @module
 */

/**
 * The `manyToMany` relations of `table` whose link carries columns of its own,
 * each with those columns as a table.
 *
 * Keyed by the relation's name, which is what a membership write names
 * (`{ tags: [...] }`). A junction with no `pivot` is not here at all: there is
 * nothing a `_pivot` could legally say about it, and the write path refuses
 * one with the relation named.
 */
function junctionsWithPayload(table: TableDescriptor): Array<[string, TableDescriptor]> {
    return relationsOfKind(table, "manyToMany")
        .filter((relation: RelationOfKind<"manyToMany">) => relation.through.pivot.length > 0)
        .map(relation => [relation.name, pivotTable(table, relation)]);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

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
    value.forEach((element: unknown, index) => {
        if (!isPlainObject(element)) return;
        const pivot = element[JUNCTION_PIVOT_KEY];
        if (!isPlainObject(pivot)) return;
        out.push({ index, pivot });
    });
    return out;
}

/** The column of `table` with this key. */
function columnOf(table: TableDescriptor, key: string): ColumnDescriptor | undefined {
    return table.columns.find(column => column.key === key);
}

/**
 * The two ways a column can be closed to a write, told apart.
 *
 * `excluded` is closed to every caller at every privilege: a `.private()`
 * column, a `.readOnly()` one, a generated one, and a list `access.write: []`.
 * `unwritable` is a non-empty role list this caller does not satisfy. They are
 * one rule and two answers: the first is a property of the *table* and the
 * same for everybody, the second is a property of the *caller* and would be a
 * 200 for their colleague. A client that retries after acquiring a role should
 * be able to tell which it hit without parsing English.
 *
 * Both are `restrictedKeys`, which is the one list of the names a closed
 * column can be written under: its key, its SQL name, and — for a to-one
 * relation — the foreign key that sets the same column (`bandId: 7` is
 * `band: { id: 7 }`). Asked for the trusted plane, which satisfies every role
 * list but the empty one, it answers exactly the closed-to-all half.
 */
function closedWriteNames(
    table: TableDescriptor,
    viewer: FieldViewer | undefined
): { excluded: Set<string>; unwritable: Set<string> } {
    const excluded = restrictedKeys(table, undefined, "write").refused;
    const unwritable = new Set<string>();
    if (!viewer) return { excluded, unwritable };
    for (const name of restrictedKeys(table, viewer, "write").refused) {
        if (!excluded.has(name)) unwritable.add(name);
    }
    return { excluded, unwritable };
}

/**
 * Refuse a write naming a column this caller may not set.
 *
 * `.private()` means what the generated SDK already says it means: "absent
 * from Row, Insert and Update — the API surface does not mention it, in either
 * direction". On the user store that is the sharp one: `users_write_own` lets
 * you update your own row, `password_hash` is a column on it, and setting it
 * directly is a password change that does not need the old password. A
 * `.readOnly()` or generated column is the database's or the server's to fill,
 * the same for every caller.
 *
 * `access.write: ["editor"]` is the same rule with a role list instead of an
 * empty one, and answers `FIELD_NOT_WRITABLE` rather than
 * `VALIDATION_EXCLUDED_FIELDS`. Both refuse rather than dropping the key: a
 * write that silently discards a field reports success for an edit that did not
 * happen, which is the one outcome a form cannot recover from.
 *
 * The closed-to-all half is refused for every caller, not only unprivileged
 * ones, and regardless of `strictWrites`. The framework's own auth paths do not
 * come through here — `prepareUserCreation` builds the row itself — so what is
 * left is callers the rule was written to exclude.
 *
 * Exported for the history revert, which writes a stored version rather than a
 * body and so asks this question of the columns the revert would change, not
 * of every key the snapshot holds. `where` prefixes the message.
 */
export function assertNoClosedFields(
    values: Record<string, unknown>,
    table: TableDescriptor,
    where: string,
    viewer: FieldViewer | undefined
): void {
    const { excluded, unwritable } = closedWriteNames(table, viewer);
    if (excluded.size === 0 && unwritable.size === 0) return;

    const named = Object.keys(values).filter(key => excluded.has(key));
    if (named.length > 0) {
        // Named separately from "no such column", because it is a different
        // fact and the generic message would send the reader looking for a typo
        // in a name that is spelled correctly.
        throw ApiError.badRequest(
            `${where}${named.map(f => `'${f}'`).join(", ")} on table '${table.slug}' ` +
            `cannot be written through the API: ${named.length > 1 ? "these columns are" : "the column is"} ` +
            "private, read-only or generated — the server's to set.",
            "VALIDATION_EXCLUDED_FIELDS",
            { collection: table.slug, fields: named }
        );
    }

    const refused = Object.keys(values).filter(key => unwritable.has(key));
    if (refused.length === 0) return;

    // The wire name the caller sent, in `field`, so a form can mark the input it
    // owns rather than the column key it may never have seen.
    const violations: WriteViolation[] = refused.map(field => ({
        field,
        code: "access",
        message: `'${field}' on table '${table.slug}' is not writable with your roles.`
    }));
    throw ApiError.badRequest(
        `${where}${violations.map(v => v.message).join(" ")}`,
        "FIELD_NOT_WRITABLE",
        {
            collection: table.slug,
            fields: refused,
            violations,
            messages: violations.map(v => v.message)
        }
    );
}

/** Any table's descriptor by slug: what a relation's target names. */
export type RelatedTableLookup = (slug: string) => TableDescriptor | undefined;

/**
 * Refuse a write of a `hasMany` / `hasOne` relation that sets a foreign key
 * this caller may not set on the target.
 *
 * `PATCH /threads/1 { replies: [1, 2] }` writes `replies.thread_id` on rows 1
 * and 2 (and clears it on the replies it drops): it is a write of the child's
 * column, made from the parent. `PATCH /replies/2 { threadId: 1 }` answers
 * `VALIDATION_EXCLUDED_FIELDS` when that column is `.readOnly()` or private,
 * `FIELD_NOT_WRITABLE` when its `access.write` does not admit the caller — and
 * so does this, with the same codes, for the column the relation writes. The
 * rows themselves are still the child's row-level security's to admit.
 *
 * A many-to-many write sets the junction's two link columns, which have no
 * rules of their own (the relation's `access.write` is the parent's, judged
 * with its other fields); its `_pivot` columns are judged as columns.
 *
 * Fails closed: a body naming such a relation is refused when the target's
 * descriptor cannot be found, because the column it writes cannot be judged.
 */
function assertRelationTargetsWritable(
    values: Record<string, unknown>,
    table: TableDescriptor,
    where: string,
    viewer: FieldViewer | undefined,
    relatedTables: RelatedTableLookup | undefined
): void {
    for (const relation of table.relations) {
        if (!Object.hasOwn(values, relation.name)) continue;
        const written = columnsWrittenOnOtherRows(relation);
        if (!written) continue;
        const target = relatedTables?.(written.table);
        if (!target || written.columns.length === 0) {
            if (!written.required) continue;
            throw ApiError.badRequest(
                `${where}'${relation.name}' on table '${table.slug}' writes the foreign key of '${relation.target}', ` +
                "whose rules this write cannot read, so it is refused. Write the key on the related rows themselves.",
                "VALIDATION_EXCLUDED_FIELDS",
                { collection: table.slug, fields: [relation.name] }
            );
        }
        for (const sqlName of written.columns) {
            const key = keyForColumn(target, sqlName) ?? sqlName;
            assertNoClosedFields(
                { [key]: true },
                target,
                `${where}Writing '${relation.name}' on '${table.slug}' sets '${key}' on the rows of '${target.slug}': `,
                viewer
            );
        }
    }
}

/**
 * The column a `via` step's condition names on one side, unqualified — or
 * `undefined` for a step with alternatives or a composite condition, which is
 * not writable (the write path refuses it naming the relation).
 */
function soleStepColumn(step: JoinStep, side: "from" | "to"): string | undefined {
    const on = Array.isArray(step.on) ? (step.on.length === 1 ? step.on[0] : undefined) : step.on;
    if (!on) return undefined;
    const named = on[side];
    const column = Array.isArray(named) ? (named.length === 1 ? named[0] : undefined) : named;
    if (column === undefined) return undefined;
    const dot = column.lastIndexOf(".");
    return dot >= 0 ? column.slice(dot + 1) : column;
}

/**
 * The columns a relation write sets on rows other than the one written, and
 * the table (by slug or SQL name, as the lookup takes it) that holds them:
 *
 * - `hasMany` / `hasOne` — the target's foreign key;
 * - a to-one `via` — the column its one step joins to on the target;
 * - a writable to-many `via` — the junction's two link columns, judged when
 *   the junction is a declared table (an undeclared one has no rules);
 * - `belongsTo` and `manyToMany` — none: the first sets a column of this
 *   table (judged as that column), the second a junction the relation owns,
 *   whose `_pivot` columns are judged as columns.
 *
 * `required` says whether the write must be refused when the table's rules
 * cannot be read: it must for the target of a key the write moves.
 */
function columnsWrittenOnOtherRows(relation: TableDescriptor["relations"][number]):
    { table: string; columns: string[]; required: boolean } | undefined {
    if (relation.kind === "hasMany" || relation.kind === "hasOne") {
        return { table: relation.target, columns: [relation.foreignKey], required: true };
    }
    if (relation.kind !== "via" || relation.steps.length === 0) return undefined;
    if (relation.cardinality === "one") {
        const column = soleStepColumn(relation.steps[relation.steps.length - 1], "to");
        // A chain whose written column cannot be named is refused by the
        // write path; refusing it here too fails closed.
        return { table: relation.target, columns: column ? [column] : [], required: true };
    }
    if (relation.steps.length !== 2) return undefined;
    const junction = relation.steps[0];
    const columns = [soleStepColumn(junction, "to"), soleStepColumn(relation.steps[1], "from")]
        .filter((column): column is string => column !== undefined);
    return { table: junction.table, columns, required: false };
}

/**
 * Refuse a field operation on a column this caller may not read.
 *
 * An operation reads the stored value — `$inc` adds to it, `$push` appends to
 * it — and its result is held to the column's declared bounds by the same
 * statement. So the answer to one is a measurement of the value: a refused
 * `{ score: { $inc: -40 } }` against `min: 0` says the hidden score is below
 * 40, an accepted one is undone with `$inc: 40`, and a binary search recovers
 * the value exactly. A plain value reads nothing, so it stays the write rule's
 * alone.
 *
 * The same refusal, with the same code, a filter on the column gets from the
 * read side (`assertQueryFieldsReadable`): a column no response can carry is a
 * column no request may interrogate, whichever verb the request uses.
 */
function assertFieldOpsReadable(
    values: Record<string, unknown>,
    table: TableDescriptor,
    where: string,
    viewer: FieldViewer | undefined
): void {
    const operated = Object.keys(values).filter(key => isColumnFieldOperation(values[key], columnOf(table, key)));
    if (operated.length === 0) return;
    const { refused } = restrictedKeys(table, viewer, "read");
    const named = operated.filter(key => refused.has(key));
    if (named.length === 0) return;

    const violations: WriteViolation[] = named.map(field => ({
        field,
        code: "access",
        message: `'${field}' on table '${table.slug}' is not readable with your roles, so it cannot be changed ` +
            "by a field operation, which reads the stored value. Send the value itself."
    }));
    throw ApiError.badRequest(
        `${where}${violations.map(v => v.message).join(" ")}`,
        "FIELD_NOT_READABLE",
        {
            collection: table.slug,
            fields: named,
            violations,
            messages: violations.map(v => v.message)
        }
    );
}

/**
 * Refuse a write that sets a column this caller may not set, through any
 * spelling that reaches the column: its own key or SQL name, the `belongsTo`
 * bound to it (`{ reviewer: 7 }` sets `reviewerId`), the relation that sets it
 * on other rows (`hasMany` / `hasOne`, a to-one `via`), a `_pivot` field of a
 * many-to-many — and a field operation on a column the caller may not read.
 *
 * The column's rules, one list for every spelling: `.readOnly()`, `.private()`
 * and generated columns answer `VALIDATION_EXCLUDED_FIELDS` for every caller,
 * an `access.write` list `FIELD_NOT_WRITABLE` for a caller outside it. The
 * server's stamps, the tenant and the key are the driver's to judge (it folds
 * a link onto its key column before them).
 *
 * The part of {@link assertKnownWriteFields} that is not about unknown keys:
 * the in-process SDK on a caller's driver asks this alone, since the driver
 * refuses a key no column answers to on its own.
 */
export function assertColumnWriteRules(
    values: Record<string, unknown>,
    table: TableDescriptor,
    options?: {
        /** A prefix for every message (`Row 3: `). */
        where?: string;
        viewer?: FieldViewer;
        /** The related tables' descriptors; a write that moves another table's key is refused without them. */
        relatedTables?: RelatedTableLookup;
    }
): void {
    const where = options?.where ?? "";
    assertNoClosedFields(values, table, where, options?.viewer);
    assertRelationTargetsWritable(values, table, where, options?.viewer, options?.relatedTables);
    assertFieldOpsReadable(values, table, where, options?.viewer);

    // A membership element may name the link's own columns under `_pivot`.
    // They belong to the junction, so they are checked against its columns —
    // by the same function, so a pivot column with `access.write: ["admin"]`
    // or `.private()` is refused on exactly the terms a table's column is.
    // Whatever the parent's `strictWrites` says: the junction's own decides
    // its unknown keys, the parent's decides nothing about its rules.
    for (const [key, junction] of junctionsWithPayload(table)) {
        for (const { pivot } of pivotsIn(values[key])) {
            assertKnownWriteFields(pivot, junction, { viewer: options?.viewer });
        }
    }
}

/**
 * Reject a write naming a column the table does not have.
 *
 * An unknown key does not reach the INSERT and come back as `column "titel"
 * does not exist`: Drizzle builds INSERT and UPDATE from the table's own column
 * list, so a key the table does not carry is left out of the statement and the
 * write answers 201 having stored nothing under that name. A typo is a request
 * problem, it belongs in a 400.
 *
 * `strictWrites: false` on the table skips the unknown-key half (see below);
 * `assertWritableColumns` in the Postgres driver is the backstop every write
 * passes through, including in-process `rebase.data` writes.
 *
 * What counts as known:
 * - a column (the foreign key of a `belongsTo` is a column of the table);
 * - a relation, which a write sets by name (`author: { id }`, `tags: [...]`);
 * - anything named in `options.extraKnownFields` — for the auth table the
 *   credential keys the auth adapter consumes before a row is ever built;
 * - nothing else. `id` in particular is not automatically known — see below.
 */
export function assertKnownWriteFields(
    values: Record<string, unknown>,
    table: TableDescriptor,
    options?: {
        rowIndex?: number;
        extraKnownFields?: readonly string[];
        viewer?: FieldViewer;
        /**
         * The related tables' descriptors, for the foreign key a `hasMany` /
         * `hasOne` write sets on them. A body naming such a relation is refused
         * without it.
         */
        relatedTables?: RelatedTableLookup;
    }
): void {
    // A table that describes no column has nothing to check against — "no
    // declared columns" is not the claim "no columns are allowed". The
    // driver's column check has the last word.
    if (table.columns.length === 0 && table.relations.length === 0) return;

    const where = options?.rowIndex !== undefined ? `Row ${options.rowIndex}: ` : "";

    // Every rule of a DECLARED column is checked BEFORE the `strictWrites`
    // opt-out. That flag says one thing — "a key this table does not declare
    // is not a typo" — and a convenience flag must not be able to open a
    // closed column. What it decides, and all it decides, is below.
    assertColumnWriteRules(values, table, { where, viewer: options?.viewer, relatedTables: options?.relatedTables });

    // `strictWrites: false`: a key the table does not declare is handed to the
    // driver instead of refused here. The driver writes it only when the
    // database has a column of that name (`assertWritableColumns`) and refuses
    // it otherwise — it is never dropped in silence. No other rule moves.
    if (table.strictWrites === false) return;

    const known = new Set<string>([
        ...table.columns.map(column => column.key),
        ...table.relations.map(relation => relation.name)
    ]);

    // A column this caller cannot write is not among the names they may use,
    // so it is absent from the "Known columns" list the error prints. That
    // list is an offer, and offering a name the next request would refuse is
    // worse than saying nothing.
    const restricted = restrictedKeys(table, options?.viewer, "write");
    for (const name of restricted.declared) known.delete(name);

    for (const field of options?.extraKnownFields ?? []) known.add(field);

    const unknown = Object.keys(values).filter(key => !known.has(key));
    if (unknown.length === 0) return;

    // The `id` case is worth its own sentence, because the caller almost
    // certainly did not choose to send it — `create(data, id)` puts it there,
    // which is right for a table keyed on `id` and meaningless for any other.
    if (unknown.includes("id") && !known.has("id")) {
        const keys = table.primaryKey.map(name => `'${name}'`);
        const keyDesc = keys.length > 0 ? keys.join(" + ") : "its own key column";
        throw ApiError.badRequest(
            `${where}Table '${table.slug}' has no 'id' column — it is keyed on ${keyDesc}. ` +
            "The `id` argument of `create(data, id)` is written as an `id` column, so for this " +
            "table put the key in `data` instead.",
            "VALIDATION_UNKNOWN_FIELDS"
        );
    }

    throw ApiError.badRequest(
        `${where}Table '${table.slug}' has no column ${unknown.map(f => `'${f}'`).join(", ")}. ` +
        `Known columns: ${[...known].sort().map(f => `'${f}'`).join(", ")}.`,
        "VALIDATION_UNKNOWN_FIELDS"
    );
}

/**
 * The number a rule should judge, or `undefined` if the value is not one.
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

/** The instant a rule should judge, or `undefined` if the value is not one. */
function asDate(value: unknown): Date | undefined {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
}

/**
 * One broken rule, in the shape a client can branch on.
 *
 * `field` is the **wire** name — the column key, dotted through JSON objects
 * and indexed through arrays (`address.zip`, `tags[2]`) — because that is the
 * name the caller sent and the only one they can map back onto their form.
 * `code` is stable and machine-readable; `message` is the sentence a human
 * reads.
 */
export interface WriteViolation {
    field: string;
    code: string;
    message: string;
}

/**
 * A deliberately plain email shape: something, `@`, something with a dot.
 *
 * Not RFC 5322 — that grammar accepts addresses no mail server will deliver to
 * and is not what `format: "email"` in the published OpenAPI leads anyone to
 * expect. This rejects the mistakes people actually make and accepts
 * everything deliverable.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Is this an absolute URL — the thing `format: "uri"` promises? */
function isAbsoluteUrl(value: string): boolean {
    try {
        return Boolean(new URL(value).protocol);
    } catch {
        return false;
    }
}

/**
 * The rules one scalar value answers to, whatever declared them: a column, the
 * items of an array column, or a field of a JSON document.
 */
interface ScalarRules {
    kind: "text" | "number" | "temporal" | "geopoint" | "none";
    validate?: ColumnValidation;
    /** A closed set: an enum type's labels, or `oneOf`. */
    oneOf?: readonly (string | number)[];
    /** The value must be whole: an integer column, or `validate({ integer })`. */
    integer?: boolean;
    /** The longest text accepted. */
    maxLength?: number;
}

/** The scalar rules of a value of `type`, with the rules that came with it. */
function scalarRulesOf(type: ColumnType, rules: { validate?: ColumnValidation; oneOf?: readonly (string | number)[] }, maxLength?: number): ScalarRules {
    if (type.kind === "enum") return { kind: "text", validate: rules.validate, oneOf: rules.oneOf ?? type.values, maxLength };
    if (isTextColumnType(type) || type.kind === "uuid" || type.kind === "other") {
        return { kind: "text", validate: rules.validate, oneOf: rules.oneOf, maxLength };
    }
    if (isNumericColumnType(type)) {
        return {
            kind: "number",
            validate: rules.validate,
            oneOf: rules.oneOf,
            integer: rules.validate?.integer === true || isIntegerFamilyType(type)
        };
    }
    if (isTemporalColumnType(type)) return { kind: "temporal", validate: rules.validate };
    return { kind: "none" };
}

/** The scalar rules of a JSON shape node, or `undefined` for a node that is not a scalar. */
function scalarRulesOfNode(node: JsonShape): ScalarRules | undefined {
    switch (node.kind) {
        case "string": {
            const max = node.validate?.max;
            return { kind: "text", validate: node.validate, oneOf: node.oneOf, maxLength: typeof max === "number" ? max : undefined };
        }
        case "number":
            return { kind: "number", validate: node.validate, oneOf: node.oneOf, integer: node.validate?.integer === true };
        case "date":
            return { kind: "temporal", validate: node.validate };
        case "geopoint":
            return { kind: "geopoint" };
        case "boolean":
            return { kind: "none" };
        default:
            return undefined;
    }
}

/** Judge one scalar value by its rules. `null`/`undefined` is `required`'s question, not a range's. */
function collectScalarViolations(key: string, rules: ScalarRules, value: unknown, into: WriteViolation[]): void {
    if (value === null || value === undefined) return;
    switch (rules.kind) {
        case "text": {
            if (typeof value !== "string") return;
            // A closed set. Postgres enforces it for a real `enum` column — as
            // `22P02`, which names no field — and nothing enforces it for a text
            // column with `.oneOf()`. Checked here so both answer the same 400,
            // naming the column and the values it accepts. The value is echoed
            // because a label is a declared constant, already in the OpenAPI
            // and the generated SDK.
            if (rules.oneOf && rules.oneOf.length > 0) {
                const ids = rules.oneOf.map(String);
                if (!ids.includes(value)) {
                    into.push({
                        field: key,
                        code: "enum",
                        message: `'${key}' must be one of ${ids.map(id => `'${id}'`).join(", ")} (received '${value}').`
                    });
                }
            }
            const validate = rules.validate;
            if (validate?.email && value !== "" && !EMAIL_SHAPE.test(value)) {
                into.push({ field: key, code: "email", message: `'${key}' must be an email address.` });
            }
            if (validate?.url && value !== "" && !isAbsoluteUrl(value)) {
                into.push({ field: key, code: "url", message: `'${key}' must be an absolute URL, including the scheme (e.g. https://).` });
            }
            if (validate?.length !== undefined && value.length !== validate.length) {
                into.push({ field: key, code: "length", message: `'${key}' must be exactly ${validate.length} character${validate.length === 1 ? "" : "s"} long (received ${value.length}).` });
            }
            const min = typeof validate?.min === "number" ? validate.min : undefined;
            if (min !== undefined && value.length < min) {
                into.push({ field: key, code: "min_length", message: `'${key}' must be at least ${min} character${min === 1 ? "" : "s"} long (received ${value.length}).` });
            }
            const max = rules.maxLength;
            if (max !== undefined && value.length > max) {
                into.push({ field: key, code: "max_length", message: `'${key}' must be at most ${max} character${max === 1 ? "" : "s"} long (received ${value.length}).` });
            }
            const pattern = validationPattern(validate);
            // The value is not echoed: a pattern usually guards an identifier,
            // a token or a phone number, and the message ends up in logs.
            if (pattern && !pattern.test(value)) {
                into.push({ field: key, code: "pattern", message: validate?.matchesMessage ?? `'${key}' does not match the required pattern ${pattern}.` });
            }
            return;
        }
        case "number": {
            const num = asNumber(value);
            if (num === undefined) return;
            if (rules.oneOf && rules.oneOf.length > 0) {
                const ids = rules.oneOf.map(String);
                if (!ids.includes(String(num))) {
                    into.push({ field: key, code: "enum", message: `'${key}' must be one of ${ids.join(", ")} (received ${num}).` });
                }
            }
            // An integer column takes a whole number whether or not the column
            // says `validate({ integer })`. Left to Postgres, a fraction came
            // back as `Invalid data format` naming no field.
            if (rules.integer && !Number.isInteger(num)) into.push({ field: key, code: "integer", message: `'${key}' must be a whole number (received ${num}).` });
            const validate = rules.validate;
            if (!validate) return;
            const min = typeof validate.min === "number" ? validate.min : undefined;
            const max = typeof validate.max === "number" ? validate.max : undefined;
            if (validate.positive && !(num > 0)) into.push({ field: key, code: "positive", message: `'${key}' must be positive (received ${num}).` });
            if (validate.negative && !(num < 0)) into.push({ field: key, code: "negative", message: `'${key}' must be negative (received ${num}).` });
            if (min !== undefined && num < min) into.push({ field: key, code: "min", message: `'${key}' must be at least ${min} (received ${num}).` });
            if (max !== undefined && num > max) into.push({ field: key, code: "max", message: `'${key}' must be at most ${max} (received ${num}).` });
            if (validate.moreThan !== undefined && !(num > validate.moreThan)) into.push({ field: key, code: "more_than", message: `'${key}' must be greater than ${validate.moreThan} (received ${num}).` });
            if (validate.lessThan !== undefined && !(num < validate.lessThan)) into.push({ field: key, code: "less_than", message: `'${key}' must be less than ${validate.lessThan} (received ${num}).` });
            return;
        }
        case "temporal": {
            const validate = rules.validate;
            if (!validate) return;
            const date = asDate(value);
            if (date === undefined) return;
            const min = validate.min !== undefined ? asDate(validate.min) : undefined;
            const max = validate.max !== undefined ? asDate(validate.max) : undefined;
            if (min && date.getTime() < min.getTime()) into.push({ field: key, code: "date_min", message: `'${key}' must not be before ${min.toISOString()}.` });
            if (max && date.getTime() > max.getTime()) into.push({ field: key, code: "date_max", message: `'${key}' must not be after ${max.toISOString()}.` });
            return;
        }
        case "geopoint": {
            // The shape is the data transformer's to refuse; a point with
            // numeric coordinates off the globe is this rule's.
            if (!isPlainObject(value)) return;
            const { latitude, longitude } = value;
            if (typeof latitude !== "number" || typeof longitude !== "number") return;
            if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
                into.push({
                    field: key,
                    code: "geopoint_range",
                    message: `'${key}' must have a latitude between -90 and 90 and a longitude between -180 and 180 (received ${latitude}, ${longitude}).`
                });
            }
            return;
        }
        case "none":
            return;
    }
}

/** The list-level rules: `minItems`, `maxItems`, `uniqueItems`, `uniqueBy`. */
function collectListViolations(key: string, validate: ColumnValidation | undefined, items: readonly unknown[], into: WriteViolation[]): void {
    if (!validate) return;
    const { minItems, maxItems, uniqueItems, uniqueBy } = validate;
    if (minItems !== undefined && items.length < minItems) {
        into.push({ field: key, code: "min_items", message: `'${key}' must have at least ${minItems} item${minItems === 1 ? "" : "s"} (received ${items.length}).` });
    }
    if (maxItems !== undefined && items.length > maxItems) {
        into.push({ field: key, code: "max_items", message: `'${key}' must have at most ${maxItems} item${maxItems === 1 ? "" : "s"} (received ${items.length}).` });
    }
    if (uniqueItems) {
        const duplicate = firstDuplicate(items);
        // Positions rather than the value: the item is caller data.
        if (duplicate) into.push({ field: key, code: "unique_items", message: `'${key}' must not hold the same value twice (items ${duplicate[0]} and ${duplicate[1]} are equal).` });
    }
    for (const field of uniqueBy ?? []) {
        const duplicate = firstDuplicate(items, field);
        if (duplicate) {
            into.push({
                field: key,
                code: "unique_by",
                message: `'${key}' must not hold two items with the same '${field}' (items ${duplicate[0]} and ${duplicate[1]} have the same '${field}').`
            });
        }
    }
}

/**
 * Judge a value by a JSON shape node, recursing into objects, arrays and typed
 * blocks.
 *
 * `partial` is a `$merge` operand: it names the keys it sets, so a required
 * field it leaves out is the stored document's, not missing.
 */
function collectJsonViolations(key: string, node: JsonShape, value: unknown, into: WriteViolation[], partial = false): void {
    if (value === null || value === undefined) return;
    const scalar = scalarRulesOfNode(node);
    if (scalar) {
        collectScalarViolations(key, scalar, value, into);
        return;
    }
    switch (node.kind) {
        case "object": {
            if (!isPlainObject(value)) return;
            for (const [field, child] of Object.entries(node.fields)) {
                const path = `${key}.${field}`;
                const fieldValue = value[field];
                const absent = fieldValue === undefined || fieldValue === null || (child.kind === "string" && fieldValue === "");
                // Required inside a document: a value written to the column
                // replaces the whole document, so a key it leaves out is
                // missing — unless the server fills it (a default, a stamp).
                if (absent && child.required && !partial && !serverFills(child)) {
                    into.push({ field: path, code: "required", message: `'${path}' is required.` });
                    continue;
                }
                collectJsonViolations(path, child, fieldValue, into);
            }
            return;
        }
        case "array": {
            if (!Array.isArray(value)) return;
            collectListViolations(key, node.validate, value, into);
            value.forEach((item: unknown, index) => collectJsonViolations(`${key}[${index}]`, node.of, item, into));
            return;
        }
        case "oneOf": {
            // A typed block: `{ type, value }`, the value answering to the
            // shape its type names.
            if (!isPlainObject(value)) return;
            // A type that names no variant is left to the database, as a
            // block's value always was: nothing here describes it.
            const type = value[node.typeField];
            if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(node.variants, type)) return;
            const variant = node.variants[type];
            const path = `${key}.${node.valueField}`;
            const blockValue = value[node.valueField];
            const absent = blockValue === undefined || blockValue === null || (variant.kind === "string" && blockValue === "");
            if (absent && variant.required && !serverFills(variant)) {
                into.push({ field: path, code: "required", message: `'${path}' is required.` });
                return;
            }
            collectJsonViolations(path, variant, blockValue, into);
            return;
        }
        default:
            // `json.unknown()`: anything.
            return;
    }
}

/** Whether the server writes a JSON field a write leaves out: a default, or a stamp. */
function serverFills(node: JsonShape): boolean {
    if (node.default !== undefined) return true;
    return (node.kind === "string" || node.kind === "date") && node.stamp !== undefined;
}

/** Judge one column's value. */
function collectColumnViolations(column: ColumnDescriptor, key: string, value: unknown, into: WriteViolation[]): void {
    if (value === null || value === undefined) return;
    if (isColumnFieldOperation(value, column) && isPlainObject(value)) {
        collectFieldOperationViolations(column, key, value, into);
        return;
    }
    if (column.semantic === "geopoint") {
        collectScalarViolations(key, { kind: "geopoint" }, value, into);
        return;
    }
    const type = column.type;
    if (type.kind === "array") {
        if (!Array.isArray(value)) return;
        collectListViolations(key, column.validate, value, into);
        const element = scalarRulesOf(type.of, { validate: column.element?.validate, oneOf: column.element?.oneOf },
            typeof column.element?.validate?.max === "number" ? column.element.validate.max : undefined);
        value.forEach((item: unknown, index) => collectScalarViolations(`${key}[${index}]`, element, item, into));
        return;
    }
    if (type.kind === "other" && /\]\s*$/.test(type.sqlType)) {
        if (Array.isArray(value)) collectListViolations(key, column.validate, value, into);
        return;
    }
    if (type.kind === "json" || type.kind === "jsonb") {
        const shape = documentShape(column);
        if (shape) collectJsonViolations(key, shape, value, into);
        return;
    }
    collectScalarViolations(key, scalarRulesOf(type, column, textMaxLength(column)), value, into);
}

/**
 * A JSON column's shape, with the column's own list rules folded into a
 * top-level `json.array()`: `col.jsonb(json.array(…)).validate({ maxItems })`
 * and `json.array(…).validate({ maxItems })` say the same thing.
 */
function documentShape(column: ColumnDescriptor): JsonShape | undefined {
    const shape = column.json;
    if (shape?.kind === "array" && column.validate) return { ...shape, validate: { ...shape.validate, ...column.validate } };
    return shape;
}

/**
 * What a field operation writes, judged by the rules the value it becomes part
 * of answers to.
 *
 * `{ tags: { $push: "bogus" } }` stores `"bogus"` in `tags` as surely as
 * `{ tags: [..., "bogus"] }` does, so each pushed item answers to the item
 * rules, and pushing more items than `maxItems` allows is over it whatever the
 * array held. `$merge` sets the keys it names, so those answer to the
 * document's fields, and an `$inc` of a whole-number column is a whole number.
 *
 * What an operation *produces* — the stored array plus the pushed items, the
 * stored number plus the increment — depends on the stored row, which this
 * request never sees: holding an `$inc` to a `min` or `max` takes a guard in
 * the statement that does the arithmetic (the driver's). A malformed operation
 * is `assertFieldOpsValid`'s to refuse, so one is skipped here.
 */
function collectFieldOperationViolations(
    column: ColumnDescriptor,
    key: string,
    operation: Record<string, unknown>,
    into: WriteViolation[]
): void {
    const entries = Object.entries(operation);
    if (entries.length !== 1) return;
    const [operator, operand] = entries[0];
    const kind = fieldOperationKind(column);

    if (operator === "$push" && kind === "array" && operand !== undefined) {
        const pushed: unknown[] = Array.isArray(operand) ? operand : [operand];
        const type = column.type;
        if (type.kind === "array") {
            const element = scalarRulesOf(type.of, { validate: column.element?.validate, oneOf: column.element?.oneOf },
                typeof column.element?.validate?.max === "number" ? column.element.validate.max : undefined);
            pushed.forEach(item => collectScalarViolations(key, element, item, into));
        }
        const shape = documentShape(column);
        if (shape?.kind === "array") pushed.forEach(value => collectJsonViolations(key, shape.of, value, into));
        const listRules = shape?.kind === "array" ? shape.validate : column.validate;
        const maxItems = listRules?.maxItems;
        if (maxItems !== undefined && pushed.length > maxItems) {
            into.push({ field: key, code: "max_items", message: `'${key}' must have at most ${maxItems} item${maxItems === 1 ? "" : "s"}; $push adds ${pushed.length}.` });
        }
        // What the pushed items hold among themselves; a stored item they
        // repeat is the stored row's, which this request never sees.
        if (listRules?.uniqueItems || listRules?.uniqueBy) {
            collectListViolations(key, { uniqueItems: listRules.uniqueItems, uniqueBy: listRules.uniqueBy }, pushed, into);
        }
        return;
    }

    if (operator === "$merge" && kind === "document" && isPlainObject(operand)) {
        if (column.json?.kind === "object") collectJsonViolations(key, column.json, operand, into, true);
        return;
    }

    if (operator === "$inc" && kind === "number" && typeof operand === "number" && !Number.isInteger(operand)
        && (column.validate?.integer === true || isIntegerFamilyType(column.type))) {
        into.push({ field: key, code: "integer", message: `'${key}' must be a whole number, so $inc on it takes one (received ${operand}).` });
    }
}

/**
 * Does the write itself supply this column, or does something else?
 *
 * `nullable: false` on create is only a real requirement for keys the
 * *caller* has to send. A key column, a column with a default (the driver
 * applies a literal one, the database the rest), a stamp the server writes, a
 * generated column, and a column closed to the API (`.private()`,
 * `.readOnly()`) are all values that exist by the time the INSERT runs —
 * demanding them in the request would refuse writes that are entirely correct.
 */
function isCallerSupplied(column: ColumnDescriptor): boolean {
    if (column.primaryKey) return false;
    if (column.default !== undefined) return false;
    if (column.stamp !== undefined) return false;
    if (column.generated !== undefined) return false;
    if (column.private || column.readOnly) return false;
    return true;
}

/**
 * Collect the required columns a write leaves unset or sends empty.
 *
 * On every write, a required text column sent as `""` is a `required`
 * violation, as a missing value is on a create: an empty title is no more a
 * title than an absent one, and `NOT NULL` lets `""` through. A create
 * (`create: true`) also reports the required keys it leaves out or sends as
 * `null`.
 *
 * Checked here rather than left to the database's NOT NULL, whose 400 names the
 * SQL column (`author_id`) and arrives only after every `beforeSave` hook has
 * run. `23502` stays the backstop for everything this cannot see.
 *
 * A `belongsTo` foreign key is satisfied by either spelling: the column
 * (`authorId`) or the relation (`author`). Both put the same value in the same
 * column.
 */
function collectMissingRequired(
    values: Record<string, unknown>,
    table: TableDescriptor,
    into: WriteViolation[],
    options: {
        /** The write inserts the row, so an absent key is certainly absent. */
        create: boolean;
        /** Prefix for the reported field path, for values nested under a `_pivot`. */
        at?: string;
    }
): void {
    const { create, at } = options;
    // A `beforeSave` can supply a required column, and this runs before it —
    // a slug derived from a title is the canonical case. There is no way to
    // know *which* columns a hook fills, so the whole check steps aside for a
    // table that declares one, and `NOT NULL` is the backstop.
    if (table.hooks?.beforeSave) return;

    /** Foreign-key column key → the relation name that also satisfies it. */
    const relationAlias = new Map<string, string>();
    for (const relation of relationsOfKind(table, "belongsTo")) relationAlias.set(relation.localField, relation.name);

    const supplied = (key: string): boolean => {
        const value = values[key];
        return value !== undefined && value !== null;
    };

    for (const column of table.columns) {
        if (column.nullable || column.primaryKey) continue;
        const key = column.key;
        // Sent empty: the caller supplied the key, so no default fills it, and
        // the row would store `""`.
        const sentEmpty = isTextColumnType(column.type) && values[key] === "";
        if (!sentEmpty) {
            if (!create) continue;
            if (!isCallerSupplied(column)) continue;
            if (supplied(key)) continue;
            const alias = relationAlias.get(key);
            if (alias && supplied(alias)) continue;
        }

        const field = at ? `${at}.${key}` : key;
        into.push({
            field,
            code: "required",
            message: column.validate?.requiredMessage ?? `'${field}' is required.`
        });
    }
}

/**
 * Reject a write whose values break the rules the table's columns declare.
 *
 * Every rule `validate()` states, `oneOf` and an enum type's labels, the
 * per-item rules of an array column and the fields of a JSON document's shape
 * are checked here, at the request boundary, before any hook runs: the
 * generated OpenAPI publishes them as `minimum`, `maxLength`, `pattern`,
 * `enum`, `uniqueItems`…, and a client or gateway generated from it believes
 * the server is checking.
 *
 * A missing required key is checked only when `options.status` says this
 * write creates a row. A `PATCH` legitimately omits keys — this function sees
 * one request's values, not the row they land on. A required text value sent
 * as `""` is refused on every write, whatever the status: NOT NULL would store
 * it.
 *
 * A value of the wrong *type* is not this function's business — that reaches
 * Postgres, which types every column and gives a 400 through the driver's
 * SQLSTATE mapping. Rules are checked against values of the right type, plus
 * the numeric-string form a JSON body may carry for a number column.
 *
 * Every failing field is reported at once, as a message list *and* as
 * `details.violations` — `{ field, code, message }` per rule.
 *
 * ## In-process writes are exempt, by design
 *
 * This runs on what a *caller sent*, before `beforeSave` gets a chance to fill
 * in or rewrite anything. Server code writing through `rebase.data` is trusted
 * and does not come through here: a hook that stamps a moderation flag, a
 * migration that backfills a column, a seed script. The database's own
 * constraints (NOT NULL, the enum type, a CHECK) hold for those, and for every
 * path.
 */
export function assertWriteValuesValid(
    values: Record<string, unknown>,
    table: TableDescriptor,
    options?: { rowIndex?: number; status?: "new" | "existing" | "copy" }
): void {
    if (!values) return;

    const isCreate = options?.status === "new" || options?.status === "copy";
    const violations: WriteViolation[] = [];
    for (const [key, value] of Object.entries(values)) {
        const column = columnOf(table, key);
        if (column) collectColumnViolations(column, key, value, violations);
    }

    // The link's own columns, on a membership element that names them, judged
    // by the same rules a table's columns are.
    //
    // `required` is checked only where it is knowable. A membership array is a
    // set operation: an element may be adding a link or restating one, and
    // this function sees one request, not the rows it lands on. On a create
    // the parent row does not exist, so neither does any of its links, and
    // every element is an insert — the one case where a missing required pivot
    // column is certainly missing. A required pivot text sent as `""` is
    // refused on every write.
    for (const [key, junction] of junctionsWithPayload(table)) {
        for (const { index, pivot } of pivotsIn(values[key])) {
            const at = `${key}[${index}].${JUNCTION_PIVOT_KEY}`;
            for (const [pivotKey, pivotValue] of Object.entries(pivot)) {
                const column = columnOf(junction, pivotKey);
                if (column) collectColumnViolations(column, `${at}.${pivotKey}`, pivotValue, violations);
            }
            collectMissingRequired(pivot, junction, violations, { create: isCreate, at });
        }
    }

    collectMissingRequired(values, table, violations, { create: isCreate });

    if (violations.length === 0) return;

    const where = options?.rowIndex !== undefined ? `Row ${options.rowIndex}: ` : "";
    const messages = violations.map(v => v.message);
    throw ApiError.badRequest(
        `${where}${messages.join(" ")}`,
        "VALIDATION_CONSTRAINT",
        {
            collection: table.slug,
            violations,
            messages
        }
    );
}

/**
 * Narrow response rows to the fields the caller asked for (`?fields=id,title`).
 *
 * This shapes the *response*, which is what the parameter says it does; it is
 * not a column pushdown, so it saves bandwidth rather than database work.
 *
 * The table's key always survives. Rows are addressed by it everywhere above
 * this layer — the admin table, realtime reconciliation, the offline cache —
 * and a row that arrives without one is not a smaller row, it is an unusable
 * one.
 */
export function projectResponseFields<T extends Record<string, unknown>>(
    rows: T[],
    fields: readonly string[] | undefined,
    table: TableDescriptor,
    options?: { include?: IncludeSpec }
): T[] {
    if (!fields || fields.length === 0) return rows;

    const declared = new Set<string>([
        ...table.columns.map(column => column.key),
        ...table.relations.map(relation => relation.name)
    ]);
    // A relation named in `include` is returned whether or not `fields` names
    // it: `fields` narrows the row's own columns, and asking for a relation is
    // already saying to return it — as the socket and `listen()` do. `*` is
    // every relation. Naming one in `fields` without including it returns
    // nothing for it: there was nothing loaded to return.
    const include = normalizeInclude(options?.include);
    const included = include
        ? [...Object.keys(include.tree), ...(include.wildcard ? table.relations.map(relation => relation.name) : [])]
        : [];
    for (const name of included) declared.add(name);
    declared.add("id");

    // A table that declares nothing describes nothing to check against.
    if (declared.size > 1) {
        const unknown = fields.filter(field => !declared.has(field));
        if (unknown.length > 0) {
            throw ApiError.badRequest(
                `Table '${table.slug}' has no column or relation ${unknown.map(f => `'${f}'`).join(", ")} to return. ` +
                `Known columns and relations: ${[...declared].sort().map(f => `'${f}'`).join(", ")}.`,
                "UNKNOWN_RESPONSE_FIELD",
                { fields: unknown, collection: table.slug }
            );
        }
    }

    // Whatever addresses a row here: its key, or a literal `id` for a table
    // introspected without one.
    const primaryKeys = table.primaryKey;
    const keep = new Set<string>([...fields, ...included, ...(primaryKeys.length > 0 ? primaryKeys : ["id"])]);
    // A counted relation's total travels beside its rows, so it goes where
    // they go: the include asked for it, as it asked for the rows.
    if (include && Object.values(include.tree).some(node => node.count)) keep.add(INCLUDE_COUNT_KEY);
    return rows.map(row => {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(row)) {
            if (keep.has(key)) projected[key] = row[key];
        }
        return projected as T;
    });
}

/**
 * Both write checks, as one call, for a transport that is not the REST router:
 * the realtime socket's `SAVE` and MCP's write tools. The same write is then
 * judged by the same rules whichever door it came through.
 *
 * It stays at the boundary rather than moving into the driver deliberately: it
 * validates what a *caller sent*, before `beforeSave` gets a chance to fill in
 * or rewrite anything. In-process writes through `rebase.data` are trusted
 * server code and are not run through it — which is why `.private()` and
 * `access.write` are enforceable at all: something has to be able to store the
 * password hash.
 *
 * @param values the caller's payload, exactly as it arrived
 * @param table  the table's descriptor, resolved by path on the server — never
 *               a copy the client sent, or the rules would be the caller's to pick
 * @param options.viewer the caller's roles, for per-column `access.write`.
 *               Omitted is the trusted plane, which satisfies every non-empty
 *               role list; an API boundary always has one.
 */
export function assertWriteRequestValid(
    values: Record<string, unknown>,
    table: TableDescriptor,
    options?: { status?: "new" | "existing" | "copy"; viewer?: FieldViewer; relatedTables?: RelatedTableLookup }
): void {
    assertKnownWriteFields(values, table, { viewer: options?.viewer, relatedTables: options?.relatedTables });
    assertWriteValuesValid(values, table, options);
}
