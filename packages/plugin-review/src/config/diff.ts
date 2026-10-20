import type { StagedChange } from "./types";

/** How one field changes. @group Review */
export type FieldChangeKind = "added" | "removed" | "changed" | "unchanged";

/** One field of a staged change, before and after. @group Review */
export interface FieldChange {
    field: string;
    kind: FieldChangeKind;
    /** Undefined when the field had no value before: an insert, or a field the row lacked. */
    before: unknown;
    /** Undefined when the change leaves no value: a delete. */
    after: unknown;
}

/** Whether two field values are the same value, compared as JSON. */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/**
 * The field-by-field difference a staged change makes, in a stable order.
 *
 * - An insert: every proposed field, `added`.
 * - An update: every proposed field, `changed` or `unchanged` against the
 *   snapshot — the fields it does not name it does not touch, so they are not
 *   listed.
 * - A delete: every field of the snapshot, `removed`.
 *
 * @group Review
 */
export function diffStagedChange(change: Pick<StagedChange, "operation" | "before_data" | "proposed_data">): FieldChange[] {
    const before = change.before_data ?? {};
    const after = change.proposed_data ?? {};
    if (change.operation === "delete") {
        return Object.keys(before).map(field => ({ field,
kind: "removed",
before: before[field],
after: undefined }));
    }
    if (change.operation === "insert") {
        return Object.keys(after).map(field => ({ field,
kind: "added",
before: undefined,
after: after[field] }));
    }
    return Object.keys(after).map(field => {
        const had = Object.prototype.hasOwnProperty.call(before, field);
        const kind: FieldChangeKind = !had ? "added" : sameValue(before[field], after[field]) ? "unchanged" : "changed";
        return { field,
kind,
before: had ? before[field] : undefined,
after: after[field] };
    });
}
