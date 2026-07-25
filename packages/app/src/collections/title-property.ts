import type { Property, Relation } from "@rebasepro/types";
import { generateForeignKeyName } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/admin-types";
import { getPrimaryKeys, isPropertyBuilder } from "@rebasepro/common";

/**
 * How good a property is as the human-readable title of an entity.
 * Higher wins; ties are broken by declaration order.
 * `DISQUALIFIED` means the property can never be a title.
 */
const SCORE = {
    DISQUALIFIED: -1,
    /**
     * Points at another entity. Only readable once the target resolves, and it
     * renders as the raw key until then — last resort, for collections (like
     * junction tables) that hold no text of their own.
     */
    REFERENCE: 5,
    RELATION: 10,
    /** A user picker: resolves to a person's name, like a relation does */
    USER: 10,
    /** Long form text — readable, but a description, not a name */
    LONG_TEXT: 20,
    /** A closed set of values: shared by many rows, so it identifies nothing */
    ENUM: 30,
    /** Identifying, but PII and usually secondary to a name */
    EMAIL: 45,
    /** Any plain, short, free text field */
    PLAIN_TEXT: 60,
    /** Free text whose name says it holds the entity's label */
    NAMED: 100
} as const;

/**
 * Keys whose name states outright that the property is the entity label.
 * This is a *bonus* on top of the structural rules — never a requirement, and
 * never the mechanism that keeps identifiers out of the title slot.
 */
const TITLE_LIKE_KEYS = new Set([
    "name",
    "fullname",
    "displayname",
    "title",
    "label",
    "heading",
    "subject",
    "username",
    "nickname"
]);

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isHidden(property: Property): boolean {
    return Boolean(property.ui?.hideFromCollection);
}

/**
 * File-storage backed content (single image, array of images, generic upload…).
 * Rendered by the dedicated image slot, so never a title.
 */
function isStorageProperty(property: Property): boolean {
    if (property.type === "string" && (property.storage || property.ui?.url === "image")) return true;
    if (property.type === "array" && property.of && !Array.isArray(property.of)) {
        const inner = property.of;
        if (inner.type === "string" && (inner.storage || inner.ui?.url === "image")) return true;
    }
    return false;
}

/**
 * Every column on this collection that stores a foreign key: the `localKey` of
 * each owning relation (declared inline on a property or in `relations[]`), the
 * source column of a junction, and the key a many-to-many joins on.
 *
 * These hold another entity's id, so they must never fill the title slot even
 * though they are declared as plain strings.
 */
function getForeignKeyColumns<M extends Record<string, unknown>>(collection: AdminCollection<M>): Set<string> {
    const keys = new Set<string>();

    const addRelationKeys = (relation: Pick<Relation, "localKey" | "through" | "joinPath">) => {
        if (relation.localKey) keys.add(relation.localKey);
        if (relation.through?.sourceColumn) keys.add(relation.through.sourceColumn);
        // Only the first hop of a join path starts on this collection's table.
        const firstStep = relation.joinPath?.[0];
        if (firstStep) {
            const from = firstStep.on?.from;
            for (const column of Array.isArray(from) ? from : [from]) {
                if (column) keys.add(column);
            }
        }
    };

    for (const relation of collection.relations ?? []) {
        addRelationKeys(relation);
    }

    for (const [key, propertyRaw] of Object.entries(collection.properties ?? {})) {
        const property = propertyRaw as Property | undefined;
        if (!property || isPropertyBuilder(property) || property.type !== "relation") continue;
        addRelationKeys(property);
        if (property.relation) addRelationKeys(property.relation);
        // An owning one-to-one whose localKey was left to be inferred still
        // consumes a column; assume the conventional `<relation>_id` name.
        if ((property.cardinality ?? "one") === "one" && (property.direction ?? "owning") === "owning") {
            keys.add(generateForeignKeyName(property.relationName || key));
        }
    }

    return keys;
}

/**
 * True when the property is declared to hold an opaque identifier rather than
 * something a person reads: a primary key, a foreign key, a UUID column, or a
 * picker bound to an auth user id. Decided from the property *schema*, never
 * from the key name.
 */
function isIdentifierProperty(property: Property, key: string, idKeys: Set<string>, foreignKeys: Set<string>): boolean {
    if (idKeys.has(key)) return true;
    if (foreignKeys.has(key)) return true;
    if ("isId" in property && property.isId) return true;
    if (property.type === "string" && property.columnType === "uuid") return true;
    return false;
}

