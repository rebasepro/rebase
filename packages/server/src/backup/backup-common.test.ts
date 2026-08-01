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
        let root: string;
        let dir: string;
        beforeAll(() => {
            // The backup directory is nested one level down so that "outside the
            // backup directory" is a real place with a real file in it. When the
            // traversal target did not exist, `readBackupBytes` returned null at
            // its `existsSync` check and the guard above it was never reached —
            // the test passed with the guard deleted.
            root = fs.mkdtempSync(path.join(os.tmpdir(), "core-backup-test-"));
            dir = path.join(root, "backups");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "rebase-app-20260714T030000Z.dump"), "AAA");
            fs.writeFileSync(path.join(dir, "rebase-app-20260101T000000Z.dump"), "BB");
            fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
            fs.writeFileSync(path.join(root, "escape.dump"), "SECRET");
        });
        afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

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

            // A readable, correctly-named .dump that simply is not in the backup
            // directory. Only the containment check can refuse this one, so it
            // is the only assertion here that measures it. `existsSync` first,
            // to keep a rename of the fixture from silently making it vacuous
            // again.
            const escape = path.join(dir, "..", "escape.dump");
            expect(fs.existsSync(escape)).toBe(true);
            expect(await readBackupBytes(dest, escape)).toBeNull();
        });
    });

    it("returns empty for object storage without a controller", async () => {
        expect(await listBackupObjects(parseBackupDestination("s3://b/p"))).toEqual([]);
    });
});
