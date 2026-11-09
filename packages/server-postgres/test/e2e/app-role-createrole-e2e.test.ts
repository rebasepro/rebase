/**
 * E2E: a connection that is only CREATEROLE — no superuser, no BYPASSRLS, the
 * owner of its database — boots and serves a signed-in read, on Postgres 16
 * and on 15.
 *
 * That is the user managed Postgres hands out: RDS's master user, Cloud SQL's
 * `postgres`, Neon's owner, Hostman's `gen_user`. On 16+ a role such a user
 * creates is recorded with the creator as a member `WITH ADMIN TRUE,
 * SET FALSE`, so `rebase_user` existed, `pg_has_role(…, 'MEMBER')` said yes, the
 * boot logged RLS enforcement as active, and the first signed-in request
 * failed with 42501 "permission denied to set role". 15 has no SET option and
 * was never affected; it is here so the fix is proven not to break it — the
 * grant syntax that fixes 16 is a syntax error on 15.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureCollectionTables, type Queryable } from "../../src/schema/ensure-collection-tables.js";
import { ensureCollectionPolicies } from "../../src/schema/ensure-collection-policies.js";
import { ensureAuthTablesExist } from "../../src/auth/ensure-tables.js";
import {
    AppRoleSetupError,
    detectConnectionPosture,
    ensureAppRole,
    REBASE_USER_ROLE,
    type RawSqlRunner
} from "../../src/security/rls-enforcement.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { testUser } from "./test-user.js";

const notesCollection: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        body: { name: "Body", type: "string" },
        owner_id: { name: "Owner", type: "string" }
    },
    securityRules: [{ operation: "all", ownerField: "owner_id" }]
};

const notesTable = pgTable("notes", {
    id: varchar("id").primaryKey(),
    body: varchar("body"),
    owner_id: varchar("owner_id")
});

describe.each([
    { image: "postgres:16-alpine", setOption: true },
    { image: "postgres:15-alpine", setOption: false }
])("a CREATEROLE-only owner on $image", ({ image, setOption }) => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;

    const appUrl = () => `postgresql://gen_user:secret@localhost:${container.port}/default_db?sslmode=disable`;

    beforeAll(async () => {
        container = await startPgContainer({ image });
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        // The managed-provider shape: CREATEROLE, owner of its database, nothing more.
        await admin.query("CREATE ROLE gen_user LOGIN PASSWORD 'secret' NOSUPERUSER NOBYPASSRLS CREATEROLE");
        await admin.query("CREATE DATABASE default_db OWNER gen_user");

        pool = new pg.Pool({ connectionString: appUrl() });
        // Postgres 15+ no longer grants CREATE on public to PUBLIC, and the
        // schema belongs to pg_database_owner — gen_user, as the owner.
        const db = drizzle(pool);
        const queryable: Queryable = { query: <T,>(text: string): Promise<{ rows: T[] }> => pool.query<T & pg.QueryResultRow>(text) };
        const runSql: RawSqlRunner = async (text) => (await pool.query(text)).rows as Record<string, unknown>[];

        await ensureAuthTablesExist(db);
        await ensureCollectionTables(queryable, [notesCollection]);
        const posture = await detectConnectionPosture(runSql);
        expect(posture.superuser).toBe(false);
        expect(posture.privileged).toBe(true);
        await ensureAppRole(runSql, ["public", "rebase"]);
        const applied = await ensureCollectionPolicies(queryable, [notesCollection]);
        expect(applied.failures).toEqual([]);

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([notesCollection]);
        registry.registerTable(notesTable, "notes");
        const realtime = new RealtimeService(db, registry);
        driver = new PostgresBackendDriver(db, realtime, registry);
        realtime.setDataDriver(driver);
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.rlsUserRole = REBASE_USER_ROLE;

        // Seeded as the owner, which bypasses RLS.
        await pool.query("INSERT INTO public.notes (id, body, owner_id) VALUES ('n1', 'mine', 'u1'), ('n2', 'theirs', 'u2')");
    }, 180_000);

    afterAll(async () => {
        await pool?.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("serves a signed-in read, as rebase_user, with the policy applied", async () => {
        const asU1 = await driver.withAuth(testUser("u1", []));
        const entities = await asU1.fetchCollection({ path: "notes", collection: notesCollection });
        // The owner would see both; the request role sees its own.
        expect(entities.map(e => String(e.id))).toEqual(["n1"]);
    });

    it(setOption ? "holds the membership WITH SET, which MEMBER alone never was" : "holds a plain membership", async () => {
        const { rows } = await pool.query(
            `SELECT pg_has_role('gen_user', '${REBASE_USER_ROLE}', 'MEMBER') AS member` +
            (setOption ? `, pg_has_role('gen_user', '${REBASE_USER_ROLE}', 'SET') AS can_set` : "")
        );
        expect(rows[0]).toEqual(setOption ? { member: true, can_set: true } : { member: true });
    });

    it("refuses to boot, with SQL that runs on this major, when the switch cannot be granted", async () => {
        // A second application user, given membership by an administrator
        // without the switch (16) or not at all (15), and no way to grant it.
        await admin.query("CREATE ROLE other_app LOGIN PASSWORD 'secret' NOSUPERUSER NOBYPASSRLS");
        await admin.query("GRANT ALL ON DATABASE default_db TO other_app");
        if (setOption) await admin.query(`GRANT ${REBASE_USER_ROLE} TO other_app WITH SET FALSE`);

        const other = new pg.Client({
            connectionString: `postgresql://other_app:secret@localhost:${container.port}/default_db?sslmode=disable`
        });
        await other.connect();
        try {
            const runSql: RawSqlRunner = async (text) => (await other.query(text)).rows as Record<string, unknown>[];
            const error = await ensureAppRole(runSql, []).catch((err: unknown) => err);
            expect(error).toBeInstanceOf(AppRoleSetupError);
            expect((error as Error).message).toMatch(/"other_app" may not switch to "rebase_user"/);

            // What the operator is told to run, run by an administrator, on this major.
            const instructions = (error as AppRoleSetupError).instructions;
            await admin.query(instructions.slice(instructions.indexOf("DO $rebase_role$")));
            await ensureAppRole(runSql, []);
            await other.query("BEGIN");
            await other.query(`SELECT set_config('role', '${REBASE_USER_ROLE}', true)`);
            const { rows } = await other.query("SELECT current_user AS role");
            await other.query("ROLLBACK");
            expect(rows).toEqual([{ role: REBASE_USER_ROLE }]);
        } finally {
            await other.end();
        }
    });
});
