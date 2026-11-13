import { col, defineTable, pgEnum, sql } from "../../src/schema";
import { DRIZZLE_REFUSALS } from "../../src/schema/columns";
import type { InferInsert, InferRow } from "../../src/schema";

/**
 * The Drizzle spelling of `col.*` (`drizzle-alignment.md`): what an agent
 * writes from Drizzle memory either compiles with the same meaning, or fails to
 * compile with the instruction. The `Equal<…>` assertions and the
 * `@ts-expect-error` lines are checked by `tsc` (`tsconfig.tests.json`); the
 * runtime tests prove each refusal also throws, with the same text, for a
 * JavaScript caller.
 */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compiles only when its argument is `true`. */
function assertType<T extends true>(_proof?: T): void {
    void _proof;
}

const postStatus = pgEnum("post_status", ["draft", "published"]);

const drizzle = defineTable("drizzle_posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        legacyTitle: col.text("legacy_title").notNull(),
        slug: col.varchar({ length: 160 }).notNull().unique(),
        kind: col.text({ enum: ["news", "guide"] }),
        code: col.char({ length: 2, enum: ["eu", "us"] }).notNull(),
        status: postStatus().notNull().default("draft"),
        state: postStatus("state_col"),
        tags: col.text().array().notNull().default([]),
        kinds: col.text({ enum: ["a", "b"] }).array(),
        views: col.bigint({ mode: "number" }).notNull().default(0),
        seq: col.integer().generatedByDefaultAsIdentity(),
        price: col.numeric({ precision: 10, scale: 2 }),
        amount: col.decimal({ precision: 8, mode: "number" }),
        embedding: col.vector({ dimensions: 3, index: false }),
        metadata: col.jsonb().$type<{ seoTitle?: string }>(),
        short: col.text().notNull().default(sql`gen_short_id()`),
        lower: col.text().generatedAlwaysAs(sql`lower(legacy_title)`),
        ip: col.custom({ dataType: "inet" }),
        day: col.date({ mode: "string" }),
        at: col.time(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().defaultNow(),
        updatedAt: col.timestamp("updated", { withTimezone: true, mode: "string" }).onUpdateNow()
    },
    rls: "admin-only"
});

type Row = InferRow<typeof drizzle>;
type Insert = InferInsert<typeof drizzle>;

export function drizzleRowTypes(): void {
    assertType<Equal<Row["legacyTitle"], string>>();
    assertType<Equal<Row["kind"], "news" | "guide" | null>>();
    assertType<Equal<Row["code"], "eu" | "us">>();
    assertType<Equal<Row["status"], "draft" | "published">>();
    assertType<Equal<Row["state"], "draft" | "published" | null>>();
    assertType<Equal<Row["tags"], string[]>>();
    assertType<Equal<Row["kinds"], ("a" | "b")[] | null>>();
    assertType<Equal<Row["views"], number>>();
    assertType<Equal<Row["price"], number | null>>();
    assertType<Equal<Row["embedding"], number[] | null>>();
    assertType<Equal<Row["metadata"], { seoTitle?: string } | null>>();
    assertType<Equal<Row["createdAt"], string>>();
    // Defaults make a create optional.
    assertType<Equal<undefined extends Insert["short"] ? true : false, true>>();
    assertType<Equal<undefined extends Insert["createdAt"] ? true : false, true>>();
    assertType<Equal<undefined extends Insert["seq"] ? true : false, true>>();
    assertType<Equal<"lower" extends keyof Insert ? true : false, false>>();
    assertType<Equal<undefined extends Insert["tags"] ? true : false, true>>();
}

/**
 * The spellings Rebase had before it took Drizzle's (`drizzle-alignment-renames.json`)
 * are gone: each fails to compile, and the ones a JavaScript caller can still
 * reach throw the instruction.
 */
