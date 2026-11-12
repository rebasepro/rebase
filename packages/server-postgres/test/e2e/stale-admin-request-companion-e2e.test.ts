/**
 * E2E: an admin-request companion goes when the rule that earned it changes —
 * on every path that writes policies, not only a provisioning boot.
 *
 * A companion is `TO rebase_admin_request USING (true)`: every admin, every
 * row. A boot drops one no rule earns, but `db push` and a migration rewrite
 * the base policies without a boot, and a deployment whose boot provisions
 * nothing never runs that step. A named rule narrowed to `admin AND owner`
 * kept its companion's name; an unnamed rule removed left its companion to the
 * push's orphan cleanup, which kept it. Either way an admin request went on
 * reading every row, and deleting them. What must hold (found by review):
 *
 * - After a push, and after a migration, of the narrowed and removed rules, no
 *   companion is left and an admin reads and deletes what the rules allow.
 * - A boot that provisions nothing brings none back; one that provisions
 *   writes them only for rules that earn them.
 * - Push keeps no companion whose role something else holds.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { authContextStatement } from "../../src/security/rls-enforcement.js";
import { resolveRlsSettings } from "../../src/security/rls-settings.js";
import { generatePostgresPoliciesDdl } from "../../src/schema/generate-postgres-ddl-logic.js";
import { checkPolicyDrift, dropOrphanedPolicies, dropStaleAdminRequestCompanions } from "../../src/security/policy-drift.js";
import { compileSet } from "../helpers/plan-tables";
import { tablesFromCollections } from "../helpers/tables.js";

const properties: CollectionConfig["properties"] = {
    id: { name: "ID", type: "number", isId: "increment" },
    ownerId: { name: "Owner", type: "string", columnName: "owner_id" }
};

/** Two admin-only rules every admin passes: one named, one not. */
const before: CollectionConfig = {
    name: "Notes", slug: "notes", table: "notes",
    disableDefaultPolicies: true,
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "admins_select", operation: "select", roles: ["admin"] },
        { operation: "delete", roles: ["admin"] }
    ],
    properties
};

/** The named rule narrowed to admin AND owner; the unnamed delete rule removed. */
const after: CollectionConfig = {
    ...before,
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "admins_select", operation: "select", roles: ["admin"], ownerField: "ownerId" }
    ]
};

/** A named single-operation rule every admin passes… */
const opsBefore: CollectionConfig = {
    name: "Ops", slug: "ops", table: "ops",
    disableDefaultPolicies: true,
    securityRules: [{ name: "admins", operation: "select", roles: ["admin"] }],
    properties
};
/** …moved to another operation under the same name: its policy keeps its name, and so would its companion. */
const opsAfter: CollectionConfig = { ...opsBefore, securityRules: [{ name: "admins", operation: "delete", roles: ["admin"] }] };

const JWT_SECRET = "stale-companion-e2e-secret-that-is-long-enough-0123";
const SERVICE_KEY = "stale-companion-e2e-service-key-0123456789abcdef";