function scoreTitleCandidate(property: Property, key: string, idKeys: Set<string>, foreignKeys: Set<string>): number {
    if (isHidden(property)) return SCORE.DISQUALIFIED;
    if (isIdentifierProperty(property, key, idKeys, foreignKeys)) return SCORE.DISQUALIFIED;
    if (isStorageProperty(property)) return SCORE.DISQUALIFIED;

    if (property.type === "relation") {
        const isMany = property.cardinality === "many" || property.relation?.cardinality === "many";
        return isMany ? SCORE.DISQUALIFIED : SCORE.RELATION;
    }
    if (property.type === "reference") {
        return SCORE.REFERENCE;
    }
    if (property.type !== "string") {
        // Numbers, dates, booleans, maps and arrays never read as a title.
        return SCORE.DISQUALIFIED;
    }

    // A user picker stores an auth user id but renders the person behind it, so
    // it ranks with relations: usable as a title, but only as a last resort.
    if (property.userSelect) return SCORE.USER;
    if (property.enum) return SCORE.ENUM;
    if (property.ui?.multiline || property.ui?.markdown) return SCORE.LONG_TEXT;
    if (property.email) return SCORE.EMAIL;
    if (TITLE_LIKE_KEYS.has(normalizeKey(key))) return SCORE.NAMED;
    return SCORE.PLAIN_TEXT;
}

/**
 * All properties that could serve as the entity title, best first.
 *
 * Candidates are ranked from the property *schema* — identifiers (primary
 * keys, foreign keys, UUID columns, user pickers), images and hidden fields are
 * excluded structurally, so a collection whose id column is called something
 * other than `id` is handled the same as one where it isn't.
 *
 * When the collection declares `propertiesOrder` the developer has already
 * stated what comes first, so qualifying candidates keep that order; otherwise
 * they are ranked (a name beats a description beats a relation).
 *
 * @group Collections
 */
export function getTitlePropertyCandidates<M extends Record<string, unknown>>(
    collection: AdminCollection<M>
): string[] {
    if (!collection.properties) return [];

    if (collection.titleProperty && collection.properties[collection.titleProperty as string]) {
        return [collection.titleProperty as string];
    }

    const idKeys = new Set<string>(getPrimaryKeys(collection) as string[]);
    const foreignKeys = getForeignKeyColumns(collection);
    const explicitOrder = collection.propertiesOrder as string[] | undefined;
    const order = explicitOrder ?? Object.keys(collection.properties);

    const scored: { key: string; score: number; index: number }[] = [];
    order.forEach((key, index) => {
        const property = collection.properties[key];
        if (!property || isPropertyBuilder(property)) return;
        const score = scoreTitleCandidate(property as Property, key, idKeys, foreignKeys);
        if (score === SCORE.DISQUALIFIED) return;
        scored.push({ key,
score,
index });
    });

    // An explicit `propertiesOrder` is a statement of what matters first, so it
    // wins over the ranking — the ranking only decides between properties the
    // developer never ordered.
    if (!explicitOrder) {
        scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    }

    return scored.map(candidate => candidate.key);
}

/**
 * The property that should fill the title slot for a collection, ignoring any
 * concrete values. Prefer {@link getTitlePropertyKeyForValues} when an entity
 * is at hand — it can skip candidates that happen to be empty or to hold an id.
 *
 * @group Collections
 */
export function getTitlePropertyKey<M extends Record<string, unknown>>(
    collection: AdminCollection<M>
): string | undefined {
    return getTitlePropertyCandidates(collection)[0];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_REGEX = /^[0-9a-f]{24,}$/i;
const CUID_REGEX = /^c[a-z0-9]{20,}$/i;

/**
 * True when a value reads as a machine identifier (UUID, ObjectId/long hex,
 * cuid) rather than as something worth showing to a person.
 *
 * @group Collections
 */
export function looksLikeIdentifierValue(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    return UUID_REGEX.test(trimmed) || LONG_HEX_REGEX.test(trimmed) || CUID_REGEX.test(trimmed);
}

/**
 * The title property for a concrete entity: the best-ranked candidate that
 * actually carries a readable value. Candidates that are empty, that repeat the
 * entity id, or that hold an opaque identifier are skipped, so a free-text
 * column that happens to store UUIDs never ends up as the title.
 *
 * Returns the top-ranked candidate when none of them has a usable value, so
 * callers can still render a placeholder for that property.
 *
 * @group Collections
 */
export function getTitlePropertyKeyForValues<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    values: Record<string, unknown> | undefined,
    entityId?: string | number
): string | undefined {
    const candidates = getTitlePropertyCandidates(collection);
    if (!values || candidates.length === 0) return candidates[0];

    for (const key of candidates) {
        const value = values[key];
        if (value === undefined || value === null || value === "") continue;
        if (typeof value === "string") {
            if (looksLikeIdentifierValue(value)) continue;
            if (entityId !== undefined && value === String(entityId)) continue;
        }
        return key;
    }

    return candidates[0];
}
