import { AsyncLocalStorage } from "node:async_hooks";
import { apiHiddenFieldNames, type FieldViewer } from "@rebasepro/common";
import type { CollectionConfig } from "@rebasepro/types";

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

/**
 * The names an API caller's query may not see on `collection`: its
 * `excludeFromApi` fields, in every spelling. Empty on the trusted server plane
 * (no viewer), which may filter and sort on those columns — the auth adapter
 * looks rows up by them — and empty with no collection in hand.
 *
 * A query naming one of these is answered exactly as a query naming a column
 * the table does not have. The REST check passes such a name through to this
 * driver rather than refusing it itself, so the two answers come from one throw
 * and cannot drift: a "not readable" there would confirm a column OpenAPI and
 * `list_collections` hide.
 */
export function namesHiddenFromCaller(collection: CollectionConfig | undefined): ReadonlySet<string> {
    if (!collection || currentFieldViewer() === undefined) return NO_NAMES;
    return apiHiddenFieldNames(collection);
}

const NO_NAMES: ReadonlySet<string> = new Set();
