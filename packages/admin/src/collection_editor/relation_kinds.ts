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
