import { describe, expect, it } from "vitest";

import { findPolicyRecursion, readSubLinks, type RecursionPolicy, type RoleContext } from "./policy-recursion";

/** A policy as Rebase writes it: `TO public` unless it says otherwise. */
function policy(
    table: string,
    name: string,
    command: RecursionPolicy["command"],
    clauses: { using?: string; withCheck?: string; roles?: string[]; schema?: string }
): RecursionPolicy {
    return {
        schema: clauses.schema ?? "rebase",
        table,
        name,
        command,
        roles: clauses.roles ?? ["public"],
        using: clauses.using ?? null,
        withCheck: clauses.withCheck ?? null
    };
}

/** How the compiler writes `user_id = rebase.uid()` since 0.25. */
const OWN_ROWS = "(user_id = (SELECT rebase.uid()))";
/** How it wrote it before. */
const OWN_ROWS_021 = "(user_id = rebase.uid())";
const IS_MANAGER = "EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = team_members.team_id AND tm.user_id = rebase.uid() AND tm.role::text IN ('owner', 'admin'))";

const USER: RoleContext = { name: "rebase_user", roles: ["rebase_user"] };
const ADMIN: RoleContext = { name: "rebase_user_admin", roles: ["rebase_user_admin", "rebase_user", "rebase_admin", "rebase_admin_request"] };
const CONTEXTS = [USER, ADMIN];

/** The admin baseline a table gets: sub-selects, `TO rebase_admin`. */
const adminBaseline = (table: string): RecursionPolicy[] => [
    policy(table, `${table}_default_admin_read`, "SELECT", {
        roles: ["rebase_admin"],
        using: "(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))"
    }),
    policy(table, `${table}_default_admin_read_ar_5f45dbfb`, "SELECT", { roles: ["rebase_admin_request"], using: "true" })
];

describe("readSubLinks", () => {
    it("sees a sub-select that reads nothing — the caller check the compiler hoists", () => {
        expect(readSubLinks(OWN_ROWS)).toEqual({ hasSubLink: true, reads: [] });
        expect(readSubLinks(OWN_ROWS_021)).toEqual({ hasSubLink: false, reads: [] });
    });

    it("reads every FROM and JOIN item, qualified or bare, with or without an alias", () => {
        expect(readSubLinks(
            "EXISTS (SELECT 1 FROM rebase.team_members tm JOIN teams AS t ON t.id::text = tm.team_id, \"Projects\" p WHERE true)"
        ).reads).toEqual([
            { schema: "rebase", name: "team_members" },
            { schema: null, name: "teams" },
            { schema: null, name: "Projects" }
        ]);
    });

    it("reads Postgres's own deparse of a policy, as pg_policies returns it", () => {
        expect(readSubLinks(
            "(EXISTS ( SELECT 1\n   FROM team_members tm\n  WHERE ((tm.team_id = team_members.team_id) AND (tm.user_id = rebase.uid()))))"
        )).toEqual({ hasSubLink: true, reads: [{ schema: null, name: "team_members" }] });
    });

    it("reads a derived table's own FROM, and nothing from a function in FROM", () => {
        expect(readSubLinks("x IN (SELECT s.id FROM (SELECT id FROM public.notes) s, unnest(ARRAY[1]) u)").reads)
            .toEqual([{ schema: "public", name: "notes" }]);
    });

    it("is not fooled by FROM in a string, a comment, extract() or IS DISTINCT FROM", () => {
        const reads = readSubLinks(
            "EXISTS (SELECT 1 FROM public.a WHERE a.note <> 'see FROM public.b' " +
            "/* FROM public.c */ AND extract(year FROM a.created_at) > 2000 AND a.x IS DISTINCT FROM public.d)"
        ).reads;
        expect(reads).toEqual([{ schema: "public", name: "a" }]);
    });

    it("leaves out a CTE's name, and keeps the table its body reads", () => {
        expect(readSubLinks("EXISTS (WITH mine AS (SELECT team_id FROM rebase.team_members) SELECT 1 FROM mine)").reads)
            .toEqual([{ schema: "rebase", name: "team_members" }]);
    });

    it("finds no sub-select in a function call — the body is planned when it runs", () => {
        expect(readSubLinks("rebase.is_team_manager(team_id)")).toEqual({ hasSubLink: false, reads: [] });
    });
});

