/**
 * Who may read the user picker (`GET /api/admin/users/pick`).
 *
 * A user column (`.userId()`, `semantic: "user"` — a column, the items of an
 * array, or a field of a JSON document) stores a user's id, and the person
 * filling it in picks that user from a list. Listing the users is an
 * admin-plane read (`users:read`), which an editor does not hold — so the
 * picker answers a narrower question for a wider audience: id, name, email and
 * avatar, to anyone who may write a table that has such a column.
 *
 * "May write" is the table's row-level security for an insert or an update,
 * read from its descriptor (`checkTableOperation`), with one difference from
 * Postgres. A rule that depends only on the row (an owner column) counts as
 * allowing, since the person may write some row. A rule written as SQL the
 * policy model cannot read cannot be judged ahead, and here it counts as
 * refusing: read optimistically, it would let any signed-in person list every
 * user's name and email. A key or token narrowed by scopes must also hold
 * `data:write` on that table.
 *
 * The tables are the backend's own (`c.var.services`), read when the question
 * is asked, so a schema edited live is what is judged.
 *
 * @module
 */
import type { Context } from "hono";
import { checkTableOperation, referencesUsers, securityRuleToConditions } from "@rebasepro/common";
import {
    isAnonymousUid,
    policy,
    type PolicyExpression,
    type SecurityRule,
    type TableDescriptor
} from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { hasScope } from "./access";

/**
 * The tables the picker judges for a route mounted outside any backend:
 * the process default's. None until a backend is installed as the default, or
 * a test configures some.
 */
let tablesForPicking: () => readonly TableDescriptor[] = () => [];

/** Tell the process default's picker which tables it serves. */
export function configureUserPicking(tables: () => readonly TableDescriptor[]): void {
    tablesForPicking = tables;
}

/** @internal The process default's tables getter, to snapshot or restore it. */
export function defaultUserPicking(): () => readonly TableDescriptor[] {
    return tablesForPicking;
}

/** Whether any part of a policy is raw SQL the evaluator cannot decide. */
function containsRawSql(expr: PolicyExpression | null): boolean {
    if (!expr) return false;
    switch (expr.kind) {
        case "raw":
            return true;
        case "and":
        case "or":
            return expr.operands.some(containsRawSql);
        case "not":
            return containsRawSql(expr.operand);
        case "existsIn":
            return containsRawSql(expr.where);
        default:
            return false;
    }
}

/**
 * The rule with each clause that holds raw SQL read as `false`, so an
 * undecidable rule never grants (permissive) and always refuses
 * (restrictive). The clauses are carried already desugared — roles folded
 * in — so nothing else in the rule is read again.
 */
function failClosedOnRawSql(rule: SecurityRule): SecurityRule {
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);
    if (!containsRawSql(usingExpr) && !containsRawSql(withCheckExpr)) return rule;
    // A missing clause refuses (Postgres writes `false` for it), so `false`
    // stands in for one as well as for a raw clause.
    const clause = (expr: PolicyExpression | null): PolicyExpression =>
        expr === null || containsRawSql(expr) ? policy.false() : expr;
    return {
        operation: rule.operation,
        operations: rule.operations,
        mode: rule.mode,
        name: rule.name,
        condition: clause(usingExpr),
        check: clause(withCheckExpr)
    };
}

/** The signed-in person behind a request, as the policy evaluator reads one. */
function personOf(c: Context<HonoEnv>): { uid: string; roles: string[] } | null {
    const user = c.get("user");
    if (typeof user !== "object" || user === null) return null;
    const uid = typeof user.uid === "string" ? user.uid : undefined;
    if (!uid || isAnonymousUid(uid)) return null;
    if ("isAnonymous" in user && user.isAnonymous === true) return null;
    const roles = Array.isArray(user.roles) ? user.roles.filter((role): role is string => typeof role === "string") : [];
    return { uid, roles };
}

/**
 * Whether this request's caller may read the user picker: they hold
 * `users:read`, or they may write a table with a user column.
 */
export function mayPickUsers(c: Context<HonoEnv>): boolean {
    if (hasScope(c, "users:read")) return true;
    const person = personOf(c);
    if (!person) return false;
    const tables = c.get("services")?.tables ?? tablesForPicking;
    return tables().some(table => {
        if (!referencesUsers(table) || !hasScope(c, "data:write", table.slug)) return false;
        const options = { mapRule: failClosedOnRawSql };
        return checkTableOperation(table, person, "insert", options)
            || checkTableOperation(table, person, "update", options);
    });
}
