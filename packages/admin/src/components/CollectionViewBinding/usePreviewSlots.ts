import { useMemo } from "react";
import type { Property, RelationProperty } from "@rebasepro/types";
import type { Entity, EntityRelation } from "@rebasepro/types";
import type { PropertyConfig, AdminCollection } from "@rebasepro/admin-types";
import { getEntityImagePreviewPropertyKey } from "@rebasepro/app";
import { getLeadingRelationTitleKey, getTitlePropertyCandidates, looksLikeIdentifierValue } from "@rebasepro/app";
import { getEntityFromCache } from "@rebasepro/app";
import { getEntityPreviewKeys } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";
import type { AuthController } from "@rebasepro/admin-types";
import { ChipColorScheme, CHIP_COLORS, CHIP_SEED_KEYS } from "@rebasepro/ui";

/** Whether an authored relation yields many rows. Derived from its kind. */
function relationCardinality(relation: { kind?: string; cardinality?: string } | undefined): "one" | "many" | undefined {
    if (!relation) return undefined;
    if (relation.kind === "via") return relation.cardinality as "one" | "many" | undefined;
    if (relation.kind === "hasMany" || relation.kind === "manyToMany") return "many";
    if (relation.kind === "belongsTo" || relation.kind === "hasOne") return "one";
    return relation.cardinality as "one" | "many" | undefined;
}


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
    /** Every property that could act as the title, best first (see `getTitlePropertyCandidates`) */
    titleKeyCandidates: string[];
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
    collection: AdminCollection<Record<string, unknown>>,
    authController: AuthController,
    propertyConfigs: Record<string, PropertyConfig>
): CollectionSlotKeys {
    // One row per entity: when the collection leads with a relation and holds no
    // name of its own, that relation *is* what the row is called. See
    // `getLeadingRelationTitleKey` — the general ranking keeps relations last,
    // which is right for a detail header but leaves a junction row titleless.
    const rankedCandidates = getTitlePropertyCandidates(collection);
    const leadingRelationKey = getLeadingRelationTitleKey(collection);
    const titleKeyCandidates = leadingRelationKey
        ? [leadingRelationKey, ...rankedCandidates.filter(key => key !== leadingRelationKey)]
        : rankedCandidates;
    const titleKey = titleKeyCandidates[0];
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
            // The relation filling the title slot is already the row's headline;
            // repeating it as a chip below says the same thing twice.
            if (p.type === "relation" && key !== titleKey) {
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
            const scoreA = propA?.type === "string" ? (propA.admin?.multiline ? 2 : 1) : 0;
            const scoreB = propB?.type === "string" ? (propB.admin?.multiline ? 2 : 1) : 0;
            return scoreB - scoreA;
        });
    const subtitleKey = sortedPreviewKeys.length > 0 ? sortedPreviewKeys[0] : undefined;

    return { titleKey,
titleKeyCandidates,
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
    collection: AdminCollection<Record<string, unknown>>,
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

// ── Title resolution (entity-level) ───────────────────────────────────

/**
 * Walk the collection's ranked title candidates and return the first one that
 * holds something a person can read for this entity. Candidates are already
 * ordered and free of identifier properties; this only rejects values —
 * empties, and strings that turn out to be an id at runtime.
 */
function resolveEntityTitleKey(
    entity: Entity<Record<string, unknown>>,
    candidates: string[]
): string | undefined {
    for (const key of candidates) {
        const value = getValueInPath(entity.values, key);
        if (value === undefined || value === null || value === "") continue;
        if (typeof value === "string") {
            if (looksLikeIdentifierValue(value)) continue;
            if (value === String(entity.id)) continue;
        }
        return key;
    }
    return candidates[0];
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
    collection: AdminCollection<Record<string, unknown>>,
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
    collection: AdminCollection<Record<string, unknown>>,
    slotKeys: CollectionSlotKeys
): EntityPreviewSlots {
    const { titleKey, titleKeyCandidates, imageKey, subtitleKey, relationKeys, statusKey, dateKey } = slotKeys;

    // Image
    const image = imageKey ? resolveImageSlot(collection, imageKey, entity) : undefined;

    // Title — the best-ranked candidate that carries a readable value for THIS
    // entity, so a row whose name is empty (or whose column happens to hold a
    // UUID) falls through to the next candidate instead of showing an id.
    const resolvedTitleKey = resolveEntityTitleKey(entity, titleKeyCandidates ?? (titleKey ? [titleKey] : []));
    let title: PreviewSlot | undefined;
    if (resolvedTitleKey) {
        const prop = collection.properties[resolvedTitleKey] as Property | undefined;
        const val = getValueInPath(entity.values, resolvedTitleKey);
        if (prop) title = { property: prop,
propertyKey: resolvedTitleKey,
value: val };
    }

    // Subtitle
    let subtitle: PreviewSlot | undefined;
    if (subtitleKey && subtitleKey !== resolvedTitleKey) {
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

        const isMany = relationCardinality(prop.relation) === "many";

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
            // Walking the seed keys rather than `Object.values`: the table also
            // holds a bare-hue alias per hue, so raw values would hand the first
            // two relations the same scheme.
            const colorScheme = CHIP_COLORS[CHIP_SEED_KEYS[relIndex % CHIP_SEED_KEYS.length]];
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

    // Resolve target collection from either `prop.relation.target()` or `prop.relation?.target()` (inline API)
    let targetCollection: AdminCollection | undefined;
    try {
        const resolved = prop.relation?.target?.() ?? (typeof prop.relation?.target === "function" ? prop.relation?.target() : undefined);
        if (resolved && typeof resolved === "object") {
            targetCollection = resolved as AdminCollection;
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
                if (p.admin?.hideFromCollection) return true;
                if (typeof p.admin?.disabled === "object" && p.admin.disabled.hidden) return true;
                return false;
            };

            // Helper to check if a property is a visible, non-id string
            const isDisplayCandidate = (p: Property): boolean => {
                return p.type === "string" && !p.admin?.multiline && !p.admin?.markdown && !p.storage
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
