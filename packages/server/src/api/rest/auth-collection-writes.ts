/**
 * A write to the auth collection is user administration.
 *
 * The auth collection's rows are the users. `/admin/users` holds a change to
 * one to the auth adapter's rules: a create goes through the adapter's user
 * creation (the password hashed, the email normalized, the collection's
 * `onCreateUser`, the invitation), an update may not leave the project without
 * an administrator and stores an email the way sign-in looks it up, and a
 * deletion runs `beforeUserDelete` (a veto), ends the sessions and runs
 * `afterUserDelete`. The data doors that write the same rows — the REST routes
 * and MCP's write tools — call these, so that no door writes a user by rules
 * of its own. (The Postgres socket calls the adapter's methods directly.)
 *
 * Every function here leaves any other collection, and an adapter without the
 * step, exactly as it was: the rows are then written as any table's.
 */
import type { AuthAdapter, CollectionConfig, UserCreationFinalizeResult } from "@rebasepro/types";
import type { FieldViewer } from "@rebasepro/common";
import { completeUserCreation } from "../../auth/admin-user-ops";
import { assertKnownWriteFields, assertWriteValuesValid } from "./write-validation";

/** Whether `collection` is the auth collection — its rows are the users. */
export function isAuthCollection(collection: CollectionConfig): boolean {
    const auth = collection.auth;
    return auth === true || (!!auth && typeof auth === "object" && auth.enabled === true);
}

/** The collection's own auth settings, when it declares them as an object. */
function collectionAuthConfig(collection: CollectionConfig): unknown {
    return typeof collection.auth === "object" ? collection.auth : undefined;
}

/**
 * Check a create body for the auth collection against what the adapter says a
 * create consumes (`describeUserCreationContract`).
 *
 * Signups carry credential fields (`password`) the collection does not declare
 * as columns, so the body is checked for everything else. A custom
 * `onCreateUser` owns the body's shape, and then the adapter asks for no check:
 * the collection's fields do not describe what arrived.
 */
export function assertUserCreationBodyValid(
    adapter: AuthAdapter | undefined,
    collection: CollectionConfig,
    body: Record<string, unknown>,
    viewer: FieldViewer
): void {
    const contract = adapter?.describeUserCreationContract?.(collectionAuthConfig(collection));
    if (!contract?.validate) return;
    assertKnownWriteFields(body, collection, { extraKnownFields: contract.extraFields, viewer });
    assertWriteValuesValid(body, collection);
}

/**
 * Create a user through the auth collection: the adapter's
 * `prepareUserCreation`, then `save` (the door's own driver write), then the
 * credentials' delivery through {@link completeUserCreation}, which is also
 * what `POST /admin/users` calls.
 *
 * `undefined` when the collection is not the auth collection or the adapter has
 * no user creation step — the door then writes the row as any other.
 *
 * @returns The written row, and the delivery fields a create response carries
 * (`invitationSent`, and `temporaryPassword` when nobody was sent one).
 */
export async function createUserThroughAuthCollection(
    adapter: AuthAdapter | undefined,
    collection: CollectionConfig,
    body: Record<string, unknown>,
    save: (values: Record<string, unknown>) => Promise<Record<string, unknown>>
): Promise<{ row: Record<string, unknown>; delivery: UserCreationFinalizeResult } | undefined> {
    if (!adapter?.prepareUserCreation || !isAuthCollection(collection)) return undefined;

    const prepared = await adapter.prepareUserCreation(body, collectionAuthConfig(collection));
    const row = await save(prepared.values);

    const finalize = adapter.finalizeUserCreation?.bind(adapter);
    const delivery = await completeUserCreation(prepared, finalize && (clearPassword => finalize(
        // `driver.save` returns the flat row — the row IS the values. Reading
        // `row.values` (an Entity-era leftover) handed the adapter
        // `undefined`, whose `.email` threw inside the invite-email try
        // block — reported as "email delivery failed", so no invitation was
        // ever sent.
        { id: String(row.id), values: row },
        clearPassword
    )));
    return { row, delivery };
}

/**
 * Updates to rows of the auth collection, checked and put in stored form by
 * the adapter's `prepareUserUpdates`: judged together, so a bulk demotion of
 * every administrator is refused although each row alone would pass.
 *
 * @returns Each update's values, as they should be written, in order.
 */
export async function prepareAuthCollectionUpdates(
    adapter: AuthAdapter | undefined,
    collection: CollectionConfig,
    updates: { uid: string; values: Record<string, unknown> }[]
): Promise<Record<string, unknown>[]> {
    if (updates.length === 0 || !adapter?.prepareUserUpdates || !isAuthCollection(collection)) {
        return updates.map(update => update.values);
    }
    return adapter.prepareUserUpdates(updates);
}

/**
 * Delete rows of the auth collection as user administration: the adapter's
 * checks and `beforeUserDelete` before `remove` runs (either may refuse), its
 * session cleanup and `afterUserDelete` after.
 */
export async function deletingAuthCollectionUsers<T>(
    adapter: AuthAdapter | undefined,
    collection: CollectionConfig | undefined,
    uids: string[],
    remove: () => Promise<T>
): Promise<T> {
    const userAdmin = collection && isAuthCollection(collection) && uids.length > 0 ? adapter : undefined;
    await userAdmin?.prepareUserDeletions?.(uids);
    const result = await remove();
    await userAdmin?.finalizeUserDeletions?.(uids);
    return result;
}
