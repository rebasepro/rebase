/**
 * A backup is uploaded from the dump on disk, not from a copy of it in memory.
 *
 * `uploadBackup` read the dump with `readFileSync` and copied it into a `File`
 * before the controller read it again: three to four times the dump in the
 * process running the cron — usually the API — and a dump over 2 GiB could
 * not be read at all (`ERR_FS_FILE_TOO_LARGE`), so it never left the pod.
 */
import fs from "fs";
import os from "os";
import path from "path";
// `execa` is ESM-only and nothing here runs a process.
jest.mock("execa", () => ({ execa: jest.fn() }));
import { uploadBackup } from "../src/backup/backup-service";
import { LocalStorageController, type StorageController } from "@rebasepro/server";

describe("uploadBackup", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-upload-"));
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    /** A controller that reads what it is given as a stream and keeps only a count. */
    function countingSink() {
        const seen = { bytes: 0, key: "", size: 0, wholeReads: 0 };
        const storage = {
            putObject: async ({ file, key }: { file: File; key: string }) => {
                const arrayBuffer = file.arrayBuffer.bind(file);
                file.arrayBuffer = async () => { seen.wholeReads++; return arrayBuffer(); };
                seen.key = key;
                seen.size = file.size;
                const reader = file.stream().getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    seen.bytes += value.byteLength;
                }
                return { key, bucket: "b", storageUrl: `s3://b/${key}` };
            }
        } as unknown as StorageController;
        return { storage, seen };
    }

    it("hands the controller a file backed by the dump on disk, never read into memory", async () => {
        const dump = path.join(dir, "rebase-app-20260714T030000Z.dump");
        fs.writeFileSync(dump, Buffer.alloc(3 * 1024 * 1024 + 5, 9));
        const readFileSync = jest.spyOn(fs, "readFileSync");
        const { storage, seen } = countingSink();

        const result = await uploadBackup(storage, dump, { kind: "s3", bucket: "b", prefix: "nightly" });

        expect(result.key).toBe("nightly/rebase-app-20260714T030000Z.dump");
        expect(seen.bytes).toBe(3 * 1024 * 1024 + 5);
        expect(seen.wholeReads).toBe(0);
        expect(readFileSync).not.toHaveBeenCalled();
    });

    it("uploads a dump larger than 2 GiB, which readFileSync cannot read", async () => {
        const dump = path.join(dir, "rebase-app-20260714T040000Z.dump");
        const size = 2 * 1024 * 1024 * 1024 + 1;
        // Sparse: no disk, and reads of it are zeros.
        const fd = fs.openSync(dump, "w");
        fs.ftruncateSync(fd, size);
        fs.closeSync(fd);
        const { storage, seen } = countingSink();

        await uploadBackup(storage, dump, { kind: "gcs", bucket: "b", prefix: "" });

        expect(seen.size).toBe(size);
        expect(seen.bytes).toBe(size);
    }, 120_000);
});

/**
 * A backup is not a user upload, so the storage's upload limits do not apply.
 *
 * `maxFileSize` (50 MB unless configured) and `allowedMimeTypes` say what a
 * user may upload. `uploadBackup` went through the same `putObject` and was
 * held to them: the CLI and the documented cron build their controller with
 * no `maxFileSize`, so every dump over 50 MB answered `PAYLOAD_TOO_LARGE`.
 */
describe("uploadBackup and the storage's upload limits", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-limits-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function sparseDump(name: string, size: number): string {
        const file = path.join(dir, name);
        const fd = fs.openSync(file, "w");
        fs.ftruncateSync(fd, size);
        fs.closeSync(fd);
        return file;
    }

    it("uploads a dump over the default 50 MB limit through a controller built as the docs build it", async () => {
        const storage = new LocalStorageController({ type: "local", basePath: path.join(dir, "bucket") });
        const size = storage.maxFileSize() + 1;
        const dump = sparseDump("rebase-app-20260714T030000Z.dump", size);

        const result = await uploadBackup(storage, dump, { kind: "s3", bucket: "backups", prefix: "nightly" });

        expect(result.key).toBe("nightly/rebase-app-20260714T030000Z.dump");
        expect(fs.statSync(path.join(dir, "bucket", "backups", "nightly", "rebase-app-20260714T030000Z.dump")).size).toBe(size);
    });

    it("is not held to a configured maxFileSize or allowedMimeTypes", async () => {
        const storage = new LocalStorageController({
            type: "local",
            basePath: path.join(dir, "bucket"),
            maxFileSize: 1024,
            allowedMimeTypes: ["image/png"]
        });
        const dump = sparseDump("rebase-app-20260714T040000Z.dump", 4096);

        await uploadBackup(storage, dump, { kind: "gcs", bucket: "backups", prefix: "" });

        expect(fs.statSync(path.join(dir, "bucket", "backups", "rebase-app-20260714T040000Z.dump")).size).toBe(4096);
        // The same controller still holds a user's upload to both.
        await expect(storage.putObject({
            file: new File([Buffer.alloc(4096)], "x.png", { type: "image/png" }),
            key: "x.png"
        })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
        await expect(storage.putObject({
            file: new File([Buffer.alloc(16)], "x.dump", { type: "application/octet-stream" }),
            key: "x.dump"
        })).rejects.toThrow(/not allowed/);
    });
});
