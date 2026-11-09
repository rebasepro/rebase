/**
 * The request role on a database another application shares.
 *
 * Three things went wrong there, reproduced on PostgreSQL 18 on 2026-11-09
 * (docs/design/rebase-user-on-existing-databases.md, findings 2 and 4):
 *
 *  - The grant tier ran `GRANT … ON ALL TABLES IN SCHEMA public`, which also
 *    tries the other application's tables. One this connection holds no
 *    privilege on failed the statement, and the boot with it. One it holds
 *    without grant option only warned, but the schema never read as granted,
 *    so every boot ran the schema-wide grant again.
 *  - A collection over a table another role owns booted silently and then
 *    refused every request.
 *  - `validatePolicyPgRoles` passed a `pgRoles` the request role was only a
 *    member of. Policies apply to a role that has the target's privileges, which
 *    a NOINHERIT member does not, so the collection read as empty.
 */
import { PGlite } from "@electric-sql/pglite";
import { ensureAppRoleGrants, findUngrantableTables, validatePolicyPgRoles } from "../src/security/rls-enforcement";

/** Statements that write the catalogue. */
const WRITES = /^\s*(GRANT|REVOKE|ALTER|DO\b)/i;

/**
 * `app` connects and owns its own table; `legacy` is the other application,
 * which owns two tables in the same `public`: one `app` cannot touch at all,
 * and one it may read but not grant on.
 */
async function sharedDatabase(): Promise<PGlite> {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
        CREATE ROLE app NOLOGIN;
        CREATE ROLE legacy NOLOGIN;
        CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
        GRANT rebase_user TO app;
        GRANT CREATE ON SCHEMA public TO app, legacy;
        SET ROLE legacy;
        CREATE TABLE public.payroll (id int);
        CREATE TABLE public.shared (id int);
        GRANT SELECT ON public.shared TO app;
        RESET ROLE;
        SET ROLE app;
        CREATE TABLE public.notes (id serial PRIMARY KEY, body text);
    `);
    return pg;
}

const recorder = (pg: PGlite) => {
    const ran: string[] = [];
    const run = async (text: string) => {
        ran.push(text.trim());
        return (await pg.query<Record<string, unknown>>(text)).rows;
    };
    return { ran, run, writes: () => ran.filter(text => WRITES.test(text)) };
};

const privilege = async (pg: PGlite, table: string, role = "rebase_user"): Promise<boolean> => {
    const { rows } = await pg.query<{ ok: boolean }>(
        `SELECT has_table_privilege('${role}', '${table}', 'SELECT') AS ok`
    );
    return rows[0].ok;
};

describe("the grant tier on a schema another application shares", () => {
    let pg: PGlite;
    beforeEach(async () => { pg = await sharedDatabase(); });
    afterEach(async () => { await pg.close(); });

    it("grants its own tables and leaves the other application's alone, without failing", async () => {
        const { run } = recorder(pg);
        await ensureAppRoleGrants(run, ["public"]);
        expect(await privilege(pg, "public.notes")).toBe(true);
        expect(await privilege(pg, "public.payroll")).toBe(false);
        expect(await privilege(pg, "public.shared")).toBe(false);
    });

    it("settles: the next run writes nothing", async () => {
        const { run, ran, writes } = recorder(pg);
        await ensureAppRoleGrants(run, ["public"]);
        ran.length = 0;
        await ensureAppRoleGrants(run, ["public"]);
        expect(writes()).toEqual([]);
        expect(ran).toHaveLength(1);
    });

    it("names a collection's table it cannot grant on, with its owner and the grant to run", async () => {
        const { run } = recorder(pg);
        await ensureAppRoleGrants(run, ["public"]);
        const found = await findUngrantableTables(run, [
            { schema: "public", table: "notes" },
            { schema: "public", table: "payroll" },
            { schema: "public", table: "missing" }
        ]);
        expect(found).toEqual([{
            name: "\"public\".\"payroll\"",
            owner: "legacy",
            grant: "GRANT SELECT, INSERT, UPDATE, DELETE ON \"public\".\"payroll\" TO rebase_user;"
        }]);
    });

    it("stops naming the table once its owner has granted it", async () => {
        const { run } = recorder(pg);
        await pg.exec("RESET ROLE; SET ROLE legacy; GRANT SELECT ON public.payroll TO rebase_user; RESET ROLE; SET ROLE app;");
        expect(await findUngrantableTables(run, [{ schema: "public", table: "payroll" }])).toEqual([]);
    });
});

describe("validatePolicyPgRoles", () => {
    let pg: PGlite;
    beforeEach(async () => {
        pg = new PGlite();
        await pg.waitReady;
        await pg.exec(`
            CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
            CREATE ROLE authenticated NOLOGIN;
        `);
    });
    afterEach(async () => { await pg.close(); });

    const collections = [{ slug: "posts", securityRules: [{ pgRoles: ["authenticated"] }] }];

    it("refuses a role the request role is a member of but does not inherit, and says the grant that works", async () => {
        await pg.exec("GRANT authenticated TO rebase_user WITH INHERIT FALSE");
        const { run } = recorder(pg);
        await expect(validatePolicyPgRoles(run, collections)).rejects.toThrow(
            /is a member of it but does not inherit[\s\S]*GRANT authenticated TO rebase_user WITH INHERIT TRUE/
        );
    });

    it("accepts the same role once the membership inherits", async () => {
        await pg.exec("GRANT authenticated TO rebase_user WITH INHERIT TRUE");
        const { run } = recorder(pg);
        await expect(validatePolicyPgRoles(run, collections)).resolves.toBeUndefined();
    });

    it("still explains a role that is not there as another platform's convention", async () => {
        await pg.exec("DROP ROLE authenticated");
        const { run } = recorder(pg);
        await expect(validatePolicyPgRoles(run, collections)).rejects.toThrow(/is a Supabase convention/);
    });

    it("gives the inheriting grant for an existing Supabase role rather than calling it a convention", async () => {
        const { run } = recorder(pg);
        await expect(validatePolicyPgRoles(run, collections)).rejects.toThrow(
            /is not a member of it[\s\S]*GRANT authenticated TO rebase_user WITH INHERIT TRUE/
        );
    });
});
