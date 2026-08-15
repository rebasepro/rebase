/**
 * Choosing which of a bundle's functions this process serves.
 *
 * A functions process usually serves all of them; naming a subset is how one
 * expensive or slow function gets its own replica count, its own restarts and
 * its own blast radius without moving its code anywhere.
 *
 * Selection is by name — the filename without its extension, which is also the
 * URL segment it mounts at — because that name is already the function's stable
 * identity everywhere else: `/api/functions/<name>`, the `functions/<name>` API
 * key permission, and the listing endpoint.
 */

/** A name in the selection that the bundle does not contain. */
export class FunctionSelectionError extends Error {
    constructor(message: string, readonly hint?: string) {
        super(message);
        this.name = "FunctionSelectionError";
    }
}

export interface FunctionSelection {
    /** Serve only these. Empty or absent means all of them. */
    only?: string[];
    /** Serve none of these. Applied after `only`. */
    exclude?: string[];
}

/** The shape this needs from a loaded function: its name. */
interface Named {
    name: string;
}

/**
 * Apply a selection to what the loader found.
 *
 * @throws FunctionSelectionError when a named function is not in the bundle.
 *   A refusal rather than a warning, and the one decision in this file worth
 *   arguing about. The argument for it: a process configured with
 *   `REBASE_FUNCTIONS_ONLY=send-invoice` exists *for* that function, so a typo
 *   leaves a replica set serving nothing, answering 404 to the only caller it
 *   has, with one skipped line in a boot log as the only evidence. A deployment
 *   that will not start is read in seconds; one that starts and serves nothing
 *   is read after the incident.
 *
 *   `exclude` is held to the same standard for the same reason in reverse — an
 *   excluded name that does not match is a function still being served by a
 *   process someone believed had stopped serving it.
 */
export function selectFunctions<T extends Named>(
    loaded: T[],
    selection: FunctionSelection = {}
): T[] {
    const available = loaded.map(fn => fn.name);
    const only = selection.only ?? [];
    const exclude = selection.exclude ?? [];

    assertAllKnown("REBASE_FUNCTIONS_ONLY", only, available);
    assertAllKnown("REBASE_FUNCTIONS_EXCLUDE", exclude, available);

    const excluded = new Set(exclude);
    return loaded
        .filter(fn => only.length === 0 || only.includes(fn.name))
        .filter(fn => !excluded.has(fn.name));
}

function assertAllKnown(variable: string, names: string[], available: string[]): void {
    const unknown = names.filter(name => !available.includes(name));
    if (unknown.length === 0) return;

    throw new FunctionSelectionError(
        `${variable} names ${unknown.length === 1 ? "a function" : "functions"} this bundle does not ` +
        `contain: ${unknown.join(", ")}.`,
        available.length > 0
            // The available list is the whole point of the message. Without it
            // the reader's next step is to go and read the bundle by hand, and
            // the usual cause — a name that differs from the filename by an
            // extension, a dash, or a directory that the loader flattened away —
            // is visible the moment the two lists sit side by side.
            ? `This bundle contains: ${available.join(", ")}. Names are filenames without the extension.`
            : "This bundle contains no functions at all. Check that the build included the functions directory."
    );
}
