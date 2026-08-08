/**
 * Row security for MongoDB.
 *
 * MongoDB has no RLS, so this driver enforces `securityRules` in-process. That
 * makes the translation from a rule to a query the enforcement boundary, and it
 * has exactly one safe failure mode: refuse.
 *
 * Two properties this file exists to hold:
 *
 * 1. **One predicate, one implementation.** The rules are compiled through the
 *    same {@link securityRuleToConditions} the Postgres DDL generator and the
 *    admin UI's `checkOperation` use, so "what does this rule mean" is answered
 *    in one place. The previous translator re-parsed the raw SQL itself and
 *    recognised four shapes — a second, smaller parser that disagreed with the
 *    first about the same rule.
 * 2. **Fail closed, out loud.** An expression with no MongoDB equivalent (raw
 *    SQL, a membership subquery, a negated row predicate) used to become `{}` —
 *    "match every document". It now raises {@link SECURITY_RULE_UNSUPPORTED},
 *    the same shape the REST layer uses to refuse bulk writes this driver
 *    cannot perform: a request that cannot be authorized is not served.
 */

import { Document, Filter } from "mongodb";
import {
    ANONYMOUS_USER_ID,
    CollectionConfig,
    PolicyExpression,
    PolicyOperand,
    SecurityOperation,
    SecurityRule,
    User,
    isAnonymousUid
} from "@rebasepro/types";
import { securityRuleToConditions } from "@rebasepro/common";
import { ApiError } from "@rebasepro/server";

/** Matches every document. */
const MATCH_ALL: Filter<Document> = {};

/**
 * Matches no document. A distinct object rather than a `false` sentinel so it
 * can be nested inside `$and`/`$or` like any other filter; identity is what
 * {@link isMatchNone} tests, so never mutate or copy it.
 */
const MATCH_NONE: Filter<Document> = { _id: { $exists: false } };

/** The expression has no MongoDB equivalent — the caller must refuse. */
const UNTRANSLATABLE = "untranslatable" as const;

type TranslationResult = Filter<Document> | typeof UNTRANSLATABLE;

function isMatchAll(f: TranslationResult): boolean {
    return f !== UNTRANSLATABLE && f !== MATCH_NONE && Object.keys(f).length === 0;
}

function isMatchNone(f: TranslationResult): boolean {
    return f === MATCH_NONE;
}

/** The error code a caller sees when a rule cannot be honoured. */
export const SECURITY_RULE_UNSUPPORTED = "SECURITY_RULE_UNSUPPORTED";

/**
 * The refusal. Names the collection, the clause and the expression, because the
 * only useful thing an operator can do with this is rewrite that rule — or move
 * the collection to an engine that can enforce it.
 */
export function securityRuleUnsupported(
    collectionSlug: string,
    clause: "using" | "withCheck",
    detail: string
): ApiError {
    return ApiError.internal(
        `This collection's data source (MongoDB) cannot enforce a security rule on "${collectionSlug}": ` +
        `the \`${clause}\` expression ${detail} has no MongoDB equivalent. The request was refused rather ` +
        "than served without row authorization. Express the rule with `access`, `ownerField`, `roles`, or a " +
        "structured `condition`/`check`, or move this collection to a Postgres data source.",
        SECURITY_RULE_UNSUPPORTED
    );
}

/** Describe an expression well enough for the refusal message to be actionable. */
function describe(expr: PolicyExpression): string {
    switch (expr.kind) {
        case "raw":
            return `\`${expr.sql}\``;
        case "existsIn":
            return `a membership subquery over \`${expr.collection}\``;
        case "not":
            return "a negated row predicate";
        default:
            return `a \`${expr.kind}\` node`;
    }
}

