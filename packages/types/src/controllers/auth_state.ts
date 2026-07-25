import type { User } from "../users";

/**
 * The read-only slice of authentication state that property resolution needs.
 *
 * `dynamicProps`, `conditions` and the JSON-Logic condition context all want the
 * same one thing: who is asking. They used to be handed the entire
 * {@link AuthController} — `signOut`, `googleLogin`, `authLoading`, thirty-odd
 * members of frontend machinery — which meant `properties.ts` named a frontend
 * controller, and so did `resolveProperty` in `@rebasepro/common`, which the
 * Postgres schema generator calls at build time. A backend generating DDL had to
 * satisfy a type with a login method in it.
 *
 * `User` already carries `roles` and `metadata`, so this is not a reduction in
 * what a dynamic property can decide on — only in what it has to be given.
 * An `AuthController` satisfies this structurally, so the frontend passes the
 * controller it already has.
 *
 * @group Hooks and utilities
 */
export interface AuthState<USER extends User = User> {
    /** The signed-in user, or `null` when nobody is. */
    user: USER | null;
}
