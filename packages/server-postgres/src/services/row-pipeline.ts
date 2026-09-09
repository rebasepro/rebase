import { CollectionConfig, Property, ResolvedRelation, isManyToMany, type ResolvedVia } from "@rebasepro/types";
import { canReadField, resolveCollectionRelations, findRelation, createRelationRefWithData } from "@rebasepro/common";
import { currentFieldViewer } from "./field-viewer";
import { normalizeDbValues } from "../data-transformer";
import { deriveRowAddress } from "./collection-helpers";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";

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
 */
function unwrapJunctionRow(item: Record<string, unknown>): Record<string, unknown> {
    const nestedKey = Object.keys(item).find(
        key => typeof item[key] === "object" && item[key] !== null && !Array.isArray(item[key])
    );
    return nestedKey ? item[nestedKey] as Record<string, unknown> : item;
}

/**
 * Give back the number a `number` property was declared to be.
 *
 * Postgres returns NUMERIC as a string and drizzle keeps it that way, since a
 * numeric can hold more precision than a double. But the collection declared
 * this property `number` and the OpenAPI spec this server publishes says
 * `type: number`, so serving `"9.99"` breaks its own contract — and breaks it
 * asymmetrically, because a create answers with the number and the read that
 * follows answers with the string. Any client that multiplies a price works
 * until the first refresh.
 *
 * Declaring a property `number` already accepts double precision — that is what
 * the admin has always parsed it to. Columns REST serves that no property
 * declares are left exactly as the database returned them.
 */
function coerceDeclaredNumber(value: unknown, property: Property | undefined): unknown {
    if (property?.type !== "number" || typeof value !== "string") return value;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Serve a `date` column as the timestamp this API says it serves.
 *
 * The OpenAPI document this server publishes types a `date` property as
 * `string, format: date-time` — RFC 3339 — and node-postgres hands over the
 * Postgres literal: `"2026-08-24 01:37:57.647+02"`, with a space where the `T`
 * belongs and a two-digit offset. V8 parses that by accident; Safari's
 * `new Date()` does not have to, and the spec never promised it. A column whose
 * documented type only parses in some browsers is not a contract.
 *
 * A date-only column (`mode: "date"`, `format: "date"` in the spec) is already
 * RFC 3339 as `YYYY-MM-DD` and is left alone — widening it to a timestamp would
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
 * One scalar, as REST serves it: declared numbers as numbers, declared dates as
 * RFC 3339, everything else exactly as the database returned it.
 */
function toRestScalar(value: unknown, property: Property | undefined): unknown {
    if (property?.type === "date") return toRestDate(value);
    return coerceDeclaredNumber(value, property);
}

/**
 * Apply {@link toRestScalar} across a row, leaving undeclared columns alone.
 *
 * Exported because the include loader attaches related rows itself, and a
 * target rendered differently from its parent is the shape bug this whole file
 * exists to prevent — a date was a string at the top level and a
 * `{ __type: "date" }` envelope one level down, in the same response.
 */
export function toRestValues(
    row: Record<string, unknown>,
    collection: CollectionConfig
): Record<string, unknown> {
    const properties = collection.properties;
    if (!properties) return row;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = toRestScalar(value, properties[key] as Property | undefined);
    }
    return out;
}

/** Render one target row in the requested style. */
/**
 * Drop every column this caller may not read.
 *
 * Password hashes and verification tokens have to be readable server-side but
 * must never reach a client — and "never" has to mean every exit from this
 * pipeline, including relation targets, or a secret leaks through whichever
 * path was overlooked. Keyed by both the property name and its column name,
 * since a row can arrive keyed either way depending on the caller.
 *
 * `excludeFromApi` is the case with no roles in it: `effectiveAccess` expands
 * the flag to `read: []`, which no caller satisfies, so the flag needs no branch
 * of its own here and no longer has one. `access.read: ["hr"]` is the same walk
 * asking a different question of {@link currentFieldViewer}.
 *
 * The field is **deleted**, never nulled. A withheld value that arrives as
 * `null` is indistinguishable from a stored `null`, which turns a permission
 * boundary into a question a client can answer by counting nulls — and it makes
 * an `update` that echoes the row back overwrite the real value with the null it
 * was handed.
 *
 * `_matches` is filtered rather than deleted: it is the list of fields a text
 * search hit, and a field the caller cannot read must not appear in it even
 * though the array itself is theirs to see.
 */