/** The first node of an expression tree this driver cannot translate, if any. */
function findUntranslatable(expr: PolicyExpression, hasRow: boolean): PolicyExpression | undefined {
    switch (expr.kind) {
        case "and":
        case "or": {
            for (const operand of expr.operands) {
                const found = findUntranslatable(operand, hasRow);
                if (found) return found;
            }
            return undefined;
        }
        case "not":
            // Only decidable without the row when the operand is: negating a
            // column predicate in MongoDB (`$nor`) also matches documents that
            // lack the column, which SQL's three-valued logic would exclude.
            return hasRow ? findUntranslatable(expr.operand, hasRow) : (referencesField(expr.operand) ? expr : undefined);
        case "compare":
            return operandUntranslatable(expr.left) || operandUntranslatable(expr.right) ? expr : undefined;
        case "existsIn":
        case "raw":
            return expr;
        default:
            return undefined;
    }
}

function operandUntranslatable(operand: PolicyOperand): boolean {
    return operand.kind === "outerField";
}

function referencesField(expr: PolicyExpression): boolean {
    switch (expr.kind) {
        case "and":
        case "or":
            return expr.operands.some(referencesField);
        case "not":
            return referencesField(expr.operand);
        case "compare":
            return expr.left.kind === "field" || expr.right.kind === "field" ||
                expr.left.kind === "outerField" || expr.right.kind === "outerField";
        default:
            return false;
    }
}

/** The acting user, as the policy model sees them. */
interface PolicyUserContext {
    uid: string;
    roles: string[];
}

function userContext(user: User | undefined): PolicyUserContext {
    // The sentinel, not an empty string: `rebase.uid()` is never NULL for a
    // request that came from a client, and an `ownerField` rule compared
    // against `undefined` would become `{ owner: undefined }` — which MongoDB
    // reads as `{ owner: null }` and matches every document that has no owner.
    return {
        uid: user?.uid || ANONYMOUS_USER_ID,
        roles: user?.roles ?? []
    };
}

const COMPARE_TO_MONGO = {
    eq: "$eq",
    neq: "$ne",
    lt: "$lt",
    lte: "$lte",
    gt: "$gt",
    gte: "$gte"
} as const;

const INVERTED_COMPARE = {
    eq: "eq",
    neq: "neq",
    lt: "gt",
    lte: "gte",
    gt: "lt",
    gte: "lte"
} as const;

type ResolvedOperand =
    | { kind: "field"; name: string }
    | { kind: "value"; value: unknown }
    | { kind: "unknown" };

function resolveOperand(operand: PolicyOperand, ctx: PolicyUserContext): ResolvedOperand {
    switch (operand.kind) {
        case "literal":
            return { kind: "value", value: operand.value };
        case "authUid":
            return { kind: "value", value: ctx.uid };
        case "authRoles":
            return { kind: "value", value: ctx.roles };
        case "field":
            return { kind: "field", name: operand.name };
        case "outerField":
            return { kind: "unknown" };
    }
}

/**
 * Translate one {@link PolicyExpression} into a MongoDB filter, or
 * {@link UNTRANSLATABLE}.
 *
 * The JavaScript twin of `evaluatePolicy`, one level up: where that decides a
 * single row, this narrows a query. `"unknown"` there and `UNTRANSLATABLE` here
 * are the same condition, and both are resolved fail-closed by their callers.
 */
