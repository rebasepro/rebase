/**
 * A backup download streams; it does not hold the dump in memory.
 *
 * `GET /admin/backups/download` read the whole file before sending a byte:
 * `readFileSync` for a local destination, then a copy of that into a
 * `Uint8Array`, and `file.arrayBuffer()` on top of the controller's own buffer
 * for object storage. A 1 GB dump cost ~2 GB of heap in the API process, and
 * one over 2 GiB never downloaded at all — `readFileSync` throws
 * `ERR_FS_FILE_TOO_LARGE` there, which answered 500.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createBackupRoutes } from "../src/backup/backup-routes";
import { parseBackupDestination } from "../src/backup/backup-common";
import type { StorageController } from "../src/storage";

const DUMP = "rebase-app-20260714T030000Z.dump";

describe("GET /download", () => {
    let root: string;
    let dir: string;
    // Several read chunks' worth, so the stream is exercised past its first.
    const content = "PGDMP".padEnd(200 * 1024 + 7, "x");

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-download-"));
        dir = path.join(root, "backups");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, DUMP), content);
        fs.writeFileSync(path.join(root, "escape.dump"), "SECRET");
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
    afterEach(() => jest.restoreAllMocks());

    function download(key: string, storage?: StorageController, destination = dir) {
        const router = createBackupRoutes({ getDestination: () => parseBackupDestination(destination), storage });
        return router.request(`/download?key=${encodeURIComponent(key)}`);
    }

    it("streams a local backup from disk, with its length, and never reads it whole", async () => {
        const readFileSync = jest.spyOn(fs, "readFileSync");

        const res = await download(path.join(dir, DUMP));

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Length")).toBe(String(content.length));
        expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${DUMP}"`);
        expect(await res.text()).toBe(content);
        expect(readFileSync).not.toHaveBeenCalled();
    });

    it("still refuses a file outside the backup directory", async () => {
        const res = await download(path.join(dir, "..", "escape.dump"));
        expect(res.status).toBe(404);
    });

    it("streams an object-storage backup instead of copying it into a second buffer", async () => {
        const file = new File([content], DUMP);
        const arrayBuffer = jest.spyOn(file, "arrayBuffer");
        const storage = {
            getObject: async (key: string) => (key === `nightly/${DUMP}` ? file : null)
        } as unknown as StorageController;

        const res = await download(`nightly/${DUMP}`, storage, "s3://bucket/nightly");

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Length")).toBe(String(content.length));
        expect(await res.text()).toBe(content);
        expect(arrayBuffer).not.toHaveBeenCalled();
    });
});
