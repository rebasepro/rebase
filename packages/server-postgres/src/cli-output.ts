/**
 * Terminal output for the `rebase db|schema|doctor` commands.
 *
 * These commands used to write every line through `logger`, and that is a
 * category error with three separate consequences:
 *
 *  - `logger` prefixes each line with its own level, so a box-drawn report
 *    arrived as `ℹ️ [INFO]   ┌─ ✗ Missing Column ───` and the frame no longer
 *    lined up with anything;
 *  - `logger` is gated by `LOG_LEVEL`, which ships in the scaffold's own
 *    `.env.example` — a developer who quietened their dev server with
 *    `LOG_LEVEL=warn` got a `rebase db push` that printed almost nothing and
 *    still exited non-zero, indistinguishable from a crash;
 *  - under `NODE_ENV=production` `logger` emits JSON, so the whole report
 *    became log records with the chalk escape codes embedded in them.
 *
 * A CLI's report *is* its return value. It goes to the terminal unconditionally
 * and unadorned. `packages/cli` has always written its output this way; this is
 * the same three functions for the plugin CLI that `rebase` delegates to.
 *
 * `logger` still belongs in this package's *runtime* — a request handler has no
 * terminal and its lines want levels, timestamps and redaction. The rule is the
 * caller, not the severity: anything a developer reads because they typed a
 * command goes here, anything a server emits while running goes to `logger`.
 *
 * Errors and warnings go to stderr so `rebase db push > plan.txt` keeps the
 * diagnosis on the terminal where it is readable.
 */
import { parseEnvBoolean } from "@rebasepro/types";

/** One line of human-facing output on stdout. */
export const out = (line = ""): void => {
    console.log(line);
};

/** One line of human-facing warning output on stderr. */
export const outWarn = (line = ""): void => {
    console.warn(line);
};

/** One line of human-facing error output on stderr. */
export const outError = (line = ""): void => {
    console.error(line);
};

/**
 * Whether a failure should be printed with its stack — `rebase --debug`, which
 * the launcher passes down as `REBASE_DEBUG`, or `REBASE_DEBUG` set by hand.
 */
export const wantsStack = (): boolean => parseEnvBoolean(process.env.REBASE_DEBUG) === true;

/**
 * An error as a person reads it: its message, and its stack only under
 * `--debug`.
 *
 * The rule `rebase` itself follows (`bin/rebase.js`). These commands run in a
 * child process the launcher's handler never sees, so a syntax error in a
 * collection file reached the terminal as `Doctor failed CollectionConfigError:`
 * followed by twenty frames of loader internals, under a sentence that already
 * said which file and which line.
 */
export const describeFailure = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error);
    const failedQuery = describeFailedQuery(error);
    const lead = failedQuery?.reason ? `${failedQuery.reason}\n  ` : "";
    if (wantsStack() && error.stack) {
        if (!failedQuery) return error.stack;
        // The stack opens with the message, `params:` line and all.
        const opening = `${error.name}: ${error.message}`;
        const frames = error.stack.startsWith(opening) ? error.stack.slice(opening.length) : `\n${error.stack}`;
        return `${lead}${error.name}: ${failedQuery.query}${frames}`;
    }
    if (failedQuery) return `${lead}${failedQuery.query}\n  Re-run with --debug for the stack trace.`;
    return `${error.message}\n  Re-run with --debug for the stack trace.`;
};

/**
 * A failed query as a reader needs it: why it failed — Postgres' own reason
 * with its SQLSTATE (`relation "nope_table" does not exist (42P01)`), or the
 * driver's when Postgres never answered — and the query without the values it
 * ran with. `null` for any other error.
 *
 * Drizzle reports a failed query as `Failed query: <sql>` and a `params:` line
 * and keeps the error underneath in `cause`, so the message alone names a query
 * and no reason: `rebase console -e` printed exactly that, `--debug` included.
 * The values stay off the terminal: they are whatever the code passed, a
 * password hash or a token as readily as an id.
 */
function describeFailedQuery(error: Error): { reason: string | null; query: string } | null {
    if (!error.message.startsWith("Failed query:")) return null;
    const paramsAt = error.message.lastIndexOf("\nparams:");
    const postgres = postgresError(error.cause);
    return {
        reason: postgres ? `${postgres.message} (${postgres.code})` : deepestMessage(error.cause),
        query: paramsAt === -1 ? error.message : error.message.slice(0, paramsAt)
    };
}

/** The error Postgres raised, from a cause chain: the one carrying a SQLSTATE. */
function postgresError(cause: unknown, depth = 0): { code: string; message: string } | null {
    if (!(cause instanceof Error) || depth > 5) return null;
    if ("code" in cause && typeof cause.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) && cause.message) {
        return { code: cause.code, message: cause.message };
    }
    return postgresError(cause.cause, depth + 1);
}

/** The innermost message in a cause chain, or `null` when there is none. */
function deepestMessage(cause: unknown, depth = 0): string | null {
    if (!(cause instanceof Error) || depth > 5) return null;
    return deepestMessage(cause.cause, depth + 1) ?? (cause.message || null);
}
