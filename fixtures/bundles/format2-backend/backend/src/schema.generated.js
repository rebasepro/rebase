// Frozen build output — see the sibling fixture's note for why it is not
// regenerated.
import { pgTable, text, uuid, boolean, timestamp } from 'drizzle-orm/pg-core';

export const notes = pgTable("corpus_notes_format2", {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body"),
    published: boolean("published"),
    createdAt: timestamp("created_at", { withTimezone: true })
}).enableRLS();

// The shape the runtime actually loads. `loadBundleSchema` reads exactly these
// three exports — individual table exports above are for humans and for
// drizzle-kit; a bundle that omits `tables` boots and then cannot resolve a
// single collection to a table.
export const tables = { notes };
export const enums = {};
export const relations = {};
