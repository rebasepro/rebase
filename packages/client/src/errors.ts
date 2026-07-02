/**
 * Client-side logic errors (e.g. accessing an unknown collection when
 * a typed dictionary is available).  Distinct from {@link RebaseApiError}
 * which represents HTTP-level failures returned by the server.
 */
export class RebaseClientError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RebaseClientError";
    }
}