export function retiredSpellings(): void {
    // @ts-expect-error — a bare varchar is unbounded in Drizzle: `col.varchar({ length: 255 })`.
    col.varchar();
    // @ts-expect-error — the length is a config key: `col.varchar({ length: 160 })`.
    col.varchar(160);
    // @ts-expect-error — a bare char is char(1) in Drizzle: `col.char({ length: 2 })`.
    col.char();
    // @ts-expect-error — `col.bigint({ mode: "number" })`.
    col.bigint();
    // @ts-expect-error — `col.bigserial({ mode: "number" })`.
    col.bigserial();
    // @ts-expect-error — `col.numeric({ precision: 10, scale: 2 })`.
    col.numeric(10, 2);
    // @ts-expect-error — `col.vector({ dimensions: 3 })`.
    col.vector(3, { index: false });
    // @ts-expect-error — a lone string is the SQL column name: `col.custom({ dataType: "inet" })`.
    col.custom("inet");
    // @ts-expect-error — a named enum type is a `pgEnum`.
    col.enum(["draft", "published"], { name: "post_status" });
    // @ts-expect-error — `col.timestamp({ withTimezone: true })`.
    col.timestamptz();
    // @ts-expect-error — `col.text().array()`.
    col.array(col.text());
    // @ts-expect-error — `col.jsonb().$type<T>()`.
    col.jsonb<{ seoTitle?: string }>();
    // @ts-expect-error — the SQL name is the builder's leading argument: `col.text("legacy")`.
    col.text().column("legacy");
    // @ts-expect-error — `.default(sql\`gen_short_id()\`)`.
    col.text().defaultSql("gen_short_id()");
    // @ts-expect-error — `.generatedAlwaysAs(sql\`lower(title)\`)`.
    col.text().generatedAs("lower(title)");
    // @ts-expect-error — `.generatedByDefaultAsIdentity()`.
    col.integer().identity();
}

/** Every refused Drizzle spelling fails to compile; the message is the `this` / argument / key type. */
export function refusedSpellings(): void {
    // @ts-expect-error — Drizzle's bare timestamp is WITHOUT time zone.
    col.timestamp();
    // @ts-expect-error — the same, said explicitly.
    col.timestamp({ withTimezone: false });
    // @ts-expect-error — the wire is an ISO string, not a Date.
    col.timestamp({ withTimezone: true, mode: "date" });
    // @ts-expect-error — no precision.
    col.timestamp({ withTimezone: true, precision: 3 });
    // @ts-expect-error — the wire is a string.
    col.date({ mode: "date" });
    // @ts-expect-error — time is without time zone.
    col.time({ withTimezone: true });
    // @ts-expect-error — numeric is a JSON number.
    col.numeric({ precision: 10, mode: "string" });
    // @ts-expect-error — bigint is a JSON number.
    col.bigint({ mode: "bigint" });
    // @ts-expect-error — a varchar named but with no length would be unbounded.
    col.varchar("title");
    // @ts-expect-error — a config with no length would be unbounded.
    col.varchar({ enum: ["a"] });
    // @ts-expect-error — only BY DEFAULT identities.
    col.integer().generatedAlwaysAsIdentity();
    // @ts-expect-error — no sequence options.
    col.integer().generatedByDefaultAsIdentity({ startWith: 10 });
    // @ts-expect-error — foreign keys are relations.
    col.uuid().references(() => undefined, { onDelete: "cascade" });
    // @ts-expect-error — the schema is data.
    col.text().$defaultFn(() => "x");
    // @ts-expect-error — the schema is data.
    col.text().$default(() => "x");
    // @ts-expect-error — the schema is data.
    col.timestamp({ withTimezone: true }).$onUpdate(() => new Date().toISOString());
    // @ts-expect-error — the schema is data.
    col.timestamp({ withTimezone: true }).$onUpdateFn(() => new Date().toISOString());
    // @ts-expect-error — constraint names are derived.
    col.text().unique("posts_slug_key");
    // @ts-expect-error — modifiers before `.array()` would describe each item.
    col.text().notNull().array();
    // @ts-expect-error — a default before `.array()`.
    col.text().default("x").array();
    // @ts-expect-error — Postgres ignores array sizes.
    col.text().array(3);
    // @ts-expect-error — no arrays of arrays.
    col.text().array().array();
    // @ts-expect-error — generated columns take SQL.
    col.text().generatedAlwaysAs("lower(title)");
    // @ts-expect-error — `sql` takes no interpolation.
    void sql`lower(${"title"})`;
    // @ts-expect-error — enums take a list of labels.
    pgEnum("mood", { Happy: "happy" });
    // @ts-expect-error — no `col.inet()`; `col.custom({ dataType: "inet" })`.
    col.inet();
    // @ts-expect-error — no `col.interval()`.
    col.interval("gap");
}

