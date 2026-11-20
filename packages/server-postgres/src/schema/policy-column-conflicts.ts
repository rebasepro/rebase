/**
 * The `ALTER COLUMN … TYPE` statements in an Atlas plan that a policy blocks,
 * and how to run them anyway without ever loosening row-level security.
 *
 * PostgreSQL refuses to retype a column any policy's expression reads:
 *
 *     cannot alter type of a column used in a policy definition
 *
 * Atlas has no model of a policy, so it plans the retype regardless, and as
 * `schema apply` runs the plan in one transaction, every other statement rolls
 * back with it. One widened `owner_id` made `rebase db push` fail on every run
 * (reported from a Supabase migration, 2026-11-18).
 *
 * Dropping the policies before Atlas and letting the policy step put them back
 * afterwards would work until the apply failed in between: a table would then
 * be left without its restrictive policies, which is wider access, not less.
 * So the push runs each blocked statement itself, before Atlas, in ONE
 * transaction with the policies that read the column: save their definitions,
 * drop them, run the plan's own `ALTER TABLE`, recreate them exactly (roles,
 * command, mode, expressions, comment), commit. Either all of that happens or
 * none of it does. Atlas then plans what is left.
 *
 * Everything here is side-effect free; the database half is in `cli-helpers.ts`
 * (`queryPolicyColumnDependencies`, `retypeAroundPolicies`). Unit-tested in
 * `policy-column-conflicts.test.ts`.
 */
import { extractPlanStatements, fromAlterTable } from "./destructive-sql";
import { parseColumnMutations } from "./generated-column-conflicts";

/** One `policy → column it reads` edge, as read from `pg_depend`. */
export interface PolicyColumnDependency {
    schema: string;
    table: string;
    column: string;
    /** The policy's `oid`, to read its definition back in the transaction. */
    policyOid: number;
    policy: string;
}

/** A plan statement Postgres would refuse, and the policies in its way. */
export interface PolicyBlockedStatement {
    /** The plan's own `ALTER TABLE …` statement, without a trailing `;`. */
    statement: string;
    schema: string;
    table: string;
    /** The retyped columns some policy reads, sorted. */
    columns: string[];
    /** The policies to drop and recreate around it, by oid and name, sorted by name. */
    policies: { oid: number; name: string }[];
}

/**
 * The plan statements that retype a column a policy reads.
 *
 * A statement that names a bare table matches on the table name alone, the
 * same loose reading `findGeneratedColumnConflicts` uses: a wrong guess in that
 * direction costs a policy dropped and recreated in a transaction, and in the
 * other the whole push.
 */
export function findPolicyBlockedStatements(planSql: string, dependencies: PolicyColumnDependency[]): PolicyBlockedStatement[] {
    const blocked: PolicyBlockedStatement[] = [];
    for (const raw of extractPlanStatements(planSql)) {
        const statement = fromAlterTable(raw).replace(/;\s*$/, "");
        const retyped = parseColumnMutations(statement).filter((m) => m.kind === "type");
        if (retyped.length === 0) continue;
        const hits = dependencies.filter((d) => retyped.some((m) =>
            m.table === d.table && (m.schema === undefined || m.schema === d.schema) && m.column === d.column));
        if (hits.length === 0) continue;
        const policies = new Map<number, string>();
        for (const hit of hits) policies.set(hit.policyOid, hit.policy);
        blocked.push({
            statement,
            schema: hits[0].schema,
            table: hits[0].table,
            columns: [...new Set(hits.map((h) => h.column))].sort(),
            policies: [...policies].map(([oid, name]) => ({ oid, name })).sort((a, b) => a.name.localeCompare(b.name))
        });
    }
    return blocked;
}

/** A policy as `pg_policy` holds it, with its expressions printed by `pg_get_expr`. */
export interface PolicyDefinition {
    name: string;
    schema: string;
    table: string;
    /** `pg_policy.polcmd`: `r` SELECT, `a` INSERT, `w` UPDATE, `d` DELETE, `*` ALL. */
    command: string;
    permissive: boolean;
    /** Role names; `public` for the PUBLIC pseudo-role (oid 0). */
    roles: string[];
    using: string | null;
    withCheck: string | null;
    comment: string | null;
}

const COMMANDS: Record<string, string> = { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" };

const ident = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;
const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`;

/**
 * The statements that put a policy back exactly as it was: `CREATE POLICY`, and
 * `COMMENT ON POLICY` when it had one (Rebase keeps its policy stamps there).
 *
 * Run on the connection that read the definition, so the expressions, which
 * `pg_get_expr` prints relative to that session's `search_path`, resolve to
 * the same objects.
 */
export function recreatePolicySql(policy: PolicyDefinition): string[] {
    const command = COMMANDS[policy.command];
    if (!command) throw new Error(`Policy ${policy.name} has a command this cannot recreate: ${policy.command}`);
    const roles = policy.roles.length === 0
        ? "PUBLIC"
        : policy.roles.map((r) => (r === "public" ? "PUBLIC" : ident(r))).join(", ");
    const on = `${ident(policy.schema)}.${ident(policy.table)}`;
    const create = `CREATE POLICY ${ident(policy.name)} ON ${on} AS ${policy.permissive ? "PERMISSIVE" : "RESTRICTIVE"}` +
        ` FOR ${command} TO ${roles}` +
        (policy.using !== null ? ` USING (${policy.using})` : "") +
        (policy.withCheck !== null ? ` WITH CHECK (${policy.withCheck})` : "");
    return policy.comment !== null
        ? [create, `COMMENT ON POLICY ${ident(policy.name)} ON ${on} IS ${literal(policy.comment)}`]
        : [create];
}

/** `DROP POLICY` for one definition. */
export function dropPolicySql(policy: Pick<PolicyDefinition, "name" | "schema" | "table">): string {
    return `DROP POLICY ${ident(policy.name)} ON ${ident(policy.schema)}.${ident(policy.table)}`;
}

/** `public.notes (owner_id)`, the way the push names one. */
export function describeBlocked(blocked: PolicyBlockedStatement): string {
    return `${blocked.schema}.${blocked.table} (${blocked.columns.join(", ")}): ${blocked.policies.map((p) => p.name).join(", ")}`;
}
