// Stands in for what `rebase build` emits. Hand-written so the fixture has no
// build step, and small on purpose — the split-roles e2e only needs the data
// surface to be genuinely servable, not to exercise the generator.
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const notes = pgTable("split_notes", {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title")
}).enableRLS();

// The shape the runtime loads. A bundle that omits `tables` boots and then
// cannot resolve a single collection to a table — which surfaces as
// "Table not found for collection", not as a missing schema.
export const tables = { notes };
export const enums = {};
export const relations = {};
