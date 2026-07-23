import { applyGlobalsWith, pruneWith } from "../src/backup/backup-logic";

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
