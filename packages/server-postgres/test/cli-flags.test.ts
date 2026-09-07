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
import fs from "fs";
import path from "path";

import {
    assertKnownFlags,
    assertOutputAliasesPaired,
    assertSpecMatchesUsage,
    DRIVER_FLAG_SPECS,
    flagsInUsage,
    OUTPUT_FLAG_ALIASES
} from "../src/cli-flags";

/** The driver's own line: `["db", "push", …]`, as the CLI relays it. */
const line = (...args: string[]) => args;

/**
 * The `--help` usage lines, read out of the CLI's own help pages.
 *
 * The help lives in `packages/cli` and the specs live here, because `rebase db
 * --help` must answer without *running* the driver. Two packages, two lists,
 * one contract — so the test reads the other package's source rather than
 * restating it, the way `help-coverage.test.ts` reads a dispatcher's cases.
 *
 * Keyed the way {@link DRIVER_FLAG_SPECS} is, off the usage string itself:
 * every one of them opens `rebase <domain> <subcommand>`.
 */
function usageStrings(): Record<string, string> {
    const cliCommands = path.resolve(__dirname, "..", "..", "cli", "src", "commands");
    const usages: Record<string, string> = {};
    for (const file of ["db.ts", "schema.ts"]) {
        const source = fs.readFileSync(path.join(cliCommands, file), "utf8");
        for (const [, usage] of source.matchAll(/^\s+usage: "(rebase [^"]+)",?$/gm)) {
            const [, domain, subcommand] = usage.split(" ");
            if (subcommand && !subcommand.startsWith("<") && !subcommand.startsWith("[")) {
                usages[`${domain} ${subcommand}`] = usage;
            }
        }
    }
    // A silently empty map would make every check below pass by reading nothing.
    if (Object.keys(usages).length < 6) {
        throw new Error(`Found ${Object.keys(usages).length} usage strings under ${cliCommands} — the help pages moved.`);
    }
    return usages;
}

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
        // Derived, not hand-listed: this used to name three flags and `db push
        // --help` documented four, so `--dry-run` was rejected for two releases
        // by a test called "accepts the flags db push documents". See the
        // "help and spec" describe block below for the check that keeps them
        // in step; this asserts the line a reader would actually type.
        const documented = flagsInUsage(usageStrings()["db push"]);
        expect(documented).toContain("--dry-run");
        const typed = documented.flatMap(flag => (flag === "--collections" ? [flag, "./config/collections"] : [flag]));
        expect(() => assertKnownFlags("db", "push", line("db", "push", ...typed))).not.toThrow();
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

/**
 * The help page and the spec are one contract, checked in both directions.
 *
 * `rebase db push --help` documented `[--dry-run]`; the spec did not list it;
 * `assertKnownFlags` then answered `unknown or unexpected option: --dry-run` to
 * a line the command's own help had just offered. Nothing failed — the test
 * that was supposed to cover this hand-listed three flags and was green.
 */
describe("the help page and the flag spec", () => {
    it("agree on every command that has both", () => {
        expect(assertSpecMatchesUsage(DRIVER_FLAG_SPECS, usageStrings())).toEqual([]);
    });

    it("reports a flag added to the help but not the spec", () => {
        // The check has to be able to fail, or a green run means nothing. This
        // is the exact shape of the `--dry-run` drift.
        const problems = assertSpecMatchesUsage(
            { "db push": { "--yes": Boolean } },
            { "db push": "rebase db push [--dry-run] [--yes]" }
        );
        expect(problems).toEqual(["`db push` documents --dry-run in its usage line but the spec rejects it"]);
    });

    it("reports a flag the spec accepts and no help mentions", () => {
        const problems = assertSpecMatchesUsage(
            { "db push": { "--yes": Boolean, "--force": Boolean } },
            { "db push": "rebase db push [--yes]" }
        );
        expect(problems).toEqual(["`db push` accepts --force but no usage line documents it"]);
    });

    it("does not ask for a line per alias, or per flag the CLI relays", () => {
        const problems = assertSpecMatchesUsage(
            { "db push": { "--collections": String, "-c": "--collections", "--docker": Boolean } },
            { "db push": "rebase db push [--collections <dir>]" }
        );
        expect(problems).toEqual([]);
    });

    it("says nothing about a command that parses its own line", () => {
        expect(assertSpecMatchesUsage({}, { "db branch": "rebase db branch <create|list> [--force]" })).toEqual([]);
    });
});

/**
 * One destination flag, two spellings, accepted everywhere either is.
 *
 * `--out` is the primary name on `rebase build`, an alias on `generate-sdk`,
 * `db backup` and `cloud env pull`, and was refused outright by all three
 * `schema` commands — so `rebase schema generate --out /tmp/x.ts`, typed by
 * someone who had just used `--out` on `build`, answered "unknown or unexpected
 * option". Neither name can be retired: both are shipped. The rule is that a
 * spec naming one names both, and it is checked over the specs rather than
 * asserted command by command, so the next `--output`-only command fails here.
 */
describe("the --out / --output pair", () => {
    it("is complete in every driver spec that names either", () => {
        expect(assertOutputAliasesPaired(DRIVER_FLAG_SPECS)).toEqual([]);
    });

    it("would report a spec that names only one", () => {
        // The check has to be able to fail, or a green run means nothing.
        const problems = assertOutputAliasesPaired({ "schema drift": { "--output": String } });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("schema drift");
        expect(problems[0]).toContain("--out");
    });

    it.each(OUTPUT_FLAG_ALIASES)("is accepted by every schema command as %s", flag => {
        for (const subcommand of ["generate", "introspect", "stale"]) {
            expect(() => assertKnownFlags("schema", subcommand, line("schema", subcommand, flag, "/tmp/x.ts")))
                .not.toThrow();
        }
    });
});
