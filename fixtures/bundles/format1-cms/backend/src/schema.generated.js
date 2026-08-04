// Frozen build output. This is what the Rebase Drizzle generator emitted for
// this bundle's collections, kept exactly as it was rather than regenerated.
//
// A real bundle always ships one of these: the runtime creates the physical
// tables at boot, but the QUERY layer resolves a collection to a drizzle table
// through this module. A bundle without it boots, answers /health, and 500s on
// the first read — which is the shape of failure this corpus exists to catch.
//
// It is deliberately coupled to the drizzle version of its era. If a drizzle API
// change makes this stop loading, every bundle deployed in that era would stop
// loading too, and that is the finding.
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

export const notes = pgTable("corpus_notes_format1", {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true })
}).enableRLS();

// The shape the runtime actually loads. `loadBundleSchema` reads exactly these
// three exports — individual table exports above are for humans and for
// drizzle-kit; a bundle that omits `tables` boots and then cannot resolve a
// single collection to a table.
export const tables = { notes };
export const enums = {};
export const relations = {};
