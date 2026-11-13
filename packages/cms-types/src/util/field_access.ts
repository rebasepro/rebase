/**
 * Field access on the panel's property view model: `excludeFromApi` and
 * `access` read as one rule, judged by the kernel's predicates
 * (`canReadWithAccess` / `canWriteWithAccess`), the ones the backend judges a
 * column's `access` by.
 *
 * @module
 */
import type { FieldAccess, Property } from "@rebasepro/types";
import { canReadWithAccess, canWriteWithAccess, type FieldViewer } from "@rebasepro/common";

/**
 * What a property's access rules actually are, with `excludeFromApi` expanded.
 *
 * Returns `undefined` when the property constrains nothing, so callers can skip
 * the whole check for the overwhelmingly common case.
 */
export function effectiveAccess(property: Property | undefined): FieldAccess | undefined {
    if (!property) return undefined;
    if (property.excludeFromApi) return EXCLUDED_ACCESS;
    const access = property.access;
    if (!access) return undefined;
    if (access.read === undefined && access.write === undefined) return undefined;
    return access;
}

/** The rule `excludeFromApi: true` expands to. Frozen: it is shared by every caller. */
const EXCLUDED_ACCESS: FieldAccess = Object.freeze({ read: Object.freeze([]), write: Object.freeze([]) });

/** May this caller receive this field's value? */
export function canReadField(property: Property | undefined, viewer: FieldViewer | undefined): boolean {
    return canReadWithAccess(effectiveAccess(property), viewer);
}

/** May this caller set this field's value? */
export function canWriteField(property: Property | undefined, viewer: FieldViewer | undefined): boolean {
    return canWriteWithAccess(effectiveAccess(property), viewer);
}
