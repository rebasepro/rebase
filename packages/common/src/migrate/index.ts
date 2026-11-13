/**
 * `@rebasepro/common/migrate` — the migration from the legacy collection model
 * to tables.
 *
 * - `legacy-model`: the pre-0.31 authoring types, frozen at 0.30 — the input
 *   format of `rebase migrate collections-to-tables` (every name `Legacy…`).
 * - the lift: `collectionsToTableDefs` / `collectionToTableDef`, a legacy
 *   collection rewritten as the table definition it is, with a structured note
 *   for every field it does not carry; and the rule-spelling translation.
 * - `defineLegacyCollection`: an identity that types a fixture literal against
 *   the frozen model.
 *
 * A subpath of its own, not the package root: nothing at runtime may import
 * it. The codemod, the migration scripts and tests do.
 *
 * @module
 */
export * from "./legacy-model";
export * from "./legacy-relations";
export * from "./lift-collection";
export * from "./lift-rule-spelling";
export * from "./define-legacy-collection";
