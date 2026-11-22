/**
 * The zero-code catalog is out of the request role's reach.
 *
 * `rebase.table_meta`, `storage_policies`, `webhooks`, `cron_jobs` and `roles`
 * are the server's, read and written on the owner connection. The driver
 * grants `rebase_user` DML across `rebase`, and default privileges hand it the
 * tables created later, so these five shipped readable and writable by any
 * signed-in caller's SQL — `rls:check` failed the self-host lane with five
 * `[critical] rls-disabled` findings. Every boot revokes on each of them.
 */
import { describe, expect, it } from "@jest/globals";
import type { SQLAdmin } from "@rebasepro/types";
import { ensureBaasCatalogTables } from "../src/baas/catalog-ddl";

const CATALOG = ["table_meta", "storage_policies", "webhooks", "cron_jobs", "roles"];

function recordingAdmin(): { admin: SQLAdmin, statements: string[] } {
    const statements: string[] = [];
    const admin: SQLAdmin = {
        executeSql: async (sql: string) => {
            statements.push(sql);
            return [];
        }
    };
    return { admin, statements };
}

describe("the zero-code catalog and the request role", () => {
    it("revokes every catalog table from the request role, after creating it", async () => {
        const { admin, statements } = recordingAdmin();
        await ensureBaasCatalogTables(admin);

        for (const table of CATALOG) {
            const created = statements.findIndex(s => s.includes(`CREATE TABLE IF NOT EXISTS "rebase"."${table}"`));
            const revoked = statements.findIndex(s => s.includes("$rebase_revoke$") && s.includes(`"rebase"."${table}"`));
            expect({ table, created: created >= 0 }).toEqual({ table, created: true });
            expect({ table, revokedAfterCreate: revoked > created }).toEqual({ table, revokedAfterCreate: true });
        }
    });

    it("creates no catalog table it does not also revoke", async () => {
        const { admin, statements } = recordingAdmin();
        await ensureBaasCatalogTables(admin);

        const created = statements
            .map(s => /CREATE TABLE IF NOT EXISTS "rebase"\."([a-z_]+)"/.exec(s)?.[1])
            .filter((name): name is string => name !== undefined);
        expect(created.sort()).toEqual([...CATALOG].sort());
    });
});
