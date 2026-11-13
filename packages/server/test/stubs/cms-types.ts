/**
 * Stands in for `@rebasepro/cms-types` while the shipped templates are loaded.
 *
 * The templates import only types from that package (erased at runtime).
 * Mapping the real package in would drag React and the panel's modules into a
 * node test run, and would put an import of the admin panel's type surface
 * inside `@rebasepro/server`, which is the boundary `pnpm check:baas-types`
 * exists to keep.
 */
export {};
