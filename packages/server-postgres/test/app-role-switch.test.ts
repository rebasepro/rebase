/**
 * `rebase_user` is only provisioned when the connection can actually switch to
 * it, and an adopted one is only used when it actually restricts.
 *
 * From Postgres 16 a membership carries its own SET option, and a
 * non-superuser with CREATEROLE that creates a role is recorded as a member
 * `WITH ADMIN TRUE, SET FALSE`. The tier that asked `pg_has_role(…, 'MEMBER')`
 * read that as done, the boot logged RLS enforcement as active, and every
 * signed-in request then failed with 42501 "permission denied to set role".
 * Managed Postgres hands out exactly that kind of user (RDS master, Cloud SQL
 * `postgres`, Neon's owner, Hostman's `gen_user`).
 *
 * PGlite runs Postgres 18, and `SET SESSION AUTHORIZATION` makes the CREATEROLE
 * role the session user — which is whose membership `SET ROLE` checks — so the
 * 16+ cases run against a real catalogue here. The ≤15 branch, which this
 * PGlite cannot be, runs against a scripted runner; `app-role-switch-e2e`
 * runs both majors for real.
 */
import { PGlite } from "@electric-sql/pglite";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { logger } from "@rebasepro/server";
import {
    AppRoleSetupError,
    appRoleSetupInstructions,
    authContextStatement,
    ensureAppRole,
    type RawSqlRunner
} from "../src/security/rls-enforcement";

/** A runner over one PGlite session. */
const runner = (pg: PGlite): RawSqlRunner => async (text) => (await pg.query<Record<string, unknown>>(text)).rows;

/** The same, failing the way a Drizzle runner fails: `Failed query: …` around Postgres's error. */
const drizzleRunner = (pg: PGlite): RawSqlRunner => async (text) => {
    try {
        return (await pg.query<Record<string, unknown>>(text)).rows;
    } catch (err) {
        throw new DrizzleQueryError(text, [], err as Error);
    }
};

/** A signed-in read, as the request path sends it: the context and the role switch, then the query. */
async function signedInRead(pg: PGlite): Promise<unknown[]> {
    const { text, values } = authContextStatement({ uid: "u1", roles: [] }, "rebase_user");
    await pg.exec("BEGIN");
    try {
        await pg.query(text, values);
        const { rows } = await pg.query("SELECT current_user AS role");
        return rows;
    } finally {
        await pg.exec("ROLLBACK");
    }
}

