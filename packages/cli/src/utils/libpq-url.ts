/**
 * Detect Postgres connection strings that libpq refuses to parse.
 *
 * libpq splits a URI query parameter on the FIRST `=` and rejects any further
 * one in the same parameter:
 *
 *   extra key/value separator "=" in URI query parameter: "options"
 *
 * That makes a URL like
 *
 *   postgresql://u:p@h:5432/db?options=-c%20search_path=public&sslmode=disable
 *
 * unusable by every libpq caller — `pg_dump`/`pg_restore` behind
 * `rebase db backup|restore`, and a plain `psql "$DATABASE_URL"`. It is not a
 * version quirk: Postgres 15 through 18 all refuse it.
 *
 * `rebase init` generated exactly that string until 2026-08-18, and the failure
 * is invisible day to day because node-postgres parses URLs itself and accepts
 * it — so `rebase dev` and `rebase db push` work while backups do not. Fixing
 * the generator does nothing for projects that already exist, which is what
 * these functions are for: `rebase doctor` reads them off disk and reports.
 */

/** A query parameter whose value carries a literal `=`. */
export interface UnparseableParam {
    /** The parameter name, e.g. "options". */
    name: string;
    /** The raw `name=value` text as it appears in the URL. */
    raw: string;
}

/** Postgres URI schemes. A key/value DSN ("host=… dbname=…") is not one. */
const POSTGRES_URI_RE = /^postgres(ql)?:\/\//i;

/**
 * Return the query parameters libpq would reject, or an empty array.
 *
 * Deliberately not built on `new URL()`: that parser is happy to accept the
 * broken form (it splits on the first `=` and keeps the rest as the value),
 * so it cannot see the defect at all. The rule being checked is libpq's, and
 * it is about the raw text.
 */
export function findUnparseableParams(connectionString: string): UnparseableParam[] {
    if (!POSTGRES_URI_RE.test(connectionString)) return [];

    const q = connectionString.indexOf("?");
    if (q === -1) return [];

    // A fragment is not part of the query.
    const query = connectionString.slice(q + 1).split("#")[0];
    if (!query) return [];

    const found: UnparseableParam[] = [];
    for (const part of query.split("&")) {
        if (!part) continue;
        // One separator is the parameter's own; any further one is the defect.
        if (part.split("=").length > 2) {
            found.push({ name: part.slice(0, part.indexOf("=")), raw: part });
        }
    }
    return found;
}

/**
 * Percent-encode the offending `=` characters, leaving everything else byte for
 * byte as it was.
 *
 * Only the second and later `=` in a parameter are rewritten — the first is the
 * real separator. Nothing else is touched: re-serialising through `URL` would
 * also reorder parameters and turn spaces into `+`, which libpq does not decode,
 * so a "tidy up" would trade one unparseable string for another.
 */
export function encodeExtraEquals(connectionString: string): string {
    if (findUnparseableParams(connectionString).length === 0) return connectionString;

    const q = connectionString.indexOf("?");
    const head = connectionString.slice(0, q + 1);
    const rest = connectionString.slice(q + 1);
    const hash = rest.indexOf("#");
    const query = hash === -1 ? rest : rest.slice(0, hash);
    const fragment = hash === -1 ? "" : rest.slice(hash);

    const fixed = query
        .split("&")
        .map((part) => {
            const first = part.indexOf("=");
            if (first === -1) return part;
            const name = part.slice(0, first);
            const value = part.slice(first + 1).replace(/=/g, "%3D");
            return `${name}=${value}`;
        })
        .join("&");

    return `${head}${fixed}${fragment}`;
}

/** One connection string, found somewhere on disk, that libpq cannot parse. */
export interface LibpqUrlFinding {
    /** File it came from, relative to the project root. */
    file: string;
    /** The variable holding it, e.g. "DATABASE_URL". */
    variable: string;
    /** Parameter names libpq objects to. */
    params: string[];
    /** The same string with the offending `=` encoded. */
    suggested: string;
}

/** Variables whose value is a Postgres connection string. */
const CONNECTION_VARIABLES = ["DATABASE_URL", "ADMIN_CONNECTION_STRING"];

/**
 * Scan one file's text for connection strings libpq would reject.
 *
 * Handles both shapes a scaffolded project uses, because both shipped with the
 * defect and a deployed stack is broken by the compose one alone:
 *
 *   .env               DATABASE_URL=postgresql://…
 *   docker-compose.yml   DATABASE_URL: postgresql://…
 */
export function scanTextForLibpqUrls(file: string, text: string): LibpqUrlFinding[] {
    const findings: LibpqUrlFinding[] = [];

    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        // Commented-out examples are not what the project runs on.
        if (trimmed.startsWith("#")) continue;

        for (const variable of CONNECTION_VARIABLES) {
            // `NAME=value` or `NAME: value`, optionally exported/indented.
            const match = trimmed.match(
                new RegExp(`^(?:export\\s+)?${variable}\\s*[:=]\\s*(.+)$`)
            );
            if (!match) continue;

            // Strip surrounding quotes and any trailing comment-free whitespace.
            let value = match[1].trim();
            const quoted = value.match(/^(['"])(.*)\1$/);
            if (quoted) value = quoted[2];
            if (!value) continue;

            const params = findUnparseableParams(value);
            if (params.length === 0) continue;

            findings.push({
                file,
                variable,
                params: params.map((p) => p.name),
                suggested: encodeExtraEquals(value)
            });
        }
    }

    return findings;
}
