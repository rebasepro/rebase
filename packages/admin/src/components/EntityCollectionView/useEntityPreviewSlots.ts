import { useMemo } from "react";
import type { EntityCollection, Property, RelationProperty } from "@rebasepro/types";
import type { Entity, PropertyConfig, EntityRelation } from "@rebasepro/types";
import { getEntityImagePreviewPropertyKey } from "@rebasepro/common";
import { getEntityTitlePropertyKey, getEntityPreviewKeys } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";
import type { AuthController } from "@rebasepro/types";
import { ChipColorScheme, CHIP_COLORS } from "@rebasepro/ui";


// ── Slot types ────────────────────────────────────────────────────────

/**
 * A resolved "slot" containing the property definition, key, and the
 * concrete value extracted from an entity.
 */
export interface PreviewSlot {
    property: Property;
    propertyKey: string;
    value: unknown;
}

/**
 * Date slot extends the base with a pre-formatted string.
 */
export interface DatePreviewSlot extends PreviewSlot {
    formatted: string;
}

/**
 * A single resolved relation chip — one item to render as a compact chip.
 * For cardinality:"one" relations there will be one chip.
 * For cardinality:"many" there can be several (capped for layout stability).
 */
export interface RelationChipItem {
    /** Human-readable display text for the chip */
    displayName: string;
    /** Relation ID */
    id: string | number;
}

/**
 * A resolved relation slot — groups all chips for one relation property.
 */
export interface RelationChipSlot {
    /** The relation property definition */
    property: RelationProperty;
    /** The property key on this entity (e.g. "author", "tags") */
    propertyKey: string;
    /** The relation property's user-facing name (e.g. "Author", "Tags") */
    label: string;
    /** Resolved chip items (display names extracted from eagerly-loaded data) */
    items: RelationChipItem[];
    /** Total count (for "many" relations that exceed the chip cap) */
    totalCount: number;
    /** Deterministic color for this relation property */
    colorScheme: ChipColorScheme;
}

/**
 * Fixed set of preview slots resolved from any entity + collection.
 *
 * Every view (list, card, board) consumes these same slots and decides
 * which ones to render and how.  This eliminates duplicated inference
 * logic across view components.
 */
export interface EntityPreviewSlots {
    /** MEDIA — image thumbnail or `undefined` (view falls back to icon) */
    image: PreviewSlot | undefined;
    /** PRIMARY — title / name field */
    title: PreviewSlot | undefined;
    /** SECONDARY — subtitle or short description (first non-title text field) */
    subtitle: PreviewSlot | undefined;
    /** RELATIONS — compact chips for all relation properties (one + many) */
    relations: RelationChipSlot[];
    /** STATUS — enum chip (first enum field that isn't the title) */
    status: PreviewSlot | undefined;
    /** META — date / timestamp */
    date: DatePreviewSlot | undefined;
    /** Entity ID (always available) */
    entityId: string | number;
}

// ── Collection-level slot resolution (entity-independent) ─────────────

/**
 * Resolved property keys per slot.  This is the expensive part (walks
 * all properties) so we memoize it at the collection level, not per entity.
 */
export interface CollectionSlotKeys {
    titleKey: string | undefined;
    imageKey: string | undefined;
    subtitleKey: string | undefined;
    relationKeys: string[];
    statusKey: string | undefined;
    dateKey: string | undefined;
}

/**
 * Resolve which property key fills each slot for a given collection.
 * Pure function — call inside `useMemo`.
 */
