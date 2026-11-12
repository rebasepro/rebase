import "../capabilities";
import type {
    AnyCollectionConfig,
    FirebaseCollectionConfig,
    ResourceRef,
    StrictProperties,
    User
} from "@rebasepro/types";
import { resolveResourceRefs, resourceKeyOf } from "@rebasepro/types";
import {
    FirestoreDocumentOf,
    FirestoreField,
    FirestoreFields,
    FirestoreFieldsAsProperties,
    normalizeFirestoreFields
} from "./fields";

/**
 * A Firestore collection as the admin mounts it: engine `firestore`, its
 * documents read and written in the browser by the Firestore driver of the
 * data source its `dataSource` names (`transport: "direct"`), never through
 * the Rebase backend.
 *
 * What {@link defineFirestoreCollection} returns.
 *
 * @group Firebase
 */
export type FirestoreCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    FirebaseCollectionConfig<M, USER>;

/**
 * Everything a Firestore collection declares besides its fields: `slug`,
 * `name`, `path` (where its documents live, when that is not the slug),
 * `dataSource`, `databaseId`, `subcollections`, `callbacks`, and the `admin`
 * block (views, Kanban, icon, group, entity actions…), with `M` the document
 * type the fields describe.
 *
 * @group Firebase
 */
export type FirestoreCollectionOptions<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<FirebaseCollectionConfig<M, USER>, "properties" | "engine" | "dataSource" | "subcollections">
    & {
        /**
         * The key of the `<Rebase dataSources>` entry that serves this
         * collection — the `key` given to `useFirestoreDataSource`. Leave it
         * out only when Firestore *is* the default data source
         * (`RebaseFirebaseApp`).
         */
        dataSource?: ResourceRef;
        /**
         * The collections nested under each document, shown as tabs of the
         * document and stored at `<path>/<id>/<child path>`. Each is
         * declared with `defineFirestoreCollection` too.
         */
        subcollections?: () => AnyCollectionConfig[];
    };

/**
 * Declare a Firestore collection for the admin — the one way to declare one.
 *
 * `fields` are the collection's properties in Firestore's terms: every key a
 * Firestore-capable property accepts, plus `required: true` for
 * `validation.required` and, on a reference, `target: "<collection slug>"` for
 * the collection it points at. A target may live on any data source: a
 * reference from this collection to a Postgres table's collection is routed
 * to the Postgres source when it is previewed or picked, and is stored in the
 * document as the target's id (a string), so it can be queried with `==`.
 *
 * The document type is inferred from `fields` the way `defineCollection`
 * infers it from `properties`, so `admin.display`, `admin.propertiesOrder`
 * and callback values are checked against the collection's own keys.
 *
 * @example
 * ```ts
 * const firestoreEvents = defineFirestoreCollection({
 *     slug: "fs_events",
 *     path: "events",
 *     name: "Live Events (Firestore)",
 *     dataSource: "firestore",
 *     fields: {
 *         type:       { name: "Event Type", type: "string", required: true },
 *         payload:    { name: "Payload", type: "map" },
 *         customerId: { name: "Customer", type: "reference", target: "customers" }
 *     },
 *     subcollections: () => [eventTracesFirestoreCollection]
 * });
 * ```
 *
 * @group Firebase
 */
export function defineFirestoreCollection<
    /**
     * The fields, **constrained**: what checks each one against its kind and
     * types the callbacks inside it.
     */
    const F extends FirestoreFields = FirestoreFields,
    /**
     * The fields again, **unconstrained**, so one bad field does not widen
     * the key set every other check reads (see `defineCollection`).
     */
    const KEYS = FirestoreFields,
    USER extends User = User
>(
    collection: FirestoreCollectionOptions<FirestoreDocumentOf<KEYS>, USER>
        & { fields: StrictProperties<F, FirestoreField> & KEYS }
): FirestoreCollection<FirestoreDocumentOf<KEYS>, USER> & { properties: FirestoreFieldsAsProperties<KEYS> };

/**
 * At runtime: the fields normalised into properties, `engine: "firestore"`
 * stamped, and a resource handle written where a key belongs (`dataSource`,
 * a field's `storage.storageSource`) replaced by its key.
 * @group Firebase
 */
export function defineFirestoreCollection(
    collection: FirestoreCollectionOptions & { fields: FirestoreFields }
): FirestoreCollection {
    const where = `defineFirestoreCollection("${String(collection.slug)}")`;
    if ("properties" in collection) {
        throw new Error(`${where} has \`properties\`. A Firestore collection declares its fields under \`fields\`.`);
    }
    if ("engine" in collection) {
        throw new Error(`${where} has \`engine\`. Leave it out: a collection defined here is always a Firestore one.`);
    }
    if (typeof collection.fields !== "object" || collection.fields === null) {
        throw new Error(`${where} has no \`fields\`. Declare the collection's fields: \`fields: { name: { type: "string" } }\`.`);
    }
    const { fields, dataSource, subcollections, ...rest } = collection;
    const defined: FirestoreCollection = {
        ...rest,
        engine: "firestore",
        properties: normalizeFirestoreFields(fields, where),
        ...(dataSource !== undefined ? { dataSource: resourceKeyOf(dataSource) } : {}),
        ...(subcollections !== undefined ? { subcollections } : {})
    };
    return resolveResourceRefs(defined);
}
