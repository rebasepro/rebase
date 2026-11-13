/**
 * The legacy collection model — the INPUT FORMAT of the migration.
 *
 * Before 0.31 a Rebase backend was authored as collections
 * (`defineCollection`, `PostgresCollectionConfig`, `Property`, `relations`,
 * `securityRules`, `callbacks`, the `admin` block). 0.31 authors and runs
 * tables (`defineTable`), and the shared kernel (`@rebasepro/types`,
 * `@rebasepro/common`) no longer carries the collection model. What a 0.30
 * project's `config/collections` could say is restated here, frozen at 0.30,
 * so that `rebase migrate collections-to-tables` — the migration path of every
 * existing project — and the test fixtures written as legacy literals have a
 * type to be read against after the kernel types are gone.
 *
 * Every name carries a `Legacy` prefix, so it is never mistaken for a live
 * type (the CMS's view-model `CollectionConfig`, a table's descriptor). From
 * the kernel it imports only types that are current and shared — the rule
 * vocabulary (`SecurityRule`, `TenantSource`), `SearchConfig`, the auth hook
 * context, the call context, the value classes.
 *
 * Frozen means: nothing is ever added to it. A field 0.30 did not have is not
 * a field of the input format. And nothing at runtime may import it: it is
 * reachable only from `@rebasepro/common/migrate`, which only the codemod, the
 * migration scripts and tests import.
 *
 * @module
 */
export * from "./admin";
export * from "./callbacks";
export * from "./collections";
export * from "./indexes";
export * from "./properties";
export * from "./relations";
