/**
 * Parsing of the `Authorization: Bearer <token>` header.
 *
 * Its own module rather than a helper inside `middleware.ts`, because the
 * API-key middleware needs it too and `middleware.ts` already imports from
 * there — putting it in either one would close an import cycle.
 *
 * @module
 */

/**
 * Pull the token out of an `Authorization: Bearer <token>` header.
 *
 * RFC 7235 §2.1 makes the auth-scheme name case-insensitive, and plenty of
 * clients send `bearer` — HTTP libraries that lower-case what they emit,
 * hand-written curl, proxies that normalise headers. Matching `"Bearer "`
 * exactly turned those into a 401 that, from the caller's side, is
 * indistinguishable from a rejected token; people spend an afternoon
 * regenerating credentials that were fine. Only the scheme is folded — the
 * token itself is returned byte-for-byte.
 *
 * Returns `undefined` when there is no header or it names another scheme.
 * That is deliberately distinct from an empty token (`Bearer ` with nothing
 * after it), which callers still route into verification so it fails as a bad
 * token rather than as a missing header.
 */
export function extractBearerToken(authHeader: string | undefined | null): string | undefined {
    if (!authHeader) return undefined;
    const separator = authHeader.indexOf(" ");
    if (separator < 0) return undefined;
    if (authHeader.slice(0, separator).toLowerCase() !== "bearer") return undefined;
    return authHeader.slice(separator + 1);
}
