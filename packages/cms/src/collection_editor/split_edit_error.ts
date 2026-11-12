/**
 * The refusals of `splitEdit`, in a module of their own: the controller and
 * the refusal view test for them on the eager path, while the split itself
 * is loaded with the first save.
 */
/**
 * Why an edit cannot be split into a schema edit and a presentation delta.
 *
 * - `MIGRATION_REQUIRED` — the slug, the SQL table or the database changed:
 *   that moves data, which is a migration.
 * - `NOT_A_COLUMN` — a property has no column equivalent on a table.
 * - `REDACTED_RULES` — the caller was served rules it may not read, so it may
 *   not write them back.
 * - `NO_PRIMARY_KEY` — a new table has an `id` field that is not its primary key.
 * - `EXTERNAL_COLLECTION` — the collection is not a table of this backend:
 *   it is defined in the frontend, and this backend cannot write the frontend
 *   (no dev server's source editor: production, or an older backend).
 * - `EDITED_IN_CODE` — a Firestore collection's edit changes a value that is
 *   code (a function, a component): it is changed in the collection's file.
 */
export class SplitEditError extends Error {
    constructor(
        readonly code: "MIGRATION_REQUIRED" | "NOT_A_COLUMN" | "REDACTED_RULES" | "NO_PRIMARY_KEY" | "EXTERNAL_COLLECTION" | "EDITED_IN_CODE",
        message: string,
        readonly key?: string
    ) {
        super(message);
        this.name = "SplitEditError";
    }
}
