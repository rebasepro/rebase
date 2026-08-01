/**
 * Normalise a value that may be a single item or a list into a list.
 *
 * Only `null`/`undefined` mean "nothing". A truthiness check here silently
 * swallowed legitimate values — `toArray(0)`, `toArray(false)` and `toArray("")`
 * all came back empty, so a caller normalising a single falsy item lost it.
 */
export function toArray<T>(input?: T | T[] | null): T[] {
    if (Array.isArray(input)) return input;
    if (input === undefined || input === null) return [];
    return [input];
}
