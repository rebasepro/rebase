import jsonLogic from "json-logic-js";
import {
    ArrayProperty,
    AuthState,
    ConditionContext,
    ConditionRule,
    EnumValueConfig,
    NumberProperty,
    PropertyConditions,
    Property,
    ReferenceProperty,
    StringProperty
} from "@rebasepro/types";

/**
 * Access a nested property from an object via dot notation.
 */
function getIn(obj: Record<string, unknown> | unknown, path: string): unknown {
    if (!obj || !path) return undefined;
    return path.split(".").reduce((acc: unknown, part: string) => acc && (acc as Record<string, unknown>)[part], obj);
}

let operationsRegistered = false;

/**
 * Register custom JSON Logic operations for Rebase.
 * Call this once at app initialization.
 */
export function registerConditionOperations(): void {
    if (operationsRegistered) return;

    // Check if user has a specific role by ID
    jsonLogic.add_operation("hasRole", function (this: ConditionContext, roleId: string) {
        return this?.user?.roles?.includes(roleId) ?? false;
    });

    // Check if user has any of the specified roles
    jsonLogic.add_operation("hasAnyRole", function (this: ConditionContext, roleIds: string[]) {
        if (!this?.user?.roles || !Array.isArray(roleIds)) return false;
        return roleIds.some(role => this.user.roles.includes(role));
    });

    // Check if a timestamp is today
    jsonLogic.add_operation("isToday", (timestamp: number) => {
        if (!timestamp) return false;
        const date = new Date(timestamp);
        const today = new Date();
        return date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
    });

    // Check if a timestamp is in the past
    jsonLogic.add_operation("isPast", (timestamp: number) => {
        if (!timestamp) return false;
        return timestamp < Date.now();
    });

    // Check if a timestamp is in the future
    jsonLogic.add_operation("isFuture", (timestamp: number) => {
        if (!timestamp) return false;
        return timestamp > Date.now();
    });

    operationsRegistered = true;
}

/**
 * Evaluate a condition against the given context.
 *
 * A condition may be stated as a literal instead of a rule — `hidden: true`
 * rather than `hidden: { "==": [1, 1] }` — and a literal is already its own
 * answer, so it is returned rather than handed to the evaluator.
 */
export function evaluateCondition(rule: ConditionRule, context: ConditionContext): unknown {
    if (typeof rule === "boolean") return rule;
    // Ensure operations are registered
    registerConditionOperations();
    return jsonLogic.apply(rule, context);
}

/**
 * Convert a value to a format suitable for JSON Logic evaluation.
 * Specifically handles Date objects by converting them to Unix timestamps.
 */
function serializeValueForConditions(value: unknown): unknown {
    if (value === null || value === undefined) {
        return value;
    }

    // Handle Date objects
    if (value instanceof Date) {
        return value.getTime();
    }

    // Handle Firestore Timestamp-like objects (have toDate or toMillis)
    if (typeof (value as { toMillis?: () => number })?.toMillis === "function") {
        return (value as { toMillis: () => number }).toMillis();
    }
    if (typeof (value as { toDate?: () => Date })?.toDate === "function") {
        return (value as { toDate: () => Date }).toDate().getTime();
    }

    // Handle arrays recursively
    if (Array.isArray(value)) {
        return value.map(serializeValueForConditions);
    }

    // Handle plain objects recursively
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>)) {
            result[key] = serializeValueForConditions((value as Record<string, unknown>)[key]);
        }
        return result;
    }

    return value;
}

/**
 * Build a ConditionContext from the current property resolution context.
 */
export function buildConditionContext(params: {
    propertyKey?: string;
    values?: Record<string, unknown>;
    previousValues?: Record<string, unknown>;
    path: string;
    entityId?: string;
    index?: number;
    authController: AuthState;
}): ConditionContext {
    const {
        propertyKey,
        values,
        previousValues,
        path,
        entityId,
        index,
        authController
    } = params;

    const user = authController.user;
    const serializedValues = serializeValueForConditions(values ?? {});
    const serializedPreviousValues = serializeValueForConditions(previousValues ?? values ?? {});

    return {
        values: serializedValues as Record<string, unknown>,
        previousValues: serializedPreviousValues as Record<string, unknown>,
        propertyValue: propertyKey ? getIn(serializedValues, propertyKey) : undefined,
        path,
        entityId,
        isNew: !entityId,
        index,
        user: {
            uid: user?.uid ?? "",
            email: user?.email ?? null,
            displayName: user?.displayName ?? null,
            photoURL: user?.photoURL ?? null,
            roles: (user?.roles ?? []).map((r: unknown) => typeof r === "string" ? r : (r as { id: string }).id)
        },
        now: Date.now()
    };
}

/**
 * Apply PropertyConditions to a resolved property, evaluating all JSON Logic rules.
 */
