/**
 * Which of an account's roles the platform hosting this backend granted.
 *
 * `POST /auth/platform-signin` adds `admin` to the account of a person the
 * platform vouches for (on Rebase Cloud: an owner or admin of the project's
 * organization, or a member of the project). `POST /auth/platform-revoke`
 * takes it back when the platform withdraws that access — and must take back
 * only what the platform gave: an `admin` somebody granted by hand inside the
 * app, before or after, is the app's business and stays.
 *
 * So the grant is recorded with the account, as the list of roles under
 * {@link PLATFORM_ROLES_METADATA_KEY} in its `metadata` — the place Supabase
 * keeps `app_metadata.provider`. `metadata` is a column every auth users table
 * already has, so the record needs no schema change, works on an existing
 * database, and works where the runtime may not change the schema
 * (`REBASE_PROVISION=false`). An account is not self-service on it: the
 * profile route writes only the display name and photo.
 *
 * A role is recorded only when the platform added it. An account that already
 * held `admin` when its owner first came in through the platform keeps an
 * unmarked, hand-granted `admin`.
 *
 * @module
 */
import type { AuthRepository, UserData } from "./interfaces";

/** The `metadata` key holding the roles the platform granted. */
export const PLATFORM_ROLES_METADATA_KEY = "platformRoles";

/** The roles an account's metadata says the platform granted. */
export function platformGrantedRoles(user: Pick<UserData, "metadata">): string[] {
    const value = user.metadata?.[PLATFORM_ROLES_METADATA_KEY];
    return Array.isArray(value) ? value.filter((role): role is string => typeof role === "string") : [];
}

/**
 * The roles an account holds that came from the platform: recorded as granted
 * by it, and still held.
 */
export function heldPlatformRoles(user: Pick<UserData, "metadata">, roles: readonly string[]): string[] {
    return platformGrantedRoles(user).filter(role => roles.includes(role));
}

/**
 * Write the platform-granted roles of an account: the key is removed when the
 * list is empty.
 */
export async function writePlatformGrantedRoles(
    authRepo: Pick<AuthRepository, "mergeUserMetadata" | "updateUser">,
    user: Pick<UserData, "id" | "metadata">,
    roles: readonly string[]
): Promise<void> {
    const value = roles.length > 0 ? [...new Set(roles)] : null;
    if (typeof authRepo.mergeUserMetadata === "function") {
        await authRepo.mergeUserMetadata(user.id, { [PLATFORM_ROLES_METADATA_KEY]: value });
        return;
    }
    const metadata: Record<string, unknown> = { ...(user.metadata ?? {}) };
    if (value) metadata[PLATFORM_ROLES_METADATA_KEY] = value;
    else delete metadata[PLATFORM_ROLES_METADATA_KEY];
    await authRepo.updateUser(user.id, { metadata });
}

/**
 * Keep the record truthful after an administrator set an account's roles by
 * hand: a platform-granted role the account no longer holds is forgotten, so a
 * later hand grant of the same role is not mistaken for the platform's.
 */
export async function forgetRemovedPlatformRoles(
    authRepo: Pick<AuthRepository, "mergeUserMetadata" | "updateUser">,
    user: Pick<UserData, "id" | "metadata">,
    roles: readonly string[]
): Promise<void> {
    const recorded = platformGrantedRoles(user);
    if (recorded.length === 0) return;
    const kept = recorded.filter(role => roles.includes(role));
    if (kept.length === recorded.length) return;
    await writePlatformGrantedRoles(authRepo, user, kept);
}