describe("Drizzle spellings Rebase refuses", () => {
    const throwsWith = (message: string, call: () => unknown) => expect(call).toThrow(message);
    // Calls through `Reflect.apply`: what a JavaScript caller does, with the
    // types out of the way.
    const callMethod = (target: object, method: string, ...args: unknown[]): unknown =>
        Reflect.apply(Reflect.get(target, method), target, args);

    it("throws the instruction the types show", () => {
        throwsWith(DRIZZLE_REFUSALS.timestamp, () => callMethod(col, "timestamp"));
        throwsWith(DRIZZLE_REFUSALS.timestamp, () => callMethod(col, "timestamp", { withTimezone: false }));
        throwsWith(DRIZZLE_REFUSALS.timestampMode, () => callMethod(col, "timestamp", { withTimezone: true, mode: "date" }));
        throwsWith(DRIZZLE_REFUSALS.timestampPrecision, () => callMethod(col, "timestamp", { withTimezone: true, precision: 3 }));
        throwsWith(DRIZZLE_REFUSALS.dateMode, () => callMethod(col, "date", { mode: "date" }));
        throwsWith(DRIZZLE_REFUSALS.timeZone, () => callMethod(col, "time", { withTimezone: true }));
        throwsWith(DRIZZLE_REFUSALS.numericMode, () => callMethod(col, "numeric", { mode: "string" }));
        throwsWith(DRIZZLE_REFUSALS.bigintMode, () => callMethod(col, "bigint", { mode: "bigint" }));
        throwsWith(DRIZZLE_REFUSALS.varcharLength, () => callMethod(col, "varchar", "title"));
        throwsWith(DRIZZLE_REFUSALS.charLength, () => callMethod(col, "char", { enum: ["a"] }));
        throwsWith(DRIZZLE_REFUSALS.identityAlways, () => callMethod(col.integer(), "generatedAlwaysAsIdentity"));
        throwsWith(DRIZZLE_REFUSALS.identityOptions, () => callMethod(col.integer(), "generatedByDefaultAsIdentity", { startWith: 1 }));
        throwsWith(DRIZZLE_REFUSALS.references, () => callMethod(col.uuid(), "references", () => undefined));
        throwsWith(DRIZZLE_REFUSALS.defaultFn, () => callMethod(col.text(), "$defaultFn", () => "x"));
        throwsWith(DRIZZLE_REFUSALS.onUpdateFn, () => callMethod(col.text(), "$onUpdate", () => "x"));
        throwsWith(DRIZZLE_REFUSALS.uniqueName, () => callMethod(col.text(), "unique", "name"));
        throwsWith(DRIZZLE_REFUSALS.arrayOrder, () => callMethod(col.text().notNull(), "array"));
        throwsWith(DRIZZLE_REFUSALS.arraySize, () => callMethod(col.text(), "array", 3));
        throwsWith(DRIZZLE_REFUSALS.arrayOfArray, () => callMethod(col.text().array(), "array"));
        throwsWith(DRIZZLE_REFUSALS.generatedValue, () => callMethod(col.text(), "generatedAlwaysAs", "lower(x)"));
        throwsWith(DRIZZLE_REFUSALS.pgEnumObject, () => Reflect.apply(pgEnum, undefined, ["mood", { Happy: "happy" }]));
        throwsWith("write `col.custom({ dataType: \"inet\" })`", () => callMethod(col, "inet"));
    });

    it("throws the instruction for a retired spelling a JavaScript caller can still write", () => {
        throwsWith(DRIZZLE_REFUSALS.varcharLength, () => callMethod(col, "varchar"));
        throwsWith(DRIZZLE_REFUSALS.varcharLength, () => callMethod(col, "varchar", 160));
        throwsWith(DRIZZLE_REFUSALS.charLength, () => callMethod(col, "char", 2));
        throwsWith(DRIZZLE_REFUSALS.bigintModeMissing, () => callMethod(col, "bigint"));
        throwsWith(DRIZZLE_REFUSALS.bigintModeMissing, () => callMethod(col, "bigserial"));
        throwsWith(DRIZZLE_REFUSALS.numericPositional, () => callMethod(col, "numeric", 10, 2));
        throwsWith(DRIZZLE_REFUSALS.vectorPositional, () => callMethod(col, "vector", 3));
        throwsWith(DRIZZLE_REFUSALS.customDataType, () => callMethod(col, "custom", "inet"));
        throwsWith(DRIZZLE_REFUSALS.enumName, () => callMethod(col, "enum", ["a"], { name: "kind" }));
        for (const gone of ["timestamptz", "array"]) expect(gone in col).toBe(false);
        for (const gone of ["column", "defaultSql", "generatedAs", "identity"]) expect(gone in col.text()).toBe(false);
    });

    it("refuses an interpolation in sql``", () => {
        const strings = Object.assign(["lower(", ")"], { raw: ["lower(", ")"] });
        throwsWith(DRIZZLE_REFUSALS.sqlInterpolation, () => Reflect.apply(sql, undefined, [strings, "title"]));
    });

    it("builds the Drizzle-spelled table", () => {
        expect(drizzle.config.columns.legacyTitle.def.column).toBe("legacy_title");
        expect(drizzle.config.columns.state.def.column).toBe("state_col");
        expect(drizzle.config.columns.updatedAt.def.column).toBe("updated");
        expect(postStatus.enumName).toBe("post_status");
        expect(postStatus.enumValues).toEqual(["draft", "published"]);
    });
});
