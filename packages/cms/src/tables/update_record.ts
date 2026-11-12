/**
 * `updateRecord`: the write an entity action most often makes.
 */
import type { CustomizableTable, RebaseContext, TableUpdate } from "@rebasepro/cms-types";

/**
 * Writes `patch` onto one record through the panel's data layer, then says so.
 *
 * The write goes through `context.data`, so it is the same request the form
 * would make — the server's hooks and row-level security apply — and every
 * view of the table refreshes. `message`, when given, is shown as a success
 * snackbar. A failed write throws, and the action that called it reports it.
 *
 * Takes what an entity action's `onClick` receives as-is, so a missing context
 * or id (an action on a record that does not exist yet) writes nothing:
 *
 * ```ts
 * onClick: ({ id, context }) =>
 *     updateRecord(context, "posts", id, { status: "published" }, "Published")
 * ```
 *
 * With the table as a type argument the patch is checked against what an
 * update of it accepts: `updateRecord<typeof posts>(context, "posts", id, { … })`.
 *
 * @param context the action's `context`
 * @param slug the table's slug
 * @param id the record's id
 * @param patch the columns to write, as the server takes them (a date as its ISO string)
 * @param message what the success snackbar says; none when omitted
 *
 * @group Tables
 */
export async function updateRecord<T extends CustomizableTable | undefined = undefined>(
    context: RebaseContext | undefined,
    slug: string | undefined,
    id: string | number | undefined,
    patch: TableUpdate<T>,
    message?: string
): Promise<void> {
    if (!context || !slug || id === undefined) return;
    await context.data.table(slug).update(id, patch);
    if (message) context.snackbarController?.open({ type: "success", message });
}
