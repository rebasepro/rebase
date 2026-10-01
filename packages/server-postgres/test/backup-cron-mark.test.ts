/**
 * The scheduled backup job carries the mark the Backups panel finds it by.
 *
 * `GET /admin/backups` reports the last scheduled run so a nightly failure is
 * visible where the backups are listed. `@rebasepro/server` recognises the job
 * by `Symbol.for("rebase.backupCron")` on its definition — its id is the cron
 * file's name and its display name is configurable, so nothing else identifies
 * it. This is the other half of that contract (`backup-schedule-status.test.ts`
 * in the server package is the first).
 */
import { createBackupCron } from "../src/backup/backup-cron";

describe("createBackupCron", () => {
    it("marks its definition as the scheduled backup", () => {
        const job = createBackupCron({
            schedule: "0 3 * * *",
            connectionString: "postgres://u:p@db.example.com:5432/app",
            destination: { kind: "local", path: "./backups" }
        });
        expect(Reflect.get(job, Symbol.for("rebase.backupCron"))).toBe(true);
    });

    it("keeps the mark out of the definition's own keys", () => {
        // A spread or a JSON dump of the definition must look the same as before.
        const job = createBackupCron({
            schedule: "0 3 * * *",
            connectionString: "postgres://u:p@db.example.com:5432/app",
            destination: { kind: "local", path: "./backups" }
        });
        expect(Object.keys(job)).not.toContain("rebase.backupCron");
        expect(JSON.stringify(job)).not.toContain("backupCron");
    });
});
