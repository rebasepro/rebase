/**
 * The remediations `--format agent` hands a coding agent, one case per check id.
 *
 * Four properties, each its own block:
 *
 *   - coverage: every check in the catalogue has a builder, and a case here;
 *   - shape: the snapshot of each remediation, so a change to what an agent is
 *     told is a reviewed diff rather than an accident;
 *   - effect: applying the SQL to the snapshot clears the finding it came with —
 *     a fix that leaves its finding standing teaches the agent to ignore the tool;
 *   - types: every `securityRules` snippet compiles against the real
 *     `SecurityRule` in `@rebasepro/types`.
 *
 * The SQL is also run against a real Postgres, by `test/e2e/agent-remediation.e2e.test.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";

import {
    foreignKey,
    grant,
    policy,
    reachable,
    role,
    routine,
    snapshot,
    table,
    view,
    viewRelation,
    matviewRelation,
    DEFAULT_ROLES
} from "../test/fixtures/snapshot";
import { CHECKS, runChecks } from "./checks";
import { REMEDIATIONS, remediationFor, type Remediation, type RemediationApply } from "./remediation";
import { findingKey } from "./report-agent";
import type { DbPolicy, DbSnapshot, Finding, PolicyCommand } from "./types";

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

interface Case {
    name: string;
    check: string;
    snap: DbSnapshot;
    apply: RemediationApply;
    /** Values for the placeholders, for the "clears the finding" test. */
    fill?: Record<string, string>;
    /** The fix is correct and the finding stays by design; the reason is the value. */
    keepsFinding?: string;
}

const todos = (spec: Parameters<typeof table>[2] = {}) =>
    table("public", "todos", {
        columns: ["id", { name: "user_id", type: "uuid" }, "title"],
        ...spec
    });

const supabase = (overrides: Partial<DbSnapshot>): DbSnapshot =>
    snapshot({ platform: "supabase", ...overrides });

