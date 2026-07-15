import { useMemo } from "react";
import type { CollectionConfig, Property, RelationProperty } from "@rebasepro/types";
import type { Entity, PropertyConfig, EntityRelation } from "@rebasepro/types";
import { getEntityImagePreviewPropertyKey } from "@rebasepro/common";
import { getEntityFromCache } from "@rebasepro/app";
import { getEntityTitlePropertyKey, getEntityPreviewKeys } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";
import type { AuthController } from "@rebasepro/types";
import { ChipColorScheme, CHIP_COLORS } from "@rebasepro/ui";


// ── Slot types ────────────────────────────────────────────────────────

/**
 * A resolved "slot" containing the property definition, key, and the
 * concrete value extracted from a entity.
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
    collection: CollectionConfig<Record<string, unknown>>,
    authController: AuthController,
    propertyConfigs: Record<string, PropertyConfig>
): CollectionSlotKeys {
    const titleKey = getEntityTitlePropertyKey(collection, propertyConfigs);
    const imageKey = getEntityImagePreviewPropertyKey(collection);

    // Status: first string-enum that isn't the title
    let statusKey: string | undefined;

    // 1. Explicitly defined in previewProperties
    if (!statusKey && collection.previewProperties) {
        for (const key of collection.previewProperties) {
            const p = collection.properties[key] as Property | undefined;
            if (p?.type === "string" && "enum" in p && p.enum && key !== titleKey) {
                statusKey = key;
                break;
            }
        }
    }

    // 2. Explicitly defined in propertiesOrder
    if (!statusKey && collection.propertiesOrder) {
        for (const key of collection.propertiesOrder) {
            if (typeof key === "string" && !key.startsWith("subcollection:")) {
                const p = collection.properties[key] as Property | undefined;
                if (p?.type === "string" && "enum" in p && p.enum && key !== titleKey) {
                    statusKey = key;
                    break;
                }
            }
        }
    }

    // 3. Default automatic inference
    if (!statusKey) {
        for (const [key, prop] of Object.entries(collection.properties)) {
            const p = prop as Property;
            if (p.type === "string" && "enum" in p && p.enum && key !== titleKey) {
                statusKey = key;
                break;
            }
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

    // Relations: collect relation property keys for chip rendering.
    // When propertiesOrder is explicitly set, skip this — relations will
    // be shown in the developer-defined order, not as separate chips.
    const hasExplicitOrder = !!(collection.propertiesOrder as string[] | undefined);
    const relationKeys: string[] = [];
    if (!hasExplicitOrder) {
        for (const [key, prop] of Object.entries(collection.properties)) {
            const p = prop as Property;
            if (p.type === "relation") {
                relationKeys.push(key);
            }
        }
    }

    // Subtitle: first preview key that isn't title/image/status/date/id.
    // When propertiesOrder is not set, also exclude relation keys (they render as chips).
    // Prefer string fields (especially multiline/description-like) over numbers.
    const excludeKeys = new Set([titleKey, imageKey, statusKey, dateKey, ...relationKeys]);
    const previewKeys = getEntityPreviewKeys(authController, collection, propertyConfigs, undefined, 10)
        .filter(k => !excludeKeys.has(k) && k !== "id");

    // When propertiesOrder is set, respect the developer-defined order (no re-sorting).
    // When not set, sort: strings first (prefer multiline → good description candidate).
    const sortedPreviewKeys = hasExplicitOrder
        ? previewKeys
        : [...previewKeys].sort((a, b) => {
            const propA = collection.properties[a] as Property | undefined;
            const propB = collection.properties[b] as Property | undefined;
            const scoreA = propA?.type === "string" ? (propA.ui?.multiline ? 2 : 1) : 0;
            const scoreB = propB?.type === "string" ? (propB.ui?.multiline ? 2 : 1) : 0;
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
    collection: CollectionConfig<Record<string, unknown>>,
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
    collection: CollectionConfig<Record<string, unknown>>,
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
    collection: CollectionConfig<Record<string, unknown>>,
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

        const isMany = prop.cardinality === "many" || prop.relation?.cardinality === "many";

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
            const obj = val as Record<string, unknown>;
            const isRelation = ("__type" in obj && obj.__type === "relation")
                || (typeof obj.isEntityRelation === "function"
                    && (obj.isEntityRelation as () => boolean)());
            if (isRelation) {
                const relation = obj as unknown as EntityRelation;
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

    // Resolve target collection from either `prop.relation.target()` or `prop.target()` (inline API)
    let targetCollection: CollectionConfig | undefined;
    try {
        const resolved = prop.relation?.target?.() ?? (typeof prop.target === "function" ? prop.target() : undefined);
        if (resolved && typeof resolved === "object") {
            targetCollection = resolved as CollectionConfig;
        }
    } catch {
        // Target collection may not be resolvable
    }

    // Helper: extract display name from entity values using the target collection
    const extractDisplayName = (values: Record<string, unknown>): string | undefined => {
        if (targetCollection) {
            const targetTitleKey = targetCollection.titleProperty as string | undefined;
            if (targetTitleKey && values[targetTitleKey] !== undefined) {
                return String(values[targetTitleKey]);
            }

            // Helper to check if a property is hidden/internal
            const isHiddenProp = (p: Property): boolean => {
                if (p.ui?.hideFromCollection) return true;
                if (typeof p.ui?.disabled === "object" && p.ui.disabled.hidden) return true;
                return false;
            };

            // Helper to check if a property is a visible, non-id string
            const isDisplayCandidate = (p: Property): boolean => {
                return p.type === "string" && !p.ui?.multiline && !p.ui?.markdown && !p.storage
                    && !("isId" in p && p.isId) && !isHiddenProp(p);
            };

            // Prioritize common title-like fields: name, title, label, displayName
            const priorityKeys = ["name", "title", "label", "displayName"];
            for (const pk of priorityKeys) {
                const p = targetCollection.properties[pk] as Property | undefined;
                if (p && isDisplayCandidate(p) && values[pk] !== undefined && values[pk] !== null) {
                    return String(values[pk]);
                }
            }

            // Fallback: find first visible, non-id string property in target
            for (const [k, p] of Object.entries(targetCollection.properties)) {
                const tp = p as Property;
                if (isDisplayCandidate(tp)) {
                    if (values[k] !== undefined && values[k] !== null) {
                        return String(values[k]);
                    }
                }
            }
        }
        // Generic fallback: walk entity values for any short string.
        for (const [, v] of Object.entries(values)) {
            if (typeof v === "string" && v.length > 0 && v.length < 200) {
                return v;
            }
        }
        return undefined;
    };

    // 1. Try eagerly-loaded data on the relation object
    if (data && data.values) {
        const result = extractDisplayName(data.values as Record<string, unknown>);
        if (result) return result;
    }

    const id = "id" in relation ? relation.id : undefined;

    // 2. Try the entity cache (sessionStorage) as a fallback
    if (id !== undefined && targetCollection) {
        try {
            const slug = targetCollection.slug ?? ("table" in targetCollection ? targetCollection.table : undefined);
            if (slug) {
                const cacheKey = `${slug}/${id}`;
                const cached = getEntityFromCache(cacheKey) as { values?: Record<string, unknown> } | undefined;
                if (cached?.values) {
                    const result = extractDisplayName(cached.values);
                    if (result) return result;
                }
            }
        } catch {
            // Cache lookup failed — fall through
        }
    }

    // 3. Final fallback: show the ID
    return id !== undefined ? String(id) : undefined;
}
