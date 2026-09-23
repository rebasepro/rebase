/**
 * The flags the CLI relays to the driver never reach Atlas, or anything else
 * that reads positionals.
 *
 * `rebase db …` reads `--database-url` and `--docker` to find the database and
 * then relays them, and `--debug` is the re-run hint `bin/rebase.js` prints
 * after every failure. The driver's parsers are permissive, so a relayed flag
 * they did not declare became a positional — and the positionals are the
 * arguments `db migrate` hands `atlas migrate apply`, the name `db generate`
 * gives its migration, and the backup `db restore` restores. Atlas answered
 * `unknown flag: --docker`.
 */
import { DRIVER_FLAG_SPECS, parseDriverLine } from "../src/cli-flags";
import { migrateApplyArgs } from "../src/schema/atlas-argv";
import { parseRestoreLine } from "../src/backup/backup-cli";

// The backup module runs pg_dump through execa, which is ESM-only and which
// jest's CommonJS loader cannot require. Nothing here runs a tool.
jest.mock("execa", () => ({ execa: jest.fn() }));

const RELAYED = ["--docker", "--debug", "--database-url", "postgres://u:p@localhost:5432/app"];

const parseDbLine = (...args: string[]) => parseDriverLine(
    { ...DRIVER_FLAG_SPECS["db migrate"], ...DRIVER_FLAG_SPECS["db generate"] },
    args
);

describe("the flags the CLI relays", () => {
    it("never reach `atlas migrate apply`", () => {
        const parsed = parseDbLine("db", "migrate", ...RELAYED);
        expect(migrateApplyArgs(parsed._, undefined))
            .toEqual(["apply", "--dir", "file://drizzle/migrations"]);
    });

    it("leave a bare amount, and --baseline, to reach it", () => {
        const parsed = parseDbLine("db", "migrate", "--debug", "--baseline", "20260101000000", "2");
        const baseline = parsed["--baseline"];
        expect(migrateApplyArgs(parsed._, typeof baseline === "string" ? baseline : undefined)).toEqual([
            "apply", "--dir", "file://drizzle/migrations", "--baseline", "20260101000000", "2"
        ]);
    });

    it("do not name a generated migration", () => {
        expect(parseDbLine("db", "generate", ...RELAYED)._).toEqual([]);
        expect(parseDbLine("db", "generate", "--debug", "add_posts")._[0]).toBe("add_posts");
    });

    it("are not the backup `db restore` restores", () => {
        expect(parseRestoreLine(["db", "restore", ...RELAYED, "latest"])._).toEqual(["latest"]);
    });
});