export function resolveCollectionSlotKeys(
    collection: EntityCollection<Record<string, unknown>>,
    authController: AuthController,
    propertyConfigs: Record<string, PropertyConfig>
): CollectionSlotKeys {
    const titleKey = getEntityTitlePropertyKey(collection, propertyConfigs);
    const imageKey = getEntityImagePreviewPropertyKey(collection);

    // Status: first string-enum that isn't the title
    let statusKey: string | undefined;
    for (const [key, prop] of Object.entries(collection.properties)) {
        const p = prop as Property;
        if (p.type === "string" && "enum" in p && p.enum && key !== titleKey) {
            statusKey = key;
            break;
        }
    }

    // Date: prefer well-known timestamp fields, fallback to any date
    let dateKey: string | undefined;
    const dateCandidates = ["updated_at", "updatedAt", "modified_at", "modifiedAt", "created_at", "createdAt"];
    for (const candidate of dateCandidates) {
        if (collection.properties[candidate]) {
            dateKey = candidate;
            break;
        }
    }
    if (!dateKey) {
        for (const [key, prop] of Object.entries(collection.properties)) {
            const p = prop as Property;
            if (p.type === "date") {
                dateKey = key;
                break;
            }
        }
    }

    // Relations: collect ALL relation property keys.
    // We iterate properties (not a hardcoded key list) and check the
    // resolved relation metadata for type === "relation".
    const relationKeys: string[] = [];
    for (const [key, prop] of Object.entries(collection.properties)) {
        const p = prop as Property;
        if (p.type === "relation") {
            relationKeys.push(key);
        }
    }

    // Subtitle: first preview key that isn't title/image/status/date/relation/id.
    // Prefer string fields (especially multiline/description-like) over numbers.
    const excludeKeys = new Set([titleKey, imageKey, statusKey, dateKey, ...relationKeys]);
    const previewKeys = getEntityPreviewKeys(authController, collection, propertyConfigs, undefined, 10)
        .filter(k => !excludeKeys.has(k) && k !== "id");

    // Sort: strings first (prefer multiline → good description candidate), then others
    const sortedPreviewKeys = [...previewKeys].sort((a, b) => {
        const propA = collection.properties[a] as Property | undefined;
        const propB = collection.properties[b] as Property | undefined;
        const scoreA = propA?.type === "string" ? (propA.multiline ? 2 : 1) : 0;
        const scoreB = propB?.type === "string" ? (propB.multiline ? 2 : 1) : 0;
        return scoreB - scoreA;
    });
    const subtitleKey = sortedPreviewKeys.length > 0 ? sortedPreviewKeys[0] : undefined;

    return { titleKey,
imageKey,
subtitleKey,
relationKeys,
statusKey,
dateKey };
}

// ── Image unwrapping helper ───────────────────────────────────────────

/**
 * Unwrap image property + value from potential array-of-images.
 * Returns `{ property, value }` where property is the *inner* property
 * and value is the first element (for arrays) or the raw value.
 */
function resolveImageSlot(
    collection: EntityCollection<Record<string, unknown>>,
    imageKey: string,
    entity: Entity<Record<string, unknown>>
): PreviewSlot | undefined {
    const imageProperty = collection.properties[imageKey];
    if (!imageProperty) return undefined;

    const ofProp = "of" in imageProperty ? imageProperty.of : undefined;
    const resolvedProperty = ofProp
        ? (Array.isArray(ofProp) ? ofProp[0] : ofProp)
        : imageProperty;

    const rawValue = getValueInPath(entity.values, imageKey);
    const resolvedValue = ofProp
        ? (((rawValue as unknown[]) ?? []).length > 0 ? (rawValue as unknown[])[0] : undefined)
        : rawValue;

    if (resolvedValue === undefined || resolvedValue === null) return undefined;

    return {
        property: resolvedProperty as Property,
        propertyKey: imageKey,
        value: resolvedValue
    };
}

// ── Date formatting ───────────────────────────────────────────────────

function formatDateValue(value: unknown): string {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value as string | number);
    if (isNaN(date.getTime())) return String(value);

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined
    });
}

// ── Hook: collection-level slot keys ──────────────────────────────────

/**
 * Resolves which property key fills each preview slot for a collection.
 * Memoized — only recomputes when the collection definition changes.
 *
 * Use this in the parent list/grid component, then pass the result to
 * `resolveEntitySlots` for each entity row.
 */
export function useCollectionSlotKeys(
    collection: EntityCollection<Record<string, unknown>>,
    authController: AuthController,
    propertyConfigs: Record<string, PropertyConfig>
): CollectionSlotKeys {
    return useMemo(
        () => resolveCollectionSlotKeys(collection, authController, propertyConfigs),
        [collection, authController, propertyConfigs]
    );
}

// ── Pure function: entity-level slot resolution ───────────────────────

/**
 * Resolve concrete slot values for a single entity.
 * This is a pure function (no hooks) so it can be called inside
 * `React.memo` render functions or loops without violating hook rules.
 */
