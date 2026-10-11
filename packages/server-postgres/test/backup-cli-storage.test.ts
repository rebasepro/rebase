/**
 * `rebase db backup`/`restore`/`backups list` read a bucket the way the
 * Backups panel does.
 *
 * The CLI had its own copy of `backupStorageFromEnv` (from `@rebasepro/server`),
 * and the two had already drifted once: `S3_FORCE_PATH_STYLE` was read as
 * `=== "true"` here, so a MinIO backup addressed the bucket as a host. The CLI
 * now delegates; this holds it there.
 */
jest.mock("execa", () => ({ execa: jest.fn() }));
import fs from "fs";
import path from "path";
import { resolveStorageForDestination } from "../src/backup/backup-cli";
import { BackupToolError } from "../src/backup/backup-service";

describe("the backup CLI's storage controller", () => {
    it("is never built in this package — only by @rebasepro/server's backupStorageFromEnv", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "src", "backup", "backup-cli.ts"), "utf-8");
        expect(source).not.toMatch(/new\s+(?:S3|GCS)StorageController\b/);
        expect(source).toContain("backupStorageFromEnv");
    });

    it("needs no controller for a local destination", async () => {
        await expect(resolveStorageForDestination({ kind: "local", path: "/tmp/x" }, {})).resolves.toBeNull();
    });

    it("refuses an S3 destination with no credentials as a CLI error, with the remedy", async () => {
        const attempt = resolveStorageForDestination({ kind: "s3", bucket: "b", prefix: "" }, {});
        await expect(attempt).rejects.toBeInstanceOf(BackupToolError);
        await expect(attempt).rejects.toThrow(/S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/);
    });

    it("builds a controller for an S3 destination with credentials", async () => {
        const storage = await resolveStorageForDestination(
            { kind: "s3", bucket: "b", prefix: "" },
            { S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: "http://127.0.0.1:9000" }
        );
        expect(storage).not.toBeNull();
    });
});
