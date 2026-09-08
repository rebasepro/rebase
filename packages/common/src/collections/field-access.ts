import type { CollectionConfig, FieldAccess, Property } from "@rebasepro/types";

/**
 * Field-level access control: one mechanism, read by every enforcement point.
 *
 * A collection's `securityRules` decide which *rows* a caller reaches;
 * `property.access` decides which *fields* of a reached row they see and may
 * set. The two are independent — a field rule never widens row access, and a
 * row a caller cannot read has no fields to talk about.
 *
 * `excludeFromApi` is sugar for `access: { read: [], write: [] }` and is
 * normalised into it by {@link effectiveAccess}, which is the only place either
 * spelling is read. It used to be its own code path in five files — the read
 * strip, the write refusal, the SDK generator, the OpenAPI schema builder and
 * the filter-parameter builder — and the second rule would have made ten.
 * There is one predicate now, and the flag is a shorthand for it.
 *
 * @module
 */

/**
 * The caller a field rule is judged against: whatever the call context carries
 * as the user's application roles.
 *
 * `undefined` is the trusted server plane — an in-process `rebase.data` call
 * with no request behind it, the auth adapter writing a password hash, a
 * migration. Every API boundary has a viewer: an unauthenticated REST request is
 * scoped as `{ uid: ANONYMOUS_USER_ID, roles: ["anon"] }` before it reaches a
 * driver, so "no viewer" cannot be reached from outside.
 */
export interface FieldViewer {
    roles?: readonly string[];
}

/**
 * The role that satisfies any non-empty list.
 *
 * The same arm every baseline policy carries: `security_rules` injects
 * `rolesOverlap(['admin'])` into the default read and write policies, and
 * `rebase.dataAsAdmin` is scoped with `{ uid: "service", roles: ["admin"] }`.
 * Without this an author could declare `access: { read: ["hr"] }` and lock the
 * administrator out of a column of their own database — and lock the Studio out
 * of rendering it.
 */
export const ADMIN_ROLE = "admin";

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

/**
 * Does a caller holding `roles` satisfy `allowed`?
 *
 * Three cases, and the middle one is the one worth stating out loud:
 *
 * - `allowed` omitted — the field carries no rule of its own, so the row's
 *   policies have already answered. True.
 * - `allowed` empty — nobody, at any privilege, through any API. Not the admin,
 *   not the service key, not the trusted plane reading on a caller's behalf.
 *   This is what `excludeFromApi` has always meant on the read side, and
 *   collapsing the two spellings means the empty list has to keep meaning it.
 * - `allowed` non-empty — one of the named roles, or `admin`, or no viewer at
 *   all (the trusted server plane, which is not an API caller).
 */
function satisfies(allowed: readonly string[] | undefined, viewer: FieldViewer | undefined): boolean {
    if (allowed === undefined) return true;
    if (allowed.length === 0) return false;
    if (!viewer) return true;
    const roles = viewer.roles;
    if (!roles || roles.length === 0) return false;
    return roles.includes(ADMIN_ROLE) || allowed.some(role => roles.includes(role));
}

/** May this caller receive this field's value? */
export function canReadField(property: Property | undefined, viewer: FieldViewer | undefined): boolean {
    const access = effectiveAccess(property);
    return access ? satisfies(access.read, viewer) : true;
}

/** May this caller set this field's value? */
export function canWriteField(property: Property | undefined, viewer: FieldViewer | undefined): boolean {
    const access = effectiveAccess(property);
    return access ? satisfies(access.write, viewer) : true;
}

/**
 * The names on this collection a caller may not touch, in the two spellings a
 * caller can write them in.
 *
 * `declared` is the property keys, which is what has to leave a *known-fields*
 * set. `refused` is those plus the physical column names behind them: a caller
 * who knows the table can send `password_hash` as readily as `passwordHash`, and
 * a rule that only knew the wire name would be one rename away from useless.
 *
 * `kind` picks which half of the rule is read; nothing else differs.
 */
export function restrictedFieldNames(
    collection: CollectionConfig,
    viewer: FieldViewer | undefined,
    kind: "read" | "write"
): { declared: string[]; refused: Set<string> } {
    const declared: string[] = [];
    const refused = new Set<string>();
    const allowed = kind === "read" ? canReadField : canWriteField;

    for (const [name, property] of Object.entries(collection.properties ?? {})) {
        if (allowed(property as Property, viewer)) continue;
        declared.push(name);
        refused.add(name);
        const columnName = (property as Property).columnName;
        if (columnName) refused.add(columnName);
    }
    return { declared, refused };
}

/**
 * True when nothing on this collection restricts a field, for either direction.
 *
 * Every read of every row runs through the strip, so the collection that has no
 * rules — which is almost all of them — has to cost one property walk and no
 * allocation.
 */
export function hasFieldAccessRules(collection: CollectionConfig): boolean {
    for (const property of Object.values(collection.properties ?? {})) {
        if (effectiveAccess(property as Property)) return true;
    }
    return false;
}
