/**
 * `rebase verify`'s recursion finding says what Postgres does.
 *
 * Since 0.25 the compiler writes `rebase.uid()` as `(SELECT rebase.uid())`
 * and the admin policies as sub-selects, so a rule that reads its own table —
 * the membership pattern: "a team's managers may change its members" — makes
 * Postgres refuse every write it guards with 42P17, "infinite recursion
 * detected in policy for relation". A real project found it on its first
 * write after upgrading, while `verify` said nothing.
 *
 * Each case here is a project on disk, provisioned into Postgres (PGlite) the
 * way the boot provisions it — the helper functions, the tables, the request
 * role, the compiled policies with their admin companions — and then written
 * to as a signed-in user and as an admin request, beside `runVerify` on the
 * same files:
 *
 * - the self-reading rule: the write fails with 42P17, and verify fails it;
 * - the same rule reading through a SECURITY DEFINER function: the write
 *   succeeds, and verify is quiet;
 * - a rule reading another table whose rules do not read back: the write
 *   succeeds, and verify is quiet.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
    adminRequestRoleFor,
    col,
    defineTable,
    REBASE_ADMIN_REQUEST_ROLE,
    REBASE_ADMIN_ROLE,
    type AnyTableDef
} from "@rebasepro/types";
import { ensureAppRole, REBASE_USER_ROLE } from "@rebasepro/server-postgres";
import { RLS_BOOTSTRAP_SQL } from "../../../server-postgres/src/schema/rls-bootstrap-sql";
import { ensureTables } from "../../../server-postgres/src/schema/ensure-tables";
import { ensureTablePolicies } from "../../../server-postgres/src/schema/ensure-policies";

import { runVerify, type VerifyFinding } from "./verify";
import { loadProjectSchema } from "../utils/project-schema";
import { scaffoldProject, workspaceModuleAliases, writeTableModules } from "../../test/helpers/project";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const ALIASES = workspaceModuleAliases();
const ADMIN_REQUEST_ROLE = adminRequestRoleFor(REBASE_USER_ROLE);

const OWNER = "11111111-1111-1111-1111-111111111111";
const TEAM = "22222222-2222-2222-2222-222222222222";

let root: string | undefined;
let db: PGlite | undefined;

afterEach(async () => {
    await db?.close();
    db = undefined;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
});

const teams = (readsMembers: string) => defineTable("teams", {
    schema: "rebase",
    columns: { id: col.uuid().primaryKey().defaultRandom(), ownerId: col.text().notNull() },
    rls: [
        { operation: "select", using: `teams.owner_id = rebase.uid() OR ${readsMembers}` },
        { operation: "insert", ownerField: "owner_id" }
    ]
});

const teamMembers = (manages: string, ownsTeam: string) => defineTable("team_members", {
    schema: "rebase",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        teamId: col.text().notNull(),
        userId: col.text().notNull(),
        role: col.text().notNull()
    },
    rls: [
        { operation: "select", ownerField: "user_id" },
        // The bootstrap (claim owner of a team you own) or a manager adding someone.
        { operation: "insert", withCheck: `(user_id = rebase.uid() AND role = 'owner' AND ${ownsTeam}) OR ${manages}` },
        { operations: ["update", "delete"], using: manages }
    ]
});

/** The project as the boot provisions it, with `functions` created before the policies call them. */
async function provision(tables: AnyTableDef[], functions: string[] = []): Promise<{ db: PGlite; findings: VerifyFinding[] }> {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-verify-recursion-"));
    scaffoldProject({ root, backendDependencies: false });
    const schemaDir = path.join(root, "backend", "schema");
    writeTableModules(schemaDir, tables);

    const report = await runVerify({ projectRoot: root, schemaDir, backendDir: null, live: false, moduleAliases: ALIASES });
    const { compiled } = await loadProjectSchema(root, schemaDir, ALIASES);

    const database = new PGlite();
    db = database;
    await database.exec(RLS_BOOTSTRAP_SQL);
    await ensureTables(database, compiled.tables);
    // A SQL function's body is checked when it is created, so after the tables it reads.
    for (const fn of functions) await database.exec(fn);
    await ensureAppRole(async (text) => (await database.query<Record<string, unknown>>(text)).rows, ["public", "rebase"]);
    // What a boot that made the admin switch live and the admin request group
    // safe leaves: admins run as a role inheriting the request role and both
    // admin roles.
    await database.exec(`
        CREATE ROLE ${REBASE_ADMIN_ROLE} NOLOGIN NOINHERIT;
        CREATE ROLE ${REBASE_ADMIN_REQUEST_ROLE} NOLOGIN NOINHERIT;
        CREATE ROLE ${ADMIN_REQUEST_ROLE} NOLOGIN NOINHERIT;
        GRANT ${REBASE_USER_ROLE}, ${REBASE_ADMIN_ROLE}, ${REBASE_ADMIN_REQUEST_ROLE} TO ${ADMIN_REQUEST_ROLE} WITH INHERIT TRUE, SET FALSE;
    `);
    const applied = await ensureTablePolicies(database, compiled.tables, undefined, { adminRequestRoleAvailable: true });
    expect(applied.failures).toEqual([]);
    return { db: database, findings: report.findings };
}

