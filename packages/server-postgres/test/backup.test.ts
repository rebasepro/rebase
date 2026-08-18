import {
    buildBackupFilename,
    buildPgDumpArgs,
    buildPgDumpallGlobalsArgs,
    buildPgRestoreArgs,
    buildPgRestoreListArgs,
    checkToolServerCompatibility,
    globalsFileForDump,
    joinStorageKey,
    parseBackupDestination,
    parseBackupTimestamp,
    parseDbNameFromUrl,
    parsePgToolMajor,
    resolveConnectionString,
    serverVersionNumToMajor,
    splitGlobalsStatements,
    withDatabaseName
} from "../src/backup/pg-tools";
import { selectBackupsToPrune } from "../src/backup/retention";
import { backupCronConfigFromEnv } from "../src/backup/backup-cron";

describe("backup pg-tools", () => {
    describe("splitGlobalsStatements", () => {
        it("drops psql meta-commands that are not SQL", () => {
            /*
             * pg_dumpall 15+ brackets its output with `\restrict <token>` and
             * `\unrestrict <token>` — instructions to psql. This replay sends
             * statements over a connection instead, so they reached the server
             * verbatim and came back as `syntax error at or near "\"`, which the
             * restore then reported as two skipped globals. Nothing had actually
             * failed, but the output said otherwise on every single restore.
             */
            const sql = [
                "\\restrict AbC123",
                "-- a comment",
                "CREATE ROLE rebase_user NOLOGIN;",
                "\\unrestrict AbC123"
            ].join("\n");
            expect(splitGlobalsStatements(sql)).toEqual(["CREATE ROLE rebase_user NOLOGIN"]);
        });

        it("keeps ordinary statements intact", () => {
            expect(splitGlobalsStatements("CREATE ROLE a;\nALTER ROLE a NOSUPERUSER;"))
                .toEqual(["CREATE ROLE a", "ALTER ROLE a NOSUPERUSER"]);
        });
    });


    describe("parseDbNameFromUrl", () => {
        it("extracts the database name from a standard URL", () => {
            expect(parseDbNameFromUrl("postgresql://u:p@localhost:5432/my_db")).toBe("my_db");
        });
        it("handles query parameters", () => {
            expect(parseDbNameFromUrl("postgres://u:p@host/app?sslmode=require")).toBe("app");
        });
        it("returns null when there is no database", () => {
            expect(parseDbNameFromUrl("postgresql://u:p@localhost:5432/")).toBeNull();
        });
    });

    describe("withDatabaseName", () => {
        it("swaps the database name preserving credentials and host", () => {
            expect(withDatabaseName("postgresql://u:p@host:5432/old", "new"))
                .toBe("postgresql://u:p@host:5432/new");
        });
        it("preserves query parameters", () => {
            expect(withDatabaseName("postgres://u:p@host/old?sslmode=require", "fresh"))
                .toContain("/fresh");
        });
    });

    describe("parsePgToolMajor", () => {
        it("parses modern version output", () => {
            expect(parsePgToolMajor("pg_dump (PostgreSQL) 16.2")).toBe(16);
            expect(parsePgToolMajor("pg_restore (PostgreSQL) 17.0")).toBe(17);
        });
        it("parses the pre-10 9.x scheme as major 9", () => {
            expect(parsePgToolMajor("pg_dump (PostgreSQL) 9.6.24")).toBe(9);
        });
        it("parses beta strings", () => {
            expect(parsePgToolMajor("pg_dump (PostgreSQL) 18beta1")).toBe(18);
        });
        it("returns null for junk", () => {
            expect(parsePgToolMajor("no version here")).toBeNull();
        });
    });

    describe("serverVersionNumToMajor", () => {
        it("converts a modern server_version_num", () => {
            expect(serverVersionNumToMajor(160002)).toBe(16);
            expect(serverVersionNumToMajor("170000")).toBe(17);
        });
        it("converts a 9.x encoding", () => {
            expect(serverVersionNumToMajor(90603)).toBe(9);
        });
        it("returns null for invalid input", () => {
            expect(serverVersionNumToMajor("abc")).toBeNull();
            expect(serverVersionNumToMajor(0)).toBeNull();
        });
    });

    describe("checkToolServerCompatibility", () => {
        it("accepts a matching version", () => {
            expect(checkToolServerCompatibility(16, 16).compatible).toBe(true);
        });
        it("accepts a newer client against an older server", () => {
            expect(checkToolServerCompatibility(17, 16).compatible).toBe(true);
        });
        it("rejects an older client against a newer server", () => {
            const res = checkToolServerCompatibility(15, 16);
            expect(res.compatible).toBe(false);
            expect(res.reason).toContain("16");
        });
        it("rejects when a version is unknown", () => {
            expect(checkToolServerCompatibility(null, 16).compatible).toBe(false);
            expect(checkToolServerCompatibility(16, null).compatible).toBe(false);
        });
    });

    describe("buildBackupFilename / parseBackupTimestamp round-trip", () => {
        it("encodes a UTC timestamp recoverable from the filename", () => {
            const date = new Date("2026-07-14T03:05:09.123Z");
            const name = buildBackupFilename("my_db", date);
            expect(name).toBe("rebase-my_db-20260714T030509Z.dump");
            const parsed = parseBackupTimestamp(name);
            expect(parsed?.toISOString()).toBe("2026-07-14T03:05:09.000Z");
        });
        it("sanitises unusual database names", () => {
            const name = buildBackupFilename("weird/name db", new Date("2026-01-01T00:00:00Z"));
            expect(name).toBe("rebase-weird_name_db-20260101T000000Z.dump");
        });
        it("returns null for unrelated file names", () => {
            expect(parseBackupTimestamp("random-file.dump")).toBeNull();
            expect(parseBackupTimestamp("notes.txt")).toBeNull();
        });
        it("recovers the timestamp from a full storage key", () => {
            const parsed = parseBackupTimestamp("backups/nightly/rebase-app-20260714T030000Z.dump");
            expect(parsed?.toISOString()).toBe("2026-07-14T03:00:00.000Z");
        });
    });

    describe("parseBackupDestination", () => {
        it("parses s3 URLs", () => {
            expect(parseBackupDestination("s3://bucket/nightly/backups")).toEqual({
                kind: "s3", bucket: "bucket", prefix: "nightly/backups"
            });
        });
        it("parses gs URLs", () => {
            expect(parseBackupDestination("gs://bucket/")).toEqual({
                kind: "gcs", bucket: "bucket", prefix: ""
            });
        });
        it("treats everything else as a local path", () => {
            expect(parseBackupDestination("./backups")).toEqual({ kind: "local", path: "./backups" });
        });
    });

    describe("joinStorageKey", () => {
        it("joins without doubling slashes", () => {
            expect(joinStorageKey("nightly/", "a.dump")).toBe("nightly/a.dump");
            expect(joinStorageKey("", "a.dump")).toBe("a.dump");
            expect(joinStorageKey("/p/", "a.dump")).toBe("p/a.dump");
        });
    });

    describe("buildPgDumpArgs", () => {
        it("uses custom format and includes the connection string last", () => {
            const args = buildPgDumpArgs({
                connectionString: "postgres://x/db",
                outFile: "/tmp/a.dump",
                excludeSchemas: ["rebase"]
            });
            expect(args).toContain("--format=custom");
            expect(args).toContain("--file=/tmp/a.dump");
            expect(args).toContain("--exclude-schema=rebase");
            expect(args[args.length - 1]).toBe("postgres://x/db");
        });
    });

    describe("buildPgRestoreArgs", () => {
        it("adds --clean --if-exists when cleaning", () => {
            const args = buildPgRestoreArgs({
                connectionString: "postgres://x/db",
                inputFile: "/tmp/a.dump",
                clean: true
            });
            expect(args).toContain("--clean");
            expect(args).toContain("--if-exists");
            expect(args).toContain("--dbname=postgres://x/db");
            expect(args[args.length - 1]).toBe("/tmp/a.dump");
        });
        it("omits --clean by default", () => {
            const args = buildPgRestoreArgs({ connectionString: "postgres://x/db", inputFile: "/tmp/a.dump" });
            expect(args).not.toContain("--clean");
        });
        it("adds --exit-on-error by default so a skipped GRANT never leaves RLS off", () => {
            const args = buildPgRestoreArgs({ connectionString: "postgres://x/db", inputFile: "/tmp/a.dump" });
            expect(args).toContain("--exit-on-error");
        });
        it("omits --exit-on-error only when explicitly disabled", () => {
            const args = buildPgRestoreArgs({
                connectionString: "postgres://x/db",
                inputFile: "/tmp/a.dump",
                exitOnError: false
            });
            expect(args).not.toContain("--exit-on-error");
        });
    });

    describe("buildPgRestoreListArgs", () => {
        it("lists the archive TOC without touching a database", () => {
            expect(buildPgRestoreListArgs("/tmp/a.dump")).toEqual(["--list", "/tmp/a.dump"]);
        });
    });

    describe("buildPgDumpallGlobalsArgs", () => {
        it("captures cluster roles without passwords into the sidecar", () => {
            const args = buildPgDumpallGlobalsArgs({
                connectionString: "postgres://u:p@h/db",
                outFile: "/tmp/a.globals.sql"
            });
            expect(args).toContain("--globals-only");
            expect(args).toContain("--no-role-passwords");
            expect(args).toContain("--file=/tmp/a.globals.sql");
            expect(args).toContain("--dbname=postgres://u:p@h/db");
        });
    });

    describe("globalsFileForDump", () => {
        it("swaps a .dump suffix for .globals.sql", () => {
            expect(globalsFileForDump("/b/rebase-app-20260714T030000Z.dump"))
                .toBe("/b/rebase-app-20260714T030000Z.globals.sql");
        });
        it("keeps storage keys adjacent", () => {
            expect(globalsFileForDump("nightly/rebase-app-20260714T030000Z.dump"))
                .toBe("nightly/rebase-app-20260714T030000Z.globals.sql");
        });
        it("appends when the name does not end in .dump", () => {
            expect(globalsFileForDump("weird")).toBe("weird.globals.sql");
        });
    });

    describe("splitGlobalsStatements", () => {
        it("splits statements and drops comment lines so each role runs independently", () => {
            const sql = [
                "-- roles",
                "CREATE ROLE rebase_user NOLOGIN;",
                "ALTER ROLE rebase_user WITH NOSUPERUSER;",
                "GRANT rebase_user TO postgres;"
            ].join("\n");
            expect(splitGlobalsStatements(sql)).toEqual([
                "CREATE ROLE rebase_user NOLOGIN",
                "ALTER ROLE rebase_user WITH NOSUPERUSER",
                "GRANT rebase_user TO postgres"
            ]);
        });
    });

    describe("resolveConnectionString", () => {
        it("prefers DATABASE_URL", () => {
            expect(resolveConnectionString({ DATABASE_URL: "a", ADMIN_CONNECTION_STRING: "b" })).toBe("a");
        });
        it("falls back to ADMIN_CONNECTION_STRING", () => {
            expect(resolveConnectionString({ ADMIN_CONNECTION_STRING: "b" })).toBe("b");
        });
        it("returns null when neither is set", () => {
            expect(resolveConnectionString({})).toBeNull();
        });
    });
});

