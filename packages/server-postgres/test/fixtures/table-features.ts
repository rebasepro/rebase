/**
 * Tables using what only the table model can say — the features `lowerTables`
 * used to refuse as pending, which the planner now plans from each column's
 * own definition. Corpus-independent on purpose: nothing here has a legacy
 * spelling to be equivalent to, so `table-features.test.ts` holds the planner,
 * both renderers, Postgres (PGlite) and the boot planner to them directly.
 */
import { col, defineTable, rel } from "@rebasepro/types";

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

/** `.identity()` at every width, key or not. */
export const counters = defineTable("counters", {
    columns: {
        id: col.bigint().primaryKey().identity(),
        sequenceNo: col.integer().notNull().identity(),
        tick: col.smallint().identity(),
        label: col.text()
    },
    rls: "admin-only"
});

/** A smallint identity key, and links into a bigint identity key — one bound, one derived. */
export const tallies = defineTable("tallies", {
    columns: {
        code: col.smallint().primaryKey().identity(),
        counterId: col.bigint().notNull()
    },
    relations: {
        counter: rel.belongsTo(() => counters, { localKey: "counter_id" }),
        backup: rel.belongsTo(() => counters)
    },
    rls: "admin-only"
});

/** One table per scalar key type a table may be keyed by. */
export const codes = defineTable("codes", { columns: { code: col.varchar(12).primaryKey() }, rls: "admin-only" });
export const initials = defineTable("initials", { columns: { letter: col.char(1).primaryKey() }, rls: "admin-only" });
export const grades = defineTable("grades", { columns: { grade: col.enum(["a", "b", "c"]).primaryKey() }, rls: "admin-only" });
export const days = defineTable("days", { columns: { day: col.date().primaryKey() }, rls: "admin-only" });
export const switches = defineTable("switches", { columns: { enabled: col.boolean().primaryKey() }, rls: "admin-only" });
export const prices = defineTable("prices", { columns: { amount: col.numeric(10, 2).primaryKey() }, rls: "admin-only" });
export const tickets = defineTable("tickets", { columns: { id: col.serial().primaryKey() }, rls: "admin-only" });
export const slugs = defineTable("slugs", { columns: { slug: col.text().primaryKey() }, rls: "admin-only" });

/** A composite key: one `PRIMARY KEY (a, b)`, in declaration order. */
export const pairs = defineTable("pairs", {
    columns: {
        left: col.uuid().primaryKey(),
        right: col.text().primaryKey(),
        note: col.text()
    },
    rls: "admin-only"
});

/** A link into each of those keys, its column typed by the key it points at. */
export const keyed = defineTable("keyed", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: {
        code: rel.belongsTo(() => codes),
        letter: rel.belongsTo(() => initials),
        grade: rel.belongsTo(() => grades),
        day: rel.belongsTo(() => days),
        switch: rel.belongsTo(() => switches),
        price: rel.belongsTo(() => prices),
        ticket: rel.belongsTo(() => tickets),
        slug: rel.belongsTo(() => slugs)
    },
    rls: "admin-only"
});

/** Every table, in an order that declares a target before what points at it. */
export const TABLE_FEATURES = [people, counters, tallies, codes, initials, grades, days, switches, prices, tickets, slugs, pairs, keyed];
