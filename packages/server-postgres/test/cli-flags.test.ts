/**
 * A flag the command does not take is a typo, and every parser in `cli.ts`
 * treated it as a value.
 *
 * `arg(..., { permissive: true })` does not relax parsing — it moves an
 * undeclared flag into `_`. So the flag was accepted, ignored, and never
 * mentioned:
 *
 *  - `rebase db push --alow-destructive` pushed with the destructive gate still
 *    shut, and the refusal that followed read as Rebase ignoring the flag the
 *    developer had just typed.
 *  - `rebase schema generate --ouput src/schema.ts` wrote the default path and
 *    said nothing, so the next build compiled a schema nobody had regenerated.
 *
 * These assert both directions, because the risk of the fix is the other one:
 * `db push` and `db generate` re-enter the schema and DDL generators with the
 * *db* line, so a check placed in those generators would reject
 * `--allow-destructive` on a line where it is correct.
 */
import { assertKnownFlags, DRIVER_FLAG_SPECS } from "../src/cli-flags";

/** The driver's own line: `["db", "push", …]`, as the CLI relays it. */
const line = (...args: string[]) => args;

describe("assertKnownFlags", () => {
    it("rejects a misspelled --allow-destructive", () => {
        expect(() => assertKnownFlags("db", "push", line("db", "push", "--alow-destructive")))
            .toThrow(/unknown or unexpected option: --alow-destructive/);
    });

    it("points at the help for the command that was named", () => {
        expect(() => assertKnownFlags("db", "push", line("db", "push", "--alow-destructive")))
            .toThrow(/rebase db --help/);
    });

    it("rejects a misspelled --output on schema generate", () => {
        expect(() => assertKnownFlags("schema", "generate", line("schema", "generate", "--ouput", "x")))
            .toThrow(/unknown or unexpected option: --ouput/);
    });

    it("accepts the flags db push documents", () => {
        expect(() => assertKnownFlags(
            "db", "push",
            line("db", "push", "--collections", "./config/collections", "--allow-destructive", "--yes")
        )).not.toThrow();
    });

    it("accepts the short forms", () => {
        expect(() => assertKnownFlags("db", "push", line("db", "push", "-c", "./c", "-y"))).not.toThrow();
    });

    /**
     * The whole reason this check lives at the entry point. `db push` calls the
     * schema generator and the DDL generator with its own line, so a strict
     * parser inside either of them would see `--allow-destructive` and refuse a
     * correct command.
     */
    it("does not judge db flags by the schema generator's spec", () => {
        expect(() => assertKnownFlags("db", "push", line("db", "push", "--allow-destructive"))).not.toThrow();
        expect(() => assertKnownFlags("schema", "generate", line("schema", "generate", "--allow-destructive")))
            .toThrow(/unknown or unexpected option/);
    });

    it("accepts what the CLI relays without being asked", () => {
        // `--database-url` and `--docker` are read by the CLI to resolve the
        // database and then passed through verbatim; `--debug` is what
        // bin/rebase.js prints after every failure as the thing to re-run with.
        // Rejecting any of them would refuse a command the CLI documents.
        expect(() => assertKnownFlags(
            "db", "push",
            line("db", "push", "--database-url", "postgres://x/y", "--docker", "--debug")
        )).not.toThrow();
    });

    it("lets `db migrate` keep its positional amount and nothing else", () => {
        expect(() => assertKnownFlags("db", "migrate", line("db", "migrate", "2"))).not.toThrow();
        expect(() => assertKnownFlags("db", "migrate", line("db", "migrate", "--baselin", "1")))
            .toThrow(/unknown or unexpected option/);
    });

    it("leaves commands that own their argument handling alone", () => {
        // `branch`, `backup`, `restore` and `backups` parse their own lines. An
        // absent entry means "not checked here", never "takes nothing" — a
        // second list would be one more thing to keep in step.
        expect(DRIVER_FLAG_SPECS["db branch"]).toBeUndefined();
        expect(() => assertKnownFlags("db", "branch", line("db", "branch", "create", "x", "--from", "main")))
            .not.toThrow();
    });

    it("says nothing when no subcommand was named", () => {
        expect(() => assertKnownFlags("db", undefined, line("db"))).not.toThrow();
    });
});
