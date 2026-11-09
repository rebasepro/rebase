import { ensureAppRole, recordRequestRoles, type RawSqlRunner } from "./rls-enforcement";

/**
 * Move a database from one set of request roles to another — what
 * `rebase db request-role migrate --to …` runs.
 *
 * A role belongs to the cluster, so renaming one (`ALTER ROLE … RENAME`) moves
 * every database's grants at once, including another project's that shares
 * it. This instead creates the new role(s) and re-issues, in THIS database
 * only, every grant the old ones hold here: tables and views, columns,
 * sequences, schemas, functions, the default privileges this connection set,
 * and the memberships that carry other roles' policies (`rls.inheritRoles`).
 * Policies that name an old role in their `TO` list are re-pointed. The old
 * roles are left as they are — another database may still use them — and the
 * statements to take their grants back here are returned for the operator.
 */
export interface RequestRoleMigrationPlan {
    /** What to run, in order, to give the new roles what the old ones hold here. */
    statements: string[];
    /** What would take the old roles' grants back in this database, for the operator to run once satisfied. */
    revokeOld: string[];
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;
const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const textArray = (values: readonly string[]): string =>
    values.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;

/** Which new role(s) each old role's grants go to: one old to every new, or pairwise. */
function roleMapping(from: readonly string[], to: readonly string[]): Map<string, string[]> {
    if (from.length === 1) return new Map([[from[0], [...to]]]);
    if (from.length === to.length) return new Map(from.map((role, i) => [role, [to[i]]]));
    throw new Error(
        `Cannot map ${from.length} request roles (${from.join(", ")}) onto ${to.length} (${to.join(", ")}): ` +
        "move from one role to any number, or between two lists of the same length (pairwise, in order)."
    );
}

/**
 * Read the catalogue and plan the move. Writes nothing; {@link migrateRequestRoles}
 * runs the plan.
 */
export async function planRequestRoleMigration(
    run: RawSqlRunner,
    from: readonly string[],
    to: readonly string[]
): Promise<RequestRoleMigrationPlan> {
    const mapping = roleMapping(from, to);
    const statements: string[] = [];
    const revokeOld: string[] = [];
    const grantee = `(SELECT oid FROM pg_roles WHERE rolname = r.name)`;
    const userSchemas = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'";
    const oldRoles = textArray(from);

    const relations = await run(`
        SELECT r.name AS role, n.nspname AS schema, c.relname AS name, c.relkind AS kind,
               a.privilege_type AS privilege, a.is_grantable AS grantable
        FROM unnest(${oldRoles}) AS r(name)
        JOIN pg_class c ON c.relacl IS NOT NULL
        JOIN pg_namespace n ON n.oid = c.relnamespace AND ${userSchemas}
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE a.grantee = ${grantee} AND c.relkind IN ('r', 'v', 'm', 'f', 'p', 'S')
        ORDER BY 2, 3, 5
    `);
    for (const row of relations) {
        const target = `${row.kind === "S" ? "SEQUENCE" : "TABLE"} ${quoteIdent(String(row.schema))}.${quoteIdent(String(row.name))}`;
        for (const role of mapping.get(String(row.role)) ?? []) {
            statements.push(`GRANT ${row.privilege} ON ${target} TO ${quoteIdent(role)}${row.grantable === true ? " WITH GRANT OPTION" : ""}`);
        }
        revokeOld.push(`REVOKE ${row.privilege} ON ${target} FROM ${quoteIdent(String(row.role))}`);
    }

    const columns = await run(`
        SELECT r.name AS role, n.nspname AS schema, c.relname AS name, att.attname AS col, a.privilege_type AS privilege
        FROM unnest(${oldRoles}) AS r(name)
        JOIN pg_attribute att ON att.attacl IS NOT NULL AND NOT att.attisdropped
        JOIN pg_class c ON c.oid = att.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace AND ${userSchemas}
        CROSS JOIN LATERAL aclexplode(att.attacl) a
        WHERE a.grantee = ${grantee}
        ORDER BY 2, 3, 4
    `);
    for (const row of columns) {
        const target = `${quoteIdent(String(row.schema))}.${quoteIdent(String(row.name))}`;
        for (const role of mapping.get(String(row.role)) ?? []) {
            statements.push(`GRANT ${row.privilege} (${quoteIdent(String(row.col))}) ON TABLE ${target} TO ${quoteIdent(role)}`);
        }
        revokeOld.push(`REVOKE ${row.privilege} (${quoteIdent(String(row.col))}) ON TABLE ${target} FROM ${quoteIdent(String(row.role))}`);
    }

    const schemas = await run(`
        SELECT r.name AS role, n.nspname AS schema, a.privilege_type AS privilege
        FROM unnest(${oldRoles}) AS r(name)
        JOIN pg_namespace n ON n.nspacl IS NOT NULL AND ${userSchemas}
        CROSS JOIN LATERAL aclexplode(n.nspacl) a
        WHERE a.grantee = ${grantee}
        ORDER BY 2
    `);
    for (const row of schemas) {
        for (const role of mapping.get(String(row.role)) ?? []) {
            statements.push(`GRANT ${row.privilege} ON SCHEMA ${quoteIdent(String(row.schema))} TO ${quoteIdent(role)}`);
        }
        revokeOld.push(`REVOKE ${row.privilege} ON SCHEMA ${quoteIdent(String(row.schema))} FROM ${quoteIdent(String(row.role))}`);
    }

    const functions = await run(`
        SELECT r.name AS role, p.oid::regprocedure::text AS signature
        FROM unnest(${oldRoles}) AS r(name)
        JOIN pg_proc p ON p.proacl IS NOT NULL
        JOIN pg_namespace n ON n.oid = p.pronamespace AND ${userSchemas}
        CROSS JOIN LATERAL aclexplode(p.proacl) a
        WHERE a.grantee = ${grantee} AND a.privilege_type = 'EXECUTE'
        ORDER BY 2
    `);
    for (const row of functions) {
        for (const role of mapping.get(String(row.role)) ?? []) {
            statements.push(`GRANT EXECUTE ON FUNCTION ${row.signature} TO ${quoteIdent(role)}`);
        }
        revokeOld.push(`REVOKE EXECUTE ON FUNCTION ${row.signature} FROM ${quoteIdent(String(row.role))}`);
    }

    // Default privileges this connection set: what makes tables created later
    // reachable. Ones another role set are that role's to change.
    const defaults = await run(`
        SELECT r.name AS role, n.nspname AS schema, d.defaclobjtype AS kind, a.privilege_type AS privilege
        FROM unnest(${oldRoles}) AS r(name)
        JOIN pg_default_acl d ON d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE a.grantee = ${grantee}
        ORDER BY 2, 3, 4
    `);
    const objectKinds: Record<string, string> = { r: "TABLES", S: "SEQUENCES", f: "FUNCTIONS", T: "TYPES", n: "SCHEMAS" };
    for (const row of defaults) {
        const kind = objectKinds[String(row.kind)];
        if (!kind) continue;
        const scope = row.schema ? ` IN SCHEMA ${quoteIdent(String(row.schema))}` : "";
        for (const role of mapping.get(String(row.role)) ?? []) {
            statements.push(`ALTER DEFAULT PRIVILEGES${scope} GRANT ${row.privilege} ON ${kind} TO ${quoteIdent(role)}`);
        }
        revokeOld.push(`ALTER DEFAULT PRIVILEGES${scope} REVOKE ${row.privilege} ON ${kind} FROM ${quoteIdent(String(row.role))}`);
    }

    // Memberships that carry another role's policies (rls.inheritRoles):
    // the inherit option goes with them, from PostgreSQL 16.
    // `inherit_option` is a column from 16 on, and naming it before then fails
    // the statement whatever a CASE around it says.
    const [server] = await run("SELECT current_setting('server_version_num')::int >= 160000 AS per_grant");
    const memberships = await run(`
        SELECT r.name AS role, g.rolname AS member_of,
               ${server?.per_grant === true ? "m.inherit_option" : "false"} AS inherits
        FROM unnest(${oldRoles}) AS r(name)
        JOIN pg_auth_members m ON m.member = ${grantee}
        JOIN pg_roles g ON g.oid = m.roleid
        ORDER BY 2
    `);
    for (const row of memberships) {
        const option = row.inherits === true ? " WITH INHERIT TRUE, SET FALSE" : "";
        for (const role of mapping.get(String(row.role)) ?? []) {
            statements.push(`GRANT ${quoteIdent(String(row.member_of))} TO ${quoteIdent(role)}${option}`);
        }
    }

    // Policies that name an old role: re-pointed, keeping every other role.
    const policies = await run(`
        SELECT p.schemaname AS schema, p.tablename AS name, p.policyname AS policy, p.roles::text[] AS roles
        FROM pg_policies p
        WHERE p.roles && ${oldRoles}::name[]
        ORDER BY 1, 2, 3
    `);
    for (const row of policies) {
        const current = Array.isArray(row.roles)
            ? row.roles.map(String)
            : String(row.roles ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean);
        const next = Array.from(new Set(current.flatMap((r) => mapping.get(r) ?? [r])));
        statements.push(
            `ALTER POLICY ${quoteIdent(String(row.policy))} ON ${quoteIdent(String(row.schema))}.${quoteIdent(String(row.name))} ` +
            `TO ${next.map((r) => (r === "public" ? "public" : quoteIdent(r))).join(", ")}`
        );
    }

    return { statements, revokeOld };
}

/**
 * Provision the new role(s), run the plan, and record the new roles — in one
 * transaction where the runner has one, so a failure leaves the database on
 * its old roles. Returns the plan that ran.
 */
export async function migrateRequestRoles(
    run: RawSqlRunner,
    options: { from: readonly string[]; to: readonly string[]; schemas: readonly string[] }
): Promise<RequestRoleMigrationPlan> {
    const plan = await planRequestRoleMigration(run, options.from, options.to);
    // The role and the right to switch into it; the grants come from the plan.
    for (const role of options.to) await ensureAppRole(run, [...options.schemas], { role, grants: "none" });
    for (const statement of plan.statements) await run(statement);
    await recordRequestRoles(run, options.to);
    return plan;
}
