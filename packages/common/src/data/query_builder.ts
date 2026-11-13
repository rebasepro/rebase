import { FilterCondition, LogicalCondition, WhereFilterOp } from "@rebasepro/types";

/**
 * Any condition a group may hold. The helpers below are generic over it so the
 * group they return keeps each condition's column, operator and value exactly
 * as written — which is what lets a typed `logical` / `.where(group)` check
 * them against the row ({@link LogicalConditionFor}). Their results are still
 * plain `LogicalCondition`s anywhere one is expected.
 */
type AnyCondition = FilterCondition | LogicalCondition;

/** A value as `cond` keeps it: literals stay literals, so `"draft"` can match a `"draft" | "published"` column. */
type ConditionValue = string | number | bigint | boolean | symbol | object | null | undefined;

/** An empty group, to push conditions into later. */
export function or(): { type: "or"; conditions: AnyCondition[] };
/** The group keeps the union of what was passed, so a mixed `or(cond(…), and(…))` keeps each one. */
export function or<Cs extends AnyCondition[]>(...conditions: Cs): { type: "or"; conditions: Cs[number][] };
export function or(...conditions: AnyCondition[]): LogicalCondition {
    return { type: "or",
conditions };
}

/** An empty group, to push conditions into later. */
export function and(): { type: "and"; conditions: AnyCondition[] };
/** The group keeps the union of what was passed, so a mixed `or(cond(…), and(…))` keeps each one. */
export function and<Cs extends AnyCondition[]>(...conditions: Cs): { type: "and"; conditions: Cs[number][] };
export function and(...conditions: AnyCondition[]): LogicalCondition {
    return { type: "and",
conditions };
}

/**
 * Negate a group: `not(a)` is `NOT a`, and `not(a, b)` is `NOT (a AND b)`.
 *
 * The conjunction, not the disjunction — one rule, stated on
 * {@link LogicalCondition} and applied identically by the wire codec, the REST
 * `?not=` parameter and every driver compiler. Groups nest, so De Morgan's
 * other half is `not(or(a, b))`.
 *
 * It compiles to a real SQL `NOT (...)` rather than to inverted operators,
 * which matters more than it looks: SQL is three-valued, so `NOT (a AND b)` and
 * `(NOT a) OR (NOT b)` stop agreeing the moment a NULL is involved, and only
 * one of them is the query the caller wrote. It also means a negation includes
 * rows whose column is NULL — which is what `NOT` means.
 */
export function not(): { type: "not"; conditions: AnyCondition[] };
export function not<Cs extends AnyCondition[]>(...conditions: Cs): { type: "not"; conditions: Cs[number][] };
export function not(...conditions: AnyCondition[]): LogicalCondition {
    return { type: "not",
conditions };
}

/**
 * One condition: `cond("age", ">=", 18)`.
 *
 * It returns the column, operator and value as written rather than a
 * `FilterCondition`, so that where the group is used on a typed client the
 * column and the value are checked against the row — a typo'd column or a
 * string compared to a number column is a compile error there.
 */
export function cond<K extends string, Op extends WhereFilterOp, V extends ConditionValue>(
    column: K,
    operator: Op,
    value: V
): { column: K; operator: Op; value: V } {
    return { column,
operator,
value };
}
