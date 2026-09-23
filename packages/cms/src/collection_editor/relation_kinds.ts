import type { RelationKind } from "@rebasepro/types";

/**
 * How each relation kind is named and explained in the editor UI.
 *
 * One table, shared by every surface that lets someone pick a kind — the
 * relations tab and the relation property form — so the two cannot describe the
 * same thing differently, and so a sixth kind added to the union fails to
 * compile here rather than quietly going missing from a dropdown.
 *
 * The descriptions all answer the same question, because it is the only
 * question that distinguishes the first four: *where is the foreign key?*
 */
export const RELATION_KINDS: Record<RelationKind, { label: string; description: string }> = {
    belongsTo: {
        label: "Belongs to",
        description: "One target row. The foreign key is a column on this table."
    },
    hasOne: {
        label: "Has one",
        description: "One target row. The foreign key is a column on the target's table."
    },
    hasMany: {
        label: "Has many",
        description: "Many target rows. The foreign key is a column on the target's table."
    },
    manyToMany: {
        label: "Many to many",
        description: "Many target rows, linked through a junction table."
    },
    via: {
        label: "Via a join path",
        description: "Reached by joining across several tables. Read-only."
    }
};

/** The kinds, in the order they are offered. */
export const RELATION_KIND_ORDER = Object.keys(RELATION_KINDS) as RelationKind[];

/** Which link field, if any, a kind is configured with. */
export const kindUsesLocalKey = (kind: RelationKind) => kind === "belongsTo";
export const kindUsesForeignKeyOnTarget = (kind: RelationKind) => kind === "hasOne" || kind === "hasMany";
export const kindUsesThrough = (kind: RelationKind) => kind === "manyToMany";
export const kindUsesJoinPath = (kind: RelationKind) => kind === "via";

/**
 * The link fields each kind owns — the only ones a relation of that kind may
 * carry. The same table the boot validator checks a relation against.
 */
const LINK_FIELDS_BY_KIND: Record<RelationKind, readonly string[]> = {
    belongsTo: ["localKey"],
    hasOne: ["foreignKeyOnTarget", "sourceKey"],
    hasMany: ["foreignKeyOnTarget", "sourceKey"],
    manyToMany: ["through"],
    via: ["joinPath", "cardinality"]
};

const LINK_FIELDS = new Set(Object.values(LINK_FIELDS_BY_KIND).flat());

/**
 * `relation` switched to `kind`, without the link fields its old kind owned.
 *
 * Switching kind in the property form used to set `kind` and nothing else, so
 * a junction table filled in before switching to "Belongs to" stayed on the
 * relation — `through` on a `belongsTo` — and a `localKey` rode along into a
 * `hasMany`. The boot validator refuses both, and every collection in the
 * directory stops loading. The name, the target and the referential actions
 * belong to every kind and are kept.
 */
export function relationWithKind(relation: Record<string, unknown>, kind: RelationKind): Record<string, unknown> {
    const owned = LINK_FIELDS_BY_KIND[kind];
    return {
        ...Object.fromEntries(Object.entries(relation).filter(([key]) => !LINK_FIELDS.has(key) || owned.includes(key))),
        kind
    };
}
