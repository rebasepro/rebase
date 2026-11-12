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

/** `col.array(inner)` of every scalar element type. */
export const lists = defineTable("lists", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        ids: col.array(col.uuid()),
        counts: col.array(col.bigint()),
        smalls: col.array(col.smallint()),
        numbers: col.array(col.integer()),
        amounts: col.array(col.numeric(8, 2)),
        ratios: col.array(col.doublePrecision()),
        labels: col.array(col.enum(["red", "green", "blue"])),
        codes: col.array(col.varchar(5)),
        words: col.array(col.text()),
        flags: col.array(col.boolean()),
        days: col.array(col.date()),
        instants: col.array(col.timestamptz()),
        times: col.array(col.time())
    },
    rls: "admin-only"
});

const PRIORITIES = ["low", "normal", "high"] as const;

/** `col.enum(values, { name })`: one shared type, used by several columns of several tables. */
export const tasks = defineTable("tasks", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        priority: col.enum(PRIORITIES, { name: "priority" }).notNull().default("normal"),
        escalatedTo: col.enum(PRIORITIES, { name: "priority" })
    },
    rls: "admin-only"
});

export const bugs = defineTable("bugs", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        priority: col.enum(PRIORITIES, { name: "priority" }),
        history: col.array(col.enum(PRIORITIES, { name: "priority" })),
        state: col.enum(["open", "closed"])
    },
    rls: "admin-only"
});

/** A `varchar(n)` / `char(n)` length is `n`, whatever `.validate({ max })` says to the API. */
export const handles = defineTable("handles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        handle: col.varchar(40).notNull().validate({ max: 20 }),
        country: col.char(2).validate({ min: 2, max: 3 })
    },
    // `reason` is optional on a table's index.
    indexes: [{ columns: ["country", "handle"] }],
    rls: "admin-only"
});

/**
 * `rel.belongsTo(…, { constraint: false })`: a key column with no `FOREIGN KEY`
 * — bound or derived, indexed unless `index: false`, still a relation.
 */
export const audits = defineTable("audits", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        actorId: col.uuid()
    },
    relations: {
        actor: rel.belongsTo(() => people, { localKey: "actor_id", constraint: false }),
        subject: rel.belongsTo(() => people, { constraint: false, notNull: true }),
        archived: rel.belongsTo(() => people, { constraint: false, index: false })
    },
    rls: "admin-only"
});

/** Every table, in an order that declares a target before what points at it. */
export const TABLE_FEATURES = [
    people, counters, tallies, codes, initials, grades, days, switches, prices, tickets, slugs, pairs, keyed, lists, tasks, bugs, handles, audits
];