/** A cluster where `gen_user` — CREATEROLE, not a superuser — owns the database's schemas and is the session. */
async function managedCluster(setup = ""): Promise<PGlite> {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
        CREATE ROLE gen_user NOLOGIN CREATEROLE;
        ALTER SCHEMA public OWNER TO gen_user;
        ${setup}
        SET SESSION AUTHORIZATION gen_user;
    `);
    return pg;
}

describe("ensureAppRole on Postgres 16+", () => {
    let pg: PGlite;
    afterEach(async () => { await pg?.close(); });

    it("lets a CREATEROLE-only connection that creates the role serve a signed-in request", async () => {
        pg = await managedCluster();
        await ensureAppRole(runner(pg), ["public"]);

        expect(await signedInRead(pg)).toEqual([{ role: "rebase_user" }]);
        const { rows } = await pg.query("SELECT pg_has_role('gen_user', 'rebase_user', 'SET') AS can_set");
        expect(rows).toEqual([{ can_set: true }]);
    });

    it("proves the switch without leaving it behind, inside an open transaction too", async () => {
        pg = await managedCluster();
        const ran: string[] = [];
        const run = runner(pg);
        await pg.exec("BEGIN");
        await ensureAppRole(async (text) => { ran.push(text.trim()); return run(text); }, ["public"]);
        const { rows } = await pg.query("SELECT current_user AS role, current_setting('role') AS setting");
        await pg.exec("COMMIT");

        expect(rows).toEqual([{ role: "gen_user", setting: "none" }]);
        // And it is not a statement the provisioning recorder or guard reads as DDL.
        const probe = ran.find((text) => text.includes("current_setting('role')"));
        expect(probe).toMatch(/^SELECT /);
    });

    it("heals a role an earlier boot created without SET — MEMBER alone is not the switch", async () => {
        pg = await managedCluster();
        // What every boot before the fix left behind.
        await pg.exec("CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT");
        const before = await pg.query("SELECT pg_has_role('gen_user', 'rebase_user', 'MEMBER') AS member, pg_has_role('gen_user', 'rebase_user', 'SET') AS can_set");
        expect(before.rows).toEqual([{ member: true, can_set: false }]);
        await expect(signedInRead(pg)).rejects.toThrow(/permission denied to set role/);

        const ran: string[] = [];
        const run = runner(pg);
        await ensureAppRole(async (text) => { ran.push(text.trim()); return run(text); }, ["public"]);

        expect(ran).toContain("GRANT rebase_user TO CURRENT_USER WITH SET TRUE, INHERIT FALSE");
        expect(await signedInRead(pg)).toEqual([{ role: "rebase_user" }]);
    });

    it("refuses to boot, with SQL that works, when the connection cannot grant itself the switch", async () => {
        // Made by an administrator, who then granted membership without SET:
        // gen_user holds no ADMIN option to fix that itself.
        pg = await managedCluster(`
            CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
            GRANT rebase_user TO gen_user WITH SET FALSE;
        `);

        const error = await ensureAppRole(runner(pg), ["public"]).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(AppRoleSetupError);
        const message = (error as AppRoleSetupError).message;
        expect(message).toContain(`"gen_user" may not switch to "rebase_user" (no membership WITH SET TRUE)`);
        expect(message).toContain("permission denied to grant role");
        expect(message).toContain("WITH SET TRUE, INHERIT FALSE");

        // The instructions, run as an administrator, are the fix.
        // By name: PGlite's RESET leaves the session as gen_user.
        await pg.exec("SET SESSION AUTHORIZATION postgres");
        await pg.exec((error as AppRoleSetupError).instructions.slice((error as AppRoleSetupError).instructions.indexOf("DO $rebase_role$")));
        await pg.exec("SET SESSION AUTHORIZATION gen_user");
        await ensureAppRole(runner(pg), ["public"]);
        expect(await signedInRead(pg)).toEqual([{ role: "rebase_user" }]);
    });

    it("says why on a production log line — the setup SQL survives the query redaction", async () => {
        pg = await managedCluster(`
            CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
            GRANT rebase_user TO gen_user WITH SET FALSE;
        `);
        const error = await ensureAppRole(drizzleRunner(pg), ["public"]).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(AppRoleSetupError);
        // Postgres's sentence, not Drizzle's wrapper around the statement.
        expect((error as Error).message).not.toContain("Failed query:");

        const lines: string[] = [];
        const spy = jest.spyOn(console, "error").mockImplementation((line: unknown) => { lines.push(String(line)); });
        try {
            logger.error(`Boot failed: ${(error as Error).message}`, { error });
        } finally {
            spy.mockRestore();
        }
        expect(lines.join("\n")).toContain("permission denied to grant role");
        expect(lines.join("\n")).toContain("GRANT %I TO %I WITH SET TRUE, INHERIT FALSE");
    });
});

describe("an existing rebase_user is checked before it is adopted", () => {
    let pg: PGlite;
    afterEach(async () => { await pg?.close(); });

    it.each([
        ["LOGIN", "CREATE ROLE rebase_user LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT", /can log in[\s\S]*ALTER ROLE rebase_user NOLOGIN;/],
        ["BYPASSRLS", "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT", /BYPASSRLS, so RLS does not apply[\s\S]*ALTER ROLE rebase_user NOBYPASSRLS;/],
        ["SUPERUSER", "CREATE ROLE rebase_user NOLOGIN SUPERUSER NOINHERIT", /a superuser, so RLS does not apply[\s\S]*ALTER ROLE rebase_user NOSUPERUSER/]
    ])("refuses one with %s", async (_label, create, expected) => {
        pg = await managedCluster(`${create}; GRANT rebase_user TO gen_user;`);
        const error = await ensureAppRole(runner(pg), ["public"]).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(AppRoleSetupError);
        expect((error as Error).message).toMatch(/Refusing to use the existing "rebase_user" role/);
        expect((error as Error).message).toMatch(expected);
    });

    it("refuses one that is a member of the table owner — the grant written backwards", async () => {
        pg = await managedCluster(`
            CREATE ROLE app_owner NOLOGIN;
            CREATE TABLE public.notes (id text PRIMARY KEY);
            ALTER TABLE public.notes OWNER TO app_owner;
            CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
            GRANT rebase_user TO gen_user;
            GRANT app_owner TO rebase_user;
        `);
        const error = await ensureAppRole(runner(pg), ["public"]).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(AppRoleSetupError);
        expect((error as Error).message).toContain(`it is a member of "app_owner"`);
        expect((error as Error).message).toContain(`REVOKE "app_owner" FROM rebase_user;`);
    });

    it("adopts one whose only membership is a plain group role, as `pgRoles` asks for", async () => {
        pg = await managedCluster(`
            CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
            GRANT rebase_user TO gen_user WITH SET TRUE;
            CREATE ROLE editors NOLOGIN;
            GRANT editors TO rebase_user;
        `);
        await ensureAppRole(runner(pg), ["public"]);
        expect(await signedInRead(pg)).toEqual([{ role: "rebase_user" }]);
    });
});

/**
 * A runner answering by statement shape — for what PGlite cannot be: a
 * Postgres before 16, or a catalogue that says yes to a switch the server
 * then refuses.
 */
function scripted(answers: {
    superuser?: boolean;
    setOption: boolean;
    canSet: boolean;
    probe?: Error;
}): { run: RawSqlRunner; ran: string[] } {
    const ran: string[] = [];
    const run: RawSqlRunner = async (raw) => {
        const text = raw.trim();
        ran.push(text);
        if (text.includes("server_version_num')::int >=")) {
            return [{ role: "app", superuser: answers.superuser === true, set_option: answers.setOption, role_exists: true }];
        }
        if (text.includes("privileged_memberships")) {
            return [{ can_login: false, superuser: false, bypassrls: false, privileged_memberships: [] }];
        }
        if (text.startsWith("SELECT pg_has_role")) return [{ can_set: answers.canSet }];
        if (text.includes("current_setting('role')") && answers.probe) throw answers.probe;
        return [];
    };
    return { run, ran };
}

const pgError = (message: string, code: string): Error => Object.assign(new Error(message), { code });

describe("ensureAppRole's membership tier, by server version", () => {
    it("asks MEMBER, and grants plainly, before 16 — `WITH SET` is a syntax error there", async () => {
        const { run, ran } = scripted({ setOption: false, canSet: false });
        await ensureAppRole(run, []);
        expect(ran).toContain("SELECT pg_has_role(current_user, 'rebase_user', 'MEMBER') AS can_set");
        expect(ran).toContain("GRANT rebase_user TO CURRENT_USER");
        expect(ran.some((text) => /WITH SET/.test(text))).toBe(false);
    });

    it("asks SET, and grants WITH SET TRUE, INHERIT FALSE, from 16", async () => {
        const { run, ran } = scripted({ setOption: true, canSet: false });
        await ensureAppRole(run, []);
        expect(ran).toContain("SELECT pg_has_role(current_user, 'rebase_user', 'SET') AS can_set");
        expect(ran).toContain("GRANT rebase_user TO CURRENT_USER WITH SET TRUE, INHERIT FALSE");
    });

    it("grants nothing to a connection that may already switch", async () => {
        const { run, ran } = scripted({ setOption: true, canSet: true });
        await ensureAppRole(run, []);
        expect(ran.some((text) => text.startsWith("GRANT rebase_user"))).toBe(false);
    });

    it("asks nothing of a superuser, and still proves the switch", async () => {
        const { run, ran } = scripted({ superuser: true, setOption: true, canSet: false });
        await ensureAppRole(run, []);
        expect(ran.some((text) => text.startsWith("SELECT pg_has_role"))).toBe(false);
        expect(ran.some((text) => text.includes("current_setting('role')"))).toBe(true);
    });

    it("fails the boot when the catalogue says yes and the switch says no", async () => {
        const { run, ran } = scripted({
            setOption: true,
            canSet: true,
            probe: pgError("permission denied to set role \"rebase_user\"", "42501")
        });
        const error = await ensureAppRole(run, ["public"]).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(AppRoleSetupError);
        expect((error as Error).message).toContain(`"app" cannot switch to "rebase_user", so every authenticated request would fail`);
        expect((error as Error).message).toContain("permission denied to set role");
        // Nothing granted on the strength of a switch that does not work.
        expect(ran.some((text) => text.startsWith("GRANT USAGE"))).toBe(false);
    });
});

describe("appRoleSetupInstructions", () => {
    const text = appRoleSetupInstructions("gen_user", ["public", "rebase"]);

    it("grants the switch in one statement that picks its syntax by server version", () => {
        expect(text).toContain("IF current_setting('server_version_num')::int >= 160000 THEN");
        expect(text).toContain("EXECUTE format('GRANT %I TO %I WITH SET TRUE, INHERIT FALSE', 'rebase_user', 'gen_user');");
        expect(text).toContain("EXECUTE format('GRANT %I TO %I', 'rebase_user', 'gen_user');");
    });

    it("can be re-run on a cluster that already has the role", () => {
        expect(text).toContain("IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rebase_user') THEN");
        expect(text).not.toMatch(/^CREATE ROLE/m);
    });

    it("quotes a role name as a literal, not into the statement", () => {
        expect(appRoleSetupInstructions("o'brien", [])).toContain("'rebase_user', 'o''brien'");
    });

    it("leaves a placeholder Postgres refuses when the connection role is unknown", () => {
        expect(appRoleSetupInstructions(undefined, [])).toContain("'<your database user>'");
    });

    it("runs on Postgres 16+ as written", async () => {
        const pg = new PGlite();
        try {
            await pg.waitReady;
            await pg.exec("CREATE ROLE gen_user NOLOGIN; CREATE SCHEMA rebase;");
            await pg.exec(text.slice(text.indexOf("DO $rebase_role$")));
            const { rows } = await pg.query("SELECT pg_has_role('gen_user', 'rebase_user', 'SET') AS can_set");
            expect(rows).toEqual([{ can_set: true }]);
            // And again: every statement in it is safe to repeat.
            await pg.exec(text.slice(text.indexOf("DO $rebase_role$")));
        } finally {
            await pg.close();
        }
    });
});