const ALL: ("SELECT" | "INSERT" | "UPDATE" | "DELETE")[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

const CASES: Case[] = [
    {
        name: "rls-disabled: owner column found",
        check: "rls-disabled",
        apply: "sql",
        snap: supabase({
            relations: [todos()],
            grants: [grant("public", "todos", "anon", ALL), grant("public", "todos", "authenticated", ALL)]
        })
    },
    {
        name: "rls-disabled: no owner column, so a placeholder",
        check: "rls-disabled",
        apply: "sql",
        fill: { "<owner_column>": "\"id\"" },
        snap: supabase({
            relations: [table("public", "notes", { columns: ["id", "body"] })],
            grants: [grant("public", "notes", "anon", ["SELECT"])]
        })
    },
    {
        name: "rls-disabled: a text owner column is compared as text",
        check: "rls-disabled",
        apply: "sql",
        snap: snapshot({
            relations: [table("public", "todos", { columns: ["id", { name: "owner_id", type: "text" }] })],
            grants: [grant("public", "todos", "anon", ["SELECT"])]
        })
    },
    {
        name: "rls-disabled: existing policies take effect",
        check: "rls-disabled",
        apply: "sql",
        snap: supabase({
            relations: [todos()],
            policies: [policy("public", "todos", "todos_owner", { using: "(user_id = auth.uid())" })],
            grants: [grant("public", "todos", "authenticated", ["SELECT"])]
        })
    },
    {
        name: "rls-disabled: a foreign table loses the grant",
        check: "rls-disabled",
        apply: "sql",
        snap: supabase({
            relations: [table("public", "remote_orders", { kind: "foreign_table" })],
            grants: [grant("public", "remote_orders", "anon", ["SELECT"])]
        })
    },
    {
        name: "policy-always-true: both clauses",
        check: "policy-always-true",
        apply: "sql",
        snap: reachable(supabase({
            relations: [todos({ rlsEnabled: true, rlsForced: true })],
            policies: [policy("public", "todos", "todos_all", { command: "ALL", using: "true", withCheck: "true" })]
        }))
    },
    {
        name: "policy-always-true: Rebase-managed, so the rule changes",
        check: "policy-always-true",
        apply: "rebase-config",
        snap: reachable(snapshot({
            platform: "rebase",
            exposedRoles: ["PUBLIC", "rebase_user"],
            roles: [...DEFAULT_ROLES, role("rebase_user")],
            relations: [table("public", "posts", { rlsEnabled: true, columns: ["id", "author_id", "title"] })],
            policies: [policy("public", "posts", "posts_select_841c287", { using: "true" })]
        }))
    },
    {
        name: "policy-anonymous-tautology",
        check: "policy-anonymous-tautology",
        apply: "sql",
        snap: reachable(supabase({
            relations: [todos({ rlsEnabled: true, rlsForced: true })],
            policies: [policy("public", "todos", "todos_read", { using: "(auth.uid() IS NOT NULL)" })]
        }))
    },
    {
        name: "policy-authenticated-tautology",
        check: "policy-authenticated-tautology",
        apply: "sql",
        snap: reachable(supabase({
            relations: [todos({ rlsEnabled: true, rlsForced: true })],
            policies: [policy("public", "todos", "todos_read", {
                roles: ["authenticated"],
                using: "(auth.role() = 'authenticated'::text)"
            })]
        }))
    },
    {
        name: "view-bypasses-rls: the caller lacks SELECT on the base table",
        check: "view-bypasses-rls",
        apply: "sql",
        snap: supabase({
            relations: [todos({ rlsEnabled: true }), viewRelation("public", "todo_titles")],
            views: [view("public", "todo_titles", { dependsOn: [{ schema: "public", table: "todos" }] })],
            grants: [grant("public", "todo_titles", "anon", ["SELECT"])]
        })
    },
    {
        name: "view-bypasses-rls: before PostgreSQL 15",
        check: "view-bypasses-rls",
        apply: "sql",
        snap: supabase({
            serverVersion: "14.9",
            serverVersionNum: 140009,
            relations: [todos({ rlsEnabled: true }), viewRelation("public", "todo_titles")],
            views: [view("public", "todo_titles", {
                securityInvoker: null,
                dependsOn: [{ schema: "public", table: "todos" }]
            })],
            grants: [grant("public", "todo_titles", "anon", ["SELECT"])]
        })
    },
    {
        name: "matview-bypasses-rls",
        check: "matview-bypasses-rls",
        apply: "sql",
        snap: supabase({
            relations: [todos({ rlsEnabled: true }), matviewRelation("public", "todo_counts")],
            views: [view("public", "todo_counts", { dependsOn: [{ schema: "public", table: "todos" }] })],
            grants: [grant("public", "todo_counts", "anon", ["SELECT"]), grant("public", "todo_counts", "authenticated", ["SELECT"])]
        })
    },
    {
        name: "anonymous-write-allowed",
        check: "anonymous-write-allowed",
        apply: "sql",
        snap: supabase({
            relations: [todos({ rlsEnabled: true, rlsForced: true })],
            policies: [policy("public", "todos", "todos_insert", { command: "INSERT", roles: ["anon"], withCheck: "true" })],
            grants: [grant("public", "todos", "anon", ["SELECT", "INSERT"])]
        })
    },
    {
        name: "unqualified-column-in-subquery: a column compared with itself",
        check: "unqualified-column-in-subquery",
        apply: "sql",
        snap: reachable(supabase({
            relations: [
                table("public", "documents", { rlsEnabled: true, rlsForced: true, columns: ["id", "org_id", "body"] }),
                table("public", "memberships", { rlsEnabled: true, columns: ["id", "org_id", "user_id"] })
            ],
            policies: [policy("public", "documents", "documents_select", {
                roles: ["authenticated"],
                using:
                    "(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.user_id = auth.uid()) AND " +
                    "(memberships.org_id = memberships.org_id))))"
            })]
        }))
    },
    {
        name: "junction-table-unprotected",
        check: "junction-table-unprotected",
        apply: "sql",
        snap: supabase({
            relations: [
                table("public", "posts", { rlsEnabled: true }),
                table("public", "tags", { rlsEnabled: true }),
                table("public", "post_tags", { columns: ["post_id", "tag_id", { name: "created_at", type: "timestamp with time zone" }] })
            ],
            foreignKeys: [
                foreignKey("public", "post_tags", ["post_id"], "public", "posts"),
                foreignKey("public", "post_tags", ["tag_id"], "public", "tags")
            ],
            grants: [grant("public", "post_tags", "anon", ["SELECT"])]
        })
    },
    {
        name: "rls-enabled-not-forced: a login owner",
        check: "rls-enabled-not-forced",
        apply: "sql",
        snap: supabase({
            roles: [...DEFAULT_ROLES, role("app_owner", { canLogin: true })],
            relations: [todos({ rlsEnabled: true, owner: "app_owner" })]
        })
    },
    {
        name: "rls-enabled-not-forced: an exposed role is a member of the owner",
        check: "rls-enabled-not-forced",
        apply: "sql",
        snap: supabase({
            roles: [
                role("postgres", { canLogin: true, superuser: true }),
                role("authenticator", { canLogin: true, memberOf: ["anon", "authenticated"] }),
                role("anon", { memberOf: ["app_owner"] }),
                role("authenticated"),
                role("app_owner")
            ],
            relations: [todos({ rlsEnabled: true, owner: "app_owner" })]
        })
    },
    {
        name: "rls-enabled-not-forced: on Rebase, never FORCE",
        check: "rls-enabled-not-forced",
        apply: "manual",
        keepsFinding: "Rebase relies on the owner's exemption; the fix is how the API connects, not FORCE.",
        snap: snapshot({
            platform: "rebase",
            exposedRoles: ["PUBLIC", "rebase_user"],
            roles: [...DEFAULT_ROLES, role("rebase_owner", { canLogin: true }), role("rebase_user")],
            relations: [todos({ rlsEnabled: true, owner: "rebase_owner" })]
        })
    },
    {
        name: "rls-enabled-no-policies",
        check: "rls-enabled-no-policies",
        apply: "sql",
        snap: supabase({
            relations: [todos({ rlsEnabled: true, rlsForced: true })],
            grants: [grant("public", "todos", "authenticated", ["SELECT"])]
        })
    },
    {
        name: "policy-role-unreachable",
        check: "policy-role-unreachable",
        apply: "sql",
        fill: { "<app_role>": "\"authenticated\"" },
        snap: supabase({
            roles: [...DEFAULT_ROLES, role("reporting_bot")],
            relations: [todos({ rlsEnabled: true, rlsForced: true })],
            policies: [policy("public", "todos", "todos_reports", { roles: ["reporting_bot"], using: "true" })]
        })
    },
    {
        name: "grant-to-public",
        check: "grant-to-public",
        apply: "sql",
        snap: supabase({
            relations: [todos({ rlsEnabled: true, rlsForced: true })],
            grants: [grant("public", "todos", "PUBLIC", ["SELECT", "INSERT"])]
        })
    },
    {
        name: "security-definer-mutable-search-path",
        check: "security-definer-mutable-search-path",
        apply: "sql",
        keepsFinding: "The snapshot model has no routine config to apply the DO block to; the e2e suite runs it.",
        snap: supabase({ routines: [routine("public", "promote_user", { securityDefiner: true })] })
    },
    {
        name: "current-setting-throws",
        check: "current-setting-throws",
        apply: "sql",
        snap: reachable(supabase({
            relations: [table("public", "invoices", { rlsEnabled: true, rlsForced: true, columns: ["id", "tenant_id"] })],
            policies: [policy("public", "invoices", "invoices_tenant", {
                roles: ["authenticated"],
                using: "(tenant_id = current_setting('app.tenant_id'::text))"
            })]
        }))
    }
];

function findingsOf(c: Case): Finding[] {
    return runChecks(c.snap, { only: [c.check] });
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("remediation coverage", () => {
    it("has a builder for every check in the catalogue, and nothing else", () => {
        expect(Object.keys(REMEDIATIONS).sort()).toEqual(CHECKS.map((c) => c.id).sort());
    });

    it("has a case for every check id", () => {
        const covered = new Set(CASES.map((c) => c.check));
        expect(CHECKS.map((c) => c.id).filter((id) => !covered.has(id))).toEqual([]);
    });

    it.each(CASES)("$name: the fixture produces the finding", (c) => {
        expect(findingsOf(c).map((f) => f.id)).toContain(c.check);
    });
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("remediation per check id", () => {
    it.each(CASES)("$name", (c) => {
        const [finding] = findingsOf(c);
        const remediation = remediationFor(c.snap, finding);

        expect(remediation.apply).toBe(c.apply);
        expect({ key: findingKey(finding), remediation }).toMatchSnapshot();
    });
});

describe("remediation invariants", () => {
    const all = CASES.map((c) => ({ c, remediation: remediationFor(c.snap, findingsOf(c)[0]) }));

    it.each(all)("$c.name: sql is statements, not commentary", ({ remediation }) => {
        if (remediation.apply === "sql") expect(remediation.sql).not.toBeNull();
        if (remediation.apply === "rebase-config") expect(remediation.sql).toBeNull();
        for (const sql of [remediation.sql, ...remediation.alternatives.map((a) => a.sql)]) {
            if (sql === null) continue;
            expect(sql.trimEnd().endsWith(";")).toBe(true);
            expect(sql.split("\n").some((line) => line.trimStart().startsWith("--"))).toBe(false);
        }
    });

    it.each(all)("$c.name: every placeholder appears where it has to be filled", ({ remediation }) => {
        const text = [remediation.sql ?? "", remediation.rebase.securityRules ?? ""].join("\n");
        for (const placeholder of remediation.placeholders) expect(text).toContain(placeholder.token);
        // And nothing that looks like a placeholder goes unlisted.
        const tokens = new Set(remediation.placeholders.map((p) => p.token));
        for (const token of (remediation.sql ?? "").match(/<[a-z_]+>/g) ?? []) expect(tokens.has(token)).toBe(true);
    });

    it.each(all)("$c.name: the Rebase side is a rule or says why not", ({ remediation }) => {
        const { rebase } = remediation;
        expect(rebase.note.length).toBeGreaterThan(0);
        if (rebase.applicable) {
            expect(rebase.securityRules).not.toBeNull();
            expect(rebase.snippet).toContain("defineCollection({");
            expect(rebase.snippet).toContain("securityRules: [");
        } else {
            expect(rebase.securityRules).toBeNull();
            expect(rebase.snippet).toBeNull();
        }
    });

    it("never offers SQL for a policy Rebase re-makes at boot", () => {
        const managed = all.filter(({ c }) => c.name.includes("Rebase-managed"));
        expect(managed.length).toBeGreaterThan(0);
        for (const { remediation } of managed) {
            expect(remediation.sql).toBeNull();
            expect(remediation.caveats.join(" ")).toContain("re-created on every boot");
        }
    });

    it("never suggests FORCE on a Rebase database", () => {
        const [{ remediation }] = all.filter(({ c }) => c.name.includes("never FORCE"));
        expect(remediation.sql ?? "").not.toContain("FORCE");
    });

    it("compares a uuid owner column to auth.uid() directly and a text one through ::text", () => {
        const sqlOf = (name: string) => all.find(({ c }) => c.name === name)?.remediation.sql ?? "";
        expect(sqlOf("rls-disabled: owner column found")).toContain(`"user_id" = auth.uid()`);
        expect(sqlOf("rls-disabled: a text owner column is compared as text")).toContain(`"owner_id" = auth.uid()::text`);
    });
});

// ---------------------------------------------------------------------------
// Effect: the SQL, applied to the snapshot, clears the finding
// ---------------------------------------------------------------------------

/**
 * Just enough of Postgres to apply the statements remediations print, to a
 * snapshot. Anything it does not recognise fails the test: an unparsed statement
 * would otherwise count as a no-op that "cleared" nothing.
 */
const COMMANDS: Record<string, PolicyCommand> = {
    ALL: "ALL",
    SELECT: "SELECT",
    INSERT: "INSERT",
    UPDATE: "UPDATE",
    DELETE: "DELETE"
};

function applyToSnapshot(snap: DbSnapshot, sql: string): DbSnapshot {
    const next: DbSnapshot = {
        ...snap,
        relations: snap.relations.map((r) => ({ ...r })),
        policies: snap.policies.map((p) => ({ ...p })),
        grants: snap.grants.map((g) => ({ ...g, privileges: [...g.privileges] })),
        views: snap.views.map((v) => ({ ...v }))
    };
    const ident = `(?:"((?:[^"]|"")*)"|(\\w+))`;
    const name = (m: RegExpMatchArray, i: number): string => (m[i] ?? m[i + 1] ?? "").replace(/""/g, '"');
    const rel = `${ident}\\.${ident}`;
    const findRel = (schema: string, table: string) => {
        const found = next.relations.find((r) => r.schema === schema && r.name === table);
        if (!found) throw new Error(`no relation ${schema}.${table}`);
        return found;
    };
    const findPolicy = (policyName: string, schema: string, table: string): DbPolicy => {
        const found = next.policies.find((p) => p.name === policyName && p.schema === schema && p.table === table);
        if (!found) throw new Error(`no policy ${policyName}`);
        return found;
    };

    for (const raw of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
        const statement = raw.replace(/\s+/g, " ");
        let m: RegExpMatchArray | null;
        if ((m = statement.match(new RegExp(`^ALTER TABLE ${rel} (ENABLE|FORCE) ROW LEVEL SECURITY$`)))) {
            const r = findRel(name(m, 1), name(m, 3));
            if (m[5] === "ENABLE") r.rlsEnabled = true;
            else r.rlsForced = true;
        } else if ((m = statement.match(new RegExp(`^CREATE POLICY ${ident} ON ${rel} FOR (\\w+)(?: USING \\((.*?)\\))?(?: WITH CHECK \\((.*)\\))?$`)))) {
            next.policies.push(policy(name(m, 3), name(m, 5), name(m, 1), {
                command: COMMANDS[m[7]],
                using: m[8] ?? null,
                withCheck: m[9] ?? null
            }));
        } else if ((m = statement.match(new RegExp(`^ALTER POLICY ${ident} ON ${rel} TO ${ident}$`)))) {
            findPolicy(name(m, 1), name(m, 3), name(m, 5)).roles = [name(m, 7)];
        } else if ((m = statement.match(new RegExp(`^ALTER POLICY ${ident} ON ${rel}(?: USING \\((.*?)\\))?(?: WITH CHECK \\((.*)\\))?$`)))) {
            const p = findPolicy(name(m, 1), name(m, 3), name(m, 5));
            if (m[7] !== undefined) p.using = m[7];
            if (m[8] !== undefined) p.withCheck = m[8];
        } else if ((m = statement.match(new RegExp(`^DROP POLICY ${ident} ON ${rel}$`)))) {
            const p = findPolicy(name(m, 1), name(m, 3), name(m, 5));
            next.policies = next.policies.filter((x) => x !== p);
        } else if ((m = statement.match(new RegExp(`^REVOKE ([A-Z, ]+) ON ${rel} FROM (PUBLIC|${ident})$`)))) {
            const privileges = m[1].split(", ");
            const grantee = m[6] === "PUBLIC" ? "PUBLIC" : name(m, 7);
            for (const g of next.grants) {
                if (g.schema === name(m, 2) && g.table === name(m, 4) && g.grantee.toLowerCase() === grantee.toLowerCase()) {
                    g.privileges = g.privileges.filter((p) => !privileges.includes(p));
                }
            }
        } else if ((m = statement.match(new RegExp(`^REVOKE ${ident} FROM ${ident}$`)))) {
            const [owner, member] = [name(m, 1), name(m, 3)];
            next.roles = next.roles.map((r) => (r.name === member ? { ...r, memberOf: r.memberOf.filter((x) => x !== owner) } : r));
        } else if ((m = statement.match(new RegExp(`^GRANT ${ident} TO ${ident}$`)))) {
            const [granted, member] = [name(m, 1), name(m, 3)];
            next.roles = next.roles.map((r) => (r.name === member ? { ...r, memberOf: [...r.memberOf, granted] } : r));
        } else if ((m = statement.match(new RegExp(`^ALTER VIEW ${rel} SET \\(security_invoker = true\\)$`)))) {
            const v = next.views.find((x) => x.schema === name(m!, 1) && x.name === name(m!, 3));
            if (!v) throw new Error("no view");
            v.securityInvoker = true;
        } else {
            throw new Error(`applyToSnapshot does not understand: ${statement}`);
        }
    }
    return next;
}

describe("applying the SQL clears the finding", () => {
    it.each(CASES.filter((c) => c.apply === "sql" && !c.keepsFinding))("$name", (c) => {
        const [finding] = findingsOf(c);
        const remediation: Remediation = remediationFor(c.snap, finding);
        let sql = remediation.sql ?? "";
        for (const placeholder of remediation.placeholders) {
            const value = c.fill?.[placeholder.token];
            expect(value, `case needs a fill for ${placeholder.token}`).toBeDefined();
            sql = sql.split(placeholder.token).join(value ?? "");
        }

        const after = applyToSnapshot(c.snap, sql);
        const keys = runChecks(after, { only: [c.check] }).map(findingKey);
        expect(keys).not.toContain(findingKey(finding));
    });

    it.each(CASES.filter((c) => c.apply === "sql").flatMap((c) =>
        remediationFor(c.snap, findingsOf(c)[0]).alternatives.map((a) => ({ name: c.name, c, sql: a.sql }))))(
        "$name: alternative parses",
        ({ c, sql }) => {
            expect(() => applyToSnapshot(c.snap, sql.split("<app_role>").join("\"authenticated\""))).not.toThrow();
        }
    );
});

// ---------------------------------------------------------------------------
// Types: the snippets compile against the real SecurityRule
// ---------------------------------------------------------------------------

/** `@rebasepro/types`' SecurityRule, by path: this package may not depend on it. */
const SECURITY_RULES_MODULE = fileURLToPath(new URL("../../types/src/types/security_rules", import.meta.url));

describe("securityRules snippets", () => {
    const dir = mkdtempSync(join(tmpdir(), "rls-check-rules-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("type-check as readonly SecurityRule[] from @rebasepro/types", () => {
        const securityRulesModule = SECURITY_RULES_MODULE;
        const snippets = CASES
            .map((c) => remediationFor(c.snap, findingsOf(c)[0]).rebase.securityRules)
            .filter((s): s is string => s !== null);
        expect(snippets.length).toBeGreaterThan(10);

        const file = join(dir, "rules.ts");
        writeFileSync(
            file,
            `import type { SecurityRule } from ${JSON.stringify(securityRulesModule)};\n\n` +
            snippets.map((s, i) => `export const rules${i}: readonly SecurityRule[] = ${s};\n`).join("\n")
        );

        const program = ts.createProgram([file], {
            strict: true,
            noEmit: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            skipLibCheck: true,
            types: []
        });
        const errors = ts.getPreEmitDiagnostics(program).map((d) =>
            ts.flattenDiagnosticMessageText(d.messageText, "\n"));
        expect(errors).toEqual([]);
    });

    it("are rejected when they are wrong — the check is not vacuous", () => {
        const securityRulesModule = SECURITY_RULES_MODULE;
        const file = join(dir, "wrong.ts");
        writeFileSync(
            file,
            `import type { SecurityRule } from ${JSON.stringify(securityRulesModule)};\n` +
            `export const rules: readonly SecurityRule[] = [{ operation: "all", ownerField: "user_id", using: "true" }];\n`
        );
        const program = ts.createProgram([file], {
            strict: true,
            noEmit: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            skipLibCheck: true,
            types: []
        });
        expect(ts.getPreEmitDiagnostics(program).length).toBeGreaterThan(0);
    });
});
