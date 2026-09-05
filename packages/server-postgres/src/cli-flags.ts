/**
 * The flags each driver command takes, in one place, and the check that
 * enforces them.
 *
 * Every parser in `cli.ts` runs `arg(..., { permissive: true })`, which does not
 * mean "be lenient" — it means **an undeclared flag becomes a positional**. So
 * `rebase db push --alow-destructive` did not fail: the typo landed in `_`, the
 * push ran with the destructive gate still closed, and the developer read the
 * refusal as Rebase ignoring the flag they had just typed. `rebase schema
 * generate --ouput src/schema.ts` was worse — it wrote the default path and
 * said nothing, so the next build compiled a file nobody had regenerated.
 *
 * The check has to live at the entry point rather than in those parsers, and
 * that is not a detail: `db push` and `db generate` re-enter `schemaCommand`
 * and `generatePostgresDdlCommand` with the *db* line, so a strict parser
 * inside either of them would reject `--allow-destructive` on a line where it
 * is correct. One validation, once, against the spec for the command the user
 * actually named; the inner parsers keep reading an already-validated line.
 *
 * Commands with their own argument handling — `db branch` (`unexpectedBranchArgs`),
 * `db backup`, `db restore`, `db backups` — are deliberately absent: they own
 * their spec, and a second list here would be one more thing to keep in step.
 * An absent entry is "not checked here", never "takes nothing".
 */
import arg from "arg";

/**
 * Flags that reach this process on a line it did not compose.
 *
 * `rebase db …` hands the driver the user's whole line: the CLI *reads*
 * `--database-url` and `--docker` to resolve the database and then relays them
 * verbatim, and `--debug` is what `bin/rebase.js` prints after every failure as
 * the thing to re-run with. Rejecting any of the three would make the driver
 * refuse commands the CLI documents.
 */
const RELAYED_FLAGS: arg.Spec = {
    "--database-url": String,
    "--docker": Boolean,
    "--debug": Boolean,
    "--help": Boolean,
    "-h": "--help"
};

/** Keyed by `"<domain> <subcommand>"`, the way the user types it. */
export const DRIVER_FLAG_SPECS: Record<string, arg.Spec> = {
    "db push": {
        "--collections": String,
        "-c": "--collections",
        "--allow-destructive": Boolean,
        "--yes": Boolean,
        "-y": "--yes"
    },
    "db generate": {
        "--collections": String,
        "-c": "--collections"
    },
    // Bare positionals still pass through to `atlas migrate apply`, which takes
    // an optional amount; flags do not.
    "db migrate": {},
    "schema generate": {
        "--collections": String,
        "-c": "--collections",
        "--output": String,
        "-o": "--output",
        "--watch": Boolean,
        "-w": "--watch"
    },
    "schema introspect": {
        "--output": String,
        "-o": "--output",
        "--collections": String,
        "-c": "--collections",
        "--force": Boolean,
        "-f": "--force",
        "--schema": String
    },
    "schema stale": {
        "--collections": String,
        "-c": "--collections",
        "--output": String,
        "-o": "--output",
        "--fix": Boolean
    }
};

/**
 * Reject a flag the named command does not take.
 *
 * `args` is the driver's whole line — `["db", "push", …]` — so the flags are
 * read from `args.slice(2)`, past the two command words.
 *
 * Throws rather than exiting: `runPluginCommand`'s caller already turns a
 * thrown error into one red line and exit 1, and a thrown error is what the
 * tests can see.
 */
export function assertKnownFlags(domain: string, subcommand: string | undefined, args: string[]): void {
    if (!subcommand) return;
    const spec = DRIVER_FLAG_SPECS[`${domain} ${subcommand}`];
    if (!spec) return;

    try {
        arg({ ...RELAYED_FLAGS, ...spec }, { argv: args.slice(2) });
    } catch (err) {
        if (err instanceof Error && (err as arg.ArgError).code === "ARG_UNKNOWN_OPTION") {
            throw new Error(
                `${err.message} — run \`rebase ${domain} --help\` for the options ` +
                `\`${domain} ${subcommand}\` takes.`
            );
        }
        throw err;
    }
}
