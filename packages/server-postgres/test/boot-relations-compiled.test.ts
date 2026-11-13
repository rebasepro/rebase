/**
 * Boot provisions tables with relations from the compiled tables it is handed.
 *
 * The boot appliers (`ensureTableSchema`, `ensureTablePolicies` on
 * the bootstrapper) used to be handed the server's lowered collections and lift
 * them back into tables. The lift refuses every relation of a lowered
 * collection ("the relation its target … is not one of the tables being
 * compiled"), so any project with a `belongsTo`, `hasMany` or `manyToMany`
 * failed to boot. They take `CompiledTable[]` now — what `compileSchema`
 * returns and what the server holds — and this boots a schema with all three
 * kinds on PGlite: tables, the junction and the policies are created, and a
 * second boot plans nothing.
 */
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";
import { ensureAppRole } from "../src/security/rls-enforcement";
import { ensureTables, type Queryable } from "../src/schema/ensure-tables";
import { unreadDriver } from "./helpers/spg-a-driver";

const people = defineTable("people", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: { led: rel.hasMany(() => departments, { foreignKey: "lead_id" }) },
    rls: [{ operation: "select", access: "public" }]
});

const departments = defineTable("departments", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: {
        lead: rel.belongsTo(() => people, { localKey: "lead_id" }),
        tags: rel.manyToMany(() => tags)
    },
    rls: [{ operation: "select", access: "public" }]
});

const tags = defineTable("tags", {
    columns: { id: col.serial().primaryKey(), label: col.text() },
    rls: "admin-only"
});

const tables = compileSchema([people, departments, tags]);

/** The drizzle surface the bootstrapper uses, over one PGlite session. */
function drizzleOver(pg: PGlite) {
    const dialect = new PgDialect();
    const execute = async (query: SQL) => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        return { rows: (await pg.query(text, params)).rows };
    };
    return {
        execute,
        transaction: async <T>(fn: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => {
            await pg.exec("BEGIN");
            try {
                const result = await fn({ execute });
                await pg.exec("COMMIT");
                return result;
            } catch (err) {
                await pg.exec("ROLLBACK");
                throw err;
            }
        }
    };
}

describe("boot provisions related tables from compiled tables", () => {
    let pg: PGlite;

    beforeEach(async () => {
        pg = new PGlite();
        await pg.waitReady;
        await pg.exec(`
            CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
            CREATE SCHEMA rebase;
        `);
    });

    afterEach(async () => {
        await pg.close();
    });

    it("creates the tables, the junction and the policies, and a second boot plans nothing", async () => {
        const db = drizzleOver(pg);
        const bootstrapper = createPostgresBootstrapper({ connection: db });
        const driverResult = {
            driver: unreadDriver(),
            internals: {
                db,
                driver: { rlsUserRole: "rebase_user" },
                realtimeService: { rlsUserRole: "rebase_user" }
            }
        };

        const schema = await bootstrapper.ensureTableSchema!(tables, driverResult);
        expect(schema.applied).toBeGreaterThan(0);

        const runSql = async (text: string) => (await pg.query<Record<string, unknown>>(text)).rows;
        await ensureAppRole(runSql, ["public", "rebase"]);
        const policies = await bootstrapper.ensureTablePolicies!(tables, driverResult);
        expect(policies.applied).toBeGreaterThan(0);

        const { rows: created } = await pg.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
        );
        expect(created.map(row => row.table_name)).toEqual(expect.arrayContaining(["departments", "departments_tags", "people", "tags"]));

        const { rows: fks } = await pg.query<{ conname: string }>(
            `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = 'public.departments'::regclass`
        );
        expect(fks).toHaveLength(1);

        const { rows: secured } = await pg.query<{ relname: string }>(
            `SELECT c.relname FROM pg_policies p JOIN pg_class c ON c.relname = p.tablename WHERE p.schemaname = 'public' GROUP BY c.relname ORDER BY 1`
        );
        expect(secured.map(row => row.relname)).toEqual(expect.arrayContaining(["departments", "people", "tags"]));

        // A second boot: nothing to create, no policy to rewrite.
        const queryable: Queryable = { query: async (text, values) => ({ rows: (await pg.query(text, values)).rows }) };
        const again = await ensureTables(queryable, tables);
        expect(again.actions).toEqual([]);
        expect((await bootstrapper.ensureTablePolicies!(tables, driverResult)).applied).toBe(0);
    });
});
