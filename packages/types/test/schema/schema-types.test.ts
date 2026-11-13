import { col, defineAuthTable, defineTable, defineView, json, rel, sql } from "../../src/schema";
import type { ColumnKeyOf, InferInsert, InferRow, InferUpdate, JsonGeoPoint, RelationKeyOf, AnyTableDef, TableSlugOf, TableDef } from "../../src/schema";

/**
 * The type-level contract of the schema builders.
 *
 * Every assertion here is checked by `tsc` (this directory is in
 * `tsconfig.tests.json`, which `pnpm typecheck` runs, and
 * `pnpm check:ts-expect-error-coverage` holds it there): an `Equal<…>` that
 * stops holding, or a `@ts-expect-error` whose line starts compiling, fails the
 * typecheck. The assertions live in functions that are never called — several
 * of the refused calls would also throw at runtime, which is beside the point
 * here — and one runtime test proves the examples build.
 */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compiles only when its argument is `true`. */
function assertType<T extends true>(_proof?: T): void {
    void _proof;
}

// ── The spec's §4.1 example, verbatim ────────────────────────────────────────

const users = defineAuthTable("users", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text().notNull().unique() },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    rls: "inherit"
});

export const posts = defineTable("posts", {
    // Optional overrides (table defaults to "posts", schema defaults to "public", slug defaults to "posts")
    slug: "posts",
    schema: "public",

    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        slug:        col.varchar({ length: 160 }).notNull().unique(),
        status:      col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        heroImage:   col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
        embedding:   col.vector({ dimensions: 1536, index: { method: "hnsw", metric: "cosine" } }),
        metadata:    col.jsonb().$type<{ seoTitle?: string; canonicalUrl?: string }>(),
        publishDate: col.timestamp({ withTimezone: true }),
        orgId:       col.uuid().notNull(),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt:   col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
        deletedAt:   col.timestamp({ withTimezone: true }),
        __order:     col.text(),
    },

    relations: {
        author: rel.belongsTo(() => users, {
            // Creates FK column `author_id` (or binds to an explicit column in `columns`) + btree index
            localKey: "author_id",
            notNull: true,
            onDelete: "restrict",
        }),
        tags: rel.manyToMany(() => tags, {
            through: "posts_tags",
            pivot: {
                addedBy: col.uuid(),
                sortOrder: col.integer().default(0),
            },
        }),
    },

    // MANDATORY: omitting `rls` is a compile-time error AND a boot-time error.
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],

    // Built-in Postgres capabilities (1:1 with current PostgresCollectionConfig)
    tenant:     { field: "orgId", from: { claim: "org_id" } },
    softDelete: { field: "deletedAt" },
    history:    true,
    search:     { fields: ["title"], language: "english" },
    indexes:    [{ columns: ["orgId", "status", "publishDate"] }],

    hooks: {
        beforeSave: ({ values, previousValues }) => {
            const merged = { ...previousValues, ...values };
            if (typeof merged.title === "string" && !merged.slug) {
                values.slug = merged.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            return values;
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        afterRead: ({ values, context }) => {
            // Full parity with current PII masking (`maskValues`) across REST, Realtime & MCP
            return values;
        },
    },
});

// ── Inference of every column kind and flag ──────────────────────────────────

