/**
 * Walk the error cause chain and return the deepest meaningful message.
 *
 * A leaf module, imported by the driver CLI: `pg-error-utils.ts`, where it used
 * to live, imports `@rebasepro/server`, and the CLI must start without it.
 */
export function extractCauseMessage(error: unknown): string | null {
    if (!error || typeof error !== "object") return null;
    if (!(error instanceof Error)) return null;

    if (error.cause && typeof error.cause === "object") {
        const deeper = extractCauseMessage(error.cause);
        if (deeper) return deeper;
        // The cause itself has a message
        if (error.cause instanceof Error && error.cause.message) {
            return error.cause.message;
        }
    }
    return null;
}
