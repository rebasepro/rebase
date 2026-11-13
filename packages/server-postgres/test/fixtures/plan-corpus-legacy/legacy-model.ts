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
 *   - `// @ts-nocheck` on the first line, so an editor or a program that holds
 *     them never turns red while the kernel types they were written against
 *     leave the packages. They are still type-checked, against the frozen
 *     model: `packages/common/test/migrate/legacy-model-corpus.test.ts`
 *     compiles every file here (and the codemod's legacy fixtures) with that
 *     line stripped, which is the proof that `@rebasepro/common/migrate`'s
 *     frozen model says everything a 0.30 project said.
 *   - Imports of `@rebasepro/types`, `@rebasepro/common` and
 *     `@rebasepro/cms-types` point here instead. All of them were type-only
 *     except `defineCollection`, which at 7081747fad was
 *     `resolveResourceRefs(collection)` — the identity for a collection that
 *     holds no resource handle, which none of these do.
 *
 * The docs sample additionally gained `export default`, so the directory reader
 * finds it (the docs gate evaluated it with an identity `defineCollection` too).
 *
 * This module names the frozen model's types under the names the inputs
 * import (type-only: nothing of `@rebasepro/common/migrate` is loaded when a
 * corpus directory is evaluated).
 */
import type {
    DefinedLegacyCollection,
    LegacyAnyCollectionConfig,
    LegacyEnumValueConfig,
    LegacyWithAdminCollectionConfig,
    LegacyWithAdminPostgresCollectionConfig
} from "@rebasepro/common/migrate";
import type { RebaseCallContext, SecurityRule as KernelSecurityRule } from "@rebasepro/types";

/** A Postgres collection as the inputs wrote it: `admin` blocks included (cms-types was installed). */
export type PostgresCollectionConfig = LegacyWithAdminPostgresCollectionConfig;
/** What a relation's `target` returns. */
export type AnyCollectionConfig = LegacyAnyCollectionConfig;
export type SecurityRule = KernelSecurityRule;
export type EnumValueConfig = LegacyEnumValueConfig;
/** The context a 0.30 collection callback received. */
export type EntityCallbackContext = RebaseCallContext;
/**
 * The admin panel's context, as `app/actions.ts` (a frontend helper the demo
 * app's collections imported, not a collection) received it. The migration
 * never reads it; it is opaque here.
 */
export type RebaseContext = Record<string, unknown>;

/** `defineCollection` as it behaved for these inputs: it returned its argument, typed as its engine's collection. */
export function defineCollection<C extends LegacyWithAdminCollectionConfig>(collection: C): DefinedLegacyCollection<C>;
export function defineCollection(collection: LegacyWithAdminCollectionConfig): LegacyWithAdminCollectionConfig {
    return collection;
}
