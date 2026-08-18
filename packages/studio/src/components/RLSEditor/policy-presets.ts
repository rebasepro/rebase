/**
 * What the RLS editor offers before the user types anything: the roles a `TO`
 * list may name, and the ready-made policies.
 *
 * Separated from the component because these are the parts that have to agree
 * with the *server*, not with the UI — and the ways they can silently disagree
 * are the reason this file has tests.
 */
import { policy as policyExpr } from "@rebasepro/types";
import { policyToPostgres, REBASE_USER_ROLE } from "@rebasepro/common";

export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export const COMMAND_OPTIONS: PolicyCommand[] = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"];

/**
 * The roles a policy's `TO` list can name when nothing better is known.
 *
 * Not `authenticated` / `anon` / `admin`, which is what this list used to be.
 * The first two are Supabase's role names and Rebase never creates them, so
 * `CREATE POLICY ... TO authenticated` — which is literally what the editor
 * builds and executes — fails with `role "authenticated" does not exist`. The
 * driver's `validatePolicyPgRoles` rejects the same three names in
 * `SecurityRule.pgRoles` and says why: they are another platform's convention,
 * and application roles belong in a condition, not in the `TO` list.
 *
 * `admin` was the more dangerous entry, because it is a plausible *application*
 * role. Had one existed as a database role too, the policy would have been
 * created successfully and then matched nothing at all: requests run as
 * {@link REBASE_USER_ROLE} after a `SET LOCAL ROLE`, and a `TO` list naming a
 * role the request never assumes filters every row without erroring.
 *
 * So: `public` (what the framework's own generator emits) and the role requests
 * actually arrive as. "Signed-in users" and "admins" are not roles here — they
 * are conditions over `rebase.uid()` and `rebase.roles()`, which is what the
 * presets below now compile to.
 */
export const FALLBACK_ROLE_OPTIONS = ["public", REBASE_USER_ROLE];

/**
 * The `TO` list the editor offers, given what the database reported and what
 * the policy being edited already targets.
 *
 * Three sources, and each is there for a reason the others do not cover:
 *
 *  - {@link FALLBACK_ROLE_OPTIONS} always, because `public` is a **keyword, not
 *    a row in `pg_roles`** — `fetchAvailableRoles` cannot return it, so seeding
 *    from the live fetch alone would drop the one role every generated policy
 *    targets.
 *  - the live roles, so an operator's own `app_read` is reachable without
 *    hand-editing SQL.
 *  - the edited policy's own roles, because a `MultiSelect` silently drops a
 *    value with no matching item. That value is the `TO` list of a policy
 *    already enforcing something, so opening an unrelated policy for a one-word
 *    rename would have quietly rewritten who it applies to.
 */
export function roleOptionsFor(
    fetched: readonly string[] | undefined,
    policyRoles: readonly string[] | undefined
): string[] {
    return [...new Set([...FALLBACK_ROLE_OPTIONS, ...(fetched ?? []), ...(policyRoles ?? [])])];
}

/**
 * Preset conditions, compiled by the framework's own policy compiler rather
 * than written out here.
 *
 * `policyToPostgres` is the function `db push` generates policies with, so a
 * preset cannot drift from what the framework emits — and the one that matters
 * has drifted before: `authenticated()` used to compile to a bare
 * `IS NOT NULL`, which is true for anonymous visitors, and any copy of that
 * string sitting in a preset would still be handing out the old grant today.
 */
export const SIGNED_IN_SQL = policyToPostgres(policyExpr.authenticated());
export const IS_ADMIN_SQL = policyToPostgres(policyExpr.rolesOverlap(["admin"]));
export const OWNS_ROW_SQL = policyToPostgres(
    policyExpr.compare(policyExpr.authUid(), "eq", policyExpr.field("uid"))
);

export interface PolicyPreset {
    id: string;
    label: string;
    description: string;
    policyname: string;
    cmd: PolicyCommand;
    permissive: "PERMISSIVE" | "RESTRICTIVE";
    roles: string[];
    qual: string;
    with_check: string;
}

/**
 * Every preset targets `TO public`, which is what the framework's generator
 * emits and what actually reaches a request running as `rebase_user`. The part
 * that used to be expressed as a role — "authenticated", "admin" — is a
 * condition now, so it is enforced where Postgres will actually evaluate it.
 */
export const POLICY_PRESETS: PolicyPreset[] = [
    {
        id: "public_read",
        label: "Enable read access to everyone",
        description: "Anyone can read data, regardless of authentication status.",
        policyname: "Enable read access for all users",
        cmd: "SELECT",
        permissive: "PERMISSIVE",
        roles: ["public"],
        qual: "true",
        with_check: ""
    },
    {
        id: "auth_read",
        label: "Enable read access for signed-in users only",
        description: "Only signed-in users are allowed to read data. Anonymous requests carry a sentinel uid, so the condition excludes them explicitly.",
        policyname: "Enable read access for signed-in users",
        cmd: "SELECT",
        permissive: "PERMISSIVE",
        roles: ["public"],
        qual: SIGNED_IN_SQL,
        with_check: ""
    },
    {
        id: "auth_insert",
        label: "Enable insert for signed-in users only",
        description: "Only signed-in users are allowed to insert new data.",
        policyname: "Enable insert for signed-in users only",
        cmd: "INSERT",
        permissive: "PERMISSIVE",
        roles: ["public"],
        qual: "",
        with_check: SIGNED_IN_SQL
    },
    {
        id: "admin_all",
        label: "Admins can do anything",
        description: "Restricted to users holding the `admin` application role, matched inside the policy via rebase.roles().",
        policyname: "Admins have full access",
        cmd: "ALL",
        permissive: "PERMISSIVE",
        roles: ["public"],
        qual: IS_ADMIN_SQL,
        with_check: IS_ADMIN_SQL
    },
    {
        id: "user_select_own",
        label: "Users can read their own rows",
        description: "Users can only read rows whose uid column matches their rebase.uid()",
        policyname: "Users can select their own data",
        cmd: "SELECT",
        permissive: "PERMISSIVE",
        roles: ["public"],
        qual: OWNS_ROW_SQL,
        with_check: ""
    },
    {
        id: "user_update_own",
        label: "Users can update their own rows",
        description: "Users can only update rows whose uid column matches their rebase.uid()",
        policyname: "Users can update their own data",
        cmd: "UPDATE",
        permissive: "PERMISSIVE",
        roles: ["public"],
        qual: OWNS_ROW_SQL,
        with_check: OWNS_ROW_SQL
    },
    {
        id: "user_delete_own",
        label: "Users can delete their own rows",
        description: "Users can only delete rows whose uid column matches their rebase.uid()",
        policyname: "Users can delete their own data",
        cmd: "DELETE",
        permissive: "PERMISSIVE",
        roles: ["public"],
        qual: OWNS_ROW_SQL,
        with_check: ""
    }
];
