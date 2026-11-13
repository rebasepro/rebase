import type { LegacyCollectionConfig } from "./legacy-model";

/**
 * Type a legacy collection literal against the frozen 0.30 model and return it
 * unchanged — what test fixtures used `defineCollection` for, now that the
 * kernel no longer has one. The collection's own type is kept (its property
 * keys, its literal `type`s), so it still reads as precisely as it was written
 * when it goes through the lift.
 *
 * ```ts
 * const posts = defineLegacyCollection({ slug: "posts", name: "Posts", properties: { title: { type: "string" } } });
 * const { tables } = collectionsToTableDefs([posts]);
 * ```
 *
 * @group Migration
 */
export function defineLegacyCollection<C extends LegacyCollectionConfig>(collection: C): C {
    return collection;
}
