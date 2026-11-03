/**
 * Whether `id` names a record.
 *
 * Any number does — `0` is a valid serial or integer key — and any non-empty
 * string. A truthiness test read record `0` as "no record": the panel opened it
 * as a new one, and saving created a row instead of editing it.
 */
export function hasEntityId(id: string | number | null | undefined): id is string | number {
    if (typeof id === "number") return !Number.isNaN(id);
    return typeof id === "string" && id !== "";
}
