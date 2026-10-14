/**
 * What a command line resolves to, for the commands whose positionals are
 * credentials.
 *
 * The parser these replace ran `arg` permissively and read `_[0]`/`_[1]` out of
 * `rawArgs.slice(4)`, which meant two ordinary lines set a password to a flag:
 *
 *   rebase auth reset-password bob@example.com --debug   → password "--debug"
 *   rebase auth reset-password bob@example.com -p 'S3c!' → password "-p"
 *
 * Both are things the product tells you to type — `--debug` is what
 * `bin/rebase.js` prints after every failure, `-p` was advertised in this
 * command's own help — so neither is a hypothetical.
 */
import { describe, expect, it } from "vitest";
import { parseCommandArgs, wantsHelp } from "./args";

const SPEC = {
    "--email": String,
    "--password": String,
    "-e": "--email",
    "-p": "--password"
} as const;

/** A full `process.argv`, the way `cli.ts` hands it to a command. */
function argv(...line: string[]): string[] {
    return ["/usr/bin/node", "/usr/local/bin/rebase", ...line];
}

function parse(...line: string[]) {
    return parseCommandArgs({
        spec: SPEC,
        rawArgs: argv(...line),
        commandWords: 2,
        command: "auth reset-password",
        maxPositionals: 2
    });
}

describe("parseCommandArgs", () => {
    it("reads positionals after the command words", () => {
        const { positionals } = parse("auth", "reset-password", "bob@example.com", "S3cret!");
        expect(positionals).toEqual(["bob@example.com", "S3cret!"]);
    });

    it("refuses an undeclared flag instead of making it a positional", () => {
        expect(() => parse("auth", "reset-password", "bob@example.com", "--debug"))
            .not.toThrow();
        expect(() => parse("auth", "reset-password", "bob@example.com", "--nope"))
            .toThrow(/has no option --nope/);
    });

    /**
     * One sentence for a typo, the one `db backup`, `db restore` and `db
     * branch` say. This family said `unknown or unexpected option: --x (did
     * you mean --y?) — run …`, so the same mistake read two ways depending on
     * which half of the CLI caught it.
     */
    it("names the declared flag a typo is closest to, in the sentence db backup says", () => {
        expect(() => parse("auth", "reset-password", "--emial", "bob@example.com"))
            .toThrow("`rebase auth reset-password` has no option --emial — did you mean --email? Nothing was run. See `rebase auth reset-password --help`.");
        // `--debug` and `--help` are declared on every command, so they are
        // offered too.
        expect(() => parse("auth", "reset-password", "--hepl")).toThrow(/did you mean --help\?/);
        // Nothing close: no guess, and what it does take.
        expect(() => parse("auth", "reset-password", "--frobnicate"))
            .toThrow("`rebase auth reset-password` has no option --frobnicate — it takes --email, --password. Nothing was run. See `rebase auth reset-password --help`.");
        // An abbreviation of exactly one flag is offered too.
        expect(() => parse("auth", "reset-password", "--pass")).toThrow(/did you mean --password\?/);
        // A value given inline is not part of the flag's name.
        expect(() => parse("auth", "reset-password", "--emial=bob@example.com")).toThrow(/has no option --emial — /);
    });

    it("names the command's help in the error, so the flag can be looked up", () => {
        expect(() => parse("auth", "reset-password", "--wat"))
            .toThrow(/rebase auth reset-password --help/);
    });

    it("consumes --debug rather than passing it on as a value", () => {
        // The regression: `--debug` is what the CLI prints after every failure,
        // so appending it to a command that just failed is the likeliest next
        // keystroke. It must never land in a positional slot.
        const { positionals } = parse("auth", "reset-password", "bob@example.com", "--debug");
        expect(positionals).toEqual(["bob@example.com"]);
    });

    it("keeps a declared short alias's value, rather than shifting it", () => {
        const { flags, positionals } = parse("auth", "reset-password", "-e", "bob@example.com", "-p", "S3cret!");
        expect(flags["--email"]).toBe("bob@example.com");
        expect(flags["--password"]).toBe("S3cret!");
        expect(positionals).toEqual([]);
    });

    it("is not shifted by a flag placed before the command", () => {
        const { positionals } = parse("--debug", "auth", "reset-password", "bob@example.com", "S3cret!");
        expect(positionals).toEqual(["bob@example.com", "S3cret!"]);
    });

    it("refuses a positional that looks like an option even past `--`", () => {
        expect(() => parse("auth", "reset-password", "--", "-p"))
            .toThrow(/looks like an option/);
    });

    it("refuses more arguments than the command takes", () => {
        expect(() => parse("auth", "reset-password", "a@b.com", "one", "two"))
            .toThrow(/takes 2 arguments/);
    });

    it("reports --help without the caller having to look for it", () => {
        expect(parse("auth", "reset-password", "--help").help).toBe(true);
        expect(parse("auth", "reset-password", "a@b.com").help).toBe(false);
    });
});

/**
 * One argument holding a flag and its value, a quoting mistake:
 *
 *     rebase db pull "--fro postgres://rebase_app:secretpw123@127.0.0.1:5998/prod" --yes
 *
 * was refused with `has no option unknown or unexpected option: --fro
 * postgres://rebase_app:secretpw123@…`: arg's own sentence inside ours, and
 * the password with it.
 */
