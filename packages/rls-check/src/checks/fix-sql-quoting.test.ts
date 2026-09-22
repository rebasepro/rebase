import { describe, expect, it } from "vitest";

import {
    DEFAULT_ROLES,
    foreignKey,
    grant,
    matviewRelation,
    policy,
    role,
    routine,
    snapshot,
    table,
    view,
    viewRelation
} from "../../test/fixtures/snapshot";
import type { DbSnapshot, Finding } from "../types";
import { runChecks } from "./index";
import { qi } from "./util";

/**
 * Every `fix` is printed for a person to paste into psql, and every name in it
 * comes out of the catalog — which means out of whoever could create a table,
 * a role or a policy. A name has to stay a name when it is pasted: inside a
 * quoted identifier or a string literal, and never able to end a `--` comment
 * or a `$$` body.
 */

/**
 * The code a fix would run, with comments, quoted identifiers, string
 * literals and dollar-quoted strings taken out.
 *
 * A dollar-quoted body is lexed again and kept, because in a `DO $$ … $$`
 * block the body is code too.
 */
function executableText(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        const rest = sql.slice(i);
        if (rest.startsWith("--")) {
            const end = sql.slice(i).search(/[\n\r]/);
            i = end === -1 ? sql.length : i + end;
            continue;
        }
        if (rest.startsWith("/*")) {
            let depth = 0;
            do {
                if (sql.startsWith("/*", i)) {
                    depth++;
                    i += 2;
                } else if (sql.startsWith("*/", i)) {
                    depth--;
                    i += 2;
                } else i++;
            } while (depth > 0 && i < sql.length);
            continue;
        }
        const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
        if (dollar && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")) {
            const close = sql.indexOf(dollar[0], i + dollar[0].length);
            const body = sql.slice(i + dollar[0].length, close === -1 ? sql.length : close);
            out += ` ${executableText(body)} `;
            i = close === -1 ? sql.length : close + dollar[0].length;
            continue;
        }
        const quote = sql[i] === '"' ? '"' : sql[i] === "'" ? "'" : null;
        if (quote) {
            i++;
            while (i < sql.length) {
                if (sql[i] === quote && sql[i + 1] === quote) i += 2;
                else if (sql[i] === quote) {
                    i++;
                    break;
                } else i++;
            }
            out += " ";
            continue;
        }
        out += sql[i];
        i++;
    }
    return out;
}

/** A name that ends whatever it was put in, then runs `DROP TABLE pwned`. */
const BREAKERS: [string, string][] = [
    ["a double quote", `"; DROP TABLE pwned; --`],
    ["a single quote", `'; DROP TABLE pwned; --`],
    ["a newline", `\nDROP TABLE pwned; --`],
    ["a carriage return", `\rDROP TABLE pwned; --`],
    ["a dollar quote", `$$; DROP TABLE pwned; DO $$`],
    ["a backslash and a quote", `\\"; DROP TABLE pwned; --`]
];

