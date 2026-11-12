import { CollectionConfig, INCLUDE_COUNT_KEY, JUNCTION_PIVOT_KEY, ResolvedRelation, isManyToMany, type ColumnDescriptor, type ResolvedVia } from "@rebasepro/types";
import { canReadColumn, hasColumnAccessRules, restrictedKeys, resolveCollectionRelations, findRelation, createRelationRefWithData, restCodecOf } from "@rebasepro/common";
import type { RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { currentFieldViewer } from "./field-viewer";
import { normalizeDbValues } from "../data-transformer";
import { deriveRowAddress } from "./collection-helpers";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { RuntimeTable } from "../model/runtime-table";

/**
 * Turning a drizzle result into a row we serve.
 *
 * There are two shapes, and they are the same walk. Both take a row whose
 * relation fields hold nested objects, both unwrap junction rows to reach the
 * target behind them, and both leave every other column alone. They differ only
 * in what they put where the relation was:
 *
 * - `"ref"` — a `{ id, path, __type: "relation" }` reference carrying the
 *   target's values. This is what the admin renders.
 * - `"inline"` — the target's own columns, flat. This is what REST serves, and
 *   — since the in-process SDK reads through the same pipeline — what
 *   `rebase.dataAsAdmin` / `context.data` serve too. A developer never sees a ref.
 *
 * They used to be two functions that happened to agree, and the agreement was
 * not enforced by anything: the row-identity bug had to be fixed five times
 * across differently-shaped copies of this walk, and one of the copies was
 * dead code nobody had noticed. Whatever the next cross-cutting change is, it
 * is one edit here.
 */
export type RelationStyle = "ref" | "inline";

/**
 * Whether a many-relation reaches its target through a junction table.
 *
 * Also used to build the drizzle `with` config, which is why it is exported:
 * the query has to nest one level deeper for a junction, and the row walk has
 * to unwrap that same level back out.
 */
export function isJunctionRelation(relation: ResolvedRelation): boolean {
    // An explicit `through` says so outright.
    if (isManyToMany(relation)) return true;
    // A multi-hop join path is the same thing spelled longhand.
    return relation.kind === "via" && relation.joinPath.length > 1;
}

/**
 * Reach the target row inside a junction row.
 *
 * A junction row looks like `{ post_id: 1, tag_id: { id: 5, name: "ts" } }` —
 * the foreign keys, and the target nested under one of them. The target is the
 * only object among them, so that is how it is found. A junction row that has
 * not been nested (no `with` on the join) has no object and is returned as-is.
 *
 * "The only object" stopped being true when a junction gained
 * `through.properties`: a payload `map` is an object too, and it sits in the
 * row beside the target with no guaranteed order between them — so this would
 * have unwrapped to the payload and served it as the tag. The payload keys are
 * known from the relation, so they are skipped by name rather than by shape.
 */
function unwrapJunctionRow(
    item: Record<string, unknown>,
    relation: ResolvedRelation
): Record<string, unknown> {
    const payload = isManyToMany(relation) ? relation.through.properties : undefined;
    const nestedKey = Object.keys(item).find(
        key => key !== JUNCTION_PIVOT_KEY
            && !(payload && key in payload)
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
    // An upstream walk may already have tagged it for the admin's view model.
    if (value && typeof value === "object" && (value as { __type?: unknown }).__type === "date") {
        return (value as { value?: unknown }).value ?? null;
    }
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
type RestKeyStep = { relation: ResolvedRelation } | ((value: unknown) => unknown) | null;

/**
 * What every row of a collection shares, worked out once rather than per row
 * and per column: what each key renders as. Keyed by the collection object,
 * as `resolveCollectionRelations` caches its relations.
 */
interface RestRowPlan {
    /** Filled as keys are first seen: a row has the keys its read selected. */
    steps: Map<string, RestKeyStep>;
}

const restRowPlans = new WeakMap<CollectionConfig, RestRowPlan>();

function restRowPlan(collection: CollectionConfig): RestRowPlan {
    let plan = restRowPlans.get(collection);
    if (!plan) {
        plan = { steps: new Map() };
        restRowPlans.set(collection, plan);
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

function restKeyStep(collection: CollectionConfig, table: RuntimeTable, key: string): RestKeyStep {
    const relation = findRelation(resolveCollectionRelations(collection), key);
    if (relation) return { relation };
    return restScalarStep(table.columnsByKey.get(key));
}

/**
 * One scalar, as REST serves it: numeric columns as numbers, temporal ones as
 * RFC 3339, everything else — and a key the table does not declare — exactly
 * as the database returned it.
 */
function toRestScalar(value: unknown, column: ColumnDescriptor | undefined): unknown {
    const step = restScalarStep(column);
    return step ? step(value) : value;
}

/**
 * Apply {@link toRestScalar} across a row, leaving undeclared columns alone.
 *
 * A target rendered differently from its parent is the shape bug this whole
 * file exists to prevent — a date was a string at the top level and a
 * `{ __type: "date" }` envelope one level down, in the same response. The
 * include loader renders its targets with {@link toRestRow}, through
 * `RelationService`'s `"rest"` style, for the same reason.
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

function renderTarget(
    targetRow: Record<string, unknown>,
    targetCollection: CollectionConfig,
    style: RelationStyle,
    registry: PostgresTableRegistry
): unknown {
    if (style === "inline") {
        // The target's columns, and only those: its address is the consumer's
        // to derive, and merging one in overwrites a real `id` column.
        const target = registry.requireTable(targetCollection.slug);
        return stripUnreadable(toRestValues({ ...targetRow }, target), target.descriptor);
    }

    const address = relationTargetAddress(targetRow, targetCollection, registry);
    const path = targetCollection.slug;
    return createRelationRefWithData(address, path, {
        id: address,
        path,
        // Stripped here as well as in the inline branch above. The two branches
        // are the same data in two renderings — REST inlines the target's
        // columns, the admin and every realtime frame carry a ref with those
        // columns attached — and only the first one was filtered. So a password
        // hash that REST correctly withheld rode out on every `.listen()` frame
        // and every WebSocket fetch of anything with a relation to users.
        values: stripUnreadable(
            normalizeDbValues(targetRow, registry.requireTable(targetCollection.slug)) as Record<string, unknown>,
            registry.requireTable(targetCollection.slug).descriptor
        )
    });
}

/**
 * The address a relation ref points at.
 *
 * The whole key, not its first column: a composite-keyed target addressed by
 * `tenant_id` alone points at every row that shares it. A target whose key
 * cannot be resolved at all used to throw here — reading `[0]` of an empty
 * array — taking down the parent's fetch over a relation it may not even have
 * asked for. The first column is a guess, but a ref that resolves to nothing
 * beats no rows at all.
 */
export function relationTargetAddress(
    targetRow: Record<string, unknown>,
    targetCollection: CollectionConfig,
    registry: PostgresTableRegistry
): string {
    const address = deriveRowAddress(targetRow, targetCollection, registry);
    if (address) return address;
    return String(targetRow[Object.keys(targetRow)[0]] ?? "");
}

/**
 * The row the admin renders: every column, with relations as references.
 *
 * Values are normalized (dates, numbers, NaN) because the admin's view-model
 * expects real types. The row's own address is *not* among the columns — it is
 * derived by the consumer from the collection's primary keys.
 */
export function toFlatRow(
    row: Record<string, unknown>,
    collection: CollectionConfig,
    registry: PostgresTableRegistry
): Record<string, unknown> {
    const resolvedRelations = resolveCollectionRelations(collection);
    const normalized = normalizeDbValues(row, registry.requireTable(collection.slug)) as Record<string, unknown>;

    // Keyed by relation, reading the drizzle relation name off the raw row: the
    // relation's property key and the name drizzle nested it under are not
    // always the same, and the value is written back under the property key.
    for (const [key, relation] of Object.entries(resolvedRelations)) {
        const relData = row[relation.relationName || key];
        if (relData === undefined || relData === null) continue;

        if (relation.cardinality === "many" && Array.isArray(relData)) {
            const targetCollection = relation.target();
            normalized[key] = relData.map((item: Record<string, unknown>) =>
                renderTarget(
                    isJunctionRelation(relation) ? unwrapJunctionRow(item, relation) : item,
                    targetCollection,
                    "ref",
                    registry
                ));
        } else if (relation.cardinality === "one" && typeof relData === "object" && !Array.isArray(relData)) {
            normalized[key] = renderTarget(relData as Record<string, unknown>, relation.target(), "ref", registry);
        }
    }

    return stripUnreadable(normalized, registry.requireTable(collection.slug).descriptor);
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
    collection: CollectionConfig,
    registry: PostgresTableRegistry
): Record<string, unknown> {
    const { steps } = restRowPlan(collection);
    const table = registry.requireTable(collection.slug);
    const flat: Record<string, unknown> = {};

    for (const key of Object.keys(row)) {
        const value = row[key];
        let step = steps.get(key);
        if (step === undefined) {
            step = restKeyStep(collection, table, key);
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
                    relation.target(),
                    "inline",
                    registry
                ));
        } else if (typeof value === "object" && value !== null) {
            flat[key] = renderTarget(value as Record<string, unknown>, step.relation.target(), "inline", registry);
        } else {
            // A relation's key holding a scalar: its foreign key, as a scalar.
            flat[key] = toRestScalar(value, table.columnsByKey.get(key));
        }
    }

    return stripUnreadable(flat, table.descriptor);
}
