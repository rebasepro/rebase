
/**
 * Field-level access control: the one predicate every enforcement point reads.
 *
 * A table's `rls` decides which *rows* a caller reaches; a column's `access`
 * decides which *fields* of a reached row they see and may set. The two are
 * independent — a field rule never widens row access, and a row a caller
 * cannot read has no fields to talk about. `.private()` is `access: { read: [],
 * write: [] }` (`table/access.ts` expands it); the panel reads its property
 * view model through the same predicates.
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

/**
 * May this caller receive a value whose read rule is `access`? The same
 * predicate the panel's `canReadField` applies to a property, and the one a
 * column's or a relation's `access` in a table descriptor is judged by.
 */
export function canReadWithAccess(access: { read?: readonly string[] } | undefined, viewer: FieldViewer | undefined): boolean {
    return satisfies(access?.read, viewer);
}

/**
 * May this caller set a value whose write rule is `access`? The write half of
 * {@link canReadWithAccess}.
 */
export function canWriteWithAccess(access: { write?: readonly string[] } | undefined, viewer: FieldViewer | undefined): boolean {
    return satisfies(access?.write, viewer);
}
