import type { AdminCollection, PanelCollection } from "@rebasepro/cms-types";

/**
 * A collection as the registry holds it.
 *
 * The registry and the plugin hooks are typed by the panel's `AdminCollection`,
 * whose Postgres member takes the backend's `PostgresProperties` — and those
 * admit no top-level `reference`, on purpose, for collections a backend
 * declares. A table's collection may carry one: what `customizeTable`'s
 * `referenceTo` makes of a column holding another collection's ids. The
 * registry, the row codec and every view already handle a reference on a
 * Postgres collection; the type says otherwise until the view-model types move
 * to `@rebasepro/cms-types`. This is the one place that is bridged.
 */
export function registeredCollection(collection: PanelCollection): AdminCollection {
    return collection as AdminCollection;
}
