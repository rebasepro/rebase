import {
    appRoleSetupInstructions,
    assertAppRoleRestricted,
    findOtherRoleMembers,
    readRecordedRequestRoles,
    type ManagedTable,
    type RawSqlRunner
} from "./rls-enforcement";
import { REBASE_ADMIN_ROLE } from "@rebasepro/types";
import type { RlsSettings } from "./rls-settings";

/**
 * What `rebase doctor --database` checks: whether this database can host
 * Rebase's request role(s) under the project's `rls` settings, read from the
 * catalogue without changing anything.
 *
 * Every finding that is not "ok" carries the SQL to run as an administrator, the
 * `rls` setting that would adapt Rebase to the database instead, or both — the
 * two ways out of any of them.
 */
export interface PreflightFinding {
    level: "ok" | "warn" | "fail";
    check: string;
    detail: string;
    /** SQL that fixes it, run as a database administrator. */
    sql?: string;
    /** The `rls` setting that would fit Rebase to the database as it is. */
    setting?: string;
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;
const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const textArray = (values: readonly string[]): string =>
    values.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;
const managedPairs = (tables: readonly ManagedTable[]): string =>
    `(SELECT * FROM unnest(${textArray(tables.map((t) => t.schema))}, ${textArray(tables.map((t) => t.table))}))`;

export async function preflightDatabase(
    run: RawSqlRunner,
    settings: RlsSettings,
    options: { schemas: readonly string[]; managedTables: readonly ManagedTable[] }
): Promise<PreflightFinding[]> {
    const findings: PreflightFinding[] = [];
    // Only schemas that exist: a GRANT on a missing one breaks the setup SQL
    // these findings hand out.
    const existing = await run(`SELECT nspname FROM pg_namespace WHERE nspname = ANY(${textArray(Array.from(new Set(options.schemas)))})`);
    const schemas = existing.map((row) => String(row.nspname));
    const [who] = await run(`
        SELECT current_user AS role, current_database() AS database,
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
               current_setting('server_version_num')::int >= 160000 AS per_grant
    `);
    const connection = String(who?.role ?? "");
    const perGrant = who?.per_grant === true;

    const recorded = await readRecordedRequestRoles(run);
    if (recorded && (recorded.length !== settings.roles.length || !settings.roles.every((r) => recorded.includes(r)))) {
        findings.push({
            level: "fail",
            check: "Recorded request roles",
            detail: `This database records ${recorded.join(", ")}, but the settings name ${settings.roles.join(", ")}. A boot refuses until they agree.`,
            sql: `-- from the project: rebase db request-role migrate --to ${settings.roles.join(",")}`
        });
    }

    for (const role of settings.roles) {
        const [state] = await run(`
            SELECT to_regrole(${sqlLiteral(role)}) IS NOT NULL AS present,
                   COALESCE(pg_has_role(current_user, to_regrole(${sqlLiteral(role)}), '${perGrant ? "SET" : "MEMBER"}'), false) AS can_switch,
                   (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can_create
        `);
        if (state?.present !== true) {
            const creates = settings.provisionRole === "auto" && (state?.can_create === true || who?.superuser === true);
            findings.push({
                level: creates ? "ok" : "fail",
                check: `Request role "${role}"`,
                detail: creates
                    ? "Does not exist yet; the first boot creates it."
                    : settings.provisionRole === "never"
                        ? "Does not exist, and rls.provisionRole is \"never\"."
                        : `Does not exist, and "${connection}" cannot create roles.`,
                sql: creates ? undefined : appRoleSetupInstructions(connection, [...schemas], role, settings.grants)
            });
            continue;
        }
        try {
            await assertAppRoleRestricted(run, role);
        } catch (err) {
            findings.push({
                level: "fail",
                check: `Request role "${role}"`,
                detail: err instanceof Error ? err.message.split("\n\n")[0] : String(err),
                sql: err instanceof Error && "instructions" in err ? String((err as { instructions: unknown }).instructions) : undefined
            });
            continue;
        }
        if (state?.can_switch !== true && who?.superuser !== true) {
            findings.push({
                level: settings.provisionRole === "auto" ? "warn" : "fail",
                check: `Switching to "${role}"`,
                detail: `"${connection}" may not switch to it${perGrant ? " (no membership WITH SET TRUE)" : ""}.` +
                    (settings.provisionRole === "auto" ? " A boot grants that to itself when it can." : ""),
                sql: appRoleSetupInstructions(connection, [...schemas], role, settings.grants)
            });
        } else {
            findings.push({ level: "ok", check: `Request role "${role}"`, detail: "Exists, restricted, and this connection can switch to it." });
        }

        const others = await findOtherRoleMembers(run, role);
        if (others.length > 0) {
            findings.push({
                level: settings.sharedRole === "refuse" ? "fail" : "warn",
                check: `Who else can use "${role}"`,
                detail: `${others.join(", ")} can switch into it, and so can pass this database's policies as whichever user they like.`,
                setting: "rls.requestRole (a role of this project's own), then `rebase db request-role migrate`"
            });
        }
    }

    const [database] = await run(`
        SELECT d.datacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(d.datacl) a WHERE a.grantee = 0 AND a.privilege_type = 'CONNECT') AS public_connect
        FROM pg_database d WHERE d.datname = current_database()
    `);
    if (database?.public_connect === true) {
        findings.push({
            level: "warn",
            check: "Who can connect",
            detail: "Every role on the cluster may connect to this database (PUBLIC holds CONNECT, the default).",
            sql: `REVOKE CONNECT ON DATABASE ${quoteIdent(String(who?.database ?? ""))} FROM PUBLIC;\nGRANT CONNECT ON DATABASE ${quoteIdent(String(who?.database ?? ""))} TO ${quoteIdent(connection)};`
        });
    }

    const [unmanaged] = await run(`
        SELECT count(*)::int AS count, string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY n.nspname, c.relname) AS sample
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(${textArray(schemas)}) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (n.nspname, c.relname::text) NOT IN ${managedPairs(options.managedTables)}
          AND n.nspname <> 'rebase'
    `);
    const unmanagedCount = Number(unmanaged?.count ?? 0);
    if (unmanagedCount > 0 && settings.grants === "schema") {
        findings.push({
            level: "warn",
            check: "Tables Rebase does not serve",
            detail: `${unmanagedCount} table(s) in ${schemas.join(", ")} back no declared table (${String(unmanaged?.sample ?? "").split(", ").slice(0, 5).join(", ")}${unmanagedCount > 5 ? ", …" : ""}). With grants: "schema" the request role gets DML on every one this connection may grant on.`,
            setting: "rls.grants = \"managed\""
        });
    }

    const foreign = await run(`
        SELECT DISTINCT g.rolname AS grantee
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        JOIN pg_roles g ON g.oid = a.grantee
        WHERE (n.nspname, c.relname::text) IN ${managedPairs(options.managedTables)}
          AND g.rolname <> ALL(${textArray([...settings.roles, connection])})
          AND a.grantee <> c.relowner
        ORDER BY 1
    `);
    if (foreign.length > 0 && settings.policyTarget === "public") {
        findings.push({
            level: "warn",
            check: "Other roles on Rebase's tables",
            detail: `${foreign.map((r) => r.grantee).join(", ")} hold privileges on tables Rebase serves. Its permissive policies apply TO public, so a session of theirs that never sets Rebase's identity passes the server-context arm and sees every row.`,
            setting: "rls.policyTarget = \"requestRole\""
        });
    }

    // `rls.adminPolicies: "adminRole"`: the server-or-admin policies are `TO
    // rebase_admin`, and admin requests switch to `<role>_admin`. A missing
    // piece fails closed — admins are refused, nobody gains — so a warning.
    for (const [role, adminRole] of settings.adminRoles) {
        const [state] = await run(`
            SELECT to_regrole('${REBASE_ADMIN_ROLE}') IS NOT NULL AS marker,
                   to_regrole(${sqlLiteral(adminRole)}) IS NOT NULL AS present,
                   COALESCE(pg_has_role(to_regrole(${sqlLiteral(adminRole)}), to_regrole(${sqlLiteral(role)}), 'USAGE'), false)
                       AND COALESCE(pg_has_role(to_regrole(${sqlLiteral(adminRole)}), to_regrole('${REBASE_ADMIN_ROLE}'), 'USAGE'), false) AS inherits,
                   (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can_create
        `);
        if (state?.marker === true && state?.present === true && state?.inherits === true) {
            findings.push({ level: "ok", check: `Admin request role "${adminRole}"`, detail: `Inherits "${role}" and "${REBASE_ADMIN_ROLE}".` });
            continue;
        }
        const boots = settings.provisionRole === "auto" && (state?.can_create === true || who?.superuser === true);
        const grant = (granted: string) => perGrant
            ? `GRANT ${quoteIdent(granted)} TO ${adminRole} WITH INHERIT TRUE, SET FALSE;`
            : `GRANT ${quoteIdent(granted)} TO ${adminRole};`;
        findings.push({
            level: boots ? "ok" : "warn",
            check: `Admin request role "${adminRole}"`,
            detail: (state?.marker === true ? "" : `"${REBASE_ADMIN_ROLE}" does not exist. `) +
                (state?.present === true ? `It does not inherit "${role}" and "${REBASE_ADMIN_ROLE}".` : "Does not exist.") +
                (boots ? " The next boot provisions it." : " Until it does, admin requests run as the request role and the server-or-admin policies refuse them."),
            sql: boots ? undefined : [
                ...(state?.marker === true ? [] : [`CREATE ROLE ${REBASE_ADMIN_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;`]),
                ...(state?.present === true ? [] : [`CREATE ROLE ${adminRole} NOLOGIN NOSUPERUSER NOBYPASSRLS ${perGrant ? "NOINHERIT" : "INHERIT"};`]),
                grant(role),
                grant(REBASE_ADMIN_ROLE),
                `GRANT ${adminRole} TO ${quoteIdent(connection)}${perGrant ? " WITH SET TRUE, INHERIT FALSE" : ""};`
            ].join("\n"),
            setting: "rls.adminPolicies = \"public\""
        });
    }

    const unreachable = await run(`
        SELECT p.schemaname || '.' || p.tablename AS name, p.policyname AS policy, r.role AS role
        FROM pg_policies p CROSS JOIN LATERAL unnest(p.roles::text[]) AS r(role)
        WHERE (p.schemaname, p.tablename::text) IN ${managedPairs(options.managedTables)}
          AND r.role <> 'public' AND r.role <> '${REBASE_ADMIN_ROLE}' AND r.role <> ALL(${textArray(settings.roles)})
          AND NOT EXISTS (SELECT 1 FROM unnest(${textArray(settings.roles)}) AS q(name)
                          WHERE COALESCE(pg_has_role(to_regrole(q.name), to_regrole(r.role), 'USAGE'), false))
        ORDER BY 1, 2
    `);
    if (unreachable.length > 0) {
        const roles = Array.from(new Set(unreachable.map((r) => String(r.role))));
        findings.push({
            level: "warn",
            check: "Policies that never apply to requests",
            detail: `${unreachable.length} polic${unreachable.length === 1 ? "y" : "ies"} on Rebase's tables target ${roles.join(", ")}, whose privileges the request role does not have (e.g. ${unreachable[0].policy} on ${unreachable[0].name}).`,
            setting: perGrant ? `rls.inheritRoles = [${roles.map((r) => `"${r}"`).join(", ")}]` : "move them into the table's `rls` rules (PostgreSQL 15 cannot inherit per grant)"
        });
    }

    const defaults = await run(`
        SELECT DISTINCT g.rolname AS grantee, n.nspname AS schema
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        JOIN pg_roles g ON g.oid = a.grantee
        WHERE n.nspname = ANY(${textArray(schemas)}) AND d.defaclobjtype = 'r'
          AND g.rolname <> ALL(${textArray([...settings.roles, connection])})
        ORDER BY 2, 1
    `);
    if (defaults.length > 0) {
        findings.push({
            level: "warn",
            check: "Default privileges for other roles",
            detail: `New tables in ${Array.from(new Set(defaults.map((d) => d.schema))).join(", ")} are granted to ${Array.from(new Set(defaults.map((d) => d.grantee))).join(", ")} as they are created — Rebase's declared tables included.`,
            setting: settings.policyTarget === "public" ? "rls.policyTarget = \"requestRole\"" : undefined
        });
    }

    return findings;
}
