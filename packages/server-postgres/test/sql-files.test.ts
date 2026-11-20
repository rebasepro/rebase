/**
 * `backend/sql` planning: which files run, which are skipped, which are gone.
 * Applied end to end in `e2e/db-push-safety.test.ts`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { planSqlFiles, readSqlFiles, sqlFilesDir } from "../src/schema/sql-files";

describe("backend/sql files", () => {
    it("reads .sql files in name order, hashing each", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sql-files-"));
        fs.writeFileSync(path.join(dir, "020-b.sql"), "select 2;");
        fs.writeFileSync(path.join(dir, "010-a.sql"), "select 1;");
        fs.writeFileSync(path.join(dir, "notes.md"), "not sql");
        const files = readSqlFiles(dir);
        expect(files.map((f) => f.name)).toEqual(["010-a.sql", "020-b.sql"]);
        expect(files[0].hash).toMatch(/^[0-9a-f]{64}$/);
        expect(readSqlFiles(path.join(dir, "missing"))).toEqual([]);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("plans new and changed files to run, skips unchanged ones, and lists removed ones", () => {
        const files = [
            { name: "010-a.sql", sql: "a", hash: "h1" },
            { name: "020-b.sql", sql: "b2", hash: "h2-new" },
            { name: "030-c.sql", sql: "c", hash: "h3" }
        ];
        const plan = planSqlFiles(files, new Map([["010-a.sql", "h1"], ["020-b.sql", "h2"], ["000-gone.sql", "h0"]]));
        expect(plan.apply.map((f) => [f.name, f.changed])).toEqual([["020-b.sql", true], ["030-c.sql", false]]);
        expect(plan.unchanged).toEqual(["010-a.sql"]);
        expect(plan.removed).toEqual(["000-gone.sql"]);
    });

    it("lives beside backend/schema", () => {
        expect(sqlFilesDir("/app/backend/schema")).toBe(path.join("/app/backend", "sql"));
    });
});
