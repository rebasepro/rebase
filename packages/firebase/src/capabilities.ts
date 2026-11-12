import { ALL_WHERE_FILTER_OPS, registerDataSourceCapabilities } from "@rebasepro/types";
import type { DataSourceCapabilities } from "@rebasepro/types";

/**
 * What the Firestore engine can do, as the admin asks it: which editor tabs a
 * collection gets (subcollections, never relations), which filter operators a
 * column offers, whether a reference property exists.
 *
 * Firestore's own declaration, owned by the package that drives it. The admin
 * reads capabilities through `getDataSourceCapabilities(engine)`, and this
 * package registers this object under `firestore` before any of its
 * collections can be rendered (see {@link registerFirestoreCapabilities}) — so
 * the admin's answer for a Firestore collection never depends on a copy kept in
 * `@rebasepro/types`.
 *
 * @group Firebase
 */
export const FIRESTORE_CAPABILITIES: DataSourceCapabilities = {
    key: "firestore",
    label: "Firebase / Firestore",
    supportsRelations: false,
    supportsSubcollections: true,
    supportsRLS: false,
    supportsReferences: true,
    supportsColumnTypes: false,
    supportsRealtime: true,
    supportsVectors: false,
    // Firestore has no SQL pattern matching — the driver throws on the LIKE
    // family, so the UI must never offer it. It matches one element of an array
    // or any of a list; no query asks for all of them, or for none outside one.
    filterOperators: ALL_WHERE_FILTER_OPS.filter(op =>
        op !== "like" && op !== "ilike" && op !== "not-like" && op !== "not-ilike"
        && op !== "array-contains-all" && op !== "array-contained-by"),
    // No relations at all — a document store links by reference. Nothing to
    // reach through, so neither of the two relation-reaching features either.
    filterableRelationKinds: [],
    supportsRelationFieldFilters: false,
    relationAggregateSorts: false,
    supportsSQLAdmin: false,
    supportsSchemaAdmin: false
};

/**
 * Register {@link FIRESTORE_CAPABILITIES} under the `firestore` engine.
 *
 * Runs when this module is evaluated — which importing `defineFirestoreCollection`
 * or anything else from `@rebasepro/firebase` does — and again from
 * `useFirestoreDataSource`, for a bundle that evaluated a second copy of the
 * types package after this one. Without it, `getDataSourceCapabilities("firestore")`
 * would answer with the permissive default: relation tabs, and "Contains"
 * filters the driver refuses at query time.
 *
 * Idempotent: the registry is a map on a global symbol, keyed by engine.
 *
 * @group Firebase
 */
export function registerFirestoreCapabilities(): void {
    registerDataSourceCapabilities(FIRESTORE_CAPABILITIES);
}

registerFirestoreCapabilities();
