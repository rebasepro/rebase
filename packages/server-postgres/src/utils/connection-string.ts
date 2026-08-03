/**
 * Connection-string rewrites for the tools Rebase shells out to.
 *
 * Pure and dependency-free: `pg-tools` builds argument vectors without a live
 * server, and these have to be usable from there.
 */

/**
 * The `sslmode` values libpq accepts. `no-verify` is conspicuously not one.
 */
const LIBPQ_SSLMODES = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);

/**
 * Make a connection string safe to hand to a libpq program.
 *
 * `sslmode=no-verify` is a node-postgres convention — encrypt, but do not check
 * the certificate — and libpq does not have it. It does not degrade or warn:
 *
 *     psql: error: invalid sslmode value: "no-verify"
 *
 * which means a `DATABASE_URL` that works perfectly for the app makes `psql`,
 * `pg_dump`, `pg_restore` and Atlas all refuse to start, with an error that
 * points at the value rather than at the convention it comes from. It has cost
 * this project time more than once.
 *
 * `require` is the honest translation: libpq's `require` encrypts and does not
 * verify the certificate either, which is exactly what `no-verify` asks for.
 * Nothing is relaxed by the rewrite — `verify-ca` and `verify-full` are left
 * alone, so a connection string that asked for verification still gets it.
 *
 * Only `sslmode` is touched, and only when it is a value libpq would reject.
 * Anything unparseable is returned as given: a connection that works
 * unverified beats one this corrupted.
 */
export function forLibpq(connectionString: string): string {
    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        // Key/value DSNs and anything else we cannot parse. A `sslmode` in one
        // of those is space-separated rather than a query parameter, and
        // rewriting it with a regex is how a password containing "sslmode="
        // gets mangled.
        return connectionString;
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return connectionString;

    const sslmode = url.searchParams.get("sslmode");
    if (sslmode === null || LIBPQ_SSLMODES.has(sslmode)) return connectionString;

    url.searchParams.set("sslmode", "require");
    // Re-serialize by hand for the reason `pinSearchPath` does: URLSearchParams
    // writes a space as `+`, which node-postgres decodes and libpq does not.
    url.search = Array.from(url.searchParams.entries())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
    return url.toString();
}