/**
 * Run `statement` as a caller, in a transaction that is always rolled back.
 * Resolves to "ok" or the SQLSTATE it failed with.
 */
async function asCaller(database: PGlite, caller: "user" | "admin", statement: string): Promise<string> {
    await database.exec("BEGIN");
    try {
        await database.query("SELECT set_config('app.uid', $1, true), set_config('app.user_roles', $2, true)",
            [OWNER, caller === "admin" ? "admin" : ""]);
        await database.exec(`SET LOCAL ROLE ${caller === "admin" ? ADMIN_REQUEST_ROLE : REBASE_USER_ROLE}`);
        await database.exec(statement);
        return "ok";
    } catch (error) {
        return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : String(error);
    } finally {
        await database.exec("ROLLBACK");
    }
}

/** A team the caller owns, written past RLS as the boot's connection would. */
async function seedTeam(database: PGlite): Promise<void> {
    await database.query("INSERT INTO rebase.teams (id, owner_id) VALUES ($1, $2)", [TEAM, OWNER]);
}

const CLAIM_OWNERSHIP = `INSERT INTO rebase.team_members (team_id, user_id, role) VALUES ('${TEAM}', '${OWNER}', 'owner') RETURNING id`;
const recursions = (findings: VerifyFinding[]) => findings.filter(f => f.check === "rls-policy-recursion");

