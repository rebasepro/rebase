/**
 * What a collection that serves a SQL view (`PostgresCollectionConfig.view`)
 * allows: reads, and for a materialized view only by the roles it names.
 *
 * A plain view runs as the caller (`security_invoker`), so the policies of the
 * tables it reads already decide every row, and a read of one needs nothing
 * here. A materialized view stores its rows and Postgres puts no row-level
 * security on it: whoever may select from it sees all of it. So the role check
 * is the driver's, made before every read of one by a caller (see
 * `beforeQueryConditions`) — and not of the server's own work, which reads
 * with no viewer at all.
 */
import { isPostgresCollectionConfig, type CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import { currentFieldViewer } from "./field-viewer";

/** The roles a materialized view is served to when it names none. */
export const DEFAULT_VIEW_ROLES: readonly string[] = ["admin"];

/** Whether a collection serves a view rather than a table. */
export function isViewCollection(collection: CollectionConfig | undefined): boolean {
    return Boolean(collection && isPostgresCollectionConfig(collection) && collection.view);
}

/** Refuse a caller who holds none of a materialized view's roles. A no-op for anything else. */
export function assertViewReadable(collection: CollectionConfig | undefined): void {
    if (!collection || !isPostgresCollectionConfig(collection) || !collection.view?.materialized) return;
    const viewer = currentFieldViewer();
    if (!viewer) return;
    const allowed = collection.view.roles ?? DEFAULT_VIEW_ROLES;
    if ((viewer.roles ?? []).some(role => allowed.includes(role))) return;
    throw ApiError.forbidden(
        `"${collection.slug}" is a materialized view, which has no row-level security, so it is served whole and ` +
        `only to ${allowed.map(role => `'${role}'`).join(", ")}.`,
        "VIEW_NOT_READABLE"
    );
}

/** Refuse a write to a collection that serves a view. */
export function assertCollectionWritable(collection: CollectionConfig | undefined, path: string): void {
    if (!isViewCollection(collection)) return;
    throw new ApiError(
        405,
        "COLLECTION_READ_ONLY",
        `"${collection?.slug ?? path}" serves a SQL view, which is read-only: write to the tables it reads.`,
        { collection: collection?.slug ?? path },
        true
    );
}
