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
import type {
    AuthAdapter,
    CollectionConfig,
    UserCreationFinalizeResult,
    UserCreationPrepareResult
} from "@rebasepro/types";
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

/** An adapter that performs user creation (`prepareUserCreation`). */
export type UserCreatingAdapter = AuthAdapter & Required<Pick<AuthAdapter, "prepareUserCreation">>;

/**
 * Whether a create on `collection` is a user creation `adapter` performs: the
 * collection is the auth collection and the adapter has the step. When not,
 * the door writes the row as any other.
 */
export function createsUsers(
    adapter: AuthAdapter | undefined,
    collection: CollectionConfig
): adapter is UserCreatingAdapter {
    return !!adapter?.prepareUserCreation && isAuthCollection(collection);
}

/**
 * Check a create body for the auth collection against what the adapter says a
 * create consumes (`describeUserCreationContract`).
 *
 * Signups carry credential fields (`password`) the collection does not declare
 * as columns, so the body is checked for everything else. A custom
 * `onCreateUser` owns the body's shape, and then the adapter asks for no check:
 * the collection's fields do not describe what arrived.
 *
 * `rowIndex` names the row in a bulk write's message.
 */
export function assertUserCreationBodyValid(
    adapter: AuthAdapter | undefined,
    collection: CollectionConfig,
    body: Record<string, unknown>,
    viewer: FieldViewer,
    rowIndex?: number
): void {
    const contract = adapter?.describeUserCreationContract?.(collectionAuthConfig(collection));
    if (!contract?.validate) return;
    assertKnownWriteFields(body, collection, { extraKnownFields: contract.extraFields, viewer, rowIndex });
    assertWriteValuesValid(body, collection, { rowIndex });
}

/**
 * The first half of creating users, before anything is written: each body
 * through the adapter's `prepareUserCreation` (the password hashed or
 * generated, the email normalized, the collection's `onCreateUser`), in order.
 * The `values` of each result are what the door writes.
 */
export async function prepareUserCreations(
    adapter: UserCreatingAdapter,
    collection: CollectionConfig,
    bodies: readonly Record<string, unknown>[]
): Promise<UserCreationPrepareResult[]> {
    const prepared: UserCreationPrepareResult[] = [];
    // One at a time: a create hook may send an email or write elsewhere, and
    // its side effects should happen in the order the rows were given.
    for (const body of bodies) {
        prepared.push(await adapter.prepareUserCreation(body, collectionAuthConfig(collection)));
    }
    return prepared;
}

/**
 * The second half, once the rows are written — and only then, so a write that
 * fails invites nobody: the credentials' delivery through
 * {@link completeUserCreation}, which is also what `POST /admin/users` calls.
 *
 * @returns For each row, the delivery fields a create response carries
 * (`invitationSent`, and `temporaryPassword` when nobody was sent one).
 */
export async function completeUserCreations(
    adapter: UserCreatingAdapter,
    prepared: readonly UserCreationPrepareResult[],
    rows: readonly Record<string, unknown>[]
): Promise<UserCreationFinalizeResult[]> {
    const finalize = adapter.finalizeUserCreation?.bind(adapter);
    const deliveries: UserCreationFinalizeResult[] = [];
    for (let index = 0; index < prepared.length; index++) {
        const row = rows[index];
        deliveries.push(await completeUserCreation(prepared[index], finalize && (clearPassword => finalize(
            // `driver.save` returns the flat row — the row IS the values.
            // Reading `row.values` (an Entity-era leftover) handed the
            // adapter `undefined`, whose `.email` threw inside the
            // invite-email try block — reported as "email delivery failed",
            // so no invitation was ever sent.
            { id: String(row.id), values: row },
            clearPassword
        ))));
    }
    return deliveries;
}

/**
 * Create one user through the auth collection: {@link prepareUserCreations},
 * then `save` (the door's own driver write), then
 * {@link completeUserCreations}.
 *
 * `undefined` when the create is not a user creation ({@link createsUsers}) —
 * the door then writes the row as any other.
 */
export async function createUserThroughAuthCollection(
    adapter: AuthAdapter | undefined,
    collection: CollectionConfig,
    body: Record<string, unknown>,
    save: (values: Record<string, unknown>) => Promise<Record<string, unknown>>
): Promise<{ row: Record<string, unknown>; delivery: UserCreationFinalizeResult } | undefined> {
    if (!createsUsers(adapter, collection)) return undefined;

    const prepared = await prepareUserCreations(adapter, collection, [body]);
    const row = await save(prepared[0].values);
    const [delivery] = await completeUserCreations(adapter, prepared, [row]);
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
