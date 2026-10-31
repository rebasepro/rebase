import * as path from "path";

/**
 * How a function or cron file that failed to import is listed in the boot
 * log: `"<file> (syntax error at <file>:<line>: <message>)"` for a syntax
 * error, `"<file> (threw: <message>)"` for anything else.
 *
 * The two need different remedies. A file that *threw* usually read an
 * undefined env var at module scope; a file with a *syntax error* needs its
 * syntax fixed, and the loaders' advice is keyed on which one this is. Node
 * puts a syntax error's location only in the first line of its stack, so that
 * is where the line number comes from.
 */
export function describeLoadFailure(file: string, err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    // By name, not `instanceof`: the error comes from whatever realm did the
    // import, and its SyntaxError is not this one's.
    if (err instanceof Error && err.name === "SyntaxError") {
        const firstLine = err.stack?.split("\n", 1)[0] ?? "";
        const at = /:(\d+)(?::\d+)?$/.exec(firstLine);
        const where = at ? ` at ${path.basename(file)}:${at[1]}` : "";
        return `${file} (syntax error${where}: ${message})`;
    }
    return `${file} (threw: ${message})`;
}

/**
 * The boot stopped because a file did not load, under `requireFilesLoaded`.
 *
 * One line, with the files first, because a deployer reads this out of a pod's
 * log and quotes it as the reason a deploy failed.
 */
export class FilesFailedToLoadError extends Error {
    constructor(failures: string[]) {
        super(
            `Failed to load ${failures.join("; ")}. ` +
            "requireFilesLoaded (REBASE_REQUIRE_FILES_LOADED) stops the boot rather than serve without them."
        );
        this.name = "FilesFailedToLoadError";
    }
}

/** The advice for {@link describeLoadFailure}'s syntax-error entries. */
export const SYNTAX_ERROR_ADVICE =
    "  A file with a syntax error never ran: fix the syntax at the line shown " +
    "(`tsc --noEmit` or your editor will point at it too).";
