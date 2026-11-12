/**
 * A table's row-level security as the rules the panel gates its controls by.
 *
 * The panel hides Create, Edit and Delete through `checkOperation`
 * (`@rebasepro/common`), which reads `securityRules` — and which treats a
 * collection with **no** rules as open to everyone. So the rules projected here
 * are the *effective* ones: what the author declared plus what Rebase injects
 * into Postgres beside them, computed by the same `getEffectiveSecurityRules`
 * the policy generator uses. The panel then hides exactly what the database
 * refuses, and a protected table never projects to an empty list.
 */
import type {
    CollectionTenantConfig,
    PostgresCollectionConfig,
    PostgresProperties,
    SecurityRule,
    TableDescriptor
} from "@rebasepro/types";
import { policy } from "@rebasepro/types";
import { getEffectiveSecurityRules } from "@rebasepro/common";

/**
 * What a raw-SQL clause the server withheld is replaced with. It parses to a
 * `raw` policy node, which the client evaluator answers "unknown" for — the
 * answer any raw clause gets, so a withheld clause hides nothing a visible one
 * would have shown.
 */
export const REDACTED_SQL = "/* withheld by the server */";

/**
 * A raw clause that arrived as something other than SQL text (the server's
 * marker for a clause it does not show this caller), replaced with
 * {@link REDACTED_SQL}. Absent clauses stay absent: an absent `using` means
 * "no row may be read", and inventing one would grant.
 */
function withRedactedClauses(rule: SecurityRule): SecurityRule {
    const redacted = (key: "using" | "withCheck"): boolean => {
        if (!Object.prototype.hasOwnProperty.call(rule, key)) return false;
        const value: unknown = Reflect.get(rule, key);
        return value !== undefined && typeof value !== "string";
    };
    const using = redacted("using");
    const withCheck = redacted("withCheck");
    if (!using && !withCheck) return rule;
    // A rule carrying raw SQL is a raw rule: rebuilt as one, with the
    // targeting fields kept and nothing else that could change its meaning.
    const target = {
        ...(rule.name !== undefined ? { name: rule.name } : {}),
        ...(rule.operation !== undefined ? { operation: rule.operation } : {}),
        ...(rule.operations !== undefined ? { operations: rule.operations } : {}),
        ...(rule.mode !== undefined ? { mode: rule.mode } : {}),
        ...(rule.roles !== undefined ? { roles: rule.roles } : {}),
        ...(rule.pgRoles !== undefined ? { pgRoles: rule.pgRoles } : {})
    };
    const keptCheck = typeof rule.withCheck === "string" ? rule.withCheck : undefined;
    const check = withCheck ? REDACTED_SQL : keptCheck;
    if (using) return { ...target, using: REDACTED_SQL, ...(check !== undefined ? { withCheck: check } : {}) };
    const keptUsing = typeof rule.using === "string" ? rule.using : undefined;
    if (keptUsing !== undefined) return { ...target, using: keptUsing, withCheck: REDACTED_SQL };
    return { ...target, withCheck: REDACTED_SQL };
}

/** The facts `getEffectiveSecurityRules` reads besides the rules themselves. */
export interface RlsProjectionBasis {
    /** The projected properties: the auth self-read rule names the id column. */
    properties: PostgresProperties;
}

/**
 * A view's rules. Its `rls` (`posture: "view"`) grants nothing by itself, so
 * it is not read:
 *
 * - a plain view runs `security_invoker`, so the tables it reads decide every
 *   row. That cannot be decided here, and is projected as a read rule the
 *   evaluator answers "unknown" for — the view is listed, the server decides;
 * - a materialized view is read by the roles it names (`["admin"]` when it
 *   names none), as `checkOperation` already enforces from `view.roles`.
 *
 * Writes are refused by `checkOperation` for every view.
 */
function viewRules(table: TableDescriptor): SecurityRule[] {
    if (table.view?.materialized) {
        return [{ name: `${table.table}_view_read`, operations: ["select"], roles: table.view.roles ?? ["admin"] }];
    }
    return [{
        name: `${table.table}_view_read`,
        operations: ["select"],
        condition: policy.raw("/* security_invoker: decided by the tables the view reads */")
    }];
}

/**
 * The rules the panel evaluates for a table.
 *
 * - a view (`kind: "view"`, `posture: "view"`) → its own read rule, from
 *   `view` (see `viewRules`).
 * - `posture: "view"` on a table, which the compiler never emits → one rule
 *   that grants nothing.
 * - `posture: "admin-only"` → the injected admin baseline alone: admins may
 *   read and write, nobody else may do anything.
 * - `posture: "rules"` → the declared rules, plus the admin baseline unless
 *   `defaultPolicies` is `false`.
 * - On top of either, as in Postgres: the auth table's self-read and its
 *   restrictive admin write gate, and the tenant table's restrictive tenancy
 *   rule.
 * - Raw clauses the server withheld evaluate as "unknown", like any raw clause.
 * - Should all of that come to nothing (a posture the compiler refuses, such as
 *   `admin-only` without the baseline), the result is one rule that grants
 *   nothing — never an empty list, which the panel reads as open.
 */
export function securityRulesFromRls(table: TableDescriptor, basis: RlsProjectionBasis): SecurityRule[] {
    if (table.kind === "view") return viewRules(table);
    if (table.rls.posture === "view") return [closedRule(table)];

    const declared = table.rls.posture === "admin-only" ? [] : table.rls.rules.map(withRedactedClauses);
    const tenant: CollectionTenantConfig | undefined = table.tenant
        ? {
            field: table.tenant.field,
            from: table.tenant.from,
            ...(table.tenant.bypassRoles ? { bypassRoles: table.tenant.bypassRoles } : {})
        }
        : undefined;

    const collection: PostgresCollectionConfig = {
        slug: table.slug,
        name: table.name,
        table: table.table,
        schema: table.schema,
        properties: basis.properties,
        securityRules: declared,
        disableDefaultPolicies: !table.rls.defaultPolicies,
        ...(table.auth ? { auth: { enabled: true } } : {}),
        ...(tenant ? { tenant } : {})
    };

    const effective = getEffectiveSecurityRules(collection);
    if (effective.length > 0) return effective;
    return [closedRule(table)];
}

/** One rule that grants nothing: never an empty list, which the panel reads as open. */
function closedRule(table: TableDescriptor): SecurityRule {
    return { name: `${table.table}_closed`, operations: ["all"], condition: policy.false() };
}
