/**
 * A local backup folder is listed without a synchronous filesystem call.
 *
 * Retention lists the folder after every scheduled backup, and the backup
 * cron runs inside the server process: a year of hourly backups is 8,760 dumps,
 * each stat'ed synchronously while the server answered nothing else.
 */
import fs from "fs";
import os from "os";
import path from "path";
// `execa` is ESM-only and nothing here runs a process.
jest.mock("execa", () => ({ execa: jest.fn() }));
import { listBackups, pruneBackups } from "../src/backup/backup-service";

describe("listBackups, local destination", () => {
    let root: string;
    let dir: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-list-"));
        dir = path.join(root, "backups");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "rebase-app-20260714T030000Z.dump"), "AAA");
        fs.writeFileSync(path.join(dir, "rebase-app-20260101T000000Z.dump"), "BB");
        fs.writeFileSync(path.join(dir, "rebase-app-20260301T000000Z.dump"), "C");
        fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("lists newest first, with sizes, and makes no synchronous filesystem call", async () => {
        const sync = [jest.spyOn(fs, "statSync"), jest.spyOn(fs, "readdirSync"), jest.spyOn(fs, "existsSync")];

        const list = await listBackups({ kind: "local", path: dir });
        const byFile = await listBackups({ kind: "local", path: path.join(dir, "rebase-app-20260101T000000Z.dump") });
        const missing = await listBackups({ kind: "local", path: path.join(root, "nowhere") });

        expect(list.map((b) => [path.basename(b.key), b.sizeBytes, b.createdAt?.toISOString()])).toEqual([
            ["rebase-app-20260714T030000Z.dump", 3, "2026-07-14T03:00:00.000Z"],
            ["rebase-app-20260301T000000Z.dump", 1, "2026-03-01T00:00:00.000Z"],
            ["rebase-app-20260101T000000Z.dump", 2, "2026-01-01T00:00:00.000Z"]
        ]);
        expect(byFile.map((b) => b.key)).toEqual(list.map((b) => b.key));
        expect(missing).toEqual([]);
        for (const spy of sync) expect(spy).not.toHaveBeenCalled();
    });

    it("still prunes by what it lists", async () => {
        const removed = await pruneBackups({ kind: "local", path: dir }, { keepMinimum: 1, retentionDays: 1 });

        expect(removed.map((k) => path.basename(k)).sort()).toEqual([
            "rebase-app-20260101T000000Z.dump",
            "rebase-app-20260301T000000Z.dump"
        ]);
        expect(fs.readdirSync(dir).sort()).toEqual(["notes.txt", "rebase-app-20260714T030000Z.dump"]);
    });

    it("prunes only backups it named, and a foreign dump holds no keepMinimum slot", async () => {
        // A dump someone else left in the folder — a manual pg_dump, a copy from
        // another tool. Its mtime is older than the cutoff and newer than every
        // backup, so dated by mtime it was both pruned and counted as the
        // newest backup kept, pushing a real one out of retention.
        const foreign = path.join(dir, "before-migration.dump");
        fs.writeFileSync(foreign, "manual");
        fs.writeFileSync(path.join(dir, "before-migration.globals.sql"), "roles");
        const mtime = new Date("2026-08-01T00:00:00Z");
        fs.utimesSync(foreign, mtime, mtime);

        const removed = await pruneBackups(
            { kind: "local", path: dir },
            { keepMinimum: 1, retentionDays: 1, now: new Date("2026-10-01T00:00:00Z") }
        );

        expect(removed.map((k) => path.basename(k)).sort()).toEqual([
            "rebase-app-20260101T000000Z.dump",
            "rebase-app-20260301T000000Z.dump"
        ]);
        expect(fs.readdirSync(dir).sort()).toEqual([
            "before-migration.dump",
            "before-migration.globals.sql",
            "notes.txt",
            "rebase-app-20260714T030000Z.dump"
        ]);
    });
});
