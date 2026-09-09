import { AsyncLocalStorage } from "node:async_hooks";
import type { FieldViewer } from "@rebasepro/common";

/**
 * Who the current read is *for*, available to the row walk without threading it
 * through every read signature.
 *
 * Per-field `access.read` has to be applied wherever a row leaves this driver,
 * and that is not one place: a REST list, a single get, a relation target
 * inlined into a parent, the same target rendered as an admin ref, a realtime
 * frame, a history entry. The row pipeline is the one function they all share —
 * and it is reached through `FetchService`, `RelationService` and `DataService`,
 * none of which carry a user. Threading one through would be a parameter added
 * to a dozen signatures and forgotten on the thirteenth, which is precisely how
 * `stripExcluded` came to be missing from the relation-ref branch for a year.
 *
 * So the viewer is ambient, established at the two places that already
 * establish the *database's* auth context for a read — `applyAuthContext` is
 * called on the same line in both:
 *
 *  - `AuthenticatedPostgresBackendDriver.withTransaction`, which every REST,
 *    SDK and WebSocket read runs inside;
 *  - `RealtimeService`'s RLS-bound refetches, which build the frames a
 *    subscriber receives.
 *
 * Deliberately `run()` and not `enterWith()`. `enterWith` persists past the call
 * that made it, so a `rebase.dataAsAdmin` read inside a user's request — a
 * `beforeSave` hook, an `afterRead` hook — would leave the admin viewer in place
 * for the rest of that request and strip nothing from what the user is served.
 *
 * @module
 */

/**
 * `undefined` inside the store is meaningful and is not the same as no store at
 * all: {@link FieldViewer} reads absence as the trusted server plane. Nothing
 * currently stores `undefined`, but the store's type says the difference is
 * carried rather than flattened.
 */
const storage = new AsyncLocalStorage<FieldViewer | undefined>();

/**
 * Run `fn` with `viewer` as the caller every row strip judges against.
 *
 * Nested calls shadow: a `dataAsAdmin` read inside a user request runs under the
 * service identity for its duration and the user's viewer is restored after it,
 * which is the behaviour both halves need and the reason this is not a variable.
 */
export function withFieldViewer<T>(viewer: FieldViewer | undefined, fn: () => T): T {
    return storage.run(viewer, fn);
}

/**
 * The caller the current read is for, or `undefined` on the trusted server plane
 * — an in-process `rebase.data` call on the base driver, a migration, the auth
 * adapter reading a password hash to verify it.
 *
 * Absence cannot be reached from outside: every API ingress scopes its driver
 * with `withAuth`, including an unauthenticated one (`roles: ["anon"]`), and
 * that is what establishes the viewer.
 */
export function currentFieldViewer(): FieldViewer | undefined {
    return storage.getStore();
}
