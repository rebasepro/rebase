/**
 * Connection-string redaction.
 *
 * This tool is pointed at production databases by people who have never run it
 * before, and its output ends up in CI logs, GitHub issues and screenshots. The
 * credential must therefore never survive into *any* output — not the report,
 * not an error, not a debug line. Everything printed goes through here.
 *
 * The parser is deliberately hand-rolled rather than `new URL()`: real-world
 * Postgres URLs carry passwords with unencoded `@`, `:` and `/` in them, which
 * `URL` either rejects or silently mis-splits. Getting that wrong once means
 * printing a password, so the splitting rules are explicit:
 *
 *   - the authority ends at the first `/`, `?` or `#` after `://`
 *   - the userinfo ends at the LAST `@` in the authority
 *   - the user ends at the FIRST `:` in the userinfo
 *
 * A libpq keyword string (`host=... password=...`) is understood too, because
 * `psql "$PGSTRING"` users paste those. Understood here means *parsed*: `pg`
 * itself cannot read that form, so anything that opens a connection has to go
 * through {@link parseKeywordConnectionString} and build the `Client` options
 * by hand. Parsing it here and handing the raw string to the driver would
 * report failures against a host the user never named.
 */

/** What replaces every credential. */
export const REDACTED = "***";

export interface ConnectionTarget {
    /** `postgres` / `postgresql`, or `postgresql` for keyword strings. */
    scheme: string;
    /** Hostname only, no port. `localhost` when the string omits it. */
    host: string;
    port: number | null;
    /** Database name, empty string when the string omits it. */
    database: string;
    user: string | null;
    password: string | null;
}

/** Query parameters worth keeping in the redacted form: informative, never secret. */
const SAFE_PARAMS = new Set(["sslmode", "application_name", "connect_timeout", "target_session_attrs"]);

function decode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function splitHostPort(hostport: string): { host: string; port: number | null } {
    // IPv6 literals are bracketed: [::1]:5432
    if (hostport.startsWith("[")) {
        const close = hostport.indexOf("]");
        if (close !== -1) {
            const host = hostport.slice(0, close + 1);
            const rest = hostport.slice(close + 1);
            const port = rest.startsWith(":") ? Number.parseInt(rest.slice(1), 10) : NaN;

            return { host, port: Number.isFinite(port) ? port : null };
        }
    }

    const colon = hostport.lastIndexOf(":");
    if (colon === -1) return { host: hostport, port: null };

    const port = Number.parseInt(hostport.slice(colon + 1), 10);
    if (!Number.isFinite(port)) return { host: hostport, port: null };

    return { host: hostport.slice(0, colon), port };
}

/**
 * The libpq keyword/value form (`host=… dbname=…`) as a map of lowercased
 * keyword to unquoted value, or `null` when the string is not that form.
 *
 * Exported because `pg` cannot read this form at all: `pg-connection-string`
 * only understands URLs, so a `Client({ connectionString: "host=127.0.0.1
 * port=1 …" })` connects to the *default* host and reports a failure against an
 * endpoint nobody asked for. Whoever opens the connection has to translate
 * these keywords into `Client` options itself — see `connect()` in
 * `introspect.ts`.
 */
export function parseKeywordConnectionString(raw: string): Map<string, string> | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    // A `scheme://` string is a URL, whatever else it contains.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return null;

    // host=localhost port=5432 dbname=app user=me password='s3 cret'
    const pairs = trimmed.match(/(\w+)\s*=\s*('(?:[^']|'')*'|[^\s]+)/g);
    if (!pairs || pairs.length === 0) return null;

    const map = new Map<string, string>();
    for (const pair of pairs) {
        const eq = pair.indexOf("=");
        const key = pair.slice(0, eq).trim().toLowerCase();
        let value = pair.slice(eq + 1).trim();
        if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
            value = value.slice(1, -1).replace(/''/g, "'");
        }
        map.set(key, value);
    }

    if (!map.has("host") && !map.has("dbname") && !map.has("user")) return null;

    return map;
}

function parseKeywordString(raw: string): ConnectionTarget | null {
    const map = parseKeywordConnectionString(raw);
    if (!map) return null;

    const port = map.has("port") ? Number.parseInt(map.get("port")!, 10) : NaN;

    return {
        scheme: "postgresql",
        host: map.get("host") ?? "localhost",
        port: Number.isFinite(port) ? port : null,
        database: map.get("dbname") ?? "",
        user: map.get("user") ?? null,
        password: map.get("password") ?? null
    };
}

/**
 * A hostname, an IPv4 literal, a bracketed IPv6 literal, or a Unix socket path.
 * Anything else means the split went wrong.
 */
