import fs from "fs";
import os from "os";
import path from "path";
import {
    parseBackupDestination,
    parseBackupTimestamp,
    listBackupObjects,
    readBackupBytes
} from "./backup-common";

describe("server backup-common", () => {
    describe("parseBackupDestination", () => {
        it("parses s3 / gs URLs and local paths", () => {
            expect(parseBackupDestination("s3://bucket/nightly")).toEqual({ kind: "s3", bucket: "bucket", prefix: "nightly" });
            expect(parseBackupDestination("gs://b/")).toEqual({ kind: "gcs", bucket: "b", prefix: "" });
            expect(parseBackupDestination("./backups")).toEqual({ kind: "local", path: "./backups" });
        });
    });

    describe("parseBackupTimestamp", () => {
        it("recovers the timestamp from a key, null for foreign names", () => {
            expect(parseBackupTimestamp("rebase-app-20260714T030000Z.dump")?.toISOString()).toBe("2026-07-14T03:00:00.000Z");
            expect(parseBackupTimestamp("nightly/rebase-app-20260714T030000Z.dump")?.toISOString()).toBe("2026-07-14T03:00:00.000Z");
            expect(parseBackupTimestamp("random.txt")).toBeNull();
        });
    });

    describe("local listing + reading", () => {
        let dir: string;
        beforeAll(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backup-test-"));
            fs.writeFileSync(path.join(dir, "rebase-app-20260714T030000Z.dump"), "AAA");
            fs.writeFileSync(path.join(dir, "rebase-app-20260101T000000Z.dump"), "BB");
            fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
        });
        afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

        it("lists only .dump files, newest first, with size + timestamp", async () => {
            const list = await listBackupObjects(parseBackupDestination(dir));
            expect(list.map((b) => b.name)).toEqual([
                "rebase-app-20260714T030000Z.dump",
                "rebase-app-20260101T000000Z.dump"
            ]);
            expect(list[0].sizeBytes).toBe(3);
            expect(list[0].destinationKind).toBe("local");
            expect(list[0].createdAt).toBe("2026-07-14T03:00:00.000Z");
        });

        it("reads a backup's bytes", async () => {
            const dest = parseBackupDestination(dir);
            const key = path.join(dir, "rebase-app-20260714T030000Z.dump");
            const res = await readBackupBytes(dest, key);
            expect(res?.name).toBe("rebase-app-20260714T030000Z.dump");
            expect(Buffer.from(res!.bytes).toString()).toBe("AAA");
        });

        it("blocks path traversal and non-.dump reads", async () => {
            const dest = parseBackupDestination(dir);
            expect(await readBackupBytes(dest, "/etc/passwd")).toBeNull();
            expect(await readBackupBytes(dest, path.join(dir, "notes.txt"))).toBeNull();
            expect(await readBackupBytes(dest, path.join(dir, "..", "escape.dump"))).toBeNull();
        });
    });

    it("returns empty for object storage without a controller", async () => {
        expect(await listBackupObjects(parseBackupDestination("s3://b/p"))).toEqual([]);
    });
});
