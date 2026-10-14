/**
 * `assertDbCommandLine` judges every `rebase db …` line the driver answers,
 * with the parse each command runs itself, and without connecting to anything.
 *
 * The CLI calls it before it starts a database for the driver. Without it,
 * `rebase db push --dry-rn` started the remembered container (or booted the
 * managed PGlite daemon) and only then heard that the flag does not exist.
 */
import { assertDbCommandLine } from "../src/db-command-line";
import { DRIVER_DB_SUBCOMMANDS, isDriverDbSubcommand } from "../src/db-subcommands";

// The backup module runs pg_dump through execa, which is ESM-only and which
// jest's CommonJS loader cannot require. Nothing here runs a tool.
jest.mock("execa", () => ({ execa: jest.fn() }));

describe("assertDbCommandLine", () => {
    it("refuses a misspelt push flag in the driver's own words", () => {
        expect(() => assertDbCommandLine(["db", "push", "--dry-rn"]))
            .toThrow("`rebase db push` has no option --dry-rn — did you mean --dry-run? Nothing was run.");
    });

    it.each([
        [["db", "generate", "--colections", "x"], /`rebase db generate` has no option --colections — did you mean --collections\?/],
        [["db", "migrate", "--baselin", "1"], /`rebase db migrate` has no option --baselin — did you mean --baseline\?/],
        [["db", "branch", "create", "x", "--froce"], /`rebase db branch create` has no option --froce — did you mean --force\?/],
        [["db", "branch", "prune", "--older-then", "1d"], /`rebase db branch prune` has no option --older-then/],
        [["db", "backup", "--ot", "x"], /`rebase db backup` has no option --ot — did you mean --out\?/],
        [["db", "backup", "--exclude-schema", "rebase"], /leaves out the rebase schema/],
        [["db", "backup", "./backups"], /takes no argument "\.\/backups"/],
        [["db", "restore", "x.dump", "--targt-db", "y"], /`rebase db restore` has no option --targt-db — did you mean --target-db\?/],
        [["db", "restore", "a.dump", "b.dump"], /restores one backup, and was given 2/],
        [["db", "backups", "list", "--ot", "x"], /`rebase db backups list` has no option --ot — did you mean --out\?/],
        [["db", "backup", "list", "--ot", "x"], /`rebase db backups list` has no option --ot — did you mean --out\?/]
    ])("refuses %j", (line, message) => {
        expect(() => assertDbCommandLine(line)).toThrow(message);
    });

    it.each([
        [["db", "push", "--dry-run", "--collections", "../config/collections", "-y"]],
        [["db", "push", "--allow-destructive", "--database-url", "postgres://u:p@h/db", "--docker", "--debug"]],
        [["db", "generate", "add_tags", "-c", "x"]],
        [["db", "migrate", "--baseline", "20261014102032"]],
        [["db", "migrate", "--refuse-destructive"]],
        [["db", "branch", "create", "feature", "--from", "main", "--force"]],
        [["db", "branch", "list"]],
        [["db", "branch", "delete", "feature", "--yes"]],
        [["db", "branch", "prune", "--older-than", "14d", "--include-dev-diff", "-y"]],
        [["db", "backup", "--out", "./backups", "--exclude-schema", "audit"]],
        [["db", "restore", "x.dump", "--target-db", "fresh", "--create-db", "--clean", "--yes"]],
        [["db", "backups", "list", "--out", "s3://bucket/prefix"]],
        [["db", "backup", "list", "-o", "./backups"]]
    ])("accepts %j", (line) => {
        expect(() => assertDbCommandLine(line)).not.toThrow();
    });

    it("leaves --help to the dispatch, which prints rather than runs", () => {
        expect(() => assertDbCommandLine(["db", "push", "--dry-rn", "--help"])).not.toThrow();
    });

    it("passes a subcommand it does not answer, for the dispatch to name", () => {
        expect(() => assertDbCommandLine(["db", "psh", "--dry-rn"])).not.toThrow();
        expect(() => assertDbCommandLine(["schema", "generate", "--ouput", "x"])).not.toThrow();
        // An action the branch table does not list is the dispatch's too.
        expect(() => assertDbCommandLine(["db", "branch", "rename", "--x"])).not.toThrow();
    });

    it("covers the subcommands the dispatch accepts, and only those", () => {
        expect([...DRIVER_DB_SUBCOMMANDS].sort()).toEqual(["backup", "backups", "branch", "generate", "migrate", "push", "restore"]);
        expect(DRIVER_DB_SUBCOMMANDS.every(isDriverDbSubcommand)).toBe(true);
        expect(isDriverDbSubcommand("url")).toBe(false);
        expect(isDriverDbSubcommand(undefined)).toBe(false);
    });
});
