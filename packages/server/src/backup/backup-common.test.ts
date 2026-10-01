import fs from "fs";
import os from "os";
import path from "path";
import type { StorageController } from "../storage";
import {
    parseBackupDestination,
    parseBackupTimestamp,
    listBackupObjects,
    openBackupStream,
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

    /**
     * S3 and GCS list ascending and in pages, and the listing read one page of
     * 1,000. Keys are `rebase-<db>-<UTC timestamp>`, so that page is the OLDEST
     * thousand: with retention unset and an hourly schedule, the newest entry
     * stopped advancing after ~21 days (two objects per backup) and the panel
     * read as "backups stopped".
     */
    describe("object storage, more than one page", () => {
        const keys: string[] = [];
        for (let day = 1; day <= 28; day++) {
            for (let hour = 0; hour < 24; hour++) {
                const stamp = `202609${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}0000Z`;
                keys.push(`nightly/rebase-app-${stamp}.dump`, `nightly/rebase-app-${stamp}.globals.sql`);
            }
        }
        const PAGE = 1000;
        const listObjects = jest.fn(async (_prefix: string, options?: { pageToken?: string; maxResults?: number }) => {
            const start = options?.pageToken ? Number(options.pageToken) : 0;
            const end = Math.min(start + Math.min(options?.maxResults ?? PAGE, PAGE), keys.length);
            return {
                prefixes: [],
                items: keys.slice(start, end).map((fullPath) => ({ fullPath })),
                ...(end < keys.length ? { nextPageToken: String(end) } : {})
            };
        });
        const storage = { listObjects } as unknown as StorageController;

        it("reads every page, so the newest backup is listed first", async () => {
            const list = await listBackupObjects(parseBackupDestination("s3://bucket/nightly"), storage);
            expect(list).toHaveLength(28 * 24);
            expect(list[0].name).toBe("rebase-app-20260928T230000Z.dump");
            expect(list[0].globalsKey).toBe("nightly/rebase-app-20260928T230000Z.globals.sql");
            expect(listObjects.mock.calls.length).toBeGreaterThan(1);
        });
    });

    /**
     * The object-storage branch checked the suffix and nothing else, so an
     * admin could read any `.dump` in the bucket — `uploads/anything.dump` — by
     * naming it; the local branch has always been held to the backup directory.
     */
    describe("object storage, outside the destination's prefix", () => {
        const objects: Record<string, string> = {
            "nightly/rebase-app-20260714T030000Z.dump": "AAA",
            "uploads/user-file.dump": "SOMEONE ELSE'S",
            "nightlyish/rebase-app-20260714T030000Z.dump": "NEIGHBOUR"
        };
        // As permissive as a real controller can be: S3StorageController reads
        // an `s3://bucket/key` URL from any bucket, and a filesystem-backed or
        // S3-compatible store may resolve `..`. The guard must not rely on the
        // controller refusing either.
        const storage = {
            getObject: async (key: string) => {
                const resolved = path.posix.normalize(key.replace(/^(s3|gs):\/\/[^/]+\//, ""));
                return resolved in objects ? new File([objects[resolved]], resolved.split("/").pop()!) : null;
            }
        } as unknown as StorageController;
        const dest = parseBackupDestination("s3://bucket/nightly");

        it("reads a backup under the prefix", async () => {
            expect(await readBackupBytes(dest, "nightly/rebase-app-20260714T030000Z.dump", storage)).not.toBeNull();
            expect(await openBackupStream(dest, "nightly/rebase-app-20260714T030000Z.dump", storage)).not.toBeNull();
        });

        it.each([
            "uploads/user-file.dump",
            "nightlyish/rebase-app-20260714T030000Z.dump",
            "nightly/../uploads/user-file.dump",
            "s3://bucket/uploads/user-file.dump"
        ])("refuses %s", async (key) => {
            expect(await readBackupBytes(dest, key, storage)).toBeNull();
            expect(await openBackupStream(dest, key, storage)).toBeNull();
        });
    });

    it("returns empty for object storage without a controller", async () => {
        expect(await listBackupObjects(parseBackupDestination("s3://b/p"))).toEqual([]);
    });
});
