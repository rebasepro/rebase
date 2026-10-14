/**
 * `db backup`, `db restore` and `db backups list` refuse a flag they do not take.
 *
 * They parsed permissively, and an undeclared flag in a permissive parse is a
 * positional. So `rebase db restore <dump> --targt-db u3_typo --create-db --yes`
 * dropped the misspelled target, fell back to DATABASE_URL's own database and
 * restored into the live one; only pg_restore's "schema already exists" stopped
 * it, and with `--clean` on the line nothing would have. `db backup --ot ../x`
 * wrote to the default directory. Every other `db` subcommand already refused.
 */
import {
    confirmRestore,
    excludesRebaseSchema,
    parseBackupLine,
    parseRestoreLine,
    schemaPatternRegex,
    unknownBackupsAction
} from "../src/backup/backup-cli";
import { parseCommandFlags } from "../src/cli-flags";

// The backup module runs pg_dump through execa, which is ESM-only and which
// jest's CommonJS loader cannot require. Nothing here runs a tool.
jest.mock("execa", () => ({ execa: jest.fn() }));

describe("db restore", () => {
    it("refuses a misspelled --target-db and names the real one", () => {
        expect(() => parseRestoreLine(["db", "restore", "backups/x.dump", "--targt-db", "u3_typo", "--create-db", "--yes"]))
            .toThrow(/has no option --targt-db — did you mean --target-db\?/);
    });

    // Two neighbouring letters swapped is the commonest typo there is, and
    // one edit away it is not: `--clena` was refused with the whole flag list.
    it("names the flag a swapped pair of letters was meant to be", () => {
        expect(() => parseRestoreLine(["db", "restore", "x.dump", "--clena", "--yes"]))
            .toThrow(/has no option --clena — did you mean --clean\?/);
    });

    it("says nothing was run", () => {
        expect(() => parseRestoreLine(["db", "restore", "x.dump", "--targt-db=x", "--yes"]))
            .toThrow(/Nothing was run/);
    });

    it("lists what it takes when nothing is one edit away", () => {
        expect(() => parseRestoreLine(["db", "restore", "x.dump", "--destination", "x"]))
            .toThrow(/it takes --target-db, --create-db, --clean, --no-owner, --continue-on-error, --yes/);
    });

    it("refuses a second backup instead of ignoring it", () => {
        expect(() => parseRestoreLine(["db", "restore", "a.dump", "b.dump", "--yes"]))
            .toThrow(/restores one backup, and was given 2/);
    });

    it("reads a correct line", () => {
        const args = parseRestoreLine(["db", "restore", "x.dump", "--target-db", "fresh", "--create-db", "-y"]);
        expect(args._).toEqual(["x.dump"]);
        expect(args["--target-db"]).toBe("fresh");
        expect(args["--create-db"]).toBe(true);
        expect(args["--yes"]).toBe(true);
    });
});

describe("db backup", () => {
    it("refuses a misspelled --out and names the real one", () => {
        expect(() => parseBackupLine(["db", "backup", "--ot", "../x"]))
            .toThrow(/has no option --ot — did you mean --out\?/);
    });

    it("refuses a bare path, which means --out", () => {
        expect(() => parseBackupLine(["db", "backup", "./backups"]))
            .toThrow(/takes no argument "\.\/backups"\. Nothing was run\. To choose where the backup goes, pass --out \.\/backups/);
    });

    it("reads every flag it documents, and the spellings of --out", () => {
        const args = parseBackupLine([
            "db", "backup", "--output", "./b", "--exclude-schema", "audit", "--exclude-schema", "tmp",
            "--no-owner", "--enable-row-security", "--row-security-role", "admin"
        ]);
        expect(args["--out"]).toBe("./b");
        expect(args["--exclude-schema"]).toEqual(["audit", "tmp"]);
        expect(parseBackupLine(["db", "backup", "-o", "./c"])["--out"]).toBe("./c");
    });

    it("accepts what the CLI relays", () => {
        expect(() => parseBackupLine(["db", "backup", "--docker", "--debug", "--database-url", "postgres://u:p@h/db"]))
            .not.toThrow();
    });

    // The schema holds the users, the roles and the functions every policy
    // calls: a dump without it wrote and validated, then could not be restored.
    it("refuses to leave out the rebase schema, however the pattern spells it", () => {
        for (const pattern of ["rebase", "REBASE", "\"rebase\"", "reb*", "re?ase", "shop.rebase", "*"]) {
            expect(() => parseBackupLine(["db", "backup", "--exclude-schema", "audit", "--exclude-schema", pattern]))
                .toThrow(/--exclude-schema .* leaves out the rebase schema, and a backup without it cannot be restored/);
        }
    });

    it("says why, and that nothing was run", () => {
        expect(() => parseBackupLine(["db", "backup", "--exclude-schema=rebase"]))
            .toThrow(/the users, roles and the functions every policy calls\. Nothing was run\./);
    });

    it("leaves out any other schema, a quoted one spelled otherwise included", () => {
        for (const pattern of ["audit", "rebase_archive", "\"Rebase\"", "x.audit"]) {
            expect(parseBackupLine(["db", "backup", "--exclude-schema", pattern])["--exclude-schema"]).toEqual([pattern]);
        }
    });

    // pg_dump passes regular-expression syntax through outside quotes, so
    // `[r]ebase` matched `rebase` and wrote a 41 KB dump without it, past a
    // guard that knew only `*` and `?`. (An unquoted `.` is not one of them:
    // it separates a database from the schema.)
    it.each([
        "[r]ebase", "[a-z]ebase", "r[e]base", "[R]ebase", "(rebase)", "rebase|audit", "audit|rebase",
        "r+ebase", "reb[a-z]se", "re[a-z]{2}se", "\\w+", "[^x]ebase", "\"re\"base", "Re\"base\"", "re(b|x)ase",
        "shop.[r]ebase"
    ])("refuses the regular-expression spelling %s", (pattern) => {
        expect(excludesRebaseSchema(pattern)).toBe(true);
        expect(() => parseBackupLine(["db", "backup", "--exclude-schema", pattern])).toThrow(/leaves out the rebase schema/);
    });

    it.each([
        "\"rebase*\"", "\"[r]ebase\"", "\"(rebase)\"", "\"REBASE\"", "rebase$", "rebase[]", "[x]ebase", "reb\\.se"
    ])("leaves %s, which pg_dump does not match to rebase, alone", (pattern) => {
        expect(excludesRebaseSchema(pattern)).toBe(false);
    });
});

