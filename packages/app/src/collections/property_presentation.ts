/**
 * Property presentation helpers.
 *
 * These read a property's admin block — `readOnly`, `disabled.hidden`, the
 * declarative `conditions` — and lived in `@rebasepro/common`, which is on the
 * backend's dependency path. Nothing in core ever called them: `isReadOnly` and
 * `isHidden` are used only by the panel, and `applyPropertyConditions` has no
 * production caller at all.
 *
 * That last one is worth knowing about rather than assuming: the collection editor
 * has a whole Conditions UI, `serializable_utils` persists what it writes, and
 * `BaseProperty.conditions` documents itself as "evaluated at runtime like property
 * builders" — but the evaluator below is reached only from its own tests. The
 * declarative conditions feature is authored and stored, never applied. It lives
 * here now because here is where it would be called from once it is wired up.
 */
import type { ArrayProperty, ConditionContext, EnumValueConfig, Property, PropertyConditions, ReferenceProperty } from "@rebasepro/types";
import { evaluateCondition } from "@rebasepro/common";

export function isReadOnly(property: Property): boolean {
    if (property.admin?.readOnly)
        return true;
    if (property.type === "date") {
        if (property.autoValue)
            return true;
    }
    if (property.type === "reference") {
        return !property.path && !("Field" in (property.admin || {}) && property.admin?.Field);
    }
    return false;
}

export function isHidden(property: Property): boolean {
    return typeof property.admin?.disabled === "object" && Boolean(property.admin?.disabled.hidden);
}

export function applyPropertyConditions(
    property: Property,
    context: ConditionContext
): Property {
    const { conditions } = property;
    if (!conditions) return property;

    const result = { ...property };

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD STATE CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    // Evaluate disabled condition
    if (conditions.disabled) {
        const isDisabled = evaluateCondition(conditions.disabled, context);
        if (isDisabled) {
            result.admin = result.admin || {};
            result.admin.disabled = {
                clearOnDisabled: conditions.clearOnDisabled ?? false,
                disabledMessage: conditions.disabledMessage,
                hidden: false
            };
        }
    }

    // Evaluate hidden condition
    if (conditions.hidden) {
        const isHidden = evaluateCondition(conditions.hidden, context);
        if (isHidden) {
            result.admin = result.admin || {};
            result.admin.disabled = {
                ...(typeof result.admin?.disabled === "object" ? result.admin.disabled : {}),
                hidden: true,
                clearOnDisabled: conditions.clearOnDisabled ?? false
            };
        }
    }

    // Evaluate readOnly condition
    if (conditions.readOnly) {
        const isReadOnly = evaluateCondition(conditions.readOnly, context);
        if (isReadOnly) {
            result.admin = result.admin || {};
            result.admin.readOnly = true;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATION CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    // Evaluate required condition
    if (conditions.required !== undefined) {
        const isRequired = evaluateCondition(conditions.required, context) as boolean;
        result.validation = {
            ...result.validation,
            required: isRequired as boolean | undefined,
            requiredMessage: conditions.requiredMessage
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VALUE CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    // Apply default value for new entities
    if (context.isNew && conditions.defaultValue !== undefined) {
        result.defaultValue = evaluateCondition(conditions.defaultValue, context) as Property["defaultValue"];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ENUM CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    if ("enum" in result && result.enum && (conditions.enumConditions || conditions.allowedEnumValues || conditions.excludedEnumValues)) {
        (result as Record<string, unknown>).enum = applyEnumConditions(
            result.enum as EnumValueConfig[],
            conditions,
            context
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // REFERENCE CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    if (result.type === "reference") {
        if (conditions.referencePath) {
            (result as ReferenceProperty).path = evaluateCondition(conditions.referencePath, context) as string;
        }
        if (conditions.referenceFilter) {
            (result as ReferenceProperty).fixedFilter = evaluateCondition(conditions.referenceFilter, context) as ReferenceProperty["fixedFilter"];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ARRAY CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    if (result.type === "array") {
        if (conditions.canAddElements !== undefined) {
            (result as ArrayProperty).canAddElements = evaluateCondition(conditions.canAddElements, context) as boolean;
        }
        if (conditions.sortable !== undefined) {
            (result as ArrayProperty).sortable = evaluateCondition(conditions.sortable, context) as boolean;
        }
    }

    return result;
}

/**
 * Convert an object with numeric keys back to an array.
 * Firestore stores arrays as {"0": "a", "1": "b"} to avoid nested arrays.
 */
function objectToArray(obj: unknown): string[] {
    if (Array.isArray(obj)) return obj.map(String);
    if (obj && typeof obj === "object") {
        const keys = Object.keys(obj);
        if (keys.length > 0 && keys.every(k => !isNaN(Number(k)))) {
            return keys
                .sort((a, b) => Number(a) - Number(b))
                .map(k => (obj as Record<string, unknown>)[k])
                .filter((v): v is string => typeof v === "string" || typeof v === "number")
                .map(String);
        }
    }
    return [];
}

/**
 * Apply enum-specific conditions to filter and modify enum values.
 */
function applyEnumConditions(
    enumValues: EnumValueConfig[],
    conditions: PropertyConditions,
    context: ConditionContext
): EnumValueConfig[] {
    let result = [...enumValues];

    // Apply allowedEnumValues filter
    if (conditions.allowedEnumValues) {
        const allowed = evaluateCondition(conditions.allowedEnumValues, context);
        // Handle both array format and object-with-numeric-keys format (Firestore workaround)
        const allowedArray = objectToArray(allowed);
        if (allowedArray.length > 0) {
            result = result.filter(ev => allowedArray.includes(String(ev.id)));
        }
    }

    // Apply excludedEnumValues filter
    if (conditions.excludedEnumValues) {
        const excluded = evaluateCondition(conditions.excludedEnumValues, context);
        // Handle both array format and object-with-numeric-keys format
        const excludedArray = objectToArray(excluded);
        if (excludedArray.length > 0) {
            result = result.filter(ev => !excludedArray.includes(String(ev.id)));
        }
    }

    // Apply individual enum conditions
    if (conditions.enumConditions) {
        result = result
            .map(ev => {
                const evConditions = conditions.enumConditions?.[ev.id];
                if (!evConditions) return ev;

                // Check hidden condition first
                if (evConditions.hidden && evaluateCondition(evConditions.hidden, context)) {
                    return null; // Will be filtered out
                }

                // Check disabled condition
                if (evConditions.disabled && evaluateCondition(evConditions.disabled, context)) {
                    return {
                        ...ev,
                        disabled: true
                    };
                }

                return ev;
            })
            .filter((ev): ev is EnumValueConfig => ev !== null);
    }

    return result;
}
