/**
 * The name of the call a Firestore collection is declared with, in a module of
 * its own: the collection editor's controller lists those calls on the eager
 * path, while `firestore_edit` (and the `split_edit` it imports) load with the
 * first save of a Firestore collection.
 *
 * @module
 */

/** The call a Firestore collection is declared with. */
export const FIRESTORE_COLLECTION_CALLEE = "defineFirestoreCollection";
