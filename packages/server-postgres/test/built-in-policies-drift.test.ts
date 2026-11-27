import { describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { checkPolicyDrift, type Queryable } from "../src/security/policy-drift";
import { generatePostgresPoliciesDdl } from "../src/schema/generate-postgres-ddl-logic";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { compileSet } from "./helpers/plan-tables";

/**
 * Built-in auth serves `rebase.users` where no project table is the auth
 * table, and every boot writes its policies from the framework's own
 * definition. A project whose declared tables put `rebase` in scope used to
 * see those policies as orphans, and `rebase doctor` failed. They are the
 * boot's. A stranger on any other undeclared table in the schema is still
 * reported.
 */

/** A project table in `rebase`, which puts the schema in scope; no auth table is declared. */
const audit: LegacyCollectionConfig = {
    name: "Audit",
    slug: "audit",
    table: "audit",
    schema: "rebase",
    securityRules: [{ operation: "select", roles: ["admin"] }],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        note: { name: "Note", type: "string" }
    }
};

async function database(): Promise<Queryable> {
    const db = new PGlite();
    for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
    await db.exec(`
        CREATE SCHEMA IF NOT EXISTS rebase;
        CREATE TABLE rebase.audit (id uuid PRIMARY KEY, note text);
        CREATE TABLE rebase.users (id text PRIMARY KEY, email text, roles text[]);
        ALTER TABLE rebase.users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY users_default_admin_read ON rebase.users FOR SELECT USING (rebase.uid() IS NULL);
        CREATE TABLE rebase.scratch (id int PRIMARY KEY);
        ALTER TABLE rebase.scratch ENABLE ROW LEVEL SECURITY;
        CREATE POLICY scratch_hand_made ON rebase.scratch FOR SELECT USING (true);
    `);
    const client: Queryable = {
        async query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
            if (values) return { rows: (await db.query<R>(text, values)).rows };
            const results = await db.exec(text);
            return { rows: (results[results.length - 1]?.rows ?? []) as R[] };
        }
    };
    await client.query(generatePostgresPoliciesDdl(compileSet([audit])));
    return client;
}

describe("policy drift beside built-in auth's tables", () => {
    it("reports no orphan on the built-in users table, and still reports a hand-made stranger", async () => {
        const client = await database();
        const drift = await checkPolicyDrift(client, compileSet([audit]), { adminRoleAvailable: false });
        const orphans = drift.orphaned.map(p => `${p.schema}.${p.table}.${p.name}`);
        expect(orphans).not.toContain("rebase.users.users_default_admin_read");
        expect(orphans).toContain("rebase.scratch.scratch_hand_made");
    });
});