const kinds = defineTable("kinds", {
    columns: {
        id: col.uuid().primaryKey(),
        text: col.text(),
        varchar: col.varchar({ length: 10 }).notNull(),
        char: col.char({ length: 2 }),
        status: col.enum(["a", "b"]),
        small: col.smallint(),
        int: col.integer().notNull(),
        big: col.bigint({ mode: "number" }),
        smallSerial: col.smallserial(),
        serial: col.serial(),
        bigSerial: col.bigserial({ mode: "number" }),
        real: col.real(),
        double: col.doublePrecision(),
        numeric: col.numeric({ precision: 10, scale: 2 }),
        flag: col.boolean().notNull().default(false),
        at: col.timestamp({ withTimezone: true }),
        day: col.date().notNull(),
        clock: col.time(),
        doc: col.jsonb().$type<{ a: number }>().notNull(),
        loose: col.json(),
        shaped: col.jsonb(json.object({
            title: json.string().required(),
            tags: json.array(json.string()),
            where: json.geopoint(),
            blocks: json.array(json.oneOf({ text: json.string(), count: json.number() })),
            kind: json.string().oneOf(["x", "y"]).required(),
            extra: json.unknown()
        })),
        list: col.integer().array().notNull(),
        roles: col.text({ enum: ["admin", "editor"] }).array(),
        embedding: col.vector({ dimensions: 3 }),
        bytes: col.bytea(),
        point: col.geopoint(),
        file: col.storage({ path: "f/" }),
        files: col.storage({ path: "f/" }).multiple(),
        priority: col.integer().oneOf([1, 2, 3]).notNull(),
        // Flags
        generated: col.integer().generatedAlwaysAs(sql`1`),
        locked: col.text().notNull().readOnly(),
        secret: col.text().private(),
        stampedAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        stampedBy: col.uuid().notNull().onCreateUser(),
        identity: col.integer().notNull().generatedByDefaultAsIdentity(),
        random: col.uuid().notNull().defaultRandom(),
        sql: col.text().notNull().default(sql`x()`),
        external: col.text().notNull().dbDefault(),
        required: col.text().notNull()
    },
    relations: {
        owner: rel.belongsTo(() => users),
        writer: rel.belongsTo(() => users, { localKey: "writer_ref" }),
        // Bound: the column is declared, so the row has no second key for it.
        org: rel.belongsTo(() => users, { localKey: "required" })
    },
    rls: "admin-only"
});

type Row = InferRow<typeof kinds>;
type Insert = InferInsert<typeof kinds>;
type Update = InferUpdate<typeof kinds>;

function rowTypes(): void {
    assertType<Equal<Row["id"], string>>();
    assertType<Equal<Row["text"], string | null>>();
    assertType<Equal<Row["varchar"], string>>();
    assertType<Equal<Row["char"], string | null>>();
    assertType<Equal<Row["status"], "a" | "b" | null>>();
    assertType<Equal<Row["small"], number | null>>();
    assertType<Equal<Row["int"], number>>();
    assertType<Equal<Row["big"], number | null>>();
    assertType<Equal<Row["smallSerial"], number | null>>();
    assertType<Equal<Row["serial"], number | null>>();
    assertType<Equal<Row["bigSerial"], number | null>>();
    assertType<Equal<Row["real"], number | null>>();
    assertType<Equal<Row["double"], number | null>>();
    assertType<Equal<Row["numeric"], number | null>>();
    assertType<Equal<Row["flag"], boolean>>();
    assertType<Equal<Row["at"], string | null>>();
    assertType<Equal<Row["day"], string>>();
    assertType<Equal<Row["clock"], string | null>>();
    assertType<Equal<Row["doc"], { a: number }>>();
    assertType<Equal<Row["loose"], unknown>>();
    assertType<Equal<Row["shaped"], {
        title: string;
        kind: "x" | "y";
        tags?: string[];
        where?: JsonGeoPoint;
        blocks?: ({ type: "text"; value: string } | { type: "count"; value: number })[];
        extra?: unknown;
    } | null>>();
    assertType<Equal<Row["list"], number[]>>();
    assertType<Equal<Row["roles"], ("admin" | "editor")[] | null>>();
    assertType<Equal<Row["embedding"], number[] | null>>();
    assertType<Equal<Row["bytes"], string | null>>();
    assertType<Equal<Row["point"], JsonGeoPoint | null>>();
    assertType<Equal<Row["file"], string | null>>();
    assertType<Equal<Row["files"], string[] | null>>();
    assertType<Equal<Row["priority"], 1 | 2 | 3>>();
    assertType<Equal<Row["generated"], number | null>>();
    assertType<Equal<Row["locked"], string>>();
    assertType<Equal<Row["stampedAt"], string>>();
    assertType<Equal<Row["stampedBy"], string>>();
    // A private column is never on a row.
    assertType<Equal<"secret" extends keyof Row ? true : false, false>>();
    // Derived foreign keys: `<relation>Id`, or the camelCase of `localKey`; a bound one is the column itself.
    assertType<Equal<Row["ownerId"], string | number | null | undefined>>();
    assertType<Equal<Row["writerRef"], string | number | null | undefined>>();
    assertType<Equal<"orgId" extends keyof Row ? true : false, false>>();
    assertType<Equal<Row["required"], string>>();
}

