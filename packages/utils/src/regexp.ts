export function serializeRegExp(input: RegExp): string {
    if (!input) return "";
    // const fragments = input.toString().match(/\/(.*?)\/([a-z]*)?$/i);
    // if (fragments) {
    //     if (fragments[2])
    //         return input.toString();
    //     return fragments[1];
    // }
    return input.toString();
}

/**
 * Get a RegExp out of a serialized string
 * @param input
 */
export function hydrateRegExp(input?: string): RegExp | undefined {
    if (!input) return undefined;
    const fragments = input.match(/\/(.*?)\/([a-z]*)?$/i);
    if (fragments) {
        return new RegExp(fragments[1], fragments[2] || "");
    } else {
        return new RegExp(input, "");
    }
}

/**
 * Is `input` something {@link hydrateRegExp} can turn into a working RegExp?
 *
 * This used to pattern-match the *shape* of a regex literal and, failing that,
 * fall back to "does it contain any regex-ish character" — which said yes to
 * malformed input like `/[a-z/g`. The only answer that matters to a caller is
 * whether hydration succeeds, so ask the engine instead of approximating it.
 */
export function isValidRegExp(input: string): boolean {
    if (!input) return false;
    try {
        return hydrateRegExp(input) !== undefined;
    } catch {
        return false;
    }
}
