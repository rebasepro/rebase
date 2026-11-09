/**
 * What SQL may run as a caller (`DataDriver.sql` on the authenticated driver).
 *
 * That SQL runs in the caller's transaction, as `rebase_user`, with the
 * caller's identity in transaction-local settings — the same footing as every
 * SDK read and write, so the tables' policies decide each row. Those settings
 * are the weak point: a statement running as `rebase_user` can change them.
 * `RESET ROLE` returns to the connection's owner role, and
 * `set_config('app.uid', …)` makes the policies see somebody else. Postgres
 * offers no way to stop a role from doing either.
 *
 * So the query text has to be the application's own, and anything a user
 * typed travels in `params`, which can never become SQL. This check is the
 * backstop for when that slips — a value interpolated into the text, a query
 * assembled from pieces: it refuses every statement that can touch session
 * state, and more than one statement at a time.
 *
 * - one statement;
 * - leading with `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`,
 *   `DELETE` or `MERGE` — no `SET`, `RESET`, `DO`, `PREPARE`, DDL or
 *   transaction control;
 * - never calling `set_config` or naming `pg_settings`, the two ways a query
 *   can write a setting;
 * - never calling a function of the `rebase` schema but the identity readers
 *   (`uid`, `roles`, `jwt`, `is_anonymous`) — the rest are the server's doors.
 *
 * Read after masking string literals, dollar-quoted bodies and comments, so a
 * value that merely contains `;` or `set_config` is not refused, and
 * a call hidden in a comment-split name is not missed.
 */
import { ApiError } from "@rebasepro/server";

const ALLOWED_LEADS = new Set(["select", "with", "values", "table", "insert", "update", "delete", "merge"]);

/** `set_config(` in any spelling Postgres accepts: schema-qualified, quoted, spaced. */
const SETS_A_SETTING = /(?:^|[^\w$])"?set_config"?\s*\(/i;
/** `pg_settings`, which an `UPDATE` writes through to `set_config`. */
const NAMES_PG_SETTINGS = /(?:^|[^\w$])"?pg_settings"?(?:[^\w$]|$)/i;
/**
 * The functions in the `rebase` schema a caller may name: the ones policies
 * read the identity through. Everything else there is the server's —
 * `record_history` and `enqueue_job` are `SECURITY DEFINER` doors the request
 * role can execute, because a write's history and jobs commit in the write's
 * own transaction, and a statement calling one forges an entry or starts a job.
 */
const CALLER_REBASE_FUNCTIONS = new Set(["uid", "roles", "jwt", "is_anonymous"]);
const REBASE_FUNCTION_CALL = /(?:^|[^\w$])"?rebase"?\s*\.\s*"?([A-Za-z_][\w$]*)"?\s*\(/gi;
/** The doors by their bare names, for a `search_path` that reaches `rebase`. */
const NAMES_A_SERVER_DOOR = /(?:^|[^\w$.])"?(record_history|enqueue_job)"?\s*\(/i;

/**
 * The query with every string literal, dollar-quoted body and comment
 * replaced by a space. Quoted identifiers are kept, quotes and all, so a name
 * written `"set_config"` still reads as one.
 */
export function maskSqlLiterals(text: string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === "-" && next === "-") {
            const end = text.indexOf("\n", i);
            i = end === -1 ? text.length : end;
            out += " ";
        } else if (ch === "/" && next === "*") {
            // Postgres block comments nest.
            let depth = 1;
            i += 2;
            while (i < text.length && depth > 0) {
                if (text[i] === "/" && text[i + 1] === "*") { depth++; i += 2; }
                else if (text[i] === "*" && text[i + 1] === "/") { depth--; i += 2; }
                else i++;
            }
            out += " ";
        } else if (ch === "'") {
            // `E'…'` takes backslash escapes; a plain literal only doubles quotes.
            const escapes = i > 0 && /[eE]/.test(text[i - 1]) && (i < 2 || !/[\w$]/.test(text[i - 2]));
            i++;
            while (i < text.length) {
                if (escapes && text[i] === "\\") { i += 2; continue; }
                if (text[i] === "'") {
                    if (text[i + 1] === "'") { i += 2; continue; }
                    break;
                }
                i++;
            }
            i++;
            out += " ";
        } else if (ch === "\"") {
            const end = text.indexOf("\"", i + 1);
            const stop = end === -1 ? text.length : end + 1;
            out += text.slice(i, stop);
            i = stop;
        } else if (ch === "$" && (i === 0 || !/[\w$]/.test(text[i - 1]))) {
            const tag = /^\$(?:[A-Za-z_][\w]*)?\$/.exec(text.slice(i));
            if (!tag) { out += ch; i++; continue; }
            const end = text.indexOf(tag[0], i + tag[0].length);
            i = end === -1 ? text.length : end + tag[0].length;
            out += " ";
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

function refuse(reason: string): never {
    throw new ApiError(
        400,
        "SQL_NOT_ALLOWED",
        `${reason} SQL run as the caller is one SELECT, WITH, VALUES, TABLE, INSERT, UPDATE, DELETE or MERGE ` +
        "statement, with every value passed in `params` ($1, $2, …). Session settings carry the caller's " +
        "identity, so a statement that could change them is refused.",
        undefined,
        true
    );
}

/** Throw `SQL_NOT_ALLOWED` unless `text` may run as the caller (see the module docs). */
export function assertCallerSql(text: string): void {
    const code = maskSqlLiterals(text);
    const statements = code.split(";").filter(part => part.trim().length > 0);
    if (statements.length === 0) refuse("The query is empty.");
    if (statements.length > 1) refuse("The query holds more than one statement.");
    const lead = /^[\s(]*([A-Za-z]+)/.exec(statements[0])?.[1]?.toLowerCase();
    if (!lead || !ALLOWED_LEADS.has(lead)) refuse(`\`${lead?.toUpperCase() ?? "?"}\` cannot run as the caller.`);
    // `U&"set\005fconfig"` spells a name in escapes no pattern here would read.
    if (/u&"/i.test(code)) refuse("The query spells an identifier with Unicode escapes (U&\"…\").");
    if (SETS_A_SETTING.test(code)) refuse("The query calls set_config.");
    if (NAMES_PG_SETTINGS.test(code)) refuse("The query names pg_settings.");
    for (const call of code.matchAll(REBASE_FUNCTION_CALL)) {
        if (!CALLER_REBASE_FUNCTIONS.has(call[1].toLowerCase())) refuse(`The query calls rebase.${call[1]}, which is the server's.`);
    }
    const door = NAMES_A_SERVER_DOOR.exec(code);
    if (door) refuse(`The query calls ${door[1]}, which is the server's.`);
}