describe("rebase verify and Postgres agree on policy recursion (42P17)", () => {
    it("a rule that reads its own table: every write fails with 42P17, for users and admins, and verify fails it", async () => {
        const manages = "EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = team_members.team_id " +
            "AND tm.user_id = rebase.uid() AND tm.role IN ('owner', 'admin'))";
        const ownsTeam = "EXISTS (SELECT 1 FROM rebase.teams t WHERE t.id::text = team_members.team_id AND t.owner_id = rebase.uid())";
        const readsMembers = "EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = teams.id::text AND tm.user_id = rebase.uid())";
        const { db: database, findings } = await provision([teams(readsMembers), teamMembers(manages, ownsTeam)]);
        await seedTeam(database);

        expect(await asCaller(database, "user", CLAIM_OWNERSHIP)).toBe("42P17");
        expect(await asCaller(database, "admin", CLAIM_OWNERSHIP)).toBe("42P17");
        expect(await asCaller(database, "user", "UPDATE rebase.team_members SET role = 'admin'")).toBe("42P17");
        expect(await asCaller(database, "admin", "DELETE FROM rebase.team_members")).toBe("42P17");
        // Reads still work, as they did in the project that found it.
        expect(await asCaller(database, "user", "SELECT * FROM rebase.teams")).toBe("ok");
        expect(await asCaller(database, "user", "SELECT * FROM rebase.team_members")).toBe("ok");

        const found = recursions(findings);
        expect(found.map(f => [f.path, f.severity])).toEqual([
            ["team_members.rls[1]", "error"],
            ["team_members.rls[2]", "error"],
            ["team_members.rls[2]", "error"]
        ]);
        // The insert rule loops twice: through its own table, and through teams.
        expect(found[0].message).toContain("reads its own table, rebase.team_members, in a sub-select");
        expect(found[0].message).toContain("it also reads rebase.teams in a sub-select");
        expect(found[0].message).toContain("every insert into rebase.team_members");
        expect(found[1].message).toContain("every update of rebase.team_members");
        expect(found[2].message).toContain("every delete from rebase.team_members");
        expect(found.every(f => f.fix?.includes("SECURITY DEFINER"))).toBe(true);
        // teams' own rules read team_members, which reads nothing back.
        expect(found.filter(f => f.table === "teams")).toEqual([]);
    });

    it("the same rules reading through SECURITY DEFINER functions: every write succeeds, and verify is quiet", async () => {
        const functions = [
            `CREATE FUNCTION public.is_team_manager(team text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
                SELECT EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = team AND tm.user_id = rebase.uid() AND tm.role IN ('owner', 'admin'))
            $$`,
            `CREATE FUNCTION public.owns_team(team text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
                SELECT EXISTS (SELECT 1 FROM rebase.teams t WHERE t.id::text = team AND t.owner_id = rebase.uid())
            $$`,
            `CREATE FUNCTION public.is_team_member(team uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
                SELECT EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = team::text AND tm.user_id = rebase.uid())
            $$`
        ];
        const { db: database, findings } = await provision([
            teams("public.is_team_member(teams.id)"),
            teamMembers("public.is_team_manager(team_members.team_id)", "public.owns_team(team_members.team_id)")
        ], functions);
        await seedTeam(database);

        expect(await asCaller(database, "user", CLAIM_OWNERSHIP)).toBe("ok");
        expect(await asCaller(database, "admin", CLAIM_OWNERSHIP)).toBe("ok");
        await database.query("INSERT INTO rebase.team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [TEAM, OWNER]);
        expect(await asCaller(database, "user", "UPDATE rebase.team_members SET role = 'owner'")).toBe("ok");
        expect(await asCaller(database, "admin", "DELETE FROM rebase.team_members")).toBe("ok");

        expect(findings).toEqual([]);
    });

    it("a read rule with no sub-select: users' writes pass and admins' fail, and verify says it is admin requests", async () => {
        // `access: "public"` compiles to `USING (true)`: for a user, reading the
        // table back walks into nothing. An admin request also gets the admin
        // baseline, which is a sub-select, so the loop closes for admins alone.
        const groups = defineTable("groups", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), parentId: col.uuid(), ownerId: col.text().notNull() },
            rls: [
                { operation: "select", access: "public" },
                { operation: "update", using: "EXISTS (SELECT 1 FROM public.groups g WHERE g.id = groups.parent_id AND g.owner_id = rebase.uid())" }
            ]
        });
        const { db: database, findings } = await provision([groups]);
        await database.query("INSERT INTO public.groups (id, owner_id) VALUES ($1, $2)", [TEAM, OWNER]);

        const update = "UPDATE public.groups SET owner_id = owner_id";
        expect(await asCaller(database, "user", update)).toBe("ok");
        expect(await asCaller(database, "admin", update)).toBe("42P17");

        expect(recursions(findings)).toEqual([expect.objectContaining({ path: "groups.rls[1]", severity: "error" })]);
        expect(recursions(findings)[0].message).toContain("for admin requests");
    });

    it("a rule that reads a different table whose rules do not read back: the write succeeds, and verify is quiet", async () => {
        const projects = defineTable("projects", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), ownerId: col.text().notNull() },
            rls: [{ operation: "all", ownerField: "owner_id" }]
        });
        const notes = defineTable("notes", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), projectId: col.uuid().notNull(), userId: col.text().notNull() },
            rls: [
                { operation: "select", ownerField: "user_id" },
                { operation: "insert", withCheck: "EXISTS (SELECT 1 FROM public.projects p WHERE p.id = notes.project_id AND p.owner_id = rebase.uid())" }
            ]
        });
        const { db: database, findings } = await provision([projects, notes]);
        await database.query("INSERT INTO public.projects (id, owner_id) VALUES ($1, $2)", [TEAM, OWNER]);

        const insert = `INSERT INTO public.notes (project_id, user_id) VALUES ('${TEAM}', '${OWNER}') RETURNING id`;
        expect(await asCaller(database, "user", insert)).toBe("ok");
        expect(await asCaller(database, "admin", insert)).toBe("ok");

        expect(findings).toEqual([]);
    });
});
