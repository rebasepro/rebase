import { AuthState, Entity, CollectionConfig, SecurityOperation, SecurityRule, User } from "@rebasepro/types";
import { securityRuleToConditions } from "./policy/securityRuleToConditions";
import { evaluatePolicy, PolicyEvalContext, TriState } from "./policy/evaluatePolicy";

/**
 * Minimal auth context for permission checking.
 * Only requires the user object — avoids forcing callers to construct
 * a full AuthController just to check permissions.
 *
 * An alias, not a second definition: {@link AuthState} in `@rebasepro/types` is
 * the same shape and is what `dynamicProps` and the JSON-Logic condition context
 * now take, so declaring it twice would be the `WhereFilterOp` mistake again —
 * two copies that agree only by luck.
 */
export type AuthContext<USER extends User = User> = AuthState<USER>;

/**
 * How to resolve a policy result that cannot be decided client-side (a raw-SQL
 * escape-hatch rule, or a row-column reference with no row in hand).
 *
 * - `"allow"` (default): optimistic — used for admin-UI gating, where Postgres
 *   remains the authoritative gate and hiding a working action is worse than
 *   showing one the server may reject.
 * - `"deny"`: fail-closed — used by real enforcement callers (e.g. a driver
 *   applying policies in-process), so an undecidable rule never silently allows.
 */
export type UnknownResolution = "allow" | "deny";

/**
 * Which half of a rule to evaluate.
 *
 * Postgres evaluates `USING` against the row as it is *now* and `WITH CHECK`
 * against the row as it *will be*, both inside the transaction. A driver
 * enforcing an update in-process has two different rows in hand and therefore
 * needs to ask the two questions separately — asking one question about one row
 * either checks the new values against the old row's ownership or the reverse.
 *
 * - `"both"` (default): what a single-row decision means (`USING ∧ WITH CHECK`).
 * - `"using"`: the read/target clause only — ask it about the stored row.
 * - `"withCheck"`: the write clause only — ask it about the row being written.
 *
 * Rule *selection* is unaffected: the target operation still decides which rules
 * apply, so `"using"` on an `update` evaluates the update rules' USING clause,
 * not the delete rules'.
 */
export type PolicyClauses = "both" | "using" | "withCheck";

export interface CheckOperationOptions {
    onUnknown?: UnknownResolution;
    clauses?: PolicyClauses;
}

/** Combine clause results with AND under three-valued (Kleene) logic. */
function kleeneAnd(values: TriState[]): TriState {
    if (values.some(v => v === false)) return false;
    if (values.some(v => v === "unknown")) return "unknown";
    return true;
}

/** The operations a rule covers, mirroring the Postgres generator's resolution. */
function ruleOperations(rule: SecurityRule): readonly SecurityOperation[] {
    return rule.operations && rule.operations.length > 0
        ? rule.operations
        : [rule.operation ?? "all"];
}

function ruleApplies(rule: SecurityRule, targetOperation: SecurityOperation): boolean {
    const ops = ruleOperations(rule);
    return ops.includes(targetOperation) || ops.includes("all");
}

/**
 * Evaluate a single rule for one operation, returning a tri-state.
 *
 * A `null` clause (the rule contributes no condition for a required clause)
 * denies — matching Postgres, which emits `USING (false)` / `WITH CHECK (false)`
 * in that case. USING applies to SELECT/UPDATE/DELETE; WITH CHECK to
 * INSERT/UPDATE; both must pass for UPDATE.
 */
function evaluateRuleForOperation(
    rule: SecurityRule,
    ctx: PolicyEvalContext,
    targetOperation: SecurityOperation,
    clauses: PolicyClauses = "both"
): TriState {
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);
    const clause = (expr: typeof usingExpr): TriState => expr === null ? false : evaluatePolicy(expr, ctx);

    const needsUsing = targetOperation !== "insert" && clauses !== "withCheck";
    const needsWithCheck = (targetOperation === "insert" || targetOperation === "update") && clauses !== "using";

    const results: TriState[] = [];
    if (needsUsing) results.push(clause(usingExpr));
    if (needsWithCheck) results.push(clause(withCheckExpr));
    return kleeneAnd(results);
}

