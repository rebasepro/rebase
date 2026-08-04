import type { Property } from "@rebasepro/types";

/**
 * Whether a property can stand in for a record in *one line*.
 *
 * Preview surfaces — the reference card, a list row, a board card — have a
 * single line per property and no way to grow. That is a constraint on the
 * *value*, not on the property's importance: a Markdown biography is the most
 * interesting column on an author, and it is still the wrong thing to paste
 * into a 44px card. Ranking it here means the picker can skip it without
 * anyone having to configure their way out of a broken card.
 *
 * Kept beside {@link getTitlePropertyCandidates} because the two answer
 * neighbouring questions — "what is this record called" and "what else can be
 * said about it in a line" — from the same property schema.
 *
 * @group Collections
 */
export const SUMMARY_RANK = {
    /**
     * No single-line form exists. A map renders as a key/value table and an
     * array of maps as a stack of them; there is no first line to take.
     */
    UNUSABLE: 0,
    /**
     * Readable in one line, but only as an excerpt — the property holds a
     * document, and the line is its opening. Worth showing when nothing better
     * is available, never in preference to a value that fits whole.
     */
    EXCERPT: 1,
    /** Short and self-contained: the line *is* the value. */
    DIRECT: 2
} as const;

/** One of the three summary ranks. */
export type SummaryRank = typeof SUMMARY_RANK[keyof typeof SUMMARY_RANK];

/**
 * File-storage backed content (single image, array of images, generic upload…).
 * Preview surfaces give these their own image slot, so they are never also a
 * text line.
 *
 * @group Collections
 */
export function isStorageProperty(property: Property | undefined): boolean {
    if (!property) return false;
    if (property.type === "string" && (property.storage || property.admin?.urlPreview === "image")) return true;
    if (property.type === "array" && property.of && !Array.isArray(property.of)) {
        const inner = property.of;
        if (inner.type === "string" && (inner.storage || inner.admin?.urlPreview === "image")) return true;
    }
    return false;
}

/**
 * True when the property holds free text long enough to be a document rather
 * than a value — Markdown, or an explicitly multi-line string.
 *
 * @group Collections
 */
export function isLongTextProperty(property: Property | undefined): boolean {
    if (!property || property.type !== "string") return false;
    return Boolean(property.admin?.markdown || property.admin?.multiline);
}

/**
 * How well a property reads as one line of a preview. See {@link SUMMARY_RANK}.
 *
 * Decided from the property *schema* only: no values are consulted, so the
 * answer is stable for a collection and can be memoised per collection rather
 * than per row.
 *
 * @group Collections
 */
export function rankSummaryProperty(property: Property | undefined): SummaryRank {
    if (!property) return SUMMARY_RANK.UNUSABLE;

    // Rendered by the image slot, not as text.
    if (isStorageProperty(property)) return SUMMARY_RANK.UNUSABLE;

    // A map is a table of its own, whether it declares its properties (a row
    // per sub-property) or not (a key/value dump). Neither has a first line.
    if (property.type === "map") return SUMMARY_RANK.UNUSABLE;

    if (property.type === "array") {
        // A tuple: several properties side by side, so there is nothing single
        // about the line it would produce.
        if (Array.isArray(property.of)) return SUMMARY_RANK.UNUSABLE;
        if (!property.of) return property.oneOf ? SUMMARY_RANK.UNUSABLE : SUMMARY_RANK.DIRECT;
        // Arrays of block-shaped things inherit the block shape.
        const innerRank = rankSummaryProperty(property.of);
        if (innerRank === SUMMARY_RANK.UNUSABLE) return SUMMARY_RANK.UNUSABLE;
        // An array of documents is a stack of excerpts — worse than one
        // excerpt, and never what a card should lead with.
        if (innerRank === SUMMARY_RANK.EXCERPT) return SUMMARY_RANK.UNUSABLE;
        // Short values render as a run of chips, which fits a line.
        return SUMMARY_RANK.DIRECT;
    }

    if (isLongTextProperty(property)) return SUMMARY_RANK.EXCERPT;

    // Numbers, dates, booleans, enums, plain strings, and single references or
    // relations (which collapse to one linked line) all fit as they are.
    return SUMMARY_RANK.DIRECT;
}

/**
 * True when the property has any single-line form at all.
 *
 * @group Collections
 */
export function canSummariseProperty(property: Property | undefined): boolean {
    return rankSummaryProperty(property) !== SUMMARY_RANK.UNUSABLE;
}
