import { deepEqual as equal } from "fast-equals";

/**
 * Only plain objects are merged key by key. Arrays, dates and class instances
 * (a reference, a geopoint, a vector) are values: an edit to one replaces it
 * whole, so two edits to one are a conflict rather than something to splice.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function merge(
    previous: unknown,
    next: unknown,
    current: unknown,
    path: string[],
    conflicts: string[]
): unknown {
    // Not edited here: follow the new baseline.
    if (equal(current, previous)) return next;
    // Not changed there: keep the edit.
    if (equal(next, previous)) return current;
    // Both sides arrived at the same value.
    if (equal(current, next)) return current;

    if (isPlainObject(previous) && isPlainObject(next) && isPlainObject(current)) {
        const merged: Record<string, unknown> = {};
        const keys = new Set([...Object.keys(previous), ...Object.keys(next), ...Object.keys(current)]);
        for (const key of keys) {
            const value = merge(previous[key], next[key], current[key], [...path, key], conflicts);
            if (value === undefined && !(key in current) && !(key in next)) continue;
            merged[key] = value;
        }
        return merged;
    }

    // Both sides changed it, differently. The edit is what the user is looking
    // at, so it stays; the caller is told so it can say so.
    conflicts.push(path.join("."));
    return current;
}

/**
 * Rebase an edit onto a baseline that moved under it — a three-way merge of
 * the form's values against the old and new baselines.
 *
 * - a field the edit left alone takes the new baseline's value;
 * - a field the edit changed keeps the edit;
 * - a field both changed keeps the edit and is listed in `conflicts`, by its
 *   dotted path.
 *
 * Plain objects are merged field by field, so an edit to `seo.slug` and a
 * change to `seo.description` elsewhere both survive. Arrays and other values
 * are compared whole.
 *
 * @group Form
 */
export function rebaseEdits<T>(previousBaseline: T, nextBaseline: T, current: T): { values: T; conflicts: string[] } {
    const conflicts: string[] = [];
    const values = merge(previousBaseline, nextBaseline, current, [], conflicts) as T;
    return { values, conflicts };
}
