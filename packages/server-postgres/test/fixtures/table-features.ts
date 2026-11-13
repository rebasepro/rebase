/**
 * Tables using what only the table model can say — the features `lowerTables`
 * used to refuse as pending, which the planner now plans from each column's
 * own definition. Corpus-independent on purpose: nothing here has a legacy
 * spelling to be equivalent to, so `table-features.test.ts` holds the planner,
 * both renderers, Postgres (PGlite) and the boot planner to them directly.
 */
import { col, defineTable, rel, pgEnum, sql } from "@rebasepro/types";

/** `.generatedAlwaysAs()`: a column Postgres computes from the row. */
export const people = defineTable("people", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        firstName: col.text().notNull(),
        lastName: col.text().notNull(),
        fullName: col.text().notNull().generatedAlwaysAs(sql`first_name || ' ' || last_name`),
        initials: col.varchar({ length: 2 }).generatedAlwaysAs(sql`left(first_name, 1) || left(last_name, 1)`)
    },
    rls: "admin-only"
});

/** `.generatedByDefaultAsIdentity()` at every width, key or not. */
export const counters = defineTable("counters", {
    columns: {
        id: col.bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
        sequenceNo: col.integer().notNull().generatedByDefaultAsIdentity(),
        tick: col.smallint().generatedByDefaultAsIdentity(),
        label: col.text()
    },
    rls: "admin-only"
});

/** A smallint identity key, and links into a bigint identity key — one bound, one derived. */
export const tallies = defineTable("tallies", {
    columns: {
        code: col.smallint().primaryKey().generatedByDefaultAsIdentity(),
        counterId: col.bigint({ mode: "number" }).notNull()
    },
    relations: {
        counter: rel.belongsTo(() => counters, { localKey: "counter_id" }),
        backup: rel.belongsTo(() => counters)
    },
    rls: "admin-only"
});

/** One table per scalar key type a table may be keyed by. */
export const codes = defineTable("codes", { columns: { code: col.varchar({ length: 12 }).primaryKey() }, rls: "admin-only" });
export const initials = defineTable("initials", { columns: { letter: col.char({ length: 1 }).primaryKey() }, rls: "admin-only" });
export const grades = defineTable("grades", { columns: { grade: col.enum(["a", "b", "c"]).primaryKey() }, rls: "admin-only" });
export const days = defineTable("days", { columns: { day: col.date().primaryKey() }, rls: "admin-only" });
export const switches = defineTable("switches", { columns: { enabled: col.boolean().primaryKey() }, rls: "admin-only" });
export const prices = defineTable("prices", { columns: { amount: col.numeric({ precision: 10, scale: 2 }).primaryKey() }, rls: "admin-only" });
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

/** `<item>.array()` of every scalar element type. */
export const lists = defineTable("lists", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        ids: col.uuid().array(),
        counts: col.bigint({ mode: "number" }).array(),
        smalls: col.smallint().array(),
        numbers: col.integer().array(),
        amounts: col.numeric({ precision: 8, scale: 2 }).array(),
        ratios: col.doublePrecision().array(),
        labels: col.enum(["red", "green", "blue"]).array(),
        codes: col.varchar({ length: 5 }).array(),
        words: col.text().array(),
        flags: col.boolean().array(),
        days: col.date().array(),
        instants: col.timestamp({ withTimezone: true }).array(),
        times: col.time().array()
    },
    rls: "admin-only"
});

const PRIORITIES = ["low", "normal", "high"] as const;

const priorityEnum = pgEnum("priority", PRIORITIES);

/** `pgEnum(name, values)`: one shared type, used by several columns of several tables. */
export const tasks = defineTable("tasks", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        priority: priorityEnum().notNull().default("normal"),
        escalatedTo: priorityEnum()
    },
    rls: "admin-only"
});

export const bugs = defineTable("bugs", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        priority: priorityEnum(),
        history: priorityEnum().array(),
        state: col.enum(["open", "closed"])
    },
    rls: "admin-only"
});

/** A `varchar(n)` / `char(n)` length is `n`, whatever `.validate({ max })` says to the API. */
export const handles = defineTable("handles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        handle: col.varchar({ length: 40 }).notNull().validate({ max: 20 }),
        country: col.char({ length: 2 }).validate({ min: 2, max: 3 })
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

/**
 * A declared column that is both part of a composite key and a foreign key,
 * at another integer width than the key it points at — the shape a database
 * grown over years holds (`integer` into `bigint`).
 */
export const members = defineTable("members", { columns: { id: col.bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity() }, rls: "admin-only" });
export const memberTags = defineTable("member_tags", {
    columns: {
        memberId: col.integer().primaryKey(),
        tag: col.text().primaryKey()
    },
    relations: { member: rel.belongsTo(() => members, { localKey: "member_id" }) },
    rls: "admin-only"
});

/** Every table, in an order that declares a target before what points at it. */
export const TABLE_FEATURES = [
    people, counters, tallies, codes, initials, grades, days, switches, prices, tickets, slugs, pairs, keyed, lists, tasks, bugs, handles, audits, members, memberTags
];
