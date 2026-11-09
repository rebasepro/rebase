/**
 * The `rls` escape hatches (docs/design/rebase-user-on-existing-databases.md):
 * every choice about the request role is a setting whose default is what
 * Rebase did before, and each non-default does what it says on a real
 * Postgres (PGlite).
 */
import { PGlite } from "@electric-sql/pglite";
import { compileRulePolicies, getEffectiveSecurityRules, revokeInternalTableSql } from "@rebasepro/common";
import { resetDeclaredResources, database, type CollectionConfig } from "@rebasepro/types";
import {
    assertRecordedRequestRoles,
    authContextStatement,
    ensureAppRole,
    settleAdminRequestRoles,
    settleAdminSwitch,
    findOtherRoleMembers,
    readRecordedRequestRoles,
    recordRequestRoles,
    roleHoldsTableGrants
} from "../src/security/rls-enforcement";
import { resolveRlsSettings, rlsConfigFromEnv } from "../src/security/rls-settings";
import { migrateRequestRoles } from "../src/security/request-role-migration";
import { preflightDatabase } from "../src/security/database-preflight";
import { REQUEST_ROLE_FUNCTION_SQL, RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { ensureCollectionPolicies } from "../src/schema/ensure-collection-policies";

const run = (pg: PGlite) => async (text: string) => (await pg.query<Record<string, unknown>>(text)).rows;

const privileged = async (pg: PGlite, role: string, table: string, privilege = "SELECT"): Promise<boolean> => {
    const { rows } = await pg.query<{ ok: boolean }>(`SELECT has_table_privilege('${role}', '${table}', '${privilege}') AS ok`);
    return rows[0].ok;
};

/** `app` owns its tables and connects; nothing else is set up. */
async function appDatabase(): Promise<PGlite> {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
        CREATE ROLE app NOLOGIN CREATEROLE;
        ALTER SCHEMA public OWNER TO app;
        DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO app', current_database()); END $$;
        SET ROLE app;
        CREATE TABLE public.posts (id serial PRIMARY KEY, title text);
        CREATE TABLE public.notes (id int);
    `);
    return pg;
}

describe("resolveRlsSettings", () => {
    it("defaults to exactly what Rebase did before", () => {
        const settings = resolveRlsSettings(undefined);
        expect(settings.roles).toEqual(["rebase_user"]);
        expect(settings).toMatchObject({
            provisionRole: "auto", grants: "schema", policyTarget: "public",
            defaultPolicies: true, inheritRoles: [], sharedRole: "warn", nonDefaults: []
        });
        expect(settings.request.roleFor({ uid: "u1", roles: [] })).toBe("rebase_user");
        expect(settings.request.settingsFor({ uid: "u1", roles: [] }, "rebase_user")).toEqual([]);
    });

    it("splits anonymous callers from signed-in ones, guests and the service identity included", () => {
        const { request, roles } = resolveRlsSettings({ requestRole: { anonymous: "anon", signedIn: "authenticated" } });
        expect(roles).toEqual(["authenticated", "anon"]);
        expect(request.roleFor({ uid: "anon", roles: [] })).toBe("anon");
        expect(request.roleFor({ uid: "anonymous", roles: [] })).toBe("anon");
        expect(request.roleFor({ uid: "", roles: [] })).toBe("anon");
        expect(request.roleFor({ uid: "u1", roles: [], isAnonymous: true })).toBe("authenticated");
        expect(request.roleFor({ uid: "service", roles: ["admin"] })).toBe("authenticated");
    });

    it("grants inheritRoles only to the signed-in role of a pair, never to the anonymous one", () => {
        // `GRANT authenticated TO anon WITH INHERIT TRUE` would hand every
        // caller with no session the signed-in policies.
        const pair = resolveRlsSettings({ requestRole: { anonymous: "anon", signedIn: "authenticated_req" }, inheritRoles: ["authenticated"] });
        expect(pair.inheritTo).toEqual(["authenticated_req"]);
        expect(resolveRlsSettings({ requestRole: "acme_user", inheritRoles: ["authenticated"] }).inheritTo).toEqual(["acme_user"]);
        expect(() => resolveRlsSettings({ requestRole: () => "a_role", requestRoles: ["a_role"], inheritRoles: ["authenticated"] }))
            .toThrow(/cannot be combined with a function-valued/);
    });

    it("refuses a function-valued role without the list of what it can return, and a request outside it", () => {
        expect(() => resolveRlsSettings({ requestRole: () => "x" })).toThrow(/requestRoles must list/);
        const { request } = resolveRlsSettings({ requestRole: (auth) => auth.uid === "u1" ? "a_role" : "b_role", requestRoles: ["a_role"] });
        expect(request.roleFor({ uid: "u1", roles: [] })).toBe("a_role");
        expect(() => request.roleFor({ uid: "u2", roles: [] })).toThrow(/not in rls.requestRoles/);
    });

    it("refuses a role name that would need quoting", () => {
        expect(() => resolveRlsSettings({ requestRole: "Acme User" })).toThrow(/not a usable role name/);
        expect(() => resolveRlsSettings({ requestRole: "x\"; DROP ROLE app; --" })).toThrow(/not a usable role name/);
    });

    it("takes the environment over the code, and refuses a mistyped value at boot", () => {
        const env: Record<string, string> = { REBASE_RLS_REQUEST_ROLE: "acme_user", REBASE_RLS_GRANTS: "managed" };
        const merged = rlsConfigFromEnv({ requestRole: "other_user", sharedRole: "refuse" }, (name) => env[name]);
        expect(merged).toEqual({ requestRole: "acme_user", grants: "managed", sharedRole: "refuse" });
        expect(resolveRlsSettings(merged).nonDefaults).toEqual(["requestRole=acme_user", "grants=managed", "sharedRole=refuse"]);
        expect(() => rlsConfigFromEnv(undefined, (name) => name === "REBASE_RLS_GRANTS" ? "everything" : undefined))
            .toThrow(/REBASE_RLS_GRANTS: "everything" is not one of/);
    });
});

describe("a request's identity", () => {
    it("runs as the role its caller maps to, with the role switch last", () => {
        const { request } = resolveRlsSettings({ requestRole: { anonymous: "anon", signedIn: "authenticated" } });
        const anon = authContextStatement({ uid: "anon", roles: [] }, request);
        expect(anon.values.at(-1)).toBe("anon");
        expect(anon.text).toMatch(/set_config\('role', \$\d+, true\)$/);
        expect(authContextStatement({ uid: "u1", roles: [] }, request).values.at(-1)).toBe("authenticated");
    });

    it("carries Supabase's request settings when asked, so auth.uid() sees the caller", () => {
        const { request } = resolveRlsSettings({ identity: "supabase" });
        const setting = (statement: { text: string; values: string[] }, name: string): string | undefined => {
            const names = [...statement.text.matchAll(/set_config\('([^']+)'/g)].map((m) => m[1]);
            return statement.values[names.indexOf(name)];
        };
        const signedIn = authContextStatement({ uid: "u1", roles: ["editor"] }, request);
        expect(setting(signedIn, "request.jwt.claim.sub")).toBe("u1");
        expect(JSON.parse(setting(signedIn, "request.jwt.claims") ?? "{}")).toMatchObject({ sub: "u1", role: "rebase_user" });
        // A caller with no session has no subject, as Supabase's anon has none.
        expect(setting(authContextStatement({ uid: "anon", roles: [] }, request), "request.jwt.claim.sub")).toBe("");
    });
});

describe("provisioning a role of the project's own", () => {
    let pg: PGlite;
    beforeEach(async () => { pg = await appDatabase(); });
    afterEach(async () => { await pg.close(); });

    it("creates it, lets the connection switch to it, and grants it as before", async () => {
        await ensureAppRole(run(pg), ["public"], { role: "acme_user" });
        expect(await privileged(pg, "acme_user", "public.posts", "SELECT, INSERT, UPDATE, DELETE")).toBe(true);
        expect(await privileged(pg, "acme_user", "public.notes")).toBe(true);
    });

    it("grants only the tables Rebase serves with grants: \"managed\"", async () => {
        await ensureAppRole(run(pg), ["public"], {
            role: "acme_user", grants: "managed", managedTables: [{ schema: "public", table: "posts" }]
        });
        expect(await privileged(pg, "acme_user", "public.posts")).toBe(true);
        expect(await privileged(pg, "acme_user", "public.notes")).toBe(false);
        const { rows } = await pg.query<{ ok: boolean }>("SELECT has_sequence_privilege('acme_user', 'public.posts_id_seq', 'USAGE') AS ok");
        expect(rows[0].ok).toBe(true);
        const { rows: defaults } = await pg.query("SELECT 1 FROM pg_default_acl");
        expect(defaults).toHaveLength(0);
    });

    it("grants nothing with grants: \"none\"", async () => {
        await ensureAppRole(run(pg), ["public"], { role: "acme_user", grants: "none" });
        expect(await privileged(pg, "acme_user", "public.posts")).toBe(false);
    });

    it("creates nothing with provisionRole: \"never\", and says what to run", async () => {
        await expect(ensureAppRole(run(pg), ["public"], { role: "acme_user", provisionRole: "never" }))
            .rejects.toThrow(/does not exist, and rls.provisionRole is "never"[\s\S]*CREATE ROLE acme_user/);
        const { rows } = await pg.query("SELECT 1 FROM pg_roles WHERE rolname = 'acme_user'");
        expect(rows).toHaveLength(0);
    });

    it("takes framework tables back from the recorded role, not only from rebase_user", async () => {
        await pg.exec("CREATE SCHEMA rebase; CREATE TABLE rebase.api_keys (id text);");
        await recordRequestRoles(run(pg), ["acme_user"]);
        await ensureAppRole(run(pg), ["public", "rebase"], { role: "acme_user" });
        await pg.exec("GRANT SELECT ON rebase.api_keys TO acme_user");
        await pg.exec(revokeInternalTableSql("rebase", "api_keys"));
        expect(await privileged(pg, "acme_user", "rebase.api_keys")).toBe(false);
        expect(await readRecordedRequestRoles(run(pg))).toEqual(["acme_user"]);
    });
});

describe("the recorded request roles", () => {
    it("let a fresh database take a new role, and refuse a switch that would strand the old one's grants", async () => {
        const pg = await appDatabase();
        try {
            expect(() => assertRecordedRequestRoles(["acme_user"], undefined, false)).not.toThrow();
            await ensureAppRole(run(pg), ["public"]);
            const holds = await roleHoldsTableGrants(run(pg), ["public"]);
            expect(holds).toBe(true);
            expect(() => assertRecordedRequestRoles(["acme_user"], undefined, holds))
                .toThrow(/rebase db request-role migrate --to acme_user/);
            expect(() => assertRecordedRequestRoles(["b", "a"], ["a", "b"], true)).not.toThrow();
        } finally {
            await pg.close();
        }
    });
});

describe("another login on the role", () => {
    it("is named, so two projects sharing a role show up from either database", async () => {
        const pg = await appDatabase();
        try {
            await ensureAppRole(run(pg), ["public"]);
            await pg.exec("RESET ROLE; CREATE ROLE other_project LOGIN; GRANT rebase_user TO other_project; SET ROLE app;");
            expect(await findOtherRoleMembers(run(pg), "rebase_user")).toEqual(["other_project"]);
        } finally {
            await pg.close();
        }
    });
});

describe("rebase db request-role migrate", () => {
    it("gives the new role every grant and policy the old one held here, records it, and leaves the old one", async () => {
        const pg = await appDatabase();
        try {
            await ensureAppRole(run(pg), ["public"]);
            await pg.exec(`
                ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
                CREATE POLICY posts_mine ON public.posts FOR SELECT TO rebase_user USING (true);
                CREATE FUNCTION public.hello() RETURNS int LANGUAGE sql AS 'SELECT 1';
                REVOKE ALL ON FUNCTION public.hello() FROM PUBLIC;
                GRANT EXECUTE ON FUNCTION public.hello() TO rebase_user;
            `);
            const plan = await migrateRequestRoles(run(pg), { from: ["rebase_user"], to: ["acme_user"], schemas: ["public"] });
            expect(await privileged(pg, "acme_user", "public.posts", "SELECT, INSERT, UPDATE, DELETE")).toBe(true);
            const { rows: fn } = await pg.query<{ ok: boolean }>("SELECT has_function_privilege('acme_user', 'public.hello()', 'EXECUTE') AS ok");
            expect(fn[0].ok).toBe(true);
            const { rows: policy } = await pg.query<{ roles: string[] }>("SELECT roles::text[] AS roles FROM pg_policies WHERE policyname = 'posts_mine'");
            expect(policy[0].roles).toEqual(["acme_user"]);
            expect(await readRecordedRequestRoles(run(pg))).toEqual(["acme_user"]);
            // The old role keeps what it had: another database may still use it.
            expect(await privileged(pg, "rebase_user", "public.posts")).toBe(true);
            expect(plan.revokeOld).toContain("REVOKE SELECT ON TABLE \"public\".\"posts\" FROM \"rebase_user\"");
        } finally {
            await pg.close();
        }
    });
});

describe("inheritRoles", () => {
    it("makes a policy written TO another role apply to requests", async () => {
        const pg = await appDatabase();
        try {
            await pg.exec(`
                RESET ROLE;
                CREATE ROLE authenticated NOLOGIN;
                GRANT authenticated TO app WITH ADMIN OPTION;
                SET ROLE app;
                ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
                INSERT INTO public.notes VALUES (1);
                CREATE POLICY notes_signed_in ON public.notes FOR SELECT TO authenticated USING (true);
            `);
            await ensureAppRole(run(pg), ["public"], { inheritRoles: ["authenticated"] });
            const { rows } = await pg.query<{ usage: boolean }>("SELECT pg_has_role('rebase_user', 'authenticated', 'USAGE') AS usage");
            expect(rows[0].usage).toBe(true);
            await pg.exec("RESET ROLE; SET ROLE rebase_user;");
            const { rows: seen } = await pg.query("SELECT * FROM public.notes");
            expect(seen).toHaveLength(1);
        } finally {
            await pg.close();
        }
    });

    it("refuses a role that does not exist", async () => {
        const pg = await appDatabase();
        try {
            await expect(ensureAppRole(run(pg), ["public"], { inheritRoles: ["authenticated"] }))
                .rejects.toThrow(/"authenticated", which does not exist/);
        } finally {
            await pg.close();
        }
    });
});

describe("the policy settings, declared on the database", () => {
    afterEach(() => resetDeclaredResources());

    const posts = {
        name: "Posts", slug: "posts", table: "posts",
        properties: { id: { name: "ID", type: "string", isId: true } },
        securityRules: [{ operation: "select", access: "public" }]
    } as unknown as CollectionConfig;

    it("compile exactly as before when nothing is declared", () => {
        const [select] = compileRulePolicies(posts, { operation: "select", access: "public" });
        expect(select.using).not.toContain("is_request_role");
        expect(getEffectiveSecurityRules(posts).some((r) => r.name?.endsWith("_default_admin_read"))).toBe(true);
    });

    it("narrow permissive policies to the request roles, and leave restrictive ones for everyone", () => {
        database({ rls: { policyTarget: "requestRole" } });
        const [permissive] = compileRulePolicies(posts, { operation: "select", access: "public" });
        expect(permissive.using).toMatch(/\) AND \(SELECT rebase\.is_request_role\(current_user::text\)\)$/);
        const [restrictive] = compileRulePolicies(posts, { operation: "select", mode: "restrictive", access: "public" });
        expect(restrictive.using).not.toContain("is_request_role");
    });

    it("keep the policy's name, which hashes the rule", () => {
        const before = compileRulePolicies(posts, { operation: "select", access: "public" })[0].name;
        database({ rls: { policyTarget: "requestRole" } });
        expect(compileRulePolicies(posts, { operation: "select", access: "public" })[0].name).toBe(before);
    });

    it("drop the injected baseline everywhere with defaultPolicies: false, unless a collection says otherwise", () => {
        database({ rls: { defaultPolicies: false } });
        expect(getEffectiveSecurityRules(posts).some((r) => r.name?.endsWith("_default_admin_read"))).toBe(false);
        const keeps = { ...posts, disableDefaultPolicies: false } as CollectionConfig;
        expect(getEffectiveSecurityRules(keeps).some((r) => r.name?.endsWith("_default_admin_read"))).toBe(true);
    });

    it("let only the request roles pass a narrowed policy on a real table", async () => {
        const pg = await appDatabase();
        try {
            await pg.exec("RESET ROLE; CREATE ROLE other_app NOLOGIN; SET ROLE app;");
            await ensureAppRole(run(pg), ["public"]);
            await recordRequestRoles(run(pg), ["rebase_user"]);
            await pg.exec(REQUEST_ROLE_FUNCTION_SQL);
            database({ rls: { policyTarget: "requestRole" } });
            const [policy] = compileRulePolicies(posts, { operation: "select", access: "public" });
            await pg.exec(`
                ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
                INSERT INTO public.posts (title) VALUES ('a');
                CREATE POLICY p ON public.posts FOR SELECT USING (${policy.using});
                GRANT SELECT ON public.posts TO other_app;
            `);
            await pg.exec("RESET ROLE; SET ROLE other_app;");
            expect((await pg.query("SELECT * FROM public.posts")).rows).toHaveLength(0);
            await pg.exec("RESET ROLE; SET ROLE rebase_user;");
            expect((await pg.query("SELECT * FROM public.posts")).rows).toHaveLength(1);
        } finally {
            await pg.close();
        }
    });
});

describe("the server-or-admin policies (rls.adminPolicies)", () => {
    afterEach(() => resetDeclaredResources());

    const tasks: CollectionConfig = {
        name: "Tasks", slug: "tasks", table: "tasks",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            ownerId: { name: "Owner", type: "string", columnName: "owner_id" }
        },
        securityRules: [{ name: "owner_select", operation: "select", ownerField: "ownerId" }]
    };
    const rolesOf = (rule: Parameters<typeof compileRulePolicies>[1]) =>
        compileRulePolicies(tasks, rule, { adminRole: true }).map((p) => p.roles);

    it("write a grant only the server context or an admin can pass TO rebase_admin, and nothing else", () => {
        const baseline = getEffectiveSecurityRules(tasks).filter((r) => r.name?.startsWith("tasks_default_admin"));
        expect(baseline.flatMap((rule) => rolesOf(rule))).toEqual(Array(4).fill(["rebase_admin"]));
        expect(rolesOf({ operations: ["select", "update"], roles: ["admin"] })).toEqual([["rebase_admin"], ["rebase_admin"]]);
        expect(rolesOf({ operation: "select", ownerField: "ownerId", roles: ["admin"] })).toEqual([["rebase_admin"]]);
        // Anyone else could pass these, so a user's plan must still carry them.
        expect(rolesOf({ operation: "select", roles: ["admin", "editor"] })).toEqual([["public"]]);
        expect(rolesOf({ operation: "select", ownerField: "ownerId" })).toEqual([["public"]]);
        // Raw SQL counts when it parses back to the same admin test, not otherwise.
        expect(rolesOf({ operation: "select", using: "string_to_array(rebase.roles(), ',') && ARRAY['admin']" })).toEqual([["rebase_admin"]]);
        expect(rolesOf({ operation: "select", using: "(rebase.jwt() ->> 'tier') = 'gold'" })).toEqual([["public"]]);
        // A rule's own TO list, and a restriction, which only narrowing could widen.
        expect(rolesOf({ operation: "select", roles: ["admin"], pgRoles: ["authenticated"] })).toEqual([["authenticated"]]);
        expect(rolesOf({ operation: "select", mode: "restrictive", roles: ["admin"], access: "public" })).toEqual([["public"]]);
    });

    it("stay TO public for a caller that does not switch admins — an older driver under a newer runtime", () => {
        // The managed runtime supplies @rebasepro/common to bundles that vendor
        // an older driver; that driver never runs admins as `<role>_admin`.
        expect(compileRulePolicies(tasks, { operation: "select", roles: ["admin"] })[0].roles).toEqual(["public"]);
    });

    it("keep the policy's name, and go back TO public with adminPolicies: \"public\"", () => {
        const before = compileRulePolicies(tasks, { operation: "select", roles: ["admin"] }, { adminRole: true })[0];
        database({ rls: { adminPolicies: "public" } });
        const after = compileRulePolicies(tasks, { operation: "select", roles: ["admin"] }, { adminRole: true })[0];
        expect(after.name).toBe(before.name);
        expect(after.roles).toEqual(["public"]);
        expect(after.adminTarget).toBeUndefined();
    });

    it("give each request role an admin counterpart, but never the anonymous one of a pair", () => {
        expect([...resolveRlsSettings(undefined).adminRoles]).toEqual([["rebase_user", "rebase_user_admin"]]);
        expect([...resolveRlsSettings({ requestRole: { anonymous: "anon", signedIn: "authenticated" } }).adminRoles])
            .toEqual([["authenticated", "authenticated_admin"]]);
        expect(resolveRlsSettings({ adminPolicies: "public" }).adminRoles.size).toBe(0);
        expect(resolveRlsSettings({ adminPolicies: "public" }).nonDefaults).toEqual(["adminPolicies=public"]);
        expect(rlsConfigFromEnv(undefined, (name) => name === "REBASE_RLS_ADMIN_POLICIES" ? "public" : undefined))
            .toEqual({ adminPolicies: "public" });
        expect(() => resolveRlsSettings({ requestRole: "r".repeat(60) })).toThrow(/at most 57 bytes/);
    });

    it("switch a caller holding admin to the admin role, decided as the policies split app.user_roles", () => {
        const plain = resolveRlsSettings({ identity: "supabase" }).request;
        const request = { ...plain, adminRoleFor: (role: string) => `${role}_admin` };
        const role = (roles: string[]) => authContextStatement({ uid: "u1", roles }, request).values.at(-1);
        expect(role(["admin"])).toBe("rebase_user_admin");
        expect(role(["editor", "admin"])).toBe("rebase_user_admin");
        // One string with a comma in it: Postgres splits it, so this caller IS an admin to the policies.
        expect(role(["x,admin"])).toBe("rebase_user_admin");
        expect(role(["administrator"])).toBe("rebase_user");
        expect(role([])).toBe("rebase_user");
        // Until the boot has the admin roles ready, nobody switches.
        expect(authContextStatement({ uid: "u1", roles: ["admin"] }, plain).values.at(-1)).toBe("rebase_user");
        // The identity is still the request role's: the switch changes policies, not who asks.
        const statement = authContextStatement({ uid: "u1", roles: ["admin"] }, request);
        const names = [...statement.text.matchAll(/set_config\('([^']+)'/g)].map((m) => m[1]);
        expect(statement.values[names.indexOf("request.jwt.claim.role")]).toBe("rebase_user");
    });

    it("let admins, and only admins, through a policy written TO rebase_admin on a real table", async () => {
        const pg = await appDatabase();
        try {
            const settings = resolveRlsSettings(undefined);
            await ensureAppRole(run(pg), ["public"]);
            const { request, adminPoliciesLive } = await settleAdminSwitch(run(pg), ["public"], settings, { provision: true });
            expect(request.adminRoleFor?.("rebase_user")).toBe("rebase_user_admin");
            expect(adminPoliciesLive).toBe(true);
            for (const statement of RLS_BOOTSTRAP_STATEMENTS) await pg.exec(statement);
            await pg.exec("GRANT USAGE ON SCHEMA rebase TO rebase_user;");
            await pg.exec(`
                CREATE TABLE public.tasks (id serial PRIMARY KEY, owner_id text);
                INSERT INTO public.tasks (owner_id) VALUES ('ada'), ('bob');
                GRANT SELECT ON public.tasks TO rebase_user;
            `);
            const outcome = await ensureCollectionPolicies(
                { query: <T,>(text: string) => pg.query<T>(text) }, [tasks], undefined, { adminRoleAvailable: adminPoliciesLive }
            );
            expect(outcome.failures).toEqual([]);
            const { rows } = await pg.query<{ roles: string }>(
                "SELECT roles::text AS roles FROM pg_policies WHERE policyname = 'tasks_default_admin_read'"
            );
            expect(rows[0].roles).toBe("{rebase_admin}");
            const count = async (auth: { uid: string; roles: string[] }) => {
                const opening = authContextStatement(auth, request);
                await pg.query("BEGIN");
                try {
                    await pg.query(opening.text, opening.values);
                    return Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.tasks")).rows[0].n);
                } finally {
                    await pg.query("ROLLBACK");
                }
            };
            expect(await count({ uid: "ada", roles: ["user"] })).toBe(1);
            expect(await count({ uid: "service", roles: ["admin"] })).toBe(2);
        } finally {
            await pg.close();
        }
    });

    it("stay TO public, and keep admins on the request role, where rebase_admin cannot be made", async () => {
        // The platform pre-created the request role; the connection owns the
        // tables but may create no role — a Rebase Cloud tenant's shape.
        const pg = new PGlite();
        try {
            await pg.exec(`
                CREATE ROLE app NOLOGIN;
                CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
                GRANT rebase_user TO app;
                ALTER SCHEMA public OWNER TO app;
                DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO app', current_database()); END $$;
                SET ROLE app;
                CREATE SCHEMA rebase;
                CREATE FUNCTION rebase.uid() RETURNS text AS $f$ SELECT NULLIF(current_setting('app.uid', true), '') $f$ LANGUAGE sql STABLE;
                CREATE FUNCTION rebase.roles() RETURNS text AS $f$ SELECT COALESCE(current_setting('app.user_roles', true), '') $f$ LANGUAGE sql STABLE;
                CREATE TABLE public.tasks (id serial PRIMARY KEY, owner_id text);
            `);
            const request = await settleAdminRequestRoles(run(pg), ["public"], resolveRlsSettings(undefined), { provision: true });
            expect(request.adminRoleFor).toBeUndefined();
            const outcome = await ensureCollectionPolicies({ query: <T,>(text: string) => pg.query<T>(text) }, [tasks]);
            expect(outcome.failures).toEqual([]);
            const { rows } = await pg.query<{ roles: string }>(
                "SELECT roles::text AS roles FROM pg_policies WHERE policyname = 'tasks_default_admin_read'"
            );
            expect(rows[0].roles).toBe("{public}");
        } finally {
            await pg.close();
        }
    });

    /**
     * `rebase_admin` exists, but this server's admin switch cannot be set up:
     * the policies must follow the switch, not the role. Written TO
     * rebase_admin while admins still run as the request role, every admin
     * caller — `dataAsAdmin` among them — read an empty table.
     */
    describe("where rebase_admin exists but the admin switch cannot be set up", () => {
        const adminCount = async (setup: string) => {
            const pg = new PGlite();
            try {
                await pg.exec(setup);
                await pg.exec(`
                    SET ROLE app;
                    CREATE SCHEMA rebase;
                    GRANT USAGE ON SCHEMA rebase TO rebase_user;
                    CREATE FUNCTION rebase.uid() RETURNS text AS $f$ SELECT NULLIF(current_setting('app.uid', true), '') $f$ LANGUAGE sql STABLE;
                    CREATE FUNCTION rebase.roles() RETURNS text AS $f$ SELECT COALESCE(current_setting('app.user_roles', true), '') $f$ LANGUAGE sql STABLE;
                    CREATE TABLE public.tasks (id serial PRIMARY KEY, owner_id text);
                    INSERT INTO public.tasks (owner_id) VALUES ('ada'), ('bob');
                    GRANT SELECT ON public.tasks TO rebase_user;
                `);
                const { request, adminPoliciesLive } = await settleAdminSwitch(run(pg), ["public"], resolveRlsSettings(undefined), { provision: true });
                expect(request.adminRoleFor).toBeUndefined();
                expect(adminPoliciesLive).toBe(false);
                const outcome = await ensureCollectionPolicies(
                    { query: <T,>(text: string) => pg.query<T>(text) }, [tasks], undefined, { adminRoleAvailable: adminPoliciesLive }
                );
                expect(outcome.failures).toEqual([]);
                const { rows } = await pg.query<{ roles: string }>(
                    "SELECT DISTINCT roles::text AS roles FROM pg_policies WHERE policyname LIKE 'tasks_default_admin_%'"
                );
                const count = async (auth: { uid: string; roles: string[] }) => {
                    const opening = authContextStatement(auth, request);
                    await pg.query("BEGIN");
                    try {
                        await pg.query(opening.text, opening.values);
                        return Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.tasks")).rows[0].n);
                    } finally {
                        await pg.query("ROLLBACK");
                    }
                };
                return { roles: rows.map((r) => r.roles), user: await count({ uid: "ada", roles: ["user"] }), admin: await count({ uid: "service", roles: ["admin"] }) };
            } finally {
                await pg.close();
            }
        };

        it("writes the server-or-admin policies TO public when another project made rebase_admin", async () => {
            // Pre-created on the cluster; this connection may create no role.
            const outcome = await adminCount(`
                CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
                CREATE ROLE app NOLOGIN;
                CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
                GRANT rebase_user TO app;
                ALTER SCHEMA public OWNER TO app;
                DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO app', current_database()); END $$;
            `);
            expect(outcome).toEqual({ roles: ["{public}"], user: 1, admin: 2 });
        });

        it("writes them TO public when the connection made rebase_admin but cannot grant the request role (PG16 CREATEROLE)", async () => {
            // The documented DBA setup grants rebase_user with SET but no ADMIN
            // option, so a CREATEROLE connection makes rebase_admin and
            // rebase_user_admin, then cannot grant rebase_user to the latter.
            const outcome = await adminCount(`
                CREATE ROLE app NOLOGIN CREATEROLE;
                CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
                GRANT rebase_user TO app WITH SET TRUE, INHERIT FALSE;
                ALTER SCHEMA public OWNER TO app;
                DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO app', current_database()); END $$;
            `);
            expect(outcome).toEqual({ roles: ["{public}"], user: 1, admin: 2 });
        });
    });
});

describe("rebase doctor --database", () => {
    it("names what a shared database needs, with the setting that fits Rebase to it", async () => {
        const pg = await appDatabase();
        try {
            await ensureAppRole(run(pg), ["public"]);
            await pg.exec("RESET ROLE; CREATE ROLE analytics NOLOGIN; GRANT SELECT ON public.posts TO analytics; SET ROLE app;");
            const findings = await preflightDatabase(run(pg), resolveRlsSettings(undefined), {
                schemas: ["public"], managedTables: [{ schema: "public", table: "posts" }]
            });
            const byCheck = new Map(findings.map((f) => [f.check, f]));
            expect(byCheck.get("Request role \"rebase_user\"")?.level).toBe("ok");
            expect(byCheck.get("Who can connect")?.sql).toMatch(/REVOKE CONNECT ON DATABASE/);
            expect(byCheck.get("Tables Rebase does not serve")?.setting).toBe("rls.grants = \"managed\"");
            expect(byCheck.get("Other roles on Rebase's tables")?.detail).toContain("analytics");
            expect(byCheck.get("Other roles on Rebase's tables")?.setting).toBe("rls.policyTarget = \"requestRole\"");
        } finally {
            await pg.close();
        }
    });
});