export function policyToMongoFilter(expr: PolicyExpression, user: User | undefined): TranslationResult {
    const ctx = userContext(user);

    switch (expr.kind) {
        case "true":
            return MATCH_ALL;
        case "false":
            return MATCH_NONE;
        case "and": {
            const parts = expr.operands.map(o => policyToMongoFilter(o, user));
            // Kleene AND: a `false` operand settles the conjunction even when a
            // sibling is untranslatable, which is what keeps a role-scoped raw
            // rule from refusing requests it does not even apply to.
            if (parts.some(isMatchNone)) return MATCH_NONE;
            if (parts.some(p => p === UNTRANSLATABLE)) return UNTRANSLATABLE;
            const clauses = (parts as Filter<Document>[]).filter(p => !isMatchAll(p));
            if (clauses.length === 0) return MATCH_ALL;
            if (clauses.length === 1) return clauses[0];
            return { $and: clauses } as Filter<Document>;
        }
        case "or": {
            const parts = expr.operands.map(o => policyToMongoFilter(o, user));
            if (parts.some(isMatchAll)) return MATCH_ALL;
            if (parts.some(p => p === UNTRANSLATABLE)) return UNTRANSLATABLE;
            const clauses = (parts as Filter<Document>[]).filter(p => !isMatchNone(p));
            if (clauses.length === 0) return MATCH_NONE;
            if (clauses.length === 1) return clauses[0];
            return { $or: clauses } as Filter<Document>;
        }
        case "not": {
            const inner = policyToMongoFilter(expr.operand, user);
            // Constant-folded only. See `findUntranslatable` for why a negated
            // column predicate is refused instead of becoming `$nor`.
            if (isMatchAll(inner)) return MATCH_NONE;
            if (isMatchNone(inner)) return MATCH_ALL;
            return UNTRANSLATABLE;
        }
        case "compare": {
            const left = resolveOperand(expr.left, ctx);
            const right = resolveOperand(expr.right, ctx);
            if (left.kind === "unknown" || right.kind === "unknown") return UNTRANSLATABLE;

            if (left.kind === "field" && right.kind === "value") {
                return { [left.name]: { [COMPARE_TO_MONGO[expr.op]]: right.value } } as Filter<Document>;
            }
            if (left.kind === "value" && right.kind === "field") {
                return { [right.name]: { [COMPARE_TO_MONGO[INVERTED_COMPARE[expr.op]]]: left.value } } as Filter<Document>;
            }
            if (left.kind === "field" && right.kind === "field") {
                return { $expr: { [COMPARE_TO_MONGO[expr.op]]: [`$${left.name}`, `$${right.name}`] } } as Filter<Document>;
            }
            // Both sides are known values — the comparison is a constant.
            if (left.kind === "value" && right.kind === "value") {
                return compareValues(expr.op, left.value, right.value);
            }
            return UNTRANSLATABLE;
        }
        case "rolesOverlap":
            return expr.roles.some(r => r === "public" || ctx.roles.includes(r)) ? MATCH_ALL : MATCH_NONE;
        case "rolesContain":
            return expr.roles.every(r => r === "public" || ctx.roles.includes(r)) ? MATCH_ALL : MATCH_NONE;
        case "authenticated":
            return !isAnonymousUid(ctx.uid) ? MATCH_ALL : MATCH_NONE;
        case "serverContext":
            // A scoped driver is always acting for a user, never the server
            // context — the same answer `evaluatePolicy` gives.
            return MATCH_NONE;
        case "existsIn":
        case "raw":
            return UNTRANSLATABLE;
    }
}

function compareValues(op: keyof typeof COMPARE_TO_MONGO, a: unknown, b: unknown): TranslationResult {
    if (op === "eq") return a === b ? MATCH_ALL : MATCH_NONE;
    if (op === "neq") return a !== b ? MATCH_ALL : MATCH_NONE;
    if ((typeof a === "string" && typeof b === "string") || (typeof a === "number" && typeof b === "number")) {
        const decided = op === "lt" ? a < b : op === "lte" ? a <= b : op === "gt" ? a > b : a >= b;
        return decided ? MATCH_ALL : MATCH_NONE;
    }
    return UNTRANSLATABLE;
}

/** The rules that apply to `targetOperation`, mirroring `checkOperation`. */
function applicableRules(collection: CollectionConfig | undefined, targetOperation: SecurityOperation): SecurityRule[] {
    const rules = collection?.securityRules;
    if (!rules || rules.length === 0) return [];
    return rules.filter((rule: SecurityRule) => {
        const ops = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
        return ops.includes(targetOperation) || ops.includes("all");
    });
}

/** Which clause of a rule constrains `targetOperation` — Postgres's own split. */
function clauseFor(targetOperation: SecurityOperation): "using" | "withCheck" {
    return targetOperation === "insert" ? "withCheck" : "using";
}

