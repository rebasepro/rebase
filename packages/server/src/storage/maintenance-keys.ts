/**
 * Where storage maintenance keeps its own records inside a source: the state
 * and result of an orphan scan (`rebase storage orphans`), which a worker
 * writes and any server process reads back.
 *
 * Reserved at the route layer like the rendition space, in both directions. A
 * scan's result is the list a later delete acts on, so a caller who could
 * write one could name files for an administrator's delete to remove; and it
 * lists keys a caller may not be allowed to see.
 */
export const MAINTENANCE_PREFIX = "_rebase/maintenance/";

/**
 * True for a key in the reserved maintenance space — the prefix itself, or
 * anything under it. Folded the way the filesystem under a local bucket folds
 * it, as {@link isRenditionKey} is.
 */
export function isMaintenanceKey(key: string): boolean {
    const folded = key.replace(/\\/g, "/").normalize("NFKC").toLowerCase();
    return folded.startsWith(MAINTENANCE_PREFIX) || folded === MAINTENANCE_PREFIX.slice(0, -1);
}
