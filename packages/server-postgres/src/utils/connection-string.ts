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

/** Hosts that are this machine: `localhost`, `127.0.0.0/8`, `::1` and `0.0.0.0`. */
const isLoopbackHost = (hostname: string): boolean =>
    hostname === "localhost" || hostname === "[::1]" || hostname === "0.0.0.0" || /^127(\.\d{1,3}){3}$/.test(hostname);

/**
 * A connection string for Atlas: {@link forLibpq}, and `sslmode=disable` for a
 * database on this machine whose URL says nothing about SSL.
 *
 * Atlas connects through lib/pq, whose default `sslmode` is `require`.
 * node-postgres — the app, and every step of these commands — asks for no SSL
 * when the URL names none. So a URL that served the app from a local Postgres
 * without SSL (the Docker image, a Homebrew install) failed every schema
 * command with `pq: SSL is not enabled on the server`. Given here, Atlas
 * connects the way the app already does.
 *
 * Nothing that asked for something is touched: a URL naming `sslmode`, `ssl`,
 * `host` or `hostaddr`, any other host, and anything that is not a postgres
 * URL are returned as {@link forLibpq} returns them.
 */
export function forAtlas(connectionString: string): string {
    const libpq = forLibpq(connectionString);
    let url: URL;
    try {
        url = new URL(libpq);
    } catch {
        return libpq;
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return libpq;
    if (!isLoopbackHost(url.hostname)) return libpq;
    if (["sslmode", "ssl", "host", "hostaddr"].some(key => url.searchParams.has(key))) return libpq;

    url.searchParams.set("sslmode", "disable");
    // By hand, for the reason `forLibpq` re-serializes by hand.
    url.search = Array.from(url.searchParams.entries())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
    return url.toString();
}

/**
 * A connection string with its password taken out, and the password.
 *
 * For a libpq program: the URL goes on its command line, and the password goes
 * in `PGPASSWORD`. On the command line it was readable by anyone who can list
 * processes, and it came back verbatim in every failure, because execa's error
 * message repeats the command: `Command failed with exit code 1: pg_restore
 * '--dbname=postgresql://app:s3cret@…'`, in a terminal, a CI log and the
 * scheduled backup's run history.
 *
 * libpq takes the password from the URL's user info or a `password` parameter,
 * so both are removed. The value is percent-decoded, because `PGPASSWORD` is
 * read literally. Anything that is not a URL is returned as given, with no
 * password: a key/value DSN keeps its own.
 */
export function splitPassword(connectionString: string): { connectionString: string; password: string | null } {
    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        return { connectionString, password: null };
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return { connectionString, password: null };

    const fromUserInfo = url.password ? decodePercent(url.password) : null;
    const fromParameter = url.searchParams.get("password");
    if (fromUserInfo === null && fromParameter === null) return { connectionString, password: null };

    url.password = "";
    if (fromParameter !== null) {
        url.searchParams.delete("password");
        // By hand, as `forLibpq` does: URLSearchParams writes a space as `+`.
        url.search = Array.from(url.searchParams.entries())
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join("&");
    }
    // libpq reads the user info first, as the URL's own password.
    return { connectionString: url.toString(), password: fromUserInfo ?? fromParameter };
}

function decodePercent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Every password a line of text carries in a connection string, replaced with
 * `***`.
 *
 * For whatever is about to be printed or logged and may have a connection
 * string in it: an error a client tool or a driver raised, a message that
 * quotes a command line. Covers the URL user-info form (`scheme://user:pass@`,
 * any scheme, a password with a raw `@` in it included) and `password=` in a
 * query string or a key/value DSN. The user, host and database stay, because
 * they are what a reader needs to tell which database it was.
 */
export function redactConnectionPasswords(text: string): string {
    return text
        .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@'"]*):[^\s/?#'"]*@/gi, "$1:***@")
        .replace(/(\bpassword\s*=\s*)('[^']*'|[^\s&'"]+)/gi, "$1***");
}
