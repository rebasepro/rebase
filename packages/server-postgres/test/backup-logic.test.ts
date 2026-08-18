import { applyGlobalsWith, discardPartialDumpWith, pruneWith } from "../src/backup/backup-logic";

describe("applyGlobalsWith (tolerant globals replay)", () => {
    const globals = [
        "-- roles",
        "CREATE ROLE rebase_user NOLOGIN;",
        "ALTER ROLE rebase_user WITH NOSUPERUSER;",
        "GRANT rebase_user TO postgres;"
    ].join("\n");

    it("applies every statement when none fail", async () => {
        const ran: string[] = [];
        const res = await applyGlobalsWith(async (sql) => { ran.push(sql); }, globals);
        expect(res).toEqual({ applied: 3, skipped: 0 });
        expect(ran).toEqual([
            "CREATE ROLE rebase_user NOLOGIN",
            "ALTER ROLE rebase_user WITH NOSUPERUSER",
            "GRANT rebase_user TO postgres"
        ]);
    });

    it("tolerates a failing statement and still runs the rest (same-cluster: role already exists)", async () => {
        const ran: string[] = [];
        const runStatement = async (sql: string) => {
            ran.push(sql);
            if (/^CREATE ROLE/.test(sql)) throw new Error('role "rebase_user" already exists');
        };
        const res = await applyGlobalsWith(runStatement, globals);
        // The CREATE ROLE is skipped, but ALTER + GRANT still run.
        expect(res).toEqual({ applied: 2, skipped: 1 });
        expect(ran).toHaveLength(3); // every statement was attempted
    });

    it("logs each skipped statement with its first line", async () => {
        const logs: string[] = [];
        const runStatement = async (sql: string) => {
            if (/^ALTER ROLE/.test(sql)) throw new Error("permission denied to alter superuser");
        };
        const res = await applyGlobalsWith(runStatement, globals, (m) => logs.push(m));
        expect(res.skipped).toBe(1);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain("ALTER ROLE rebase_user");
        expect(logs[0]).toContain("permission denied");
    });

    it("does nothing for an empty script", async () => {
        const res = await applyGlobalsWith(async () => {}, "-- only a comment\n");
        expect(res).toEqual({ applied: 0, skipped: 0 });
    });
});

describe("pruneWith (dump + roles-sidecar co-deletion)", () => {
    it("deletes each dump AND its .globals.sql sidecar", async () => {
        const deleted: string[] = [];
        await pruneWith(
            ["backups/rebase-app-20260101T000000Z.dump", "backups/rebase-app-20260201T000000Z.dump"],
            async (key) => { deleted.push(key); }
        );
        expect(deleted).toEqual([
            "backups/rebase-app-20260101T000000Z.dump",
            "backups/rebase-app-20260101T000000Z.globals.sql",
            "backups/rebase-app-20260201T000000Z.dump",
            "backups/rebase-app-20260201T000000Z.globals.sql"
        ]);
    });

    it("swallows a missing sidecar (older backups predate it) but still deletes the dump", async () => {
        const deleted: string[] = [];
        const deleteObject = async (key: string) => {
            if (key.endsWith(".globals.sql")) throw new Error("not found");
            deleted.push(key);
        };
        await expect(
            pruneWith(["rebase-app-20260101T000000Z.dump"], deleteObject)
        ).resolves.toBeUndefined();
        expect(deleted).toEqual(["rebase-app-20260101T000000Z.dump"]);
    });

    it("propagates a failure to delete the dump itself (does not hide real errors)", async () => {
        const deleteObject = async (key: string) => {
            if (key.endsWith(".dump")) throw new Error("permission denied");
        };
        await expect(
            pruneWith(["rebase-app-20260101T000000Z.dump"], deleteObject)
        ).rejects.toThrow("permission denied");
    });
});

describe("discardPartialDumpWith (failed-run cleanup)", () => {
    /*
     * pg_dump creates its `--file=` target before it finishes connecting, so a
     * failure leaves a 0-byte file behind. Nothing removed it, and it was not
     * inert: `rebase db backups list` showed it as an ordinary backup, and
     * `selectBackupsToPrune` ranks by timestamp alone — so the corpse held one
     * of the protected `keepMinimum` slots while a real backup aged out under
     * it. Found by running `rebase db backup` against a scaffold whose
     * generated DATABASE_URL libpq refused to parse.
     */
    it("removes an artifact that exists", () => {
        const removed: string[] = [];
        discardPartialDumpWith(() => true, (f) => removed.push(f), "/tmp/x.dump");
        expect(removed).toEqual(["/tmp/x.dump"]);
    });

    it("does not attempt to remove what is not there", () => {
        const removed: string[] = [];
        discardPartialDumpWith(() => false, (f) => removed.push(f), "/tmp/x.dump");
        expect(removed).toEqual([]);
    });

    it("swallows a failed unlink so it cannot mask the real error", () => {
        /*
         * Every caller is already throwing the diagnosis the user needs — a
         * rejected connection string, an RLS failure. An EPERM from the cleanup
         * replacing that would trade a useful message for a useless one.
         */
        expect(() => discardPartialDumpWith(
            () => true,
            () => { throw new Error("EPERM"); },
            "/tmp/x.dump"
        )).not.toThrow();
    });

    it("swallows a failed existence check too", () => {
        expect(() => discardPartialDumpWith(
            () => { throw new Error("EACCES"); },
            () => {},
            "/tmp/x.dump"
        )).not.toThrow();
    });
});