describe("findPolicyRecursion", () => {
    it("finds a write rule that reads its own table, since 0.25's (SELECT rebase.uid()) made the read rule a sub-select", () => {
        const found = findPolicyRecursion([
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS }),
            policy("team_members", "team_members_update", "UPDATE", { using: IS_MANAGER, withCheck: IS_MANAGER })
        ], { contexts: CONTEXTS });
        expect(found).toEqual([{
            schema: "rebase",
            table: "team_members",
            policy: "team_members_update",
            command: "UPDATE",
            reads: { schema: "rebase", table: "team_members" },
            path: [{ schema: "rebase", table: "team_members", policy: "team_members_update" }],
            contexts: ["rebase_user", "rebase_user_admin"],
            confidence: "certain",
            caveats: []
        }]);
    });

    it("stays quiet on the same rule when the read rule has no sub-select (0.21's shape, which worked)", () => {
        expect(findPolicyRecursion([
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS_021 }),
            policy("team_members", "team_members_update", "UPDATE", { using: IS_MANAGER, withCheck: IS_MANAGER })
        ], { contexts: CONTEXTS })).toEqual([]);
    });

    it("finds it for admin requests alone when only the admin baseline is a sub-select", () => {
        const found = findPolicyRecursion([
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS_021 }),
            ...adminBaseline("team_members"),
            policy("team_members", "team_members_delete", "DELETE", { using: IS_MANAGER })
        ], { contexts: CONTEXTS });
        expect(found.map(f => [f.policy, f.contexts])).toEqual([["team_members_delete", ["rebase_user_admin"]]]);
    });

    it("finds a cycle across two tables: the write rule reads teams, whose read rule reads team_members back", () => {
        const found = findPolicyRecursion([
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS }),
            policy("team_members", "team_members_insert", "INSERT", {
                withCheck: "EXISTS (SELECT 1 FROM rebase.teams t WHERE t.id::text = team_members.team_id AND t.owner_id = rebase.uid())"
            }),
            policy("teams", "teams_select", "SELECT", {
                using: "teams.owner_id = rebase.uid() OR EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = teams.id::text)"
            }),
            // teams' own writes read team_members, which reads nothing back: no loop.
            policy("teams", "teams_update", "UPDATE", {
                using: "EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = teams.id::text AND tm.role::text = 'owner')"
            })
        ], { contexts: CONTEXTS });
        expect(found.map(f => ({ policy: f.policy, reads: f.reads.table, path: f.path.map(s => `${s.table}/${s.policy}`) }))).toEqual([
            { policy: "team_members_insert", reads: "teams", path: ["team_members/team_members_insert", "teams/teams_select"] }
        ]);
    });

    it("stays quiet when the read moves into a SECURITY DEFINER function", () => {
        expect(findPolicyRecursion([
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS }),
            ...adminBaseline("team_members"),
            policy("team_members", "team_members_update", "UPDATE", {
                using: "rebase.is_team_manager(team_id)",
                withCheck: "rebase.is_team_manager(team_id)"
            })
        ], { contexts: CONTEXTS })).toEqual([]);
    });

    it("stays quiet on a rule that reads a different table whose policies do not read back", () => {
        expect(findPolicyRecursion([
            policy("projects", "projects_select", "SELECT", { using: "(owner_id = (SELECT rebase.uid()))" }),
            ...adminBaseline("projects"),
            policy("notes", "notes_select", "SELECT", { using: OWN_ROWS }),
            policy("notes", "notes_insert", "INSERT", {
                withCheck: "EXISTS (SELECT 1 FROM rebase.projects p WHERE p.id = notes.project_id AND p.owner_id = (SELECT rebase.uid()))"
            })
        ], { contexts: CONTEXTS })).toEqual([]);
    });

    it("finds a read rule that reads its own table — every read fails, whatever the compiler does", () => {
        const found = findPolicyRecursion([
            policy("profiles", "profiles_team_read", "SELECT", {
                schema: "public",
                using: "EXISTS (SELECT 1 FROM profiles mine WHERE mine.team_id = profiles.team_id AND mine.id = rebase.uid())"
            })
        ]);
        expect(found.map(f => [f.table, f.command, f.contexts, f.confidence])).toEqual([["profiles", "SELECT", ["PUBLIC"], "certain"]]);
    });

    it("reports a loop between two other tables from their own policies, not from every policy that reaches it", () => {
        const found = findPolicyRecursion([
            policy("a", "a_select", "SELECT", { using: "EXISTS (SELECT 1 FROM rebase.b WHERE b.id = a.b_id)" }),
            policy("b", "b_select", "SELECT", { using: "EXISTS (SELECT 1 FROM rebase.a WHERE a.b_id = b.id)" }),
            policy("c", "c_insert", "INSERT", { withCheck: "EXISTS (SELECT 1 FROM rebase.a WHERE a.id = c.a_id)" })
        ]);
        expect(found.map(f => f.policy)).toEqual(["a_select", "b_select"]);
    });

    it("walks only USING when it expands a table for a sub-select, but walks into it on either clause's sub-select", () => {
        // `ALL` on teams: its WITH CHECK reads team_members, its USING does not.
        // Expanded for team_members' read of it, only USING applies: no edge back.
        const writeOnlyBack = [
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS }),
            policy("team_members", "team_members_insert", "INSERT", { withCheck: "EXISTS (SELECT 1 FROM rebase.teams t WHERE t.id::text = team_members.team_id)" }),
            policy("teams", "teams_all", "ALL", {
                using: "(owner_id = (SELECT rebase.uid()))",
                withCheck: "EXISTS (SELECT 1 FROM rebase.team_members tm WHERE tm.team_id = teams.id::text)"
            })
        ];
        expect(findPolicyRecursion(writeOnlyBack).map(f => f.policy)).toEqual([]);

        // A sub-select in an ALL policy's WITH CHECK still makes Postgres walk
        // into the table (`hassublinks` is per policy) — when it has a USING to
        // apply. Without one it takes no part in a read.
        const selfRead = (all: RecursionPolicy) => [
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS_021 }),
            all,
            policy("team_members", "team_members_update", "UPDATE", { using: IS_MANAGER })
        ];
        expect(findPolicyRecursion(selfRead(policy("team_members", "team_members_all", "ALL", {
            using: OWN_ROWS_021,
            withCheck: "((SELECT rebase.uid()) IS NOT NULL)"
        }))).map(f => f.policy)).toEqual(["team_members_update"]);
        expect(findPolicyRecursion(selfRead(policy("team_members", "team_members_all", "ALL", {
            withCheck: "((SELECT rebase.uid()) IS NOT NULL)"
        })))).toEqual([]);
    });

    it("leaves a policy written TO a role no context holds out of the walk", () => {
        const policies = [
            policy("team_members", "team_members_select", "SELECT", { using: OWN_ROWS, roles: ["auditor"] }),
            policy("team_members", "team_members_update", "UPDATE", { using: IS_MANAGER })
        ];
        expect(findPolicyRecursion(policies, { contexts: CONTEXTS })).toEqual([]);
        expect(findPolicyRecursion(policies, { contexts: [{ name: "auditor", roles: ["auditor"] }] }).map(f => f.policy))
            .toEqual(["team_members_update"]);
    });

    it("resolves a bare name through the search path, and says so when only another schema has the table", () => {
        const policies = (schema: string) => [
            policy("members", "members_select", "SELECT", { schema, using: OWN_ROWS }),
            policy("members", "members_delete", "DELETE", { schema, using: "EXISTS (SELECT 1 FROM members m WHERE m.org = members.org)" })
        ];
        expect(findPolicyRecursion(policies("public")).map(f => f.confidence)).toEqual(["certain"]);

        const elsewhere = findPolicyRecursion(policies("app"));
        expect(elsewhere.map(f => f.confidence)).toEqual(["heuristic"]);
        expect(elsewhere[0].caveats[0]).toContain("app.members only if the policy was created with app on its search path");
        expect(findPolicyRecursion(policies("app"), { searchPath: ["app", "public"] }).map(f => f.confidence)).toEqual(["certain"]);
    });

    it("never reads a table it has no policies for", () => {
        expect(findPolicyRecursion([
            policy("notes", "notes_select", "SELECT", { using: "EXISTS (SELECT 1 FROM rebase.audit_log l WHERE l.note_id = notes.id)" })
        ])).toEqual([]);
    });
});
