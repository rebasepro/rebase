/**
 * The boxed banner the database commands print when a connection fails.
 *
 *     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *       ❌  Cannot connect to PostgreSQL at 127.0.0.1:5508
 *     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *       The driver said: connect ECONNREFUSED 127.0.0.1:5508
 *       …
 *
 * The driver prints it for the commands it runs (`cli-errors.ts` in
 * `@rebasepro/server-postgres`, which its entry does not export); this is the
 * same box for the commands the CLI answers in its own process — `db pull`
 * and `auth reset-password`'s database fallback — as plain lines for the
 * caller to print. Never with the connection string in it: it carries the
 * password.
 */
import type { DevDatabaseSource } from "./resolve";

const RULE = "━".repeat(60);

/** The banner, as lines: a title, what the driver or tool said, then the body. */
export function banner(title: string, said: string | null, body: readonly string[]): string[] {
    return ["", RULE, `  ❌  ${title}`, RULE, "", ...(said ? [`  ${said}`, ""] : []), ...body.map(line => `  ${line}`), "", RULE];
}

/** `host:port` of a connection string, for a message: never the string, which carries the password. */
export function hostOf(connectionString: string): string {
    try {
        const url = new URL(connectionString);

        return `${url.hostname || "localhost"}:${url.port || "5432"}`;
    } catch {
        return "(unparseable connection string)";
    }
}

/**
 * A connection error's own sentence. A refused connection on a dual-stack
 * host is an `AggregateError` with an empty message, and its sentence —
 * `connect ECONNREFUSED 127.0.0.1:5432` — is in the attempts it holds.
 */
export function connectionErrorText(error: unknown): string {
    if (error instanceof AggregateError && error.errors.length > 0 && !error.message) {
        return connectionErrorText(error.errors[0]);
    }

    return error instanceof Error && error.message ? error.message : String(error);
}

/** The `code` a `pg` or `net` error carries, looking inside an `AggregateError`'s attempts. */
function codeOf(error: unknown): string | undefined {
    if (error instanceof AggregateError && error.errors.length > 0) {
        for (const inner of error.errors) {
            const code = codeOf(inner);
            if (code) return code;
        }
    }
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;

    return undefined;
}

/** A server that is not there, or not reachable from here. */
const UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET"]);

/**
 * What to print when opening `url` failed with `error`: the banner, in the
 * case it is — the server not answering, credentials refused, or a database
 * of that name not there — or `null` when it is none of those three.
 *
 * `consequence` is the line saying what did not happen ("The password was not
 * reset."); `fixes` is what to do about a server that does not answer, which
 * depends on what named the database.
 */
export function connectionFailureBanner(
    url: string,
    error: unknown,
    options: { consequence: string; fixes: readonly string[] }
): string[] | null {
    const code = codeOf(error);
    const text = connectionErrorText(error);
    const said = `The driver said: ${text}${code && !text.includes(code) ? ` (${code})` : ""}`;
    const host = hostOf(url);

    if ((code && UNREACHABLE.has(code)) || /timeout expired|Connection terminated due to connection timeout/i.test(text)) {
        return banner(`Cannot connect to PostgreSQL at ${host}`, said, [
            "The database server is not running or is not accepting connections.",
            options.consequence,
            "",
            ...options.fixes.map(fix => `  • ${fix}`)
        ]);
    }
    if (code === "28P01" || code === "28000") {
        let user = "unknown";
        try {
            user = decodeURIComponent(new URL(url).username) || "unknown";
        } catch { /* named as unknown */ }
        return banner(`Authentication failed for user "${user}" at ${host}`, said, [
            "PostgreSQL rejected the credentials in the connection string.",
            options.consequence
        ]);
    }
    if (code === "3D000") {
        let database = "(default)";
        try {
            database = decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || database;
        } catch { /* named as the default */ }
        return banner(`Database "${database}" does not exist at ${host}`, said, [
            "The server answered, and has no database of that name.",
            options.consequence
        ]);
    }

    return null;
}

/**
 * What to do about a database that does not answer, for what named it — the
 * list the driver's banner gives for the same `REBASE_DATABASE_SOURCE`.
 */
export function connectionRefusedFixes(source: DevDatabaseSource): string[] {
    switch (source) {
        case "flag": return ["Check the URL passed with --database-url, and that its server is running"];
        case "environment": return ["Check DATABASE_URL in this shell's environment, and that its server is running"];
        case "env-file": return ["Check DATABASE_URL in .env, and that its server is running"];
        case "branch": return [
            "The branch's database is on the server DATABASE_URL names: start that server",
            "Or leave the branch: rebase db branch switch --off"
        ];
        case "docker":
        case "last-dev": return ["docker compose up -d db          (the project's Postgres in Docker)"];
        case "managed": return ["Restart the managed development database: rebase db stop, then run the command again"];
    }
}