describe("backup retention pruning", () => {
    const mk = (iso: string) => ({ key: `rebase-app-${iso}.dump`, createdAt: new Date(iso.replace(/(\d{8})T(\d{6})Z/, "$1T$2Z")) });

    const now = new Date("2026-07-14T00:00:00Z");
    const days = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000);

    it("returns nothing when retentionDays is 0 or negative", () => {
        const backups = [{ key: "a.dump", createdAt: days(100) }];
        expect(selectBackupsToPrune(backups, { retentionDays: 0, now })).toEqual([]);
        expect(selectBackupsToPrune(backups, { retentionDays: -5, now })).toEqual([]);
    });

    it("deletes backups older than the retention window", () => {
        const backups = [
            { key: "recent.dump", createdAt: days(2) },
            { key: "old.dump", createdAt: days(40) },
            { key: "older.dump", createdAt: days(90) }
        ];
        const pruned = selectBackupsToPrune(backups, { retentionDays: 30, now });
        expect(pruned).toEqual(["older.dump", "old.dump"]); // oldest first
    });

    it("keeps at least keepMinimum recent backups regardless of age", () => {
        const backups = [
            { key: "b1.dump", createdAt: days(40) },
            { key: "b2.dump", createdAt: days(50) },
            { key: "b3.dump", createdAt: days(60) }
        ];
        // All are older than 30d, but keepMinimum=2 protects the 2 newest.
        const pruned = selectBackupsToPrune(backups, { retentionDays: 30, keepMinimum: 2, now });
        expect(pruned).toEqual(["b3.dump"]);
    });

    it("never prunes objects without a recoverable timestamp", () => {
        const backups = [
            { key: "foreign-object.txt" }, // no createdAt, no parseable stamp
            { key: "rebase-app-20260101T000000Z.dump" } // ~195 days before now
        ];
        const pruned = selectBackupsToPrune(backups, { retentionDays: 30, now });
        expect(pruned).toEqual(["rebase-app-20260101T000000Z.dump"]);
    });

    it("recovers timestamps from keys when createdAt is absent", () => {
        const backups = [
            { key: "rebase-app-20260710T000000Z.dump" }, // 4 days ago → keep
            { key: "rebase-app-20260501T000000Z.dump" }  // ~74 days ago → prune
        ];
        const pruned = selectBackupsToPrune(backups, { retentionDays: 30, now });
        expect(pruned).toEqual(["rebase-app-20260501T000000Z.dump"]);
    });
});