export function stripUnreadable(
    row: Record<string, unknown>,
    collection: CollectionConfig
): Record<string, unknown> {
    const properties = collection.properties as Record<string, Property> | undefined;
    if (!properties) return row;

    const viewer = currentFieldViewer();
    const hidden = new Set<string>();

    for (const [key, property] of Object.entries(properties)) {
        if (canReadField(property, viewer)) continue;
        hidden.add(key);
        delete row[key];
        if (property.columnName) {
            hidden.add(property.columnName);
            delete row[property.columnName];
        }
    }

    if (hidden.size > 0 && Array.isArray(row._matches)) {
        row._matches = (row._matches as unknown[]).filter(
            match => !hidden.has(typeof match === "string" ? match : String((match as { field?: unknown })?.field))
        );
    }
    return row;
}

function renderTarget(
    targetRow: Record<string, unknown>,
    targetCollection: CollectionConfig,
    style: RelationStyle,
    registry: PostgresCollectionRegistry
): unknown {
    if (style === "inline") {
        // The target's columns, and only those: its address is the consumer's
        // to derive, and merging one in overwrites a real `id` column.
        return stripUnreadable(toRestValues({ ...targetRow }, targetCollection), targetCollection);
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
            normalizeDbValues(targetRow, targetCollection) as Record<string, unknown>,
            targetCollection
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
    registry: PostgresCollectionRegistry
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
    registry: PostgresCollectionRegistry
): Record<string, unknown> {
    const resolvedRelations = resolveCollectionRelations(collection);
    const normalized = normalizeDbValues(row, collection) as Record<string, unknown>;

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
                    isJunctionRelation(relation) ? unwrapJunctionRow(item) : item,
                    targetCollection,
                    "ref",
                    registry
                ));
        } else if (relation.cardinality === "one" && typeof relData === "object" && !Array.isArray(relData)) {
            normalized[key] = renderTarget(relData as Record<string, unknown>, relation.target(), "ref", registry);
        }
    }

    return stripUnreadable(normalized, collection);
}

/**
 * The row REST serves: every column under its own name, with the value Postgres
 * returned, and relations inlined as the target's columns.
 *
 * Values are the ones the database returned, except where that contradicts the
 * declared type: a `number` property is served as a number (see
 * {@link coerceDeclaredNumber}) and a `date` as RFC 3339, which is what this
 * server's own OpenAPI document says a date column is (see
 * {@link toRestDate}).
 *
 * Keyed by the row rather than by the relation list — a REST fetch only loads
 * the relations `include` asked for, so the row is the authority on which are
 * actually there.
 */
export function toRestRow(
    row: Record<string, unknown>,
    collection: CollectionConfig,
    registry: PostgresCollectionRegistry
): Record<string, unknown> {
    const resolvedRelations = resolveCollectionRelations(collection);
    const flat: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
        const relation = findRelation(resolvedRelations, key);

        if (relation && Array.isArray(value)) {
            flat[key] = value.map((item: Record<string, unknown>) =>
                renderTarget(
                    isJunctionRelation(relation) ? unwrapJunctionRow(item) : item,
                    relation.target(),
                    "inline",
                    registry
                ));
        } else if (relation && typeof value === "object" && value !== null) {
            flat[key] = renderTarget(value as Record<string, unknown>, relation.target(), "inline", registry);
        } else {
            flat[key] = toRestScalar(value, collection.properties?.[key] as Property | undefined);
        }
    }

    return stripUnreadable(flat, collection);
}
