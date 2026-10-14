/**
 * `db restore` from a file pg_restore cannot list says what is wrong with the
 * file, and that nothing happened.
 *
 * The table of contents is read before anything is restored, and a failure
 * there came out as execa's own line:
 *
 *     ✗ Command failed with exit code 1: /opt/homebrew/bin/pg_restore --list /…/trunc.dump
 *     pg_restore: error: could not read from input file: end of file
 *
 * The database was untouched, but the reader was told neither that, nor that
 * the file is cut short. The stderr lines below are pg_restore 18's, captured
 * from a truncated dump, a text file and a dump whose header names a format
 * version this pg_restore does not read.
 */
import { execa } from "execa";

import { BackupToolError, describeUnreadableDump, readDumpObjects } from "../src/backup/backup-service";

jest.mock("execa", () => ({ execa: jest.fn() }));
jest.mock("../src/backup/pg-binary", () => ({
    resolvePgBinary: () => "/usr/bin/pg_restore",
    pgToolVariable: () => "PG_RESTORE_PATH"
}));

const TRUNCATED = "pg_restore: error: could not read from input file: end of file\n";
const NOT_A_DUMP = "pg_restore: error: input file does not appear to be a valid archive (too short?)\n";
const EMPTY = "pg_restore: error: input file is too short (read 0, expected 5)\n";
const NEWER = "pg_restore: error: unsupported version (1.99) in file header\n";

describe("describeUnreadableDump", () => {
    it("says a cut-short file is truncated, quotes pg_restore, and that nothing changed", () => {
        const { message, hint } = describeUnreadableDump("trunc.dump", TRUNCATED);

        expect(message).toMatch(/^trunc\.dump is truncated: it ends before pg_restore can read what it holds/);
        expect(message).toContain("(pg_restore: could not read from input file: end of file)");
        expect(message).toMatch(/Nothing was restored or changed\.$/);
        expect(hint).toContain("rebase db backups list");
    });

    it("says an empty file is truncated too", () => {
        expect(describeUnreadableDump("x.dump", EMPTY).message).toMatch(/^x\.dump is truncated/);
    });

    it("says a file that is no dump at all is not a backup", () => {
        const { message } = describeUnreadableDump("notes.txt", NOT_A_DUMP);

        expect(message).toMatch(/^notes\.txt is not a backup pg_restore can read/);
        expect(message).toContain("takes the .dump files `rebase db backup` writes");
        expect(message).toContain("Nothing was restored or changed.");
    });

    it("sends a dump from a newer pg_dump to a newer pg_restore, not to another backup", () => {
        const { message, hint } = describeUnreadableDump("new.dump", NEWER);

        expect(message).toMatch(/^new\.dump was written by a newer pg_dump than this pg_restore reads/);
        expect(hint).toContain("PG_RESTORE_PATH");
    });

    it("still says nothing changed for a reason it does not know", () => {
        const { message } = describeUnreadableDump("odd.dump", "pg_restore: error: something new\n");

        expect(message).toBe("odd.dump cannot be read as a backup (pg_restore: something new): it is damaged, or not a pg_dump archive. Nothing was restored or changed.");
    });
});

describe("readDumpObjects on a file pg_restore cannot list", () => {
    it("throws the description, not execa's command line", async () => {
        const failure = Object.assign(new Error("Command failed with exit code 1: /usr/bin/pg_restore --list /tmp/backups/trunc.dump"), {
            stderr: TRUNCATED
        });
        jest.mocked(execa).mockRejectedValueOnce(failure);

        const thrown = await readDumpObjects("/tmp/backups/trunc.dump").catch((error: unknown) => error);

        expect(thrown).toBeInstanceOf(BackupToolError);
        expect(String(thrown)).toContain("trunc.dump is truncated");
        expect(String(thrown)).not.toContain("Command failed");
    });
});