describe("backupCronConfigFromEnv", () => {
    it("is disabled when BACKUP_SCHEDULE is unset", () => {
        expect(backupCronConfigFromEnv({ DATABASE_URL: "postgres://x/db" })).toEqual({ disabled: true });
    });

    it("errors when the schedule is set but DATABASE_URL is missing", () => {
        const res = backupCronConfigFromEnv({ BACKUP_SCHEDULE: "0 3 * * *", BACKUP_DESTINATION: "./b" });
        expect(res.error).toContain("DATABASE_URL");
    });

    it("errors when the destination is missing", () => {
        const res = backupCronConfigFromEnv({ BACKUP_SCHEDULE: "0 3 * * *", DATABASE_URL: "postgres://x/db" });
        expect(res.error).toContain("BACKUP_DESTINATION");
    });

    it("builds a full config from env", () => {
        const res = backupCronConfigFromEnv({
            BACKUP_SCHEDULE: "0 3 * * *",
            DATABASE_URL: "postgres://u:p@h/app",
            BACKUP_DESTINATION: "s3://bucket/nightly",
            BACKUP_RETENTION_DAYS: "14",
            BACKUP_KEEP_MINIMUM: "3"
        });
        expect(res.config).toMatchObject({
            schedule: "0 3 * * *",
            connectionString: "postgres://u:p@h/app",
            destination: { kind: "s3", bucket: "bucket", prefix: "nightly" },
            retentionDays: 14,
            keepMinimum: 3
        });
    });

    it("rejects a non-integer retention", () => {
        const res = backupCronConfigFromEnv({
            BACKUP_SCHEDULE: "0 3 * * *",
            DATABASE_URL: "postgres://x/db",
            BACKUP_DESTINATION: "./b",
            BACKUP_RETENTION_DAYS: "seven"
        });
        expect(res.error).toContain("BACKUP_RETENTION_DAYS");
    });
});
