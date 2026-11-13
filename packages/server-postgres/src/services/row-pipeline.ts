import { INCLUDE_COUNT_KEY, JUNCTION_PIVOT_KEY, type ColumnDescriptor } from "@rebasepro/types";
import { canReadColumn, hasColumnAccessRules, restrictedKeys, restCodecOf } from "@rebasepro/common";
import type { RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { currentFieldViewer } from "./field-viewer";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { RuntimeTable } from "../model/runtime-table";

/**
 * Turning a drizzle result into the row we serve — the ONE read shape.
 *
 * REST, every socket frame, the in-process SDK and the driver's own read SPI
 * serve this row: columns under their own names, a foreign key as a key,
 * temporal columns as RFC 3339, numeric ones as numbers, and a relation only
 * when an `include` names it, as the target's own row. The admin panel's view
 * model (dates as `Date`, relations as `EntityRelation`) is built in the
 * browser from this row and the table descriptor; nothing here produces a
 * `{ __type: … }` envelope.
 *
 * There used to be a second rendering here — a `{ __type: "relation" }` ref
 * carrying the target's values, for the admin — and the two had to be kept in
 * agreement by hand: the row-identity bug was fixed five times across copies of
 * this walk. One rendering cannot disagree with itself.
 */

/**
 * Whether a many-relation reaches its target through a junction table.
 *
 * Also used to build the drizzle `with` config, which is why it is exported:
 * the query has to nest one level deeper for a junction, and the row walk has
 * to unwrap that same level back out.
 */
export function isJunctionRelation(relation: RelationDescriptor): boolean {
    // An explicit `through` says so outright.
    if (relation.kind === "manyToMany") return true;
    // A multi-hop join path is the same thing spelled longhand.
    return relation.kind === "via" && relation.steps.length > 1;
}

/**
 * Reach the target row inside a junction row.
 *
 * A junction row looks like `{ post_id: 1, tag_id: { id: 5, name: "ts" } }` —
 * the foreign keys, and the target nested under one of them. The target is the
 * only object among them, so that is how it is found. A junction row that has
 * not been nested (no `with` on the join) has no object and is returned as-is.
 *
 * "The only object" stopped being true when a junction gained pivot columns
 * (`through.pivot`): a json pivot column is an object too, and it sits in the
 * row beside the target with no guaranteed order between them — so this would
 * have unwrapped to the payload and served it as the tag. The pivot keys are
 * known from the relation, so they are skipped by name rather than by shape.
 */
function unwrapJunctionRow(
    item: Record<string, unknown>,
    relation: RelationDescriptor
): Record<string, unknown> {
    const pivot = relation.kind === "manyToMany" ? new Set(relation.through.pivot.map(column => column.key)) : undefined;
    const nestedKey = Object.keys(item).find(
        key => key !== JUNCTION_PIVOT_KEY
            && !(pivot && pivot.has(key))
            && typeof item[key] === "object" && item[key] !== null && !Array.isArray(item[key])
    );
    return nestedKey ? item[nestedKey] as Record<string, unknown> : item;
}

/**
 * Give back the number a numeric column holds.
 *
 * Postgres returns `numeric` and `bigint` as text and drizzle keeps it that
 * way, since either can hold more precision than a double. But the column is
 * numeric and the OpenAPI spec this server publishes says `type: number`, so
 * serving `"9.99"` breaks its own contract — and breaks it asymmetrically,
 * because a create answers with the number and the read that follows answers
 * with the string. Any client that multiplies a price works until the first
 * refresh.
 *
 * Serving a numeric column as a number accepts double precision — that is what
 * the admin has always parsed it to. Columns the table does not declare are
 * left exactly as the database returned them (see `restCodecOf`).
 */
function coerceDeclaredNumber(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Serve a temporal column as the timestamp this API says it serves.
 *
 * The OpenAPI document this server publishes types a `timestamptz` column as
 * `string, format: date-time` — RFC 3339 — and node-postgres hands over the
 * Postgres literal: `"2026-08-24 01:37:57.647+02"`, with a space where the `T`
 * belongs and a two-digit offset. V8 parses that by accident; Safari's
 * `new Date()` does not have to, and the spec never promised it. A column whose
 * documented type only parses in some browsers is not a contract.
 *
 * A `date` column (`format: "date"` in the spec) is already RFC 3339 as
 * `YYYY-MM-DD` and is left alone — widening it to a timestamp would
 * invent a time of day and a timezone the column does not have.
 */
function toRestDate(value: unknown): unknown {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value !== "string" && typeof value !== "number") return value;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    // Unparseable is left exactly as it arrived: inventing `null` would erase a
    // value the database holds, and this is a rendering, not a validator.
    return isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * How {@link toRestRow} renders one key of a row: inline as a relation, or as
 * a scalar through a renderer, or `null` for a value served as it arrived.
 */
type RestKeyStep = { relation: RelationDescriptor } | ((value: unknown) => unknown) | null;

/**
 * What every row of a table shares, worked out once rather than per row and
 * per column: what each key renders as. Keyed by the table's descriptor, which
 * outlives the runtime record (rebuilt when hooks or the catalogue table are
 * attached).
 */
interface RestRowPlan {
    /** Filled as keys are first seen: a row has the keys its read selected. */
    steps: Map<string, RestKeyStep>;
}

const restRowPlans = new WeakMap<TableDescriptor, RestRowPlan>();

function restRowPlan(table: TableDescriptor): RestRowPlan {
    let plan = restRowPlans.get(table);
    if (!plan) {
        plan = { steps: new Map() };
        restRowPlans.set(table, plan);
    }
    return plan;
}

/** The renderer of one column's values, or `null` for values served as they arrived. */
function restScalarStep(column: ColumnDescriptor | undefined): ((value: unknown) => unknown) | null {
    if (!column) return null;
    switch (restCodecOf(column)) {
        case "number": return coerceDeclaredNumber;
        case "timestamp":
        case "date":
        case "time": return toRestDate;
        case "passthrough": return null;
    }
}

function restKeyStep(table: RuntimeTable, key: string): RestKeyStep {
    const relation = table.relations.get(key);
    if (relation) return { relation };
    return restScalarStep(table.columnsByKey.get(key));
}

/**
 * One scalar, as REST serves it: numeric columns as numbers, temporal ones as
 * RFC 3339, everything else — and a key the table does not declare — exactly
 * as the database returned it.
 */
export function toRestScalar(value: unknown, column: ColumnDescriptor | undefined): unknown {
    const step = restScalarStep(column);
    return step ? step(value) : value;
}

/**
 * Apply {@link toRestScalar} across a row, leaving undeclared columns alone.
 *
 * A target rendered differently from its parent is the shape bug this whole
 * file exists to prevent — a date was once a string at the top level and an
 * envelope one level down, in the same response. The include loader renders
 * its targets with {@link toRestRow} for the same reason.
 */
function toRestValues(
    row: Record<string, unknown>,
    table: RuntimeTable
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = toRestScalar(value, table.columnsByKey.get(key));
    }
    return out;
}

/**
 * Whether the table restricts any column or relation, worked out once per
 * descriptor: every read of every row runs through the strip, and the table
 * with no rules — almost all of them — has to cost one map lookup.
 */
const tablesWithRules = new WeakMap<TableDescriptor, boolean>();

function restrictsAnything(table: TableDescriptor): boolean {
    let restricts = tablesWithRules.get(table);
    if (restricts === undefined) {
        restricts = hasColumnAccessRules(table);
        tablesWithRules.set(table, restricts);
    }
    return restricts;
}

/** The name a `_matches` entry reports: the entry itself, or its `field`. */
function matchedField(match: unknown): string {
    if (typeof match === "string") return match;
    if (typeof match === "object" && match !== null && "field" in match) return String(match.field);
    return String(match);
}

/**
 * Drop every column this caller may not read, as the table's descriptor says.
 *
 * Password hashes and verification tokens have to be readable server-side but
 * must never reach a client — and "never" has to mean every exit from this
 * pipeline, including relation targets, or a secret leaks through whichever
 * path was overlooked. Keyed by both the column key and its SQL name, since a
 * row can arrive keyed either way depending on the caller.
 *
 * `.private()` is the rule no caller satisfies (`read: []`), so it needs no
 * branch of its own; `.access({ read: ["hr"] })` is the same question asked of
 * {@link currentFieldViewer}. The names are common's `restrictedKeys`, the one
 * answer every enforcement point reads.
 *
 * The field is **deleted**, never nulled. A withheld value that arrives as
 * `null` is indistinguishable from a stored `null`, which turns a permission
 * boundary into a question a client can answer by counting nulls — and it makes
 * an `update` that echoes the row back overwrite the real value with the null it
 * was handed.
 *
 * A withheld relation (`rel.*(…, { access })`, `{ private: true }`) is withheld
 * whole, and a withheld `belongsTo` takes its foreign key with it: `bandId: 7`
 * names the salary band exactly as `band: { id: 7 }` does.
 *
 * `_matches` is filtered rather than deleted: it is the list of fields a text
 * search hit, and a field the caller cannot read must not appear in it even
 * though the array itself is theirs to see.
 */
export function stripUnreadable(
    row: Record<string, unknown>,
    table: TableDescriptor
): Record<string, unknown> {
    if (!restrictsAnything(table)) return row;

    const { refused: hidden } = restrictedKeys(table, currentFieldViewer(), "read");
    if (hidden.size === 0) return row;
    for (const name of hidden) delete row[name];

    // A relation withheld from this viewer is withheld whole: its total under
    // `_count` says as much about it as its rows would.
    const counts = row[INCLUDE_COUNT_KEY];
    if (counts && typeof counts === "object") {
        const remaining = Object.fromEntries(Object.entries(counts).filter(([name]) => !hidden.has(name)));
        if (Object.keys(remaining).length === 0) delete row[INCLUDE_COUNT_KEY];
        else row[INCLUDE_COUNT_KEY] = remaining;
    }
    if (Array.isArray(row._matches)) {
        row._matches = row._matches.filter((match: unknown) => !hidden.has(matchedField(match)));
    }
    return row;
}

/**
 * May the current caller be handed the rows of this relation?
 *
 * A relation's value *is* its related rows, so a relation the caller may not
 * read (`rel.*(…, { access: { read } })`, `{ private: true }`) is withheld
 * whole: an `include` neither loads it nor counts it. {@link stripUnreadable}
 * cannot be the only guard here, because the REST rows are stripped before the
 * include loader runs (`toRestRow`, then `loadIncludes`) — the loader wrote the
 * rows back onto the key the strip had just deleted, and `_count` beside them.
 */
export function canReadRelation(relation: RelationDescriptor): boolean {
    return canReadColumn(relation, currentFieldViewer());
}

/**
 * A related row as an `include` embeds it: the target's columns, and only
 * those — its address is the consumer's to derive, and merging one in
 * overwrites a real `id` column — rendered and stripped by the target's own
 * descriptor, exactly as its own route serves it.
 */
function renderTarget(targetRow: Record<string, unknown>, target: RuntimeTable): Record<string, unknown> {
    return stripUnreadable(toRestValues({ ...targetRow }, target), target.descriptor);
}

/**
 * The row REST serves: every column under its own name, with the value Postgres
 * returned, and relations inlined as the target's columns.
 *
 * Values are the ones the database returned, except where that contradicts the
 * column's type: a numeric column is served as a number (see
 * {@link coerceDeclaredNumber}) and a temporal one as RFC 3339, which is what
 * this server's own OpenAPI document says such a column is (see
 * {@link toRestDate}).
 *
 * Keyed by the row rather than by the relation list — a REST fetch only loads
 * the relations `include` asked for, so the row is the authority on which are
 * actually there.
 */
export function toRestRow(
    row: Record<string, unknown>,
    table: RuntimeTable,
    registry: PostgresTableRegistry
): Record<string, unknown> {
    const { steps } = restRowPlan(table.descriptor);
    const flat: Record<string, unknown> = {};

    for (const key of Object.keys(row)) {
        const value = row[key];
        let step = steps.get(key);
        if (step === undefined) {
            step = restKeyStep(table, key);
            steps.set(key, step);
        }

        if (step === null) {
            flat[key] = value;
        } else if (typeof step === "function") {
            flat[key] = step(value);
        } else if (Array.isArray(value)) {
            const { relation } = step;
            flat[key] = value.map((item: Record<string, unknown>) =>
                renderTarget(
                    isJunctionRelation(relation) ? unwrapJunctionRow(item, relation) : item,
                    registry.requireTable(relation.target)
                ));
        } else if (typeof value === "object" && value !== null) {
            flat[key] = renderTarget(value as Record<string, unknown>, registry.requireTable(step.relation.target));
        } else {
            // A relation's key holding a scalar: its foreign key, as a scalar.
            flat[key] = toRestScalar(value, table.columnsByKey.get(key));
        }
    }

    return stripUnreadable(flat, table.descriptor);
}
