import { isRedactedSecurityRule, REBASE_ADMIN_REQUEST_ROLE, REBASE_ADMIN_ROLE } from "@rebasepro/types";
import type { PolicyDescriptor, PostgresPolicy, RlsDescriptor, SecurityOperation, SecurityRule } from "@rebasepro/types";
import { getPolicyNamesForRule, getPolicyOperations } from "@rebasepro/utils";

/** A part of a policy the database can hold differently from its declaration. */
export type PolicyDriftField = "roles" | "command" | "mode" | "USING" | "WITH CHECK";

/** A row of the RLS editor's policy list. */
export interface ListedPolicy extends PostgresPolicy {
    /**
     * What the server compiles this policy to, when the table declares one by
     * this name. For a policy the database also has, the row's own fields are
     * the database's and this is what they are compared against.
     */
    declared?: PostgresPolicy;
    /** Where the database's policy differs from {@link declared}. Empty when it does not. */
    drift?: PolicyDriftField[];
    /**
     * Rebase adds this policy itself — the admin baseline, a tenancy or
     * auth-write gate, a junction's derived policies, an admin-request
     * companion — so no rule of the author's holds it, and the next server
     * start re-creates it.
     */
    generated?: boolean;
    /** The index in the table's declared `rls.rules` of the rule this policy compiles from. */
    rule?: number;
}

/**
 * The roles of a `pg_policies` row, from its `roles` column.
 *
 * A driver hands a `name[]` back as an array or as Postgres's text for one:
 * `{public}`, `{anon,authenticated}`, and with an element quoted — a `"` or
 * `\` in it escaped by a backslash — when it holds a comma, a brace, a quote,
 * a backslash or a space: `{"my role",anon}`. Split on commas, that last one
 * reads as the role `"my role"`, quotes and all: the policy shows drift that
 * is not there, and an edit of it names a role that does not exist.
 */
export function readPolicyRoles(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((role): role is string => typeof role === "string");
    if (typeof value !== "string") return [];
    const body = value.trim().replace(/^\{/, "").replace(/\}$/, "");
    const roles: string[] = [];
    let i = 0;
    while (i < body.length) {
        if (body[i] === "\"") {
            let role = "";
            i++;
            while (i < body.length && body[i] !== "\"") {
                if (body[i] === "\\") i++;
                role += body[i] ?? "";
                i++;
            }
            roles.push(role);
            i++;
        } else {
            const comma = body.indexOf(",", i);
            const end = comma === -1 ? body.length : comma;
            const role = body.slice(i, end).trim();
            if (role) roles.push(role);
            i = end;
        }
        // Past the comma that ends this element, if there is one.
        while (i < body.length && body[i] !== ",") i++;
        i++;
    }
    return roles;
}

const COMMANDS: Record<SecurityOperation, PostgresPolicy["cmd"]> = {
    select: "SELECT",
    insert: "INSERT",
    update: "UPDATE",
    delete: "DELETE",
    all: "ALL"
};

function commandOf(operation: string): PostgresPolicy["cmd"] {
    return operation in COMMANDS ? COMMANDS[operation as SecurityOperation] : "ALL";
}

/** A policy the server compiled, in the shape `pg_policies` describes one. */
export function servedAsPostgresPolicy(served: PolicyDescriptor, tableName: string): PostgresPolicy {
    return {
        policyname: served.name,
        tablename: tableName,
        permissive: served.mode === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE",
        cmd: commandOf(served.operation),
        roles: [...served.roles],
        qual: served.using,
        with_check: served.withCheck
    };
}

/**
 * The rule's own clauses, for a declared rule the server compiled no policy
 * from — an `existsIn` naming a table the backend does not hold, say. Only
 * ever a `code_only` row's content: nothing is compared against it.
 */
function uncompiledPolicy(rule: SecurityRule, operation: SecurityOperation, name: string, tableName: string): PostgresPolicy {
    return {
        policyname: name,
        tablename: tableName,
        permissive: rule.mode === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE",
        cmd: COMMANDS[operation],
        roles: [...(rule.pgRoles ?? ["public"])],
        qual: rule.using || null,
        with_check: rule.withCheck || null
    };
}

function sameRoles(a: readonly string[], b: readonly string[]): boolean {
    const left = [...a].sort();
    const right = [...b].sort();
    return left.length === right.length && left.every((role, i) => role === right[i]);
}

/**
 * Where a live policy differs from the one the code compiles to.
 *
 * The same comparison `rebase doctor` makes: the `TO` list, the command, the
 * mode, and whether each clause is there at all. Never the clause text —
 * Postgres rewrites an expression when it stores it, so the text of a policy
 * that matches its declaration exactly still differs from the declaration's.
 * A clause that is missing is not a rewrite, though: a `USING` that is gone
 * changes who the policy admits.
 */
