/**
 * `schema.generated.ts`, the Drizzle half of `rebase db generate`.
 *
 * There is no interpretation left in this file. `schema/plan/plan-schema.ts`
 * reads the collections into a {@link SchemaPlan} and
 * `schema/plan/render-drizzle.ts` writes the TypeScript; this is the entry
 * point they are reached through.
 *
 * It used to hold `getDrizzleColumn` — one of three `switch (prop.type)`
 * statements, each with its own reading of relations, enums, search and
 * `validation.unique`, and each disagreeing with the other two about something.
 * See `schema/plan/types.ts`.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { relationalCollections, sortCollectionsBySlug } from "@rebasepro/common";
import { planSchema } from "./plan/plan-schema";
import { renderDrizzleSchema, type DrizzleRenderOptions } from "./plan/render-drizzle";

/**
 * The generated Drizzle schema for a set of collections.
 *
 * Synchronous, and takes an options object. It was `async` with nothing to
 * await and a positional `stripPolicies` boolean — `generateSchema(c, true)`,
 * which reads as neither "with policies" nor "without".
 *
 * Sorted by slug here rather than in the writer script: the output is
 * order-dependent and `rebase doctor` regenerates it in memory to compare
 * against the file on disk, so with the sort in the writer only, a project
 * whose file order differed from its slug order was reported stale forever.
 */
export const generateSchema = (
    allCollections: CollectionConfig[],
    options: DrizzleRenderOptions = {}
): string => {
    // A Firestore or MongoDB collection has no table to generate, and
    // generating one for it is not merely wasted output: `db push` would create
    // it, and `rebase doctor` would then report the store the collection
    // actually reads from as drift.
    const collections = sortCollectionsBySlug(relationalCollections(allCollections));
    return renderDrizzleSchema(planSchema(collections), options);
};
