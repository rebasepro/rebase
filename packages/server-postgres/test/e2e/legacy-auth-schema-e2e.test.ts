/**
 * E2E: retiring the pre-1.0 `auth` schema, against a real catalogue.
 *
 * The drop identifies Rebase's helpers by result type and body, and the matcher
 * once missed an `auth.uid()` reading `app.user_id` alone — which is what every
 * release before v0.10.0 wrote, and what the control plane had copied. The
 * schema then stayed, and the swallowed `DROP SCHEMA … RESTRICT` meant nothing
 * said so. A string assertion cannot tell whether the SQL matches what
 * Postgres stores in `pg_proc`, so each case here builds the schema for real.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { dropLegacyAuthSchema } from "../../src/schema/rls-bootstrap-sql.js";

/** The `auth` schema exactly as a Rebase release before v0.10.0 left it. */
const BEFORE_V0_10 = `
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    CREATE FUNCTION auth.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    CREATE FUNCTION auth.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
`;

/** v0.10.0 to v0.13.x: the GUC renamed to `app.uid`, the old one kept as a fallback. */
const V0_10_TO_V0_13 = BEFORE_V0_10.replace(
    "SELECT NULLIF(current_setting('app.user_id', true), '');",
    "SELECT COALESCE(NULLIF(current_setting('app.uid', true), ''), NULLIF(current_setting('app.user_id', true), ''));"
);

/** Supabase's helpers, as its `auth` schema defines them. */
const SUPABASE = `
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
            nullif(current_setting('request.jwt.claims', true), ''))::jsonb
    $$;
    CREATE TABLE public.notes (id serial PRIMARY KEY, owner uuid);
    ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notes_owner ON public.notes USING (owner = auth.uid());
`;

let container: PgContainer;
let admin: pg.Client;
let databases = 0;

/** A fresh database holding `setup`, the drop run against it, and what it left. */
async function retire(setup: string) {
    const database = `legacy_auth_${++databases}`;
    await admin.query(`CREATE DATABASE ${database}`);
    const client = new pg.Client({ connectionString: container.connectionString.replace("/rebase?", `/${database}?`) });
    await client.connect();
    try {
        await client.query(setup);
        const info: string[] = [];
        const warn: string[] = [];
        await dropLegacyAuthSchema(
            async (text) => (await client.query(text)).rows as Record<string, unknown>[],
            { info: (m) => info.push(m), warn: (m) => warn.push(m) }
        );
        const schema = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'auth'");
        const functions = await client.query<{ name: string }>(
            `SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'auth' ORDER BY 1`
        );
        return { schemaLeft: schema.rowCount === 1, functions: functions.rows.map(r => r.name), info, warn };
    } finally {
        await client.end();
    }
}

describe("retiring the pre-1.0 auth schema", () => {
    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
    }, 180_000);

    afterAll(async () => {
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    it("removes the schema a release before v0.10.0 left, `app.user_id`-only `auth.uid()` and all", async () => {
        const result = await retire(BEFORE_V0_10);
        expect(result.schemaLeft).toBe(false);
        expect(result.warn).toEqual([]);
    });

    it("removes the schema v0.10.0 to v0.13.x left", async () => {
        const result = await retire(V0_10_TO_V0_13);
        expect(result.schemaLeft).toBe(false);
        expect(result.warn).toEqual([]);
    });

    it("leaves Supabase's `auth` exactly as it was, and says nothing about its policies", async () => {
        const result = await retire(SUPABASE);
        expect(result.schemaLeft).toBe(true);
        expect(result.functions).toEqual(["jwt", "uid"]);
        expect(result.warn).toEqual([]);
        expect(result.info).toEqual([]);
    });

    it("drops the helpers but names what keeps the schema, once something else lives there", async () => {
        const result = await retire(BEFORE_V0_10 + "CREATE TABLE auth.sessions (id serial PRIMARY KEY);");
        expect(result.schemaLeft).toBe(true);
        expect(result.functions).toEqual([]);
        expect(result.warn).toHaveLength(1);
        expect(result.warn[0]).toContain("  • table auth.sessions");
        // The serial's sequence goes with its table; naming it would be noise.
        expect(result.warn[0]).not.toContain("sequence");
    });

    it("leaves a helper whose body no release wrote, and says so", async () => {
        const result = await retire(`
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS text AS $$ SELECT current_setting('my.uid', true) $$ LANGUAGE sql STABLE;
        `);
        expect(result.functions).toEqual(["uid"]);
        expect(result.warn).toHaveLength(1);
        expect(result.warn[0]).toContain("function auth.uid() — named and typed like Rebase's old helper");
    });

    it("reports a drop Postgres refused, naming the dependent object", async () => {
        const result = await retire(BEFORE_V0_10 + "CREATE VIEW public.me AS SELECT auth.uid() AS uid;");
        expect(result.functions).toEqual(["jwt", "roles", "uid"]);
        expect(result.warn).toHaveLength(1);
        expect(result.warn[0]).toContain("cannot drop function auth.uid()");
        expect(result.warn[0]).toContain("view me depends on function auth.uid()");
    });
});