function resolveTriState(value: TriState, onUnknown: UnknownResolution): boolean {
    if (value === "unknown") return onUnknown === "allow";
    return value;
}

/**
 * Decide whether an operation is permitted for a user on a (possibly null) row,
 * by evaluating the collection's security rules with the shared policy model —
 * the same model compiled to Postgres RLS DDL, so the decision matches database
 * enforcement for every non-raw rule.
 *
 * Engine-independent by design. `securityRules` are a declaration about the
 * data, not about Postgres: the engine decides *who* enforces them (Postgres
 * compiles them to RLS DDL, a document driver applies them in-process), never
 * *whether* they hold. Gating this function on the engine's `supportsRLS`
 * capability is what made every `{ onUnknown: "deny" }` call site in the Mongo
 * driver return `true` before it evaluated anything — and it did so only for
 * collections that spelled their engine out, so declaring `engine: "mongodb"`
 * was what switched authorization off.
 *
 * @param options.onUnknown how to treat rules that cannot be decided
 *   client-side (raw SQL, or row predicates with no row). Defaults to `"allow"`
 *   for optimistic UI gating; enforcement callers should pass `"deny"`.
 * @param options.clauses which half of each rule to evaluate. See
 *   {@link PolicyClauses}; defaults to `"both"`.
 */
export function checkOperation<M extends Record<string, unknown>, USER extends User>(
    collection: CollectionConfig<M>,
    authContext: AuthContext<USER>,
    entity: Entity<M> | null,
    targetOperation: SecurityOperation,
    options?: CheckOperationOptions
): boolean {
    const onUnknown = options?.onUnknown ?? "allow";
    const clauses = options?.clauses ?? "both";
    const securityRules = collection.securityRules;
    if (!securityRules || securityRules.length === 0) {
        return true;
    }

    const applicableRules = securityRules.filter((r: SecurityRule) => ruleApplies(r, targetOperation));
    if (applicableRules.length === 0) return false;

    const ctx: PolicyEvalContext = {
        uid: authContext.user?.uid,
        roles: authContext.user?.roles ?? [],
        entity
    };

    let grantedByPermissive = false;
    let deniedByRestrictive = false;
    let hasPermissive = false;

    for (const rule of applicableRules) {
        const mode = rule.mode || "permissive";
        const passed = resolveTriState(evaluateRuleForOperation(rule, ctx, targetOperation, clauses), onUnknown);

        if (mode === "restrictive") {
            if (!passed) {
                deniedByRestrictive = true;
                break;
            }
        } else {
            hasPermissive = true;
            if (passed) grantedByPermissive = true;
        }
    }

    if (deniedByRestrictive) return false;
    return hasPermissive ? grantedByPermissive : false;
}

export function canReadCollection<M extends Record<string, unknown>, USER extends User>
    (
        collection: CollectionConfig<M>,
        authContext: AuthContext<USER>
    ): boolean {
    return checkOperation(collection, authContext, null, "select");
}

export function canEditEntity<M extends Record<string, unknown>, USER extends User>
    (
        collection: CollectionConfig<M>,
        authContext: AuthContext<USER>,
        path: string,
        entity: Entity<M> | null
    ): boolean {
    return checkOperation(collection, authContext, entity, "update");
}

export function canCreateEntity<M extends Record<string, unknown>, USER extends User>
    (
        collection: CollectionConfig<M>,
        authContext: AuthContext<USER>,
        path: string,
        entity: Entity<M> | null
    ): boolean {
    return checkOperation(collection, authContext, entity, "insert");
}

export function canDeleteEntity<M extends Record<string, unknown>, USER extends User>
    (
        collection: CollectionConfig<M>,
        authContext: AuthContext<USER>,
        path: string,
        entity: Entity<M> | null
    ): boolean {
    return checkOperation(collection, authContext, entity, "delete");
}
