import type { CollectionConfig } from "@rebasepro/types";
import { isPostgresCollectionConfig } from "@rebasepro/types";

/**
 * Refuse a `beforeQuery` hook on a collection Postgres does not serve.
 *
 * `beforeQuery` narrows a read *before it is compiled*, which means compiling
 * a declarative filter into the query the engine is about to run. Only
 * `@rebasepro/server-postgres` does that today. On any other engine the hook
 * would look configured and do nothing — and for a hook whose whole purpose is
 * to restrict which rows come back, "nothing" means every row served to
 * everybody.
 *
 * So it is a boot failure, named. The alternative — declaring the hook only on
 * `PostgresCollectionConfig`, the way `search` is — is not available:
 * `callbacks` is one engine-agnostic type shared by every collection, and
 * splitting it would fork `afterRead` and the five write hooks along with it.
 *
 * Lives here rather than in either driver because both have to run it: the
 * Postgres schema planner sees every collection in a mixed app, and a
 * Mongo-only app never boots a Postgres planner at all.
 *
 * Called with *every* collection, before an engine filters any out.
 */
export const assertBeforeQueryIsPostgresOnly = (collections: CollectionConfig[]): void => {
    for (const collection of collections) {
        if (isPostgresCollectionConfig(collection)) continue;
        if (!collection.callbacks?.beforeQuery) continue;
        const engine = collection.engine ?? "non-postgres";
        throw new Error(
            `${collection.slug}.callbacks.beforeQuery: narrowing a read before it is compiled is a Postgres ` +
            `feature, and this collection is served by \`${engine}\`. Remove the hook — it would otherwise ` +
            "look configured while every read kept returning every row the engine allows. Redaction that " +
            "works on every engine is `afterRead`."
        );
    }
};
