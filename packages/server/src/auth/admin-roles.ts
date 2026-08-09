/**
 * Which role names carry administrative privilege.
 *
 * One definition, because there used to be several and they disagreed.
 * `requireAdmin` accepted `admin` **or** `schema-admin`; the guard that refuses
 * a dangerous `defaultRole` compared against `admin` alone. So
 * `AUTH_DEFAULT_ROLE=schema-admin` passed the guard and made every public
 * registrant an administrator — and, since a `schema-admin` may edit users, one
 * of them could then grant themselves real `admin` and keep it.
 *
 * The guard and the check have to read the same list or the gap comes back, so
 * neither of them owns it.
 *
 * `schema-admin` is here deliberately: it can reach the schema editor and the
 * SQL surfaces, which is administrative by any definition that matters. If a
 * genuinely lesser role is added later, it does not belong in this list — it
 * belongs in a capability check of its own.
 */
export const ADMINISTRATIVE_ROLES = ["admin", "schema-admin"] as const;

export type AdministrativeRole = (typeof ADMINISTRATIVE_ROLES)[number];

/** Does this single role name carry administrative privilege? */
export function isAdministrativeRole(role: string): role is AdministrativeRole {
    return (ADMINISTRATIVE_ROLES as readonly string[]).includes(role);
}

/** Does any role in this list carry administrative privilege? */
export function hasAdministrativeRole(roles: readonly string[] | null | undefined): boolean {
    return !!roles?.some(isAdministrativeRole);
}
