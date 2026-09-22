import { clearFetchCache } from "../hooks/data/useFetch";
import { clearCollectionScrollCache } from "../components/common/useScrollRestoration";
import { clearEntityDrafts, clearEntityMemoryCache } from "../util/entity_cache";
import { getSharedEntityDisplayCache } from "../collections/entity-display-cache";

/**
 * Who the tab's cached state was read or written as. Kept in `sessionStorage`
 * as well as in memory because the local-changes backup is: a reload keeps the
 * drafts, so it has to keep the name of the user they belong to.
 */
const OWNER_STORAGE_KEY = "rebase::session_cache_owner";
let ownerInMemory: string | undefined;

function readOwner(): string | undefined {
    try {
        if (typeof sessionStorage !== "undefined") {
            return sessionStorage.getItem(OWNER_STORAGE_KEY) ?? ownerInMemory;
        }
    } catch {
        // Storage refused (privacy mode, sandboxed frame): memory is all there is.
    }
    return ownerInMemory;
}

function writeOwner(userId: string): void {
    ownerInMemory = userId;
    try {
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(OWNER_STORAGE_KEY, userId);
        }
    } catch {
        // As above.
    }
}

/**
 * Empty every module-level cache that holds data read as the signed-in user:
 * fetched records, each table's scroll position and the rows kept with it,
 * edits parked for a layout handoff, and resolved display values (the titles
 * on relation chips and breadcrumbs).
 *
 * All of them are keyed by path and id only, with no user in the key, and the
 * views seed their first render from them — so without this the next user to
 * sign in to the tab is shown what the last one could read. Called by both auth
 * controllers on `SIGNED_OUT`.
 *
 * The local-changes backup is not cleared here: a sign-out is also how a
 * rejected refresh token ends a session, and the backup exists for that user
 * coming back. {@link bindSessionCachesToUser} drops it when somebody else
 * signs in instead.
 */
export function clearSessionCaches(): void {
    clearFetchCache();
    clearCollectionScrollCache();
    clearEntityMemoryCache();
    getSharedEntityDisplayCache().clear();
}

/**
 * Record that the tab now acts as `userId`. When that is not who the caches
 * were filled for, everything goes — the session caches, and the drafts the
 * other user left in the local-changes backup.
 *
 * Call it before the new user is rendered: the views read these caches in
 * their first render, before any effect of the auth controller would run.
 */
export function bindSessionCachesToUser(userId: string): void {
    const owner = readOwner();
    if (owner !== undefined && owner !== userId) {
        clearSessionCaches();
        clearEntityDrafts();
    }
    if (owner !== userId) writeOwner(userId);
}
