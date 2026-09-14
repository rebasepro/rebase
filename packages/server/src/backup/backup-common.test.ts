import fs from "fs";
import os from "os";
import path from "path";
import type { StorageController } from "../storage";
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
            fs.writeFileSync(path.join(dir, "rebase-app-20260714T030000Z.globals.sql"), "CREATE ROLE rebase_user;");
            fs.writeFileSync(path.join(dir, "rebase-app-20260101T000000Z.dump"), "BB");
            fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
            fs.writeFileSync(path.join(root, "escape.dump"), "SECRET");
            fs.writeFileSync(path.join(root, "escape.globals.sql"), "SECRET");
        });
        afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

        it("lists one entry per .dump, newest first, with size + timestamp", async () => {
            const list = await listBackupObjects(parseBackupDestination(dir));
            expect(list.map((b) => b.name)).toEqual([
                "rebase-app-20260714T030000Z.dump",
                "rebase-app-20260101T000000Z.dump"
            ]);
            expect(list[0].sizeBytes).toBe(3);
            expect(list[0].destinationKind).toBe("local");
            expect(list[0].createdAt).toBe("2026-07-14T03:00:00.000Z");
        });

        it("attaches the roles sidecar to its dump, and only where one exists", async () => {
            const [withRoles, withoutRoles] = await listBackupObjects(parseBackupDestination(dir));
            expect(withRoles.globalsKey).toBe(path.join(dir, "rebase-app-20260714T030000Z.globals.sql"));
            expect(withoutRoles.globalsKey).toBeUndefined();
        });

        it("reads a backup's bytes", async () => {
            const dest = parseBackupDestination(dir);
            const key = path.join(dir, "rebase-app-20260714T030000Z.dump");
            const res = await readBackupBytes(dest, key);
            expect(res?.name).toBe("rebase-app-20260714T030000Z.dump");
            expect(Buffer.from(res!.bytes).toString()).toBe("AAA");
        });

        it("reads the roles sidecar the listing points at", async () => {
            const dest = parseBackupDestination(dir);
            const [withRoles] = await listBackupObjects(dest);
            const res = await readBackupBytes(dest, withRoles.globalsKey!);
            expect(res?.name).toBe("rebase-app-20260714T030000Z.globals.sql");
            expect(Buffer.from(res!.bytes).toString()).toBe("CREATE ROLE rebase_user;");
        });

        it("blocks path traversal and reads of anything but a backup file", async () => {
            const dest = parseBackupDestination(dir);
            expect(await readBackupBytes(dest, "/etc/passwd")).toBeNull();
            expect(await readBackupBytes(dest, path.join(dir, "notes.txt"))).toBeNull();

            // Readable, correctly-named backup files that simply are not in the
            // backup directory. Only the containment check can refuse these, so
            // they are the only assertions here that measure it. `existsSync`
            // first, to keep a rename of the fixture from silently making them
            // vacuous again.
            for (const name of ["escape.dump", "escape.globals.sql"]) {
                const escape = path.join(dir, "..", name);
                expect(fs.existsSync(escape)).toBe(true);
                expect(await readBackupBytes(dest, escape)).toBeNull();
            }
        });
    });

    describe("object storage", () => {
        const objects: Record<string, string> = {
            "nightly/rebase-app-20260714T030000Z.dump": "AAA",
            "nightly/rebase-app-20260714T030000Z.globals.sql": "CREATE ROLE rebase_user;",
            "nightly/rebase-app-20260101T000000Z.dump": "BB",
            "nightly/notes.txt": "ignore me"
        };
        // Only the two methods these helpers call.
        const storage = {
            listObjects: async () => ({
                prefixes: [],
                items: Object.keys(objects).map((fullPath) => ({ fullPath }))
            }),
            getObject: async (key: string) =>
                key in objects ? new File([objects[key]], key.split("/").pop()!) : null
        } as unknown as StorageController;
        const dest = parseBackupDestination("s3://bucket/nightly");

        it("lists one entry per .dump and attaches the roles sidecar", async () => {
            const list = await listBackupObjects(dest, storage);
            expect(list.map((b) => [b.key, b.globalsKey])).toEqual([
                ["nightly/rebase-app-20260714T030000Z.dump", "nightly/rebase-app-20260714T030000Z.globals.sql"],
                ["nightly/rebase-app-20260101T000000Z.dump", undefined]
            ]);
        });

        it("reads the sidecar, and refuses a key that is not a backup file", async () => {
            const res = await readBackupBytes(dest, "nightly/rebase-app-20260714T030000Z.globals.sql", storage);
            expect(Buffer.from(res!.bytes).toString()).toBe("CREATE ROLE rebase_user;");
            expect(await readBackupBytes(dest, "nightly/notes.txt", storage)).toBeNull();
        });
    });

    it("returns empty for object storage without a controller", async () => {
        expect(await listBackupObjects(parseBackupDestination("s3://b/p"))).toEqual([]);
    });
});