const PLAUSIBLE_HOST = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+|\/[^\s?#@]*)$/;

/** A database name in a URL: no delimiters, because they were not encoded. */
const PLAUSIBLE_DATABASE = /^[^\s:@?#/]*$/;

/**
 * Split a connection string into its parts. Returns `null` when the input is
 * not recognisably a connection string — callers must treat that as "unknown",
 * never as "safe to print".
 */
export function parseConnectionString(raw: string): ConnectionTarget | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;

    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(trimmed);
    if (!schemeMatch) return parseKeywordString(trimmed);

    const scheme = schemeMatch[1];
    const afterScheme = trimmed.slice(schemeMatch[0].length);

    const pathStart = afterScheme.search(/[/?#]/);
    const authority = pathStart === -1 ? afterScheme : afterScheme.slice(0, pathStart);
    const remainder = pathStart === -1 ? "" : afterScheme.slice(pathStart);

    let user: string | null = null;
    let password: string | null = null;
    let hostport = authority;

    const at = authority.lastIndexOf("@");
    if (at !== -1) {
        const userinfo = authority.slice(0, at);
        hostport = authority.slice(at + 1);
        const colon = userinfo.indexOf(":");
        if (colon === -1) {
            user = decode(userinfo);
        } else {
            user = decode(userinfo.slice(0, colon));
            password = decode(userinfo.slice(colon + 1));
        }
    }

    const { host, port } = splitHostPort(hostport);

    let database = "";
    if (remainder.startsWith("/")) {
        const end = remainder.search(/[?#]/);
        database = decode(end === -1 ? remainder.slice(1) : remainder.slice(1, end));
    }

    // A password can also arrive as a query parameter, which is why the
    // redacted form only ever re-emits an allowlist of parameters.
    const queryStart = remainder.search(/[?#]/);
    if (queryStart !== -1 && password === null) {
        const params = new URLSearchParams(remainder.slice(queryStart + 1));
        const fromQuery = params.get("password");
        if (fromQuery) password = fromQuery;
        if (user === null && params.get("user")) user = params.get("user");
    }

    // A password containing an unencoded `/`, `?` or `@` makes the authority
    // boundary ambiguous, and the split lands somewhere inside the credential.
    // The tell is a host or database that does not look like one — at which
    // point the only safe answer is "unparseable", because printing the pieces
    // would print fragments of the password. libpq is no happier with these
    // than we are; the fix on the user's side is percent-encoding.
    const normalisedHost = host.length > 0 ? host : "localhost";
    if (!PLAUSIBLE_HOST.test(normalisedHost) || !PLAUSIBLE_DATABASE.test(database)) return null;

    return {
        scheme,
        host: normalisedHost,
        port,
        database,
        user,
        password
    };
}

/** `host:port` if a port is known, otherwise just the host. Never a credential. */
export function formatEndpoint(target: ConnectionTarget | null): string {
    if (!target) return "unknown host";

    return target.port === null ? target.host : `${target.host}:${target.port}`;
}

/**
 * The display form of a connection string: scheme, host, port and database
 * kept; user and password replaced. Safe to print anywhere.
 */
export function redactConnectionString(raw: string): string {
    const target = parseConnectionString(raw);
    if (!target) return "<connection string>";

    const credential = target.user !== null || target.password !== null ? `${REDACTED}:${REDACTED}@` : "";
    const endpoint = formatEndpoint(target);
    const database = target.database.length > 0 ? `/${target.database}` : "";

    let query = "";
    const queryStart = raw.indexOf("?");
    if (queryStart !== -1) {
        const kept: string[] = [];
        for (const [key, value] of new URLSearchParams(raw.slice(queryStart + 1))) {
            if (SAFE_PARAMS.has(key.toLowerCase())) kept.push(`${key}=${value}`);
        }
        if (kept.length > 0) query = `?${kept.join("&")}`;
    }

    return `${target.scheme}://${credential}${endpoint}${database}${query}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrub credentials out of arbitrary text — driver error messages, stack
 * traces, anything we did not author. Two passes:
 *
 *   1. exact: the connection string we were given, and its password, wherever
 *      they appear, however they were quoted;
 *   2. generic: any `scheme://user:pass@host` shaped substring, which catches
 *      strings we were never told about (a `pg` error quoting `PGPASSWORD`, a
 *      nested cause carrying another URL).
 *
 * The generic pass is what makes this safe by default: forgetting to pass
 * `connectionString` degrades the redaction, it does not disable it.
 */
export function redactSecrets(text: string, connectionString?: string): string {
    let out = text;

    if (connectionString && connectionString.trim().length > 0) {
        const raw = connectionString.trim();
        out = out.split(raw).join(redactConnectionString(raw));

        const target = parseConnectionString(raw);

        // `password authentication failed for user "postgres"` — the driver
        // quotes the role name back at us. Only the quoted form is replaced,
        // because a bare global replace of a name like `app` would shred the
        // sentence around it.
        if (target?.user && target.user.length > 0) {
            out = out.replace(new RegExp(`"${escapeRegExp(target.user)}"`, "g"), `"${REDACTED}"`);
        }

        // Short passwords are left alone: a global replace of "a" would shred
        // the message and tell an attacker more than it hides.
        if (target?.password && target.password.length >= 3) {
            out = out.replace(new RegExp(escapeRegExp(target.password), "g"), REDACTED);
            const encoded = encodeURIComponent(target.password);
            if (encoded !== target.password) {
                out = out.replace(new RegExp(escapeRegExp(encoded), "g"), REDACTED);
            }
        }
    }

    // scheme://userinfo@host — the userinfo is always a credential.
    out = out.replace(
        /\b([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\s"'<>]*?)@/g,
        (_match, scheme: string) => `${scheme}://${REDACTED}:${REDACTED}@`
    );

    // libpq keyword form, in whatever quoting the message used.
    out = out.replace(/\bpassword\s*=\s*('(?:[^']|'')*'|"[^"]*"|\S+)/gi, `password=${REDACTED}`);

    return out;
}

/**
 * Is this endpoint a local proxy or tunnel rather than the database itself?
 *
 * Matters for diagnosis: cloud-sql-proxy, an SSH -L forward and a local pooler
 * all accept the TCP connection and then hang up when *their* upstream auth
 * fails, which reaches the client as a bare ECONNRESET. Advice about TLS is
 * wrong there — the proxy terminates TLS itself, and the real cause is only in
 * its log.
 *
 * Takes the display form produced by `formatEndpoint`, so `host`, `host:port`
 * and `[::1]:5432` all work.
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
    const { host } = splitHostPort(endpoint.trim());
    const bare = host.replace(/^\[|]$/g, "").toLowerCase();

    if (bare === "localhost" || bare.endsWith(".localhost")) return true;
    // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)) return true;

    return bare === "::1" || bare === "0:0:0:0:0:0:0:1";
}