function insertTypes(): void {
    // Required: NOT NULL with no default, writable.
    type RequiredKeys = { [K in keyof Insert]-?: undefined extends Insert[K] ? never : K }[keyof Insert];
    assertType<Equal<RequiredKeys, "id" | "varchar" | "int" | "day" | "doc" | "list" | "priority" | "required">>();
    // Not accepted at all: generated, read-only, private.
    assertType<Equal<"generated" extends keyof Insert ? true : false, false>>();
    assertType<Equal<"locked" extends keyof Insert ? true : false, false>>();
    assertType<Equal<"secret" extends keyof Insert ? true : false, false>>();
    // Optional because something else fills them.
    for (const key of ["flag", "serial", "smallSerial", "bigSerial", "stampedAt", "stampedBy", "identity", "random", "sql", "external"] as const) {
        const optional: undefined extends Insert[typeof key] ? true : false = true;
        void optional;
    }
    // A temporal column accepts a Date too; a nullable one accepts null.
    assertType<Equal<Insert["day"], string | Date>>();
    assertType<Equal<Insert["at"], string | Date | null | undefined>>();
    const ok: Insert = { id: "x", varchar: "v", int: 1, day: new Date(), doc: { a: 1 }, list: [1], priority: 2, required: "r" };
    // @ts-expect-error `required` is NOT NULL without a default
    const missing: Insert = { id: "x", varchar: "v", int: 1, day: "2024-01-01", doc: { a: 1 }, list: [1], priority: 2 };
    // @ts-expect-error a generated column is not writable
    const generated: Insert = { ...ok, generated: 1 };
    // @ts-expect-error a read-only column is not writable
    const locked: Insert = { ...ok, locked: "x" };
    // @ts-expect-error a private column is not on the wire
    const secret: Insert = { ...ok, secret: "x" };
    // @ts-expect-error `priority` is one of 1, 2, 3
    const priority: Insert = { ...ok, priority: 4 };
    void ok; void missing; void generated; void locked; void secret; void priority;
}

function updateTypes(): void {
    type RequiredKeys = { [K in keyof Update]-?: undefined extends Update[K] ? never : K }[keyof Update];
    assertType<Equal<RequiredKeys, never>>();
    assertType<Equal<"id" extends keyof Update ? true : false, false>>();
    assertType<Equal<"locked" extends keyof Update ? true : false, false>>();
    assertType<Equal<Update["text"], string | null | undefined>>();
    const ok: Update = { text: null, int: 2 };
    // @ts-expect-error the primary key is not updatable
    const key: Update = { id: "y" };
    // @ts-expect-error a NOT NULL column does not take null
    const nulled: Update = { int: null };
    void ok; void key; void nulled;
}

function keyTypes(): void {
    assertType<Equal<RelationKeyOf<typeof kinds>, "owner" | "writer" | "org">>();
    assertType<Equal<ColumnKeyOf<typeof posts>, "id" | "title" | "slug" | "status" | "heroImage" | "embedding" | "metadata" | "publishDate" | "orgId" | "createdAt" | "updatedAt" | "deletedAt" | "__order">>();
    // The spec example's rows.
    assertType<Equal<InferRow<typeof posts>["status"], "draft" | "needs_review" | "published" | "archived">>();
    assertType<Equal<InferRow<typeof posts>["authorId"], string | number | null | undefined>>();
    assertType<Equal<InferInsert<typeof posts>["status"], "draft" | "needs_review" | "published" | "archived" | undefined>>();
}

// ── The slug is part of the type ─────────────────────────────────────────────

