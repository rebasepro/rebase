/**
 * `defineCollection` — the admin-aware builder, in a module a backend can load.
 *
 * This is the function every scaffolded collection file imports, and it must be
 * reachable from a Node process that has no React and no DOM. So it lives here,
 * apart from `admin_collection.ts` (which describes the panel's option types and
 * names `React` throughout) and well away from `collections.ts` (the panel's
 * view models, which import React as a value).
 *
 * The side-effect import below is the other half of what the import buys you:
 * `augment.ts` is what declares `admin` on `BaseCollectionConfig` and on every
 * property type, so importing this builder brings the block's type-checking with
 * it. It is types only, and compiles to nothing.
 */
// Side-effect import: this is what adds `admin` back onto the core types.
import "./augment";

import type {
    FirebaseCollectionConfig,
    FirebaseProperties,
    FirebaseProperty,
    InferEntityType,
    MongoDBCollectionConfig,
    MongoProperties,
    MongoProperty,
    PostgresCollectionConfig,
    PostgresProperties,
    PostgresProperty,
    Properties,
    Property,
    StrictProperties,
    User,
    CollectionConfig
} from "@rebasepro/types";
import { resolveResourceRefs, type ResourceRef } from "@rebasepro/types";

/**
 * The engines a collection can name. Absent means Postgres.
 *
 * The discriminant that replaced three overloads of `defineCollection`. See
 * {@link CollectionConfigForEngine} for why that mattered.
 */
type CollectionEngine = "postgres" | "firestore" | "mongodb";

/**
 * The concrete collection type an `engine` selects.
 *
 * `defineCollection` used to be three overloads — one per engine — and overload
 * resolution is what made its errors unreadable. When no overload matches,
 * TypeScript emits **one** diagnostic at the call site listing each overload's
 * *first* failure, so:
 *
 *  - a bad `defaultValue` **and** a misspelled `admin.display.title` in the same
 *    collection reported only the first. Fixing it revealed the second on the
 *    next run, one per edit-compile cycle;
 *  - the error landed on `defineCollection(`, not on the key that was wrong;
 *  - and every Postgres collection's error dragged `FirebaseCollectionConfig`
 *    and `MongoDBCollectionConfig` through the message, naming two engines the
 *    author had not mentioned and does not use.
 *
 * With one signature there is no resolution to fail: each error is reported
 * where it is, all of them at once, against the one config type the `engine`
 * selects.
 */
type CollectionConfigForEngine<E, P, USER extends User> =
    E extends "firestore" ? FirebaseCollectionConfig<EntityShapeOf<P>, USER>
        : E extends "mongodb" ? MongoDBCollectionConfig<EntityShapeOf<P>, USER>
            : PostgresCollectionConfig<EntityShapeOf<P>, USER>;

/**
 * `InferEntityType`, tolerant of a property map that has an error in it.
 *
 * `P` is deliberately **unconstrained** on the builder, and this is why. A
 * constraint TypeScript cannot satisfy is a constraint it silently falls back
 * from: one property with a bad `defaultValue` made `P extends PostgresProperties`
 * fail, `P` became `PostgresProperties`, `M` became `Record<string, unknown>`,
 * and every `admin` key — `display.title`, `listProperties`, `propertiesOrder` —
 * widened to `string` and stopped being checked. So a collection with two
 * mistakes reported one, and reported the second only after the first was fixed.
 *
 * With no constraint, `keyof P` survives a bad property and the `admin` block is
 * still checked against the real key set. Exactness and the engine gate move
 * into `StrictProperties`, which reports them on the property itself.
 */
type EntityShapeOf<P> = InferEntityType<{
    [K in keyof P]: P[K] extends Property ? P[K] : Property;
}>;

/** The property union an engine admits — the engine gate, as a type. */
type PropertyForEngine<E> =
    E extends "firestore" ? FirebaseProperty
        : E extends "mongodb" ? MongoProperty
            : PostgresProperty;

/** {@link PropertyForEngine} as a property map, for the `P` constraint. */
type PropertiesForEngine<E> =
    E extends "firestore" ? FirebaseProperties
        : E extends "mongodb" ? MongoProperties
            : PostgresProperties;

/**
 * Define a collection with the admin block type-checked.
 *
 * The same identity function as `defineCollection` in `@rebasepro/common` — which
 * is what a BaaS or headless project uses, and where `admin` does not exist at all
 * — with one difference: importing this one brings the augmentation with it, so
 * `admin: { icon, listProperties, kanban }` gets completion and a typo is an
 * error. See {@link AdminCollectionOptions}.
 *
 * Import it from the layer you are in. A project with an admin panel wants this
 * one; a project without one has no `admin` block to check.
 *
 * `const P` captures the literal property types, which is what gives
 * `admin.display`, `admin.sort` and `admin.propertiesOrder` completion over
 * the collection's own property keys rather than plain `string`.
 *
 * @example
 * export default defineCollection({
 *     slug: "posts",
 *     table: "posts",
 *     properties: {
 *         title: { name: "Title", type: "string" },
 *         status: { name: "Status", type: "string" }
 *     },
 *     admin: {
 *         icon: "FileText",
 *         display: { title: "title" },   // completion: "title" | "status"
 *         listProperties: ["title", "status"]
 *     }
 * });
 *
 * @group Builder
 */
export function defineCollection<
    const E extends CollectionEngine = "postgres",
    /**
     * The properties, **constrained**. This is what checks them, and — just as
     * importantly — what supplies the contextual type inside them: without a
     * constraint the parameter of an inline
     * `callbacks: { beforeSave: ({ value }) => … }` has nothing to be typed
     * from, and TypeScript reports an implicit `any` on a callback the author
     * wrote correctly.
     */
    const P extends PropertiesForEngine<E> & Properties = PropertiesForEngine<E> & Properties,
    /**
     * The properties again, **unconstrained**, and this is why there are two.
     *
     * A constraint TypeScript cannot satisfy is one it silently falls back
     * from: one property with a bad `defaultValue` made `P` become
     * `PostgresProperties`, the entity shape become `Record<string, unknown>`,
     * and every `admin` key — `display.title`, `listProperties`,
     * `propertiesOrder` — widen to `string` and stop being checked. A
     * collection with two mistakes reported one, and revealed the second only
     * after the first was fixed.
     *
     * `KEYS` has no constraint to fall back from, so `keyof KEYS` survives a bad
     * property and the `admin` block is still checked against the real key set.
     */
    const KEYS = Properties,
    USER extends User = User
>(
    collection: Omit<CollectionConfigForEngine<E, KEYS, USER>, "properties" | "engine" | "dataSource">
        & {
            engine?: E;
            properties: StrictProperties<P, PropertyForEngine<E>> & KEYS;
            dataSource?: ResourceRef;
        }
): CollectionConfigForEngine<E, KEYS, USER> & { properties: KEYS };

/**
 * At runtime this records the collection as data: a resource handle written
 * where a key belongs — `dataSource: analytics`, `storageSource: media` — is
 * replaced by its key, so what leaves here serialises and compares like the
 * string it always was. The signature above is the rest of the point.
 * @group Builder
 */
export function defineCollection(
    collection: Omit<CollectionConfig, "dataSource"> & { dataSource?: ResourceRef }
): CollectionConfig {
    return resolveResourceRefs(collection) as CollectionConfig;
}
