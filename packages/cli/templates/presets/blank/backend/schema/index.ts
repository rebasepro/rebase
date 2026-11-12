/**
 * Every table this backend serves. A `defineTable` that is not exported from
 * here is refused at boot and by `rebase db generate`.
 *
 * Add a table as `backend/schema/<name>.ts`:
 *
 *     import { defineTable, col } from "@rebasepro/server/schema";
 *
 *     export const notes = defineTable("notes", {
 *         columns: {
 *             id: col.uuid().primaryKey().defaultRandom(),
 *             body: col.text().notNull()
 *         },
 *         rls: "admin-only"
 *     });
 *
 * then export it here. `pnpm dev` creates it.
 */
export { users } from "./users";
