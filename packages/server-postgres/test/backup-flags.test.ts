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
import { parseBackupLine, parseRestoreLine, unknownBackupsAction } from "../src/backup/backup-cli";
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
});

describe("parseCommandFlags", () => {
    it("leaves a missing value to arg's own message", () => {
        expect(() => parseCommandFlags({ "--out": String }, ["--out"], "db backups list"))
            .toThrow(/option requires argument: --out/);
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

