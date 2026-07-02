import { EntityCollection, PolicyExpression, PolicyOperand, PolicyCompareOperator, Property } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * Compiles a {@link PolicyExpression} to a PostgreSQL boolean SQL string,
 * suitable for a `USING (...)` / `WITH CHECK (...)` clause.
 *
 * This is one of the two consumers of the shared policy model (the other being
 * {@link evaluatePolicy}); the Postgres schema generators call it so that DDL
 * and the admin UI derive from the exact same expression.
 */
export function policyToPostgres(expr: PolicyExpression, collection?: EntityCollection): string {
    switch (expr.kind) {
        case "true":
            return "true";
        case "false":
            return "false";
        case "and":
            return expr.operands.length === 0
                ? "true"
                : expr.operands.map(o => `(${policyToPostgres(o, collection)})`).join(" AND ");
        case "or":
            return expr.operands.length === 0
                ? "false"
                : expr.operands.map(o => `(${policyToPostgres(o, collection)})`).join(" OR ");
        case "not":
            // Render the common `auth.uid() IS NULL` (unauthenticated) form directly.
            if (expr.operand.kind === "authenticated") return "auth.uid() IS NULL";
            return `NOT (${policyToPostgres(expr.operand, collection)})`;
        case "compare":
            return `${operandToSql(expr.left, collection)} ${COMPARE_SQL[expr.op]} ${operandToSql(expr.right, collection)}`;
        case "rolesOverlap":
            return `string_to_array(auth.roles(), ',') && ${rolesArraySql(expr.roles)}`;
        case "rolesContain":
            return `string_to_array(auth.roles(), ',') @> ${rolesArraySql(expr.roles)}`;
        case "authenticated":
            return "auth.uid() IS NOT NULL";
        case "raw":
            // Full-power escape hatch: `{column}` references resolve to the bare
            // column name (matching the previous raw-SQL behavior).
            return expr.sql.replace(/\{(\w+)\}/g, (_, col) => col);
    }
}

const COMPARE_SQL: Record<PolicyCompareOperator, string> = {
    eq: "=",
    neq: "!=",
    lt: "<",
    lte: "<=",
    gt: ">",
    gte: ">="
};

function operandToSql(operand: PolicyOperand, collection?: EntityCollection): string {
    switch (operand.kind) {
        case "field":
            return resolveColumnName(operand.name, collection);
        case "literal":
            return quoteLiteral(operand.value);
        case "authUid":
            return "auth.uid()";
        case "authRoles":
            return "string_to_array(auth.roles(), ',')";
    }
}

function resolveColumnName(propName: string, collection?: EntityCollection): string {
    const prop = collection?.properties?.[propName] as Property | undefined;
    if (prop && "columnName" in prop && typeof (prop as { columnName?: unknown }).columnName === "string") {
        return (prop as { columnName: string }).columnName;
    }
    return toSnakeCase(propName);
}

function quoteLiteral(value: string | number | boolean | null): string {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    return `'${value.replace(/'/g, "''")}'`;
}

/** Sorted, single-quoted `ARRAY['a','b']` — matches the generators' output. */
function rolesArraySql(roles: readonly string[]): string {
    return `ARRAY[${[...roles].sort().map(r => `'${r}'`).join(",")}]`;
}
