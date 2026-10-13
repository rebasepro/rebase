/**
 * `db generate` finishing the migration Atlas wrote.
 *
 * Atlas's file creates tables without RLS; the policies arrive in an append.
 * When the append failed, the CLI warned and said "You can now run rebase db
 * migrate" — and a migration that failed before it was rewritten still matched
 * its checksum, so it applied and served every new table with RLS off.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { finishNewMigration } from "../src/schema/migration-post-process";

describe("finishNewMigration", () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-migration-"));
        file = path.join(dir, "20261013000000_init.sql");
        fs.writeFileSync(file, "CREATE TABLE \"public\".\"secrets\" (\"id\" uuid);\n");
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("keeps the migration when every step succeeds", async () => {
        const rehash = jest.fn(async () => undefined);
        const outcome = await finishNewMigration(file, async () => {
            fs.appendFileSync(file, "ALTER TABLE \"public\".\"secrets\" ENABLE ROW LEVEL SECURITY;\n");
        }, rehash);

        expect(outcome).toEqual({ ok: true });
        expect(fs.readFileSync(file, "utf-8")).toContain("ENABLE ROW LEVEL SECURITY");
        expect(rehash).not.toHaveBeenCalled();
    });

    it("takes the migration back out, and re-hashes, when a step fails", async () => {
        const rehash = jest.fn(async () => undefined);
        const outcome = await finishNewMigration(file, async () => {
            throw new Error("search.sql could not be read");
        }, rehash);

        expect(outcome).toEqual({ ok: false, error: "search.sql could not be read", removed: true });
        expect(fs.existsSync(file)).toBe(false);
        expect(rehash).toHaveBeenCalledTimes(1);
    });

    it("reports a re-hash that fails after the file is gone", async () => {
        const outcome = await finishNewMigration(
            file,
            async () => { throw new Error("boom"); },
            async () => { throw new Error("atlas not found"); }
        );

        expect(outcome).toEqual({ ok: false, error: "boom", removed: true, rehashError: "atlas not found" });
    });
});