const blogPosts = defineTable("blog_posts", {
    slug: "posts",
    columns: { id: col.uuid().primaryKey() },
    rls: "admin-only"
});
const people = defineAuthTable("app_users", { slug: "people", columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
const totals = defineView("order_totals", { slug: "totals", query: "select 1 as id", columns: { id: col.integer().primaryKey() } });
const plainView = defineView("plain_view", { query: "select 1 as id", columns: { id: col.integer().primaryKey() } });

function slugTypes(): void {
    // A slug that differs from the name is read from the type…
    assertType<Equal<TableSlugOf<typeof blogPosts>, "posts">>();
    assertType<Equal<typeof blogPosts["name"], "blog_posts">>();
    assertType<Equal<TableSlugOf<typeof people>, "people">>();
    assertType<Equal<TableSlugOf<typeof totals>, "totals">>();
    // …and without one, the slug is the name.
    assertType<Equal<TableSlugOf<typeof tags>, "tags">>();
    assertType<Equal<TableSlugOf<typeof users>, "users">>();
    assertType<Equal<TableSlugOf<typeof plainView>, "plain_view">>();
    assertType<Equal<TableSlugOf<typeof posts>, "posts">>();
    // Structurally: a `{ name, config }` without a slug, and a table typed loosely.
    assertType<Equal<TableSlugOf<{ name: "x"; config: { columns: Record<never, never> } }>, "x">>();
    assertType<Equal<TableSlugOf<TableDef>, string>>();
    // A table with a literal slug is still any table.
    const loose: AnyTableDef = blogPosts;
    void loose;
}

// ── Views ────────────────────────────────────────────────────────────────────

const published = defineView("published_posts", {
    query: "select id, title from posts where status = 'published'",
    columns: { id: col.uuid().primaryKey(), title: col.text().notNull() },
    hooks: { afterRead: ({ values }) => values }
});

function viewTypes(): void {
    assertType<Equal<InferRow<typeof published>, { id: string; title: string }>>();
    // @ts-expect-error a view has read hooks only
    defineView("v", { query: "q", columns: { id: col.uuid().primaryKey() }, hooks: { beforeSave: ({ values }) => values } });
    // @ts-expect-error a view takes no rls: the tables it reads decide
    defineView("v", { query: "q", columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
    // @ts-expect-error a view's indexes name its own columns
    defineView("v", { query: "q", materialized: true, columns: { id: col.uuid().primaryKey() }, indexes: [{ columns: ["nope"] }] });
}

// ── Refusals the type system makes ───────────────────────────────────────────

function refusedTables(): void {
    // @ts-expect-error `rls` is required
    defineTable("no_rls", { columns: { id: col.uuid().primaryKey() } });
    // @ts-expect-error `rls` is required on the auth table too
    defineAuthTable("users", { columns: { id: col.uuid().primaryKey() } });
    // @ts-expect-error an empty rule list is not a posture
    defineTable("empty", { columns: { id: col.uuid().primaryKey() }, rls: [] });
    // @ts-expect-error not a posture
    defineTable("open", { columns: { id: col.uuid().primaryKey() }, rls: "public" });
    // @ts-expect-error `defaultPolicies` only switches the baseline off
    defineTable("t", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only", defaultPolicies: true });
    // @ts-expect-error `strictWrites` only switches strict writes off
    defineTable("t", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only", strictWrites: true });
    // @ts-expect-error a column must be a builder
    defineTable("t", { columns: { id: "uuid" }, rls: "admin-only" });
}

function keyTypedOptions(): void {
    const columns = { id: col.uuid().primaryKey(), orgId: col.uuid(), deletedAt: col.timestamp({ withTimezone: true }) };
    defineTable("ok", {
        columns,
        relations: { author: rel.belongsTo(() => users) },
        rls: "admin-only",
        tenant: { field: "orgId", from: { claim: "org_id" } },
        softDelete: { field: "deletedAt" },
        // A relation name stands for its foreign-key column.
        indexes: [{ columns: ["orgId", "author", { column: "deletedAt", direction: "desc", nulls: "last" }], include: ["id"], where: { column: "deletedAt", op: "is null" } }]
    });
    // @ts-expect-error tenant.field names a column key
    defineTable("t", { columns, rls: "admin-only", tenant: { field: "org_id", from: { claim: "org_id" } } });
    // @ts-expect-error softDelete.field names a column key
    defineTable("t", { columns, rls: "admin-only", softDelete: { field: "deleted_at" } });
    // @ts-expect-error indexes[].columns name column keys or relations
    defineTable("t", { columns, rls: "admin-only", indexes: [{ columns: ["nope"] }] });
    // @ts-expect-error an index lists at least one column
    defineTable("t", { columns, rls: "admin-only", indexes: [{ columns: [] }] });
}

function kindRestrictedModifiers(): void {
    // @ts-expect-error defaultRandom is a uuid modifier
    col.text().defaultRandom();
    // @ts-expect-error identity is an integer modifier
    col.numeric().generatedByDefaultAsIdentity();
    // @ts-expect-error identity is not for a serial, which has its own sequence
    col.serial().generatedByDefaultAsIdentity();
    // @ts-expect-error identity is not for text
    col.text().generatedByDefaultAsIdentity();
    // @ts-expect-error onCreateNow is a temporal modifier
    col.text().onCreateNow();
    // @ts-expect-error onUpdateNow is a temporal modifier
    col.boolean().onUpdateNow();
    // @ts-expect-error onCreateUser stores an id: text or uuid
    col.integer().onCreateUser();
    // @ts-expect-error onUpdateUser stores an id: text or uuid
    col.timestamp({ withTimezone: true }).onUpdateUser();
    // @ts-expect-error userId holds an id: text or uuid
    col.integer().userId();
    // @ts-expect-error userId holds an id, not a document
    col.jsonb().userId();
    // @ts-expect-error userId holds an id, not a file path
    col.storage({ path: "avatars/" }).userId();
    col.varchar({ length: 36 }).notNull().userId();
    col.uuid().userId().onCreateUser();
    // @ts-expect-error a JSON number field holds no user id
    json.number().userId();
    json.string().required().userId();
    // @ts-expect-error multiple is a storage modifier
    col.text().multiple();
    // @ts-expect-error oneOf takes text or numbers
    col.boolean().oneOf([true]);
    // @ts-expect-error oneOf values are of the column's type
    col.integer().oneOf(["a"]);
    // @ts-expect-error a number column has no string rules
    col.integer().validate({ email: true });
    // @ts-expect-error a text column has no numeric rules
    col.text().validate({ positive: true });
    // @ts-expect-error an array takes item-count rules
    col.text().array().validate({ email: true });
    // @ts-expect-error a default is of the column's type
    col.integer().default("1");
    // @ts-expect-error an enum default is one of its values
    col.enum(["a", "b"]).default("c");
    // @ts-expect-error an enum lists at least one value
    col.enum([]);
    // @ts-expect-error a JSON string field stamps the user, not the time
    json.string().onCreateNow();
    // @ts-expect-error a JSON date field stamps the time, not the user
    json.date().onCreateUser();
    // @ts-expect-error a JSON number field holds no user id
    json.number().onUpdateUser();
    json.string().required().onCreateUser();
    json.string().onUpdateUser().describe("last editor");
    // @ts-expect-error a JSON boolean has no oneOf
    json.boolean().oneOf([true]);
    // @ts-expect-error a JSON default is of the field's type
    json.number().default("1");
    // A temporal default may be a Date.
    col.timestamp({ withTimezone: true }).default(new Date());
    col.text().validate({ matches: /x/, matchesMessage: "m", requiredMessage: "r" });
}

function relationOptions(): void {
    // @ts-expect-error a relation's target is a thunk
    rel.belongsTo(users);
    // @ts-expect-error a via needs its steps
    rel.via(() => users);
    // Every kind takes field-level access, or `private`.
    rel.belongsTo(() => users, { access: { read: ["admin"], write: [] } });
    rel.hasOne(() => users, { private: true });
    rel.hasMany(() => users, { access: { write: ["admin"] } });
    rel.manyToMany(() => users, { private: true });
    rel.via(() => users, { steps: [{ table: "users", on: { from: "id", to: "id" } }], access: { read: ["admin"] } });
    // @ts-expect-error roles are strings
    rel.hasMany(() => users, { access: { read: [1] } });
    // The literal is kept on a belongsTo, like its other options.
    assertType<Equal<ReturnType<typeof rel.belongsTo<{ private: true }>>["private"], true>>();
    // What a thunk returns is not typed (a `TableThunk` is `() => void`, so
    // two-way links need no annotation); `compileTables` refuses a thunk that
    // does not return a table or view. Neither side of this link annotates.
    const a = defineTable("a", {
        columns: { id: col.uuid().primaryKey() },
        relations: { bs: rel.hasMany(() => b) },
        rls: "admin-only"
    });
    const b = defineTable("b", {
        columns: { id: col.uuid().primaryKey(), aId: col.uuid() },
        relations: { a: rel.belongsTo(() => a) },
        rls: "admin-only"
    });
    void b;
}

// ── Hooks are typed from the columns ─────────────────────────────────────────

function transformTypes(): void {
    // A nullable column hands its transform `null`.
    col.text().transform({
        beforeSave: ({ value }) => {
            assertType<Equal<typeof value, string | null>>();
            return value === null ? null : value.trim();
        },
        afterRead: ({ value }) => value
    });
    // `.notNull()` (or `.primaryKey()`) first: the value is never null…
    col.text().notNull().transform({
        beforeSave: ({ value }) => {
            assertType<Equal<typeof value, string>>();
            return value.trim();
        }
    });
    col.uuid().primaryKey().transform({ afterRead: ({ value }) => { assertType<Equal<typeof value, string>>(); return value; } });
    // …`.notNull()` after `.transform()` came too late for the hook's type: it keeps `null`.
    col.integer().transform({ afterRead: ({ value }) => { assertType<Equal<typeof value, number | null>>(); return value; } }).notNull();
    // @ts-expect-error a nullable column's hook cannot assume a value
    col.text().transform({ beforeSave: ({ value }) => value.trim() });
    // A JSON field that is not `.required()` can be absent.
    json.string().transform({ beforeSave: ({ value }) => { assertType<Equal<typeof value, string | undefined>>(); return value; } });
    json.string().required().transform({ beforeSave: ({ value }) => { assertType<Equal<typeof value, string>>(); return value.trim(); } });
    json.number().transform({ afterRead: ({ value }) => { assertType<Equal<typeof value, number | undefined>>(); return value; } }).required();
    // @ts-expect-error an optional JSON field's hook cannot assume a value
    json.string().transform({ beforeSave: ({ value }) => value.trim() });
}

function hookTypes(): void {
    defineTable("hooked", {
        columns: { id: col.uuid().primaryKey(), title: col.text().notNull(), secret: col.text().private(), count: col.integer() },
        rls: "admin-only",
        hooks: {
            beforeSave: ({ values }) => {
                assertType<Equal<typeof values.title, string | undefined>>();
                assertType<Equal<typeof values.count, number | null | undefined>>();
                // @ts-expect-error `title` is text
                values.title = 3;
                // @ts-expect-error a private column is not among the values a write carries
                values.secret = "x";
                return values;
            },
            afterRead: ({ values }) => {
                assertType<Equal<typeof values.title, string>>();
                // @ts-expect-error a private column is not on the served row
                void values.secret;
                return values;
            },
            beforeDelete: ({ values }) => {
                assertType<Equal<typeof values.count, number | null>>();
                return true;
            },
            // @ts-expect-error not a hook
            beforeEverything: () => undefined
        }
    });
}

void [slugTypes, transformTypes, rowTypes, insertTypes, updateTypes, keyTypes, viewTypes, refusedTables, keyTypedOptions, kindRestrictedModifiers, relationOptions, hookTypes];

test("the typed examples build", () => {
    expect(posts.name).toBe("posts");
    expect(posts.config.columns.__order.def.type).toEqual({ kind: "text" });
    expect(kinds.config.relations?.org.localKey).toBe("required");
    expect(published.config.columns.title.def.notNull).toBe(true);
});
