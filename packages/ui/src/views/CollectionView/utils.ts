/**
 * Traverse an object by dot-separated path.
 * Returns `undefined` if any segment is missing.
 */
export function getValueInPath(obj: Record<string, unknown> | undefined, path: string): unknown {
    if (!obj) return undefined;
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}
