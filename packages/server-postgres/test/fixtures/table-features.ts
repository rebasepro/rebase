/**
 * Tables using what only the table model can say — the features `lowerTables`
 * used to refuse as pending, which the planner now plans from each column's
 * own definition. Corpus-independent on purpose: nothing here has a legacy
 * spelling to be equivalent to, so `table-features.test.ts` holds the planner,
 * both renderers, Postgres (PGlite) and the boot planner to them directly.
 */
import { col, defineTable } from "@rebasepro/types";

/** `.generatedAs()`: a column Postgres computes from the row. */
export const people = defineTable("people", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        firstName: col.text().notNull(),
        lastName: col.text().notNull(),
        fullName: col.text().notNull().generatedAs("first_name || ' ' || last_name"),
        initials: col.varchar(2).generatedAs("left(first_name, 1) || left(last_name, 1)")
    },
    rls: "admin-only"
});

/** Every table, in an order that declares a target before what points at it. */
export const TABLE_FEATURES = [people];
