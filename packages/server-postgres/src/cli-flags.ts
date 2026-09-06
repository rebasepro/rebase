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
        "--dry-run": Boolean,
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
        "--out": "--output",
        "--watch": Boolean,
        "-w": "--watch"
    },
    "schema introspect": {
        "--output": String,
        "-o": "--output",
        "--out": "--output",
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
        "--out": "--output",
        "--fix": Boolean
    }
};

/**
 * One destination flag, two spellings, everywhere.
 *
 * `--out` is the primary on `rebase build`, an alias on `generate-sdk`, `db
 * backup` and `cloud env pull`, and was refused outright by the three `schema`
 * commands — so the spelling a user learned on one command was an
 * "unknown or unexpected option" on the next. Neither name can be retired (both
 * are shipped), so both are accepted, and {@link assertOutputAliasesPaired}
 * makes that the rule rather than a habit.
 */
export const OUTPUT_FLAG_ALIASES = ["--out", "--output"] as const;

/**
 * Every spec that names one of the pair names both.
 *
 * Exported so the CLI's own specs can be held to it too: the drift this fixes
 * ran across two packages, and a check that only reads this file would let the
 * next `--out`-only command through.
 */
export function assertOutputAliasesPaired(specs: Record<string, arg.Spec>): string[] {
    const problems: string[] = [];
    for (const [command, spec] of Object.entries(specs)) {
        const present = OUTPUT_FLAG_ALIASES.filter(flag => flag in spec);
        if (present.length === 0 || present.length === OUTPUT_FLAG_ALIASES.length) continue;
        const missing = OUTPUT_FLAG_ALIASES.filter(flag => !(flag in spec));
        problems.push(`\`${command}\` takes ${present.join(", ")} but not ${missing.join(", ")}`);
    }
    return problems;
}

/**
 * The long flags a `--help` usage line documents.
 *
 * `"rebase db push [--collections <dir>] [--dry-run] …"` → `["--collections",
 * "--dry-run"]`. Placeholders (`<dir>`) and the alternation inside a positional
 * (`<create|list|switch>`) are not flags and are not returned.
 */
export function flagsInUsage(usage: string): string[] {
    return [...new Set(usage.match(/--[a-z][a-z0-9-]*/g) ?? [])];
}

/**
 * Every flag the help documents is accepted, and every flag accepted is documented.
 *
 * The drift this catches shipped: `rebase db push --help` has printed
 * `[--dry-run]` since the flag was written, `DRIVER_FLAG_SPECS["db push"]` never
 * listed it, and {@link assertKnownFlags} — added later to stop typos being
 * swallowed — turned the documented flag into `unknown or unexpected option`.
 * The only way to see a push's SQL was to trip the destructive gate, which is
 * the exact problem `--dry-run` was written to solve. Worse in a project on an
 * older driver, whose permissive parser *applied* the schema on that line.
 *
 * Two hand-maintained lists in two packages cannot be kept in step by care, so
 * they are held to each other instead: `usages` is keyed the way
 * {@link DRIVER_FLAG_SPECS} is (`"db push"`), and comes from the CLI's own help
 * pages. A key in only one of the two is not this function's business — the
 * help covers commands that parse their own lines (`db branch`, `db backup`),
 * and an absent spec entry means "not checked here".
 *
 * Aliases (`"-c": "--collections"`, `"--out": "--output"`) need no line of their
 * own: they are spellings of a documented flag. Neither do {@link RELAYED_FLAGS},
 * which every driver command accepts because the CLI relays them.
 */
export function assertSpecMatchesUsage(
    specs: Record<string, arg.Spec>,
    usages: Record<string, string>
): string[] {
    const problems: string[] = [];
    for (const [command, spec] of Object.entries(specs)) {
        const usage = usages[command];
        if (usage === undefined) continue;

        const documented = flagsInUsage(usage);
        const accepted = Object.entries(spec);
        // An alias resolves to the flag it spells; only the target needs a line.
        const canonical = new Set(
            accepted
                .map(([flag, kind]) => (typeof kind === "string" ? kind : flag))
                .filter(flag => flag.startsWith("--"))
        );

        for (const flag of documented) {
            if (flag in spec || flag in RELAYED_FLAGS) continue;
            problems.push(`\`${command}\` documents ${flag} in its usage line but the spec rejects it`);
        }
        for (const flag of canonical) {
            if (documented.includes(flag) || flag in RELAYED_FLAGS) continue;
            problems.push(`\`${command}\` accepts ${flag} but no usage line documents it`);
        }
    }
    return problems;
}

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
