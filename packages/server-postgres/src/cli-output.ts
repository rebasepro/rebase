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