describe("an argument holding a flag and its value", () => {
    const PULL = { "--from": String, "--anonymize": Boolean, "--yes": Boolean } as const;
    const pull = (...line: string[]) =>
        parseCommandArgs({ spec: PULL, rawArgs: argv("db", "pull", ...line), commandWords: 2, command: "db pull", maxPositionals: 0 });
    const refusal = (...line: string[]): string => {
        try {
            pull(...line);
        } catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
        throw new Error("expected a refusal");
    };

    it("is named as that, masked, with the flag it was probably meant to be", () => {
        expect(refusal("--fro postgres://rebase_app:secretpw123@127.0.0.1:5998/prod", "--yes")).toBe(
            "`rebase db pull` has no option \"--fro postgres://rebase_app:***@127.0.0.1:5998/prod\": " +
            "that is a flag and a value in one argument, quoted together. " +
            "Write them as two arguments, --from <value>, or as --from=<value>. Nothing was run. See `rebase db pull --help`."
        );
    });

    it("names the flag itself when it is the right one, quoted together with its value", () => {
        const said = refusal("--from postgres://app:hunter2@db.example.com/prod?sslmode=require");
        expect(said).toContain("Write them as two arguments, --from <value>, or as --from=<value>.");
        expect(said).not.toContain("hunter2");
    });

    it("never repeats a password given inline", () => {
        expect(refusal("--fro=postgres://app:hunter2@db/prod")).toBe(
            "`rebase db pull` has no option --fro — did you mean --from? Nothing was run. See `rebase db pull --help`."
        );
    });

    it("masks a password in a value that looks like an option", () => {
        expect(refusal("--", "-postgres://app:hunter2@db/prod")).not.toContain("hunter2");
    });
});

/**
 * `arg` drops the value of a flag that takes none and turns it on, so
 * `rebase db pull --anonymize=false` anonymized and `--yes=false` answered
 * yes. A value on a switch is refused instead, on every command on this
 * parser.
 */
describe("a switch given a value", () => {
    const SWITCHES = { "--anonymize": Boolean, "--yes": Boolean, "-y": "--yes", "--schema": [String], "--tag": [Boolean] } as const;
    const pull = (...line: string[]) =>
        parseCommandArgs({ spec: SWITCHES, rawArgs: argv("db", "pull", ...line), commandWords: 2, command: "db pull", maxPositionals: 0 });

    it.each(["--anonymize=false", "--anonymize=true", "--anonymize=no", "--anonymize=", "--yes=false", "--tag=x"])(
        "refuses %s rather than turning it on",
        (typed) => {
            const flag = typed.slice(0, typed.indexOf("="));
            expect(() => pull(typed)).toThrow(
                `\`rebase db pull\` takes ${flag} without a value (${typed}): give it to turn it on, and leave it out to turn it off. ` +
                "Nothing was run. See `rebase db pull --help`."
            );
        }
    );

    it("refuses one on a global switch too", () => {
        expect(() => pull("--debug=false")).toThrow(/takes --debug without a value/);
    });

    it("leaves a flag that takes a value, and a switch written alone, as they are", () => {
        const { flags } = pull("--anonymize", "--schema=public", "-y");
        expect(flags["--anonymize"]).toBe(true);
        expect(flags["--schema"]).toEqual(["public"]);
        expect(flags["--yes"]).toBe(true);
    });

    it("reads nothing past `--`", () => {
        expect(() => parseCommandArgs({ spec: SWITCHES, rawArgs: argv("x", "--", "--yes=false"), commandWords: 1, command: "x" }))
            .toThrow(/looks like an option/);
    });

    it("masks a password in what it quotes", () => {
        expect(() => pull("--yes=postgres://app:hunter2@db/prod")).toThrow("(--yes=postgres://app:***@db/prod)");
    });

    it("is a usage error", () => {
        try {
            pull("--yes=false");
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toMatchObject({ isUsageError: true });
        }
    });
});

describe("wantsHelp", () => {
    it("sees --help and -h anywhere on the line", () => {
        expect(wantsHelp(argv("skills", "install", "--help"))).toBe(true);
        expect(wantsHelp(argv("api-keys", "revoke", "-h"))).toBe(true);
        expect(wantsHelp(argv("api-keys", "list"))).toBe(false);
    });
});

describe("UsageError", () => {
    /**
     * `bin/rebase.js` ends every failure with "Re-run with --debug for the
     * stack trace." For a mistyped flag that is worse than nothing: the stack
     * names `arg` and this file, and the suggested next step is to add another
     * flag to the command line we have just established is the problem.
     *
     * The marker is a property, not the class: `bin/rebase.js` imports the
     * bundle, so the class object it would test with `instanceof` is a
     * different one from this.
     */
    it("marks every shape parseCommandArgs refuses", () => {
        const refuse = (rawArgs: string[], maxPositionals?: number) => {
            try {
                parseCommandArgs({ spec: { "--json": Boolean }, rawArgs, commandWords: 1, command: "status", maxPositionals });
                throw new Error("expected a refusal");
            } catch (err) {
                return err as { isUsageError?: boolean; name?: string };
            }
        };

        for (const err of [
            refuse(["node", "rebase", "status", "--jsn"]),
            refuse(["node", "rebase", "status", "--", "-x"]),
            refuse(["node", "rebase", "status", "extra"], 0)
        ]) {
            expect(err.isUsageError).toBe(true);
            expect(err.name).toBe("UsageError");
        }
    });
});
