/**
 * Stands in for `@rebasepro/cms-types` while the shipped templates are loaded.
 *
 * The templates import exactly one runtime value from that package, and it is
 * the identity function below — everything else they use from it is a type.
 * Mapping the real package in would drag React and 25 `.tsx` modules into a
 * node test run, and would put an import of the admin panel's type surface
 * inside `@rebasepro/server`, which is the boundary `pnpm check:baas-types`
 * exists to keep.
 */
export function defineCollection<T>(collection: T): T {
    return collection;
}
