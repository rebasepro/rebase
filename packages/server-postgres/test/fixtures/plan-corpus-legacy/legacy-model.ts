/**
 * The legacy collection model, as far as the frozen corpus inputs beside this
 * file need it to load.
 *
 * Every directory under `plan-corpus-legacy/` is a verbatim copy of a legacy
 * `config/collections` project as it stood when the plan goldens were recorded
 * (`app/config` and `packages/cli/templates/template/config` at 7081747fad,
 * each CLI preset laid out the way `applyPreset` left it), the collections
 * `rebase schema introspect` generated from `test/fixtures/real-schemas/*.json`
 * at that commit, and the Schema-as-Code docs sample. The live projects have
 * since moved to the table model; these copies are the legacy model's last
 * residence, so the goldens keep an input that cannot move under them.
 *
 * Two edits were made to each copy, neither semantic:
 *
 *   - `// @ts-nocheck` on the first line. The files are evaluated, not
 *     compiled against today's types — the types they were written against are
 *     leaving the packages, and a frozen input must not turn red when they do.
 *   - Imports of `@rebasepro/types`, `@rebasepro/common` and
 *     `@rebasepro/cms-types` point here instead. All of them were type-only
 *     except `defineCollection`, which at 7081747fad was
 *     `resolveResourceRefs(collection)` — the identity for a collection that
 *     holds no resource handle, which none of these do.
 *
 * The docs sample additionally gained `export default`, so the directory reader
 * finds it (the docs gate evaluated it with an identity `defineCollection` too).
 */

/** A legacy collection, as data: these inputs are evaluated, not type-checked. */
export type LegacyRecord = Record<string, unknown>;

export type PostgresCollectionConfig = LegacyRecord;
export type AnyCollectionConfig = LegacyRecord;
export type SecurityRule = LegacyRecord;
export type EnumValueConfig = LegacyRecord;
export type EntityCallbackContext = LegacyRecord;
export type RebaseContext = LegacyRecord;

/** `defineCollection` as it behaved for these inputs: it returned its argument. */
export function defineCollection<T>(collection: T): T {
    return collection;
}