export function resolveEntitySlots(
    entity: Entity<Record<string, unknown>>,
    collection: EntityCollection<Record<string, unknown>>,
    slotKeys: CollectionSlotKeys
): EntityPreviewSlots {
    const { titleKey, imageKey, subtitleKey, relationKeys, statusKey, dateKey } = slotKeys;

    // Image
    const image = imageKey ? resolveImageSlot(collection, imageKey, entity) : undefined;

    // Title
    let title: PreviewSlot | undefined;
    if (titleKey) {
        const prop = collection.properties[titleKey] as Property | undefined;
        const val = getValueInPath(entity.values, titleKey);
        if (prop) title = { property: prop,
propertyKey: titleKey,
value: val };
    }

    // Subtitle
    let subtitle: PreviewSlot | undefined;
    if (subtitleKey) {
        const prop = collection.properties[subtitleKey] as Property | undefined;
        const val = getValueInPath(entity.values, subtitleKey);
        if (prop && val !== undefined && val !== null && val !== "") {
            subtitle = { property: prop,
propertyKey: subtitleKey,
value: val };
        }
    }

    // Relations — resolve chip items for every relation property
    const relations: RelationChipSlot[] = [];
    const MAX_CHIPS_PER_RELATION = 3;

    for (const relKey of relationKeys) {
        const prop = collection.properties[relKey] as RelationProperty | undefined;
        if (!prop || prop.type !== "relation") continue;

        const val = getValueInPath(entity.values, relKey);
        if (val === undefined || val === null) continue;

        const items: RelationChipItem[] = [];
        let totalCount = 0;

        const isMany = prop.relation?.cardinality === "many";

        if (isMany && Array.isArray(val)) {
            // cardinality:"many" → array of EntityRelation
            totalCount = val.length;
            for (let i = 0; i < Math.min(val.length, MAX_CHIPS_PER_RELATION); i++) {
                const rel = val[i];
                if (rel && typeof rel === "object") {
                    const displayName = resolveRelationDisplayName(rel as EntityRelation, prop);
                    const id = (rel as EntityRelation).id ?? i;
                    if (displayName) {
                        items.push({ displayName,
id });
                    }
                }
            }
        } else if (!isMany && val && typeof val === "object") {
            // cardinality:"one" → single EntityRelation
            const isRelation = "__type" in val && (val as Record<string, unknown>).__type === "relation";
            if (isRelation) {
                const relation = val as unknown as EntityRelation;
                const displayName = resolveRelationDisplayName(relation, prop);
                totalCount = 1;
                if (displayName) {
                    items.push({ displayName,
id: relation.id });
                }
            }
        }

        if (items.length > 0) {
            const relIndex = relationKeys.indexOf(relKey);
            const chipColors = Object.values(CHIP_COLORS);
            const colorScheme = chipColors[relIndex % chipColors.length];
            relations.push({
                property: prop,
                propertyKey: relKey,
                label: prop.name || relKey,
                items,
                totalCount,
                colorScheme
            });
        }
    }

    // Status
    let status: PreviewSlot | undefined;
    if (statusKey) {
        const prop = collection.properties[statusKey] as Property | undefined;
        const val = getValueInPath(entity.values, statusKey);
        if (prop && val !== undefined && val !== null) {
            status = { property: prop,
propertyKey: statusKey,
value: val };
        }
    }

    // Date
    let date: DatePreviewSlot | undefined;
    if (dateKey) {
        const prop = collection.properties[dateKey] as Property | undefined;
        const val = getValueInPath(entity.values, dateKey);
        if (prop && val !== undefined && val !== null) {
            date = {
                property: prop,
                propertyKey: dateKey,
                value: val,
                formatted: formatDateValue(val)
            };
        }
    }

    return {
        image,
        title,
        subtitle,
        relations,
        status,
        date,
        entityId: entity.id
    };
}

// ── Relation display name resolution ─────────────────────────────────

/**
 * Extract a human-readable display name from an eagerly-loaded EntityRelation.
 * Uses the target collection's title property when available, otherwise
 * walks the entity values for the first short string.
 */
function resolveRelationDisplayName(
    relation: EntityRelation | Record<string, unknown>,
    prop: RelationProperty
): string | undefined {
    // Support both EntityRelation instances and plain objects
    const data = "data" in relation ? (relation as EntityRelation).data : undefined;
    if (!data || !data.values) {
        // No eagerly-loaded data — fall back to ID
        const id = "id" in relation ? relation.id : undefined;
        return id !== undefined ? String(id) : undefined;
    }

    const values = data.values as Record<string, unknown>;

    // Try using the target collection's title property for accuracy
    try {
        const targetCollection = prop.relation?.target?.();
        if (targetCollection) {
            const targetTitleKey = targetCollection.titleProperty as string | undefined;
            if (targetTitleKey && values[targetTitleKey] !== undefined) {
                return String(values[targetTitleKey]);
            }
            // Fallback: find first non-id string property in target
            for (const [k, p] of Object.entries(targetCollection.properties)) {
                const tp = p as Property;
                if (tp.type === "string" && !tp.multiline && !tp.markdown && !tp.storage && !("isId" in tp && tp.isId)) {
                    if (values[k] !== undefined && values[k] !== null) {
                        return String(values[k]);
                    }
                }
            }
        }
    } catch {
        // Target collection may not be resolvable — fall through
    }

    // Generic fallback: walk entity values for any short string.
    for (const [, v] of Object.entries(values)) {
        if (typeof v === "string" && v.length > 0 && v.length < 200) {
            return v;
        }
    }

    const id = "id" in relation ? relation.id : undefined;
    return id !== undefined ? String(id) : undefined;
}