describe("a companion follows its rule (E2E)", () => {
    let container: PgContainer;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let rebase: OpenedRebase;
    const backends: Array<Awaited<ReturnType<typeof initializeRebaseBackend>>> = [];

    async function boot(collections: CollectionConfig, provision = true, others: CollectionConfig[] = [opsBefore]): Promise<void> {
        backends.push(await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            collections: [collections, ...others],
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            cronPersistence: false,
            provisionSchema: provision
        }));
    }

    /** What `db push` does with policies: `policies.sql`, then its orphan cleanup. */
    async function push(collections: CollectionConfig): Promise<void> {
        await rebase.sql(generatePostgresPoliciesDdl(compileSet([collections])));
        const drift = await checkPolicyDrift(connection.pool, compileSet([collections]), { adminRoleAvailable: true });
        await dropOrphanedPolicies(connection.pool, drift, compileSet([collections]));
    }

    /** What `db migrate` does: replay `policies.sql`, then sweep stale companions. */
    async function migrate(collections: CollectionConfig): Promise<void> {
        await rebase.sql(generatePostgresPoliciesDdl(compileSet([collections])));
        await dropStaleAdminRequestCompanions(connection.pool, compileSet([collections]), { adminRoleAvailable: true });
    }

    async function companions(table = "notes"): Promise<string[]> {
        const rows = await rebase.sql("SELECT cmd, policyname FROM pg_policies WHERE tablename = $1 AND 'rebase_admin_request' = ANY(roles) ORDER BY 1, 2", { params: [table] });
        return rows.map(row => `${String(row.cmd)} ${String(row.policyname)}`);
    }

    /** What an admin who owns no row can read and delete, rolled back. */
    async function adminReach(table = "notes"): Promise<{ read: number; deleted: number }> {
        const client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        try {
            await client.query("BEGIN");
            const request = { ...resolveRlsSettings(undefined).request, adminRoleFor: (role: string) => `${role}_admin` };
            const context = authContextStatement({ uid: "admin1", roles: ["admin"] }, request);
            await client.query(context.text, context.values);
            const read = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n;
            const deleted = (await client.query(`DELETE FROM public."${table}" WHERE owner_id = 'u3'`)).rowCount ?? 0;
            await client.query("ROLLBACK");
            return { read, deleted };
        } finally {
            await client.end();
        }
    }

    beforeAll(async () => {
        container = await startPgContainer();
        connection = createPostgresDatabaseConnection(container.connectionString);
        await boot(before);
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [before], tables: tablesFromCollections([before]).tables });
        await rebase.sql("INSERT INTO public.notes (owner_id) SELECT 'u' || g FROM generate_series(1, 10) g");
        await rebase.sql("INSERT INTO public.ops (owner_id) SELECT 'u' || g FROM generate_series(1, 10) g");
    }, 240_000);

    afterAll(async () => {
        await rebase?.close();
        for (const backend of backends) await backend.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        await connection?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("takes a narrowed named rule's and a removed unnamed rule's companions away on a push", async () => {
        expect(await companions()).toHaveLength(2);
        expect(await adminReach()).toEqual({ read: 10, deleted: 1 });

        await push(after);
        expect(await companions()).toEqual([]);
        expect(await adminReach()).toEqual({ read: 0, deleted: 0 });

        // A boot that provisions nothing brings none back.
        await boot(after, false);
        expect(await companions()).toEqual([]);
        expect(await adminReach()).toEqual({ read: 0, deleted: 0 });
    }, 120_000);

    it("takes them away on a migration too", async () => {
        await boot(before);
        expect(await companions()).toHaveLength(2);

        await migrate(after);
        expect(await companions()).toEqual([]);
        expect(await adminReach()).toEqual({ read: 0, deleted: 0 });

        // A boot that provisions writes none for rules that no longer earn one.
        await boot(after);
        expect(await companions()).toEqual([]);
        expect(await adminReach()).toEqual({ read: 0, deleted: 0 });
    }, 120_000);

    it("keeps no companion on a push once another role holds rebase_admin_request", async () => {
        await boot(before);
        expect(await companions()).toHaveLength(2);
        await rebase.sql("CREATE ROLE stranger NOLOGIN; GRANT rebase_admin_request TO stranger WITH INHERIT TRUE");
        try {
            await push(before);
            expect(await companions()).toEqual([]);
        } finally {
            await rebase.sql("REVOKE rebase_admin_request FROM stranger; DROP ROLE stranger");
        }
        // Nothing else holds it again: a provisioning boot writes them back.
        await boot(before);
        expect(await companions()).toHaveLength(2);
    }, 120_000);

    it("drops a kept name's companion written for another operation, from policies.sql alone", async () => {
        expect(await companions("ops")).toEqual([expect.stringMatching(/^SELECT admins_ar_/)]);
        expect((await adminReach("ops")).read).toBe(10);

        // A hand migration replaying policies.sql, with no push cleanup, no
        // `db migrate` sweep and no provisioning boot after it.
        await rebase.sql(generatePostgresPoliciesDdl(compileSet([opsAfter])));
        expect(await companions("ops")).toEqual([]);
        // Nothing grants SELECT now, so nothing is read — and a DELETE … WHERE
        // sees only rows a SELECT policy admits, so none is deleted either.
        expect(await adminReach("ops")).toEqual({ read: 0, deleted: 0 });

        // A provisioning boot writes the companion the rule earns now.
        await boot(before, true, [opsAfter]);
        expect(await companions("ops")).toEqual([expect.stringMatching(/^DELETE admins_ar_/)]);
        expect((await adminReach("ops")).read).toBe(0);
    }, 120_000);
});
