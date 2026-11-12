/**
 * The collection editor's edits to a Firestore collection — one
 * `defineFirestoreCollection({...})` call in `frontend/src/cms` — as a list of
 * operations, the way `TablePatch` lists its edits to a `defineTable`.
 *
 * A Firestore collection has no server schema: everything it declares is the
 * frontend definition, so every edit the editor makes to one is one of these,
 * written in the collection's own vocabulary (`fields`, `required`, a
 * reference's `target`, the `admin` block). The admin panel sends them, in
 * development, to the dev server's frontend source editor, which writes them
 * into the call as literals and leaves everything else in the file — functions,
 * components, comments, imports — byte for byte.
 *
 * Paths are lists of keys: `["admin", "icon"]` for a collection option,
 * `["validation", "max"]` or `["properties", "street", "name"]` inside a field.
 *
 * @module
 */

/**
 * JSON: what an option or a field is written as. Functions, components and
 * other code are never part of a patch — they are edited in code.
 *
 * @group Collections
 */
export type FirestorePatchValue =
    | null
    | boolean
    | number
    | string
    | FirestorePatchValue[]
    | { [key: string]: FirestorePatchValue };

/**
 * One edit to a Firestore collection, named by its slug.
 *
 * - `setOption` / `removeOption` — a collection option at `path` (`name`,
 *   `path`, `description`, `admin.icon`, `admin.propertiesOrder`…).
 * - `addField` — a new field, written whole, before the field `before` or last.
 * - `setFieldOption` / `removeFieldOption` — one option of a field at `path`
 *   (`name`, `type`, `required`, `validation.max`, `target`, `enum`,
 *   `properties.<key>` of a map). Removing `required` removes
 *   `validation.required` too: the two are one fact.
 * - `removeField`, `renameField`, `moveField` — a field as a whole; a rename
 *   keeps everything the field holds, code included.
 *
 * @group Collections
 */
export type FirestoreCollectionPatch =
    | { op: "setOption"; collection: string; path: string[]; value: FirestorePatchValue }
    | { op: "removeOption"; collection: string; path: string[] }
    | { op: "addField"; collection: string; key: string; field: { [key: string]: FirestorePatchValue }; before?: string }
    | { op: "setFieldOption"; collection: string; key: string; path: string[]; value: FirestorePatchValue }
    | { op: "removeFieldOption"; collection: string; key: string; path: string[] }
    | { op: "removeField"; collection: string; key: string }
    | { op: "renameField"; collection: string; key: string; to: string }
    | { op: "moveField"; collection: string; key: string; before?: string };
