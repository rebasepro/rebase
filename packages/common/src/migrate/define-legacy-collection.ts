import type {
    LegacyWithAdminCollectionConfig,
    LegacyWithAdminFirebaseCollectionConfig,
    LegacyWithAdminPostgresCollectionConfig
} from "./legacy-model";

/**
 * What {@link defineLegacyCollection} returns, as 0.30's `defineCollection`
 * did: the collection type of its engine (so every field of the model can be
 * read or assigned afterwards — a directory index sets `securityRules` on each
 * collection), with the properties exactly as written.
 *
 * @group Migration
 */
export type DefinedLegacyCollection<C extends LegacyWithAdminCollectionConfig> =
    (C extends { engine: "firestore" } ? LegacyWithAdminFirebaseCollectionConfig : LegacyWithAdminPostgresCollectionConfig)
    & { properties: C["properties"] };

/**
 * Type a legacy collection literal against the frozen 0.30 model and return it
 * unchanged — what test fixtures used `defineCollection` for, now that the
 * kernel no longer has one. The property keys and their literal `type`s are
 * kept, so it reads as precisely as it was written when it goes through the
 * lift; `admin` blocks are accepted, as `@rebasepro/cms-types` accepted them.
 *
 * ```ts
 * const posts = defineLegacyCollection({ slug: "posts", name: "Posts", properties: { title: { type: "string" } } });
 * const { tables } = collectionsToTableDefs([posts]);
 * ```
 *
 * @group Migration
 */
export function defineLegacyCollection<C extends LegacyWithAdminCollectionConfig>(collection: C): DefinedLegacyCollection<C>;
/**
 * At runtime the identity, as 0.30's was for a collection holding no resource handle.
 *
 * @group Migration
 */
export function defineLegacyCollection(collection: LegacyWithAdminCollectionConfig): LegacyWithAdminCollectionConfig {
    return collection;
}
