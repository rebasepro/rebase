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
            .toThrow(/unknown or unexpected option/);
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

describe("wantsHelp", () => {
    it("sees --help and -h anywhere on the line", () => {
        expect(wantsHelp(argv("skills", "install", "--help"))).toBe(true);
        expect(wantsHelp(argv("api-keys", "revoke", "-h"))).toBe(true);
        expect(wantsHelp(argv("api-keys", "list"))).toBe(false);
    });
});
