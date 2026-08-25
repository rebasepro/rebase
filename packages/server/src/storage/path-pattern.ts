/**
 * The storage key pattern language, in one place.
 *
 * `storagePolicies` invented it and `storageTriggers` needs exactly the same
 * thing: match a key segment by segment, capture the named segments, and refuse
 * a pattern that would silently do something other than it says. Two copies of
 * a matcher used for access control is one copy too many — the day they drift
 * is the day a policy and a trigger disagree about what `users/:uid/**` means,
 * and only one of them is enforcing anything.
 *
 * The rules:
 *
 * - a literal segment matches itself
 * - `*` matches exactly one segment
 * - `:name` matches one segment and captures it
 * - `**` matches the rest of the key, including nothing, and is only allowed as
 *   the final segment
 *
 * Compilation is strict and happens at boot: a `**` in the middle, a `:` with
 * no name, or the same capture twice are all errors, because each of them is a
 * pattern whose author believed something the matcher does not do.
 */

/** A pattern that cannot be compiled. Thrown at boot, never per request. */
export class StoragePatternError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StoragePatternError";
    }
}

export interface CompiledStoragePattern {
    segments: string[];
    /** True when the last segment is `**`. */
    trailing: boolean;
    /** The pattern as written, for error messages and logs. */
    source: string;
}

/**
 * Split a key into segments, dropping empty ones.
 *
 * Empty segments come from a leading slash or a `//`, and treating them as real
 * would let `users//x` match a pattern expecting a captured segment with the
 * empty string. Keys reaching here are already sanitized against traversal; this
 * is about matching, not safety.
 */
export function segmentsOf(value: string): string[] {
    return value.split("/").filter(segment => segment.length > 0);
}

/**
 * Compile a pattern, or throw {@link StoragePatternError}.
 *
 * `label` names the thing being compiled in any error — `storagePolicies[2]`,
 * `storageTriggers[0]` — so a boot failure points at the line to edit.
 */
export function compileStoragePattern(path: string, label: string): CompiledStoragePattern {
    if (typeof path !== "string" || path.trim() === "") {
        throw new StoragePatternError(`${label}: \`path\` must be a non-empty string.`);
    }

    const segments = segmentsOf(path);
    if (segments.length === 0) {
        throw new StoragePatternError(
            `${label}: \`path\` "${path}" names no segments. Use "**" to match every key.`
        );
    }

    const starIndex = segments.indexOf("**");
    if (starIndex !== -1 && starIndex !== segments.length - 1) {
        throw new StoragePatternError(
            `${label}: "**" is only allowed as the last segment of \`path\`, and "${path}" ` +
            "puts it in the middle. Use \"*\" for a single segment."
        );
    }

    const captures = segments.filter(s => s.startsWith(":")).map(s => s.slice(1));
    for (const name of captures) {
        if (name === "") {
            throw new StoragePatternError(`${label}: a ":" placeholder in "${path}" has no name.`);
        }
        if (captures.filter(c => c === name).length > 1) {
            throw new StoragePatternError(
                `${label}: "${path}" captures ":${name}" twice, so one would silently win.`
            );
        }
    }

    return { segments, trailing: starIndex !== -1, source: path };
}

/**
 * Match a key against a compiled pattern.
 *
 * Returns the captured segments on a match — an empty object for a pattern that
 * captures nothing — and `undefined` on a miss. The distinction matters: a
 * pattern with no `:name` still matches, and `{}` is a match while `undefined`
 * is not.
 */
export function matchStoragePattern(
    compiled: CompiledStoragePattern,
    key: string
): Record<string, string> | undefined {
    const keySegments = segmentsOf(key);
    const pattern = compiled.trailing ? compiled.segments.slice(0, -1) : compiled.segments;

    if (compiled.trailing ? keySegments.length < pattern.length : keySegments.length !== pattern.length) {
        return undefined;
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < pattern.length; i++) {
        const expected = pattern[i];
        const actual = keySegments[i];
        if (expected === "*") continue;
        if (expected.startsWith(":")) {
            params[expected.slice(1)] = actual;
            continue;
        }
        if (expected !== actual) return undefined;
    }
    return params;
}
