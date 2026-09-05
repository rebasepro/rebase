/**
 * `--debug` is what `bin/rebase.js` prints after every failure as the thing to
 * re-run with, so it is the single most likely token to appear before a command
 * word — and every reader of `rawArgs` at a fixed index was shifted by it.
 *
 * What that cost is not a bad message. `rebase db branch switch feature` writes
 * a per-checkout pointer the CLI owns; the driver runs as a child process and
 * cannot persist it. The dispatch found `switch` by position, so `rebase --debug
 * db branch switch feature` missed the CLI's branch, handed the line to the
 * driver, and the driver reported success while the checkout stayed on the main
 * database. Every later `dev`, `push` and `backup` then ran against the wrong
 * database believing it was the branch — the exact failure branching exists to
 * prevent, announced as a success.
 */
import { describe, expect, it } from "vitest";
import { argsFromCommand, commandWords } from "./command-words";

/** A full process.argv, the way bin/rebase.js hands it over. */
const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

describe("commandWords", () => {
    it("names the words with no flag in the way", () => {
        expect(commandWords(argv("db", "branch", "switch", "feature"), "db"))
            .toEqual(["db", "branch", "switch", "feature"]);
    });

    it("survives a flag written before the command", () => {
        expect(commandWords(argv("--debug", "db", "branch", "switch", "feature"), "db"))
            .toEqual(["db", "branch", "switch", "feature"]);
    });

    it("survives a flag written among the command's own words", () => {
        expect(commandWords(argv("db", "branch", "--debug", "switch", "feature"), "db"))
            .toEqual(["db", "branch", "switch", "feature"]);
    });

    it("survives a value-taking flag before the command", () => {
        // No parser at this level knows which flags take values, so the value
        // arrives as a bare word. Anchoring on the command name is what makes
        // that survivable — it would have to be the literal word "db" to fool.
        expect(commandWords(argv("--database-url", "postgres://h/shop", "db", "branch", "list"), "db"))
            .toEqual(["db", "branch", "list"]);
    });

    it("keeps a branch named after a command word", () => {
        expect(commandWords(argv("db", "branch", "create", "branch"), "db"))
            .toEqual(["db", "branch", "create", "branch"]);
    });

    it("returns nothing when the command is not on the line", () => {
        expect(commandWords(argv("--help"), "db")).toEqual([]);
    });
});

describe("argsFromCommand", () => {
    it("starts the child's line at the command word", () => {
        // The driver reads its domain out of args[0], so ["--debug", "db",
        // "push"] made it answer "Unknown domain command: --debug".
        expect(argsFromCommand(argv("--debug", "db", "push"), "db"))
            .toEqual(["db", "push", "--debug"]);
    });

    it("moves a leading flag after the words rather than dropping it", () => {
        // Dropping would be the same bug facing the other way: the flag that
        // says which database to touch would vanish in silence.
        expect(argsFromCommand(argv("--database-url", "postgres://h/shop", "db", "push"), "db"))
            .toEqual(["db", "push", "--database-url", "postgres://h/shop"]);
    });

    it("leaves an ordinary line alone", () => {
        expect(argsFromCommand(argv("db", "push", "--allow-destructive"), "db"))
            .toEqual(["db", "push", "--allow-destructive"]);
    });

    it("passes a synthesised argv through unchanged", () => {
        // `rebase dev` calls the schema generator with a line it built itself.
        expect(argsFromCommand(argv("schema", "generate"), "schema"))
            .toEqual(["schema", "generate"]);
    });
});