describe("schemaPatternRegex", () => {
    it.each([
        ["rebase", "^(rebase)$"],
        ["REBASE", "^(rebase)$"],
        ["reb*", "^(reb.*)$"],
        ["re?ase", "^(re.ase)$"],
        ["\"Re*\"", "^(Re\\*)$"],
        ["\"a\"\"b\"", "^(a\"b)$"],
        ["my$schema", "^(my\\$schema)$"],
        ["int[]", "^(int\\[])$"],
        ["[r]ebase", "^([r]ebase)$"],
        ["shop.rebase", "^(rebase)$"],
        ["\"a.b\"", "^(a\\.b)$"]
    ])("turns %s into %s, as pg_dump does", (pattern, regex) => {
        expect(schemaPatternRegex(pattern)).toBe(regex);
    });
});

describe("parseCommandFlags", () => {
    it("leaves a missing value to arg's own message", () => {
        expect(() => parseCommandFlags({ "--out": String }, ["--out"], "db backups list"))
            .toThrow(/option requires argument: --out/);
    });
});

describe("the restore's confirmation", () => {
    let said: string[];
    beforeEach(() => {
        said = [];
        const capture = (...parts: unknown[]) => { said.push(parts.join(" ")); };
        jest.spyOn(console, "log").mockImplementation(capture);
        jest.spyOn(console, "warn").mockImplementation(capture);
        jest.spyOn(console, "error").mockImplementation(capture);
    });
    afterEach(() => jest.restoreAllMocks());
    // eslint-disable-next-line no-control-regex
    const text = () => said.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

    it("with no terminal, refuses and says to pass --yes, as db reset, pull and prune do", async () => {
        const ask = jest.fn(async () => true);
        await expect(confirmRestore({ target: "shop", yes: false, interactive: false, ask })).resolves.toBe(false);
        expect(ask).not.toHaveBeenCalled();
        expect(text()).toMatch(/Nothing was restored: there is no terminal to confirm on/);
        expect(text()).toMatch(/Re-run with --yes to restore into "shop"/);
    });

    it("on a terminal, asks, and a no changes nothing", async () => {
        const ask = jest.fn(async () => false);
        await expect(confirmRestore({ target: "shop", yes: false, interactive: true, ask })).resolves.toBe(false);
        expect(ask).toHaveBeenCalledTimes(1);
        expect(text()).toMatch(/Aborted\. No changes were made\./);
    });

    it("goes ahead on a typed yes, and on --yes without asking", async () => {
        await expect(confirmRestore({ target: "shop", yes: false, interactive: true, ask: async () => true })).resolves.toBe(true);
        const ask = jest.fn(async () => false);
        await expect(confirmRestore({ target: "shop", yes: true, interactive: false, ask })).resolves.toBe(true);
        expect(ask).not.toHaveBeenCalled();
    });
});

describe("db backups with an action it does not have", () => {
    it("names the one it has, the way every db command does", () => {
        expect(unknownBackupsAction("lst"))
            .toBe("Unknown db backups command \"lst\" — did you mean `list`? Run `rebase db backups --help` for the rest.");
        expect(unknownBackupsAction("show"))
            .toBe("Unknown db backups command \"show\". Run `rebase db backups --help` for the ones there are.");
    });
});