export function policyDrift(declared: PostgresPolicy, live: PostgresPolicy): PolicyDriftField[] {
    const drift: PolicyDriftField[] = [];
    if (!sameRoles(declared.roles, live.roles)) drift.push("roles");
    if (declared.cmd !== live.cmd) drift.push("command");
    if (declared.permissive !== live.permissive) drift.push("mode");
    if ((declared.qual != null) !== (live.qual != null)) drift.push("USING");
    if ((declared.with_check != null) !== (live.with_check != null)) drift.push("WITH CHECK");
    return drift;
}

/**
 * What the server says a table's policies are: its declared rules and the
 * policies it compiled from them, or — for a junction — the derived policies
 * alone. `undefined` when the table is not one the server declares, or when it
 * withheld the compiled policies from this caller (no `schema:read`).
 */
export interface DeclaredPolicies {
    /** The declared rules, as written; empty for a junction. */
    rules: readonly SecurityRule[];
    /** Every policy the server compiles for the table. */
    policies: readonly PolicyDescriptor[];
}

/** The {@link DeclaredPolicies} of a served table, when the server included its compiled policies. */
export function declaredPoliciesOf(rls: RlsDescriptor): DeclaredPolicies | undefined {
    return rls.policies ? { rules: rls.rules, policies: rls.policies } : undefined;
}

/**
 * The policies of one table: every policy the database has, as the database
 * has it, and every policy the server compiles for the table that it does not.
 *
 * The server is the one compiler: what it serves in `rls.policies` (and
 * `rls.junctions`) is exactly what `db push` and every server start write.
 * This only compares it with `pg_policies`. A policy in both keeps the
 * database's fields — this list is what Postgres enforces — and carries the
 * declaration beside them, with where the two differ.
 *
 * @param live      The table's `pg_policies` rows.
 * @param declared  What the server serves for the table, if anything.
 */
export function listPolicies(
    live: readonly PostgresPolicy[],
    declared: DeclaredPolicies | undefined,
    tableName: string
): ListedPolicy[] {
    const listed = new Map<string, ListedPolicy>();
    for (const policy of live) listed.set(policy.policyname, { ...policy, status: "live" });
    if (!declared) return [...listed.values()];

    const livePolicies = new Map(live.map(policy => [policy.policyname, policy]));
    const compiledRules = new Set<number>();

    for (const served of declared.policies) {
        if (served.rule !== undefined) compiledRules.add(served.rule);
        const existing = livePolicies.get(served.name);
        // The `TO rebase_admin_request USING (true)` companion a server writes
        // beside an admin-only policy where it made that role safe: Rebase's,
        // and compared like any declared policy when it is there. Not listed
        // when absent — a server that cannot make the role safe writes none.
        if (served.roles.includes(REBASE_ADMIN_REQUEST_ROLE) && !existing) continue;
        const compiled = servedAsPostgresPolicy(served, tableName);
        // A policy compiled TO rebase_admin is written TO public by a server
        // whose admin switch is not live — its documented fallback, not drift.
        // Only that one form is accepted.
        const fellBack = existing !== undefined && sameRoles(compiled.roles, [REBASE_ADMIN_ROLE]) && sameRoles(existing.roles, ["public"]);
        const declaredPolicy = fellBack ? { ...compiled, roles: ["public"] } : compiled;
        const rule = served.rule !== undefined ? { rule: served.rule } : {};
        if (existing) {
            listed.set(served.name, {
                ...existing,
                status: "both",
                declared: declaredPolicy,
                drift: policyDrift(declaredPolicy, existing),
                generated: served.injected,
                ...rule
            });
        } else {
            listed.set(served.name, { ...declaredPolicy, status: "code_only", generated: served.injected, ...rule });
        }
    }

    // A declared rule the server compiled nothing from still belongs in the
    // list: the code declares it, and the database cannot have it.
    declared.rules.forEach((rule, index) => {
        if (compiledRules.has(index) || isRedactedSecurityRule(rule)) return;
        const operations = getPolicyOperations(rule);
        getPolicyNamesForRule(rule, tableName).forEach((name: string, position: number) => {
            const existing = listed.get(name);
            if (existing) {
                // In the database under its name: nothing compiled to compare it with.
                if (existing.status === "live") listed.set(name, { ...existing, status: "both", generated: false, rule: index });
                return;
            }
            listed.set(name, {
                ...uncompiledPolicy(rule, operations[position] ?? "all", name, tableName),
                status: "code_only",
                generated: false,
                rule: index
            });
        });
    });

    return [...listed.values()];
}