/**
 * Refuse up front when this collection's rules cannot be enforced for
 * `targetOperation`.
 *
 * The row-in-hand paths (`fetchOne`, `save`, `delete`) resolve an undecidable
 * rule through `checkOperation`'s `onUnknown: "deny"`, which is safe but
 * indistinguishable from a plain "you may not do that". Calling this first
 * turns the same condition into the refusal an operator can act on.
 */
export function assertSecurityRulesEnforceable(
    collection: CollectionConfig | undefined,
    targetOperation: SecurityOperation
): void {
    for (const rule of applicableRules(collection, targetOperation)) {
        const conditions = securityRuleToConditions(rule);
        const clauses: ("using" | "withCheck")[] = targetOperation === "insert"
            ? ["withCheck"]
            : targetOperation === "update" ? ["using", "withCheck"] : ["using"];
        for (const clause of clauses) {
            const expr = clause === "using" ? conditions.usingExpr : conditions.withCheckExpr;
            if (!expr) continue;
            // `hasRow: true` — these callers evaluate against a fetched row, so
            // only the nodes no JavaScript evaluator can decide are refused.
            const offending = findUntranslatable(expr, true);
            if (offending) {
                throw securityRuleUnsupported(collection?.slug ?? "unknown", clause, describe(offending));
            }
        }
    }
}

/**
 * Build the MongoDB filter that narrows a query to the rows `user` may see
 * under `collection`'s security rules.
 *
 * Returns `null` when no row can qualify (the caller answers with an empty
 * result), `{}` when the rules impose no narrowing, and throws
 * {@link SECURITY_RULE_UNSUPPORTED} when a rule cannot be translated.
 */
export function buildMongoFilterFromSecurityRules<M extends Record<string, any>>(
    collection: CollectionConfig<M> | undefined,
    user: User | undefined,
    targetOperation: SecurityOperation
): Filter<Document> | null {
    const rules = applicableRules(collection as CollectionConfig | undefined, targetOperation);
    if (!collection?.securityRules || collection.securityRules.length === 0) {
        return MATCH_ALL;
    }
    // Rules exist but none covers this operation — Postgres denies, so do we.
    if (rules.length === 0) return null;

    const clause = clauseFor(targetOperation);
    const permissive: Filter<Document>[] = [];
    const restrictive: Filter<Document>[] = [];

    for (const rule of rules) {
        const conditions = securityRuleToConditions(rule);
        const expr = clause === "using" ? conditions.usingExpr : conditions.withCheckExpr;
        // A null clause denies, matching Postgres's `USING (false)`.
        const filter = expr === null ? MATCH_NONE : policyToMongoFilter(expr, user);
        if (filter === UNTRANSLATABLE) {
            const offending = expr === null ? undefined : findUntranslatable(expr, false);
            throw securityRuleUnsupported(
                collection.slug,
                clause,
                offending ? describe(offending) : "this rule"
            );
        }
        if ((rule.mode || "permissive") === "restrictive") {
            restrictive.push(filter);
        } else {
            permissive.push(filter);
        }
    }

    // No permissive rule can grant → nothing is visible, exactly as
    // `checkOperation` returns false when `hasPermissive` is false.
    if (permissive.length === 0) return null;

    const parts: Filter<Document>[] = [];
    if (!permissive.some(isMatchAll)) {
        // A permissive rule that matches nothing contributes nothing to the
        // union; if that is all of them, nothing is visible.
        const granting = permissive.filter(p => !isMatchNone(p));
        if (granting.length === 0) return null;
        parts.push(granting.length === 1 ? granting[0] : ({ $or: granting } as Filter<Document>));
    }

    for (const rf of restrictive) {
        if (isMatchNone(rf)) return null;
        if (!isMatchAll(rf)) parts.push(rf);
    }

    if (parts.length === 0) return MATCH_ALL;
    if (parts.length === 1) return parts[0];
    return { $and: parts } as Filter<Document>;
}
