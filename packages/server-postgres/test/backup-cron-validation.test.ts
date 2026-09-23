/**
 * A scheduled backup that fails validation leaves nothing behind.
 *
 * The cron validates the new dump before pruning, so a corrupt one is never
 * the reason the last good backup is deleted. It then deleted the corrupt file
 * only for object-storage destinations, where it was a temp file. On a local
 * destination the file *is* the backup: it stayed in the backup directory
 * under a valid-looking name, `rebase db backups list` showed it, and
 * retention — which ranks by timestamp and never opens a file — counted it
 * among the `keepMinimum` newest while pruning a real backup beneath it.
 * `rebase db backup` already discarded it; the scheduled door did not.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { CronJobContext } from "@rebasepro/types";
import type { StorageController } from "@rebasepro/server";
import { createBackupCron } from "../src/backup/backup-cron";

const mockValidateDump = jest.fn();
const mockPruneBackups = jest.fn();
const mockUploadBackup = jest.fn();

// The service runs pg_dump through execa. The dump is written here instead,
// as the real one would be: the file and its roles sidecar, in `outDir` when
// the destination is local and in a temp directory when it is not.
jest.mock("../src/backup/backup-service", () => {
    const realFs = jest.requireActual<typeof import("fs")>("fs");
    const realOs = jest.requireActual<typeof import("os")>("os");
    const realPath = jest.requireActual<typeof import("path")>("path");
    const { discardPartialDumpWith } = jest.requireActual<typeof import("../src/backup/backup-logic")>(
        "../src/backup/backup-logic"
    );
    return {
        createDump: async (opts: { outDir?: string; dbName: string }) => {
            const dir = opts.outDir ?? realFs.mkdtempSync(realPath.join(realOs.tmpdir(), "rebase-cron-dump-"));
            const fileName = `${opts.dbName}-2026-09-23T03-00-00-000Z.dump`;
            const localFile = realPath.join(dir, fileName);
            const globalsFile = localFile.replace(/\.dump$/, ".globals.sql");
            realFs.writeFileSync(localFile, "PGDMP truncated");
            realFs.writeFileSync(globalsFile, "CREATE ROLE app;");
            return { localFile, fileName, sizeBytes: 15, globalsFile };
        },
        validateDump: (file: string) => mockValidateDump(file),
        pruneBackups: (...args: unknown[]) => mockPruneBackups(...args),
        uploadBackup: (...args: unknown[]) => mockUploadBackup(...args),
        discardPartialDump: (file: string) =>
            discardPartialDumpWith(f => realFs.existsSync(f), f => realFs.unlinkSync(f), file)
    };
});

const context = {
    jobId: "backup",
    scheduledAt: new Date(),
    log: () => {},
    signal: new AbortController().signal
} as CronJobContext;

describe("a scheduled backup whose dump fails validation", () => {
    let backupDir: string;

    beforeEach(() => {
        jest.clearAllMocks();
        backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cron-backups-"));
        mockValidateDump.mockResolvedValue({ ok: false, reason: "pg_restore --list failed" });
    });

    afterEach(() => {
        fs.rmSync(backupDir, { recursive: true, force: true });
    });

    it("removes the dump and its sidecar from a local backup directory", async () => {
        const job = createBackupCron({
            schedule: "0 3 * * *",
            connectionString: "postgres://u:p@localhost:5432/app",
            destination: { kind: "local", path: backupDir },
            retentionDays: 7,
            keepMinimum: 3
        });

        await expect(job.handler(context)).rejects.toThrow(/failed validation/);

        expect(fs.readdirSync(backupDir)).toEqual([]);
        expect(mockPruneBackups).not.toHaveBeenCalled();
    });

    it("removes the temp files for an object-storage destination too", async () => {
        const job = createBackupCron({
            schedule: "0 3 * * *",
            connectionString: "postgres://u:p@localhost:5432/app",
            destination: { kind: "s3", bucket: "backups", prefix: "app" },
            storage: {} as StorageController
        });

        await expect(job.handler(context)).rejects.toThrow(/failed validation/);

        const dump = mockValidateDump.mock.calls[0][0] as string;
        expect(fs.existsSync(dump)).toBe(false);
        expect(fs.existsSync(dump.replace(/\.dump$/, ".globals.sql"))).toBe(false);
        expect(mockUploadBackup).not.toHaveBeenCalled();
    });

    it("keeps a dump that passes, and prunes after it", async () => {
        mockValidateDump.mockResolvedValue({ ok: true });
        mockPruneBackups.mockResolvedValue([]);
        const job = createBackupCron({
            schedule: "0 3 * * *",
            connectionString: "postgres://u:p@localhost:5432/app",
            destination: { kind: "local", path: backupDir },
            retentionDays: 7
        });

        await job.handler(context);

        expect(fs.readdirSync(backupDir).sort()).toEqual([
            "app-2026-09-23T03-00-00-000Z.dump",
            "app-2026-09-23T03-00-00-000Z.globals.sql"
        ]);
        expect(mockPruneBackups).toHaveBeenCalledTimes(1);
    });
});