/** A database where every check fires, and every name carries `evil`. */
function hostileSnapshot(evil: string): DbSnapshot {
    const n = (name: string) => `${name}${evil}`;
    const schema = n("app");
    const owner = n("owner");
    const orgs = n("orgs");
    const members = n("members");
    const memberCol = n("user_id");
    return snapshot({
        schemas: [schema],
        platform: "supabase",
        exposedRoles: ["PUBLIC", "anon", "authenticated", n("api")],
        roles: [
            ...DEFAULT_ROLES,
            role(owner, { canLogin: true }),
            role(n("admin"), { canLogin: true, bypassRls: true }),
            role(n("api"), { canLogin: true })
        ],
        relations: [
            // rls-disabled, grant-to-public
            table(schema, n("open"), { owner }),
            // rls-enabled-no-policies, rls-enabled-not-forced (both wordings)
            table(schema, n("empty"), { owner, rlsEnabled: true }),
            table(schema, n("admin_only"), { owner: n("admin"), rlsEnabled: true }),
            // junction-table-unprotected
            table(schema, orgs, { owner, rlsEnabled: true, rlsForced: true }),
            table(schema, n("people"), { owner, rlsEnabled: true, rlsForced: true }),
            table(schema, n("org_people"), { owner, columns: [n("org_id"), n("person_id")] }),
            // policy checks, unqualified-column-in-subquery
            table(schema, n("posts"), {
                owner,
                rlsEnabled: true,
                rlsForced: true,
                columns: ["id", "org_id", memberCol]
            }),
            table(schema, members, { owner, rlsEnabled: true, rlsForced: true, columns: ["id", "org_id", memberCol] }),
            // view-bypasses-rls, matview-bypasses-rls
            viewRelation(schema, n("posts_view"), { owner }),
            viewRelation(schema, n("posts_view_pg14"), { owner }),
            matviewRelation(schema, n("posts_mv"), { owner })
        ],
        foreignKeys: [
            foreignKey(schema, n("org_people"), [n("org_id")], schema, orgs),
            foreignKey(schema, n("org_people"), [n("person_id")], schema, n("people"))
        ],
        views: [
            view(schema, n("posts_view"), { owner, dependsOn: [{ schema, table: n("posts") }] }),
            view(schema, n("posts_view_pg14"), {
                owner,
                securityInvoker: null,
                dependsOn: [{ schema, table: n("posts") }]
            }),
            view(schema, n("posts_mv"), { owner, dependsOn: [{ schema, table: n("posts") }] })
        ],
        grants: [
            grant(schema, n("open"), "public", ["SELECT", "INSERT"]),
            grant(schema, n("open"), n("api"), ["SELECT"]),
            grant(schema, n("org_people"), "anon", ["SELECT"]),
            grant(schema, n("posts"), "anon", ["SELECT", "INSERT", "UPDATE", "DELETE"]),
            grant(schema, n("posts"), n("api"), ["SELECT", "INSERT"]),
            grant(schema, n("posts_view"), "anon", ["SELECT"]),
            grant(schema, n("posts_view_pg14"), "anon", ["SELECT"]),
            grant(schema, n("posts_mv"), n("api"), ["SELECT"])
        ],
        policies: [
            // policy-always-true, anonymous-write-allowed
            policy(schema, n("posts"), n("always"), { command: "ALL", using: "true", withCheck: "true", roles: [n("api")] }),
            policy(schema, n("posts"), n("anon_write"), { command: "INSERT", withCheck: "true", roles: ["anon"] }),
            // policy-anonymous-tautology
            policy(schema, n("posts"), n("tautology"), {
                using: "(auth.uid() IS NOT NULL)",
                roles: ["anon"]
            }),
            // policy-authenticated-tautology
            policy(schema, n("posts"), n("any_member"), {
                using: "((auth.uid() IS NOT NULL) AND (auth.uid() <> 'anonymous'::text))",
                roles: ["authenticated"]
            }),
            // unqualified-column-in-subquery
            policy(schema, n("posts"), n("ambiguous"), {
                using: `(EXISTS ( SELECT 1 FROM ${qi(members)} WHERE ((${qi(members)}.${qi(memberCol)} = auth.uid()) AND (org_id = id))))`,
                roles: ["authenticated"]
            }),
            // current-setting-throws
            policy(schema, n("posts"), n("tenant"), {
                using: "(org_id = (current_setting('app.org'::text))::uuid)",
                roles: ["authenticated"]
            }),
            // policy-role-unreachable
            policy(schema, n("empty"), n("unreachable"), { using: "true", roles: [n("ghost")] })
        ],
        routines: [
            routine(schema, n("elevate"), { owner, securityDefiner: true, mutableSearchPath: true })
        ]
    });
}

describe("fix SQL keeps every catalog name a name", () => {
    it("exercises every check that prints SQL", () => {
        const fired = new Set(runChecks(hostileSnapshot("")).map((f) => f.id));
        expect([...fired].sort()).toEqual([
            "anonymous-write-allowed",
            "current-setting-throws",
            "grant-to-public",
            "junction-table-unprotected",
            "matview-bypasses-rls",
            "policy-always-true",
            "policy-anonymous-tautology",
            "policy-authenticated-tautology",
            "policy-role-unreachable",
            "rls-disabled",
            "rls-enabled-no-policies",
            "rls-enabled-not-forced",
            "security-definer-mutable-search-path",
            "unqualified-column-in-subquery",
            "view-bypasses-rls"
        ]);
    });

    it.each(BREAKERS)("a name containing %s cannot run anything", (_label, evil) => {
        const findings = runChecks(hostileSnapshot(evil));
        const leaks = findings
            .filter((f): f is Finding & { fix: string } => typeof f.fix === "string")
            .filter((f) => /pwned/i.test(executableText(f.fix)))
            .map((f) => `${f.id}:\n${f.fix}`);

        expect(findings.length).toBeGreaterThanOrEqual(18);
        expect(leaks).toEqual([]);
    });

    it("renders a name with a line break as one token that still names the same object", () => {
        expect(qi("a\nb")).toBe('U&"a\\000Ab"');
        expect(qi("a\\b\n")).toBe('U&"a\\\\b\\000A"');
        expect(qi('plain "quoted"')).toBe('"plain ""quoted"""');
    });
});
