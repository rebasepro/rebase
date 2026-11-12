import { col, defineTable, defineView, rel } from "../../src/schema";
import type { DatabaseOf, TableAccessorOf } from "../../src/schema";
import type * as specSchema from "./fixtures/spec-posts.schema";
import type { Database as GeneratedSpecDatabase } from "./fixtures/spec-posts.database";

/**
 * `DatabaseOf<typeof import("./schema")>`: the generated `Database`'s shape,
 * typed straight from a schema module with no codegen run.
 *
 * Checked by `tsc` (this directory is in `tsconfig.tests.json`; `pnpm
 * check:ts-expect-error-coverage` holds it there): an `Equal<…>` or a
 * `Mutual<…>` that stops holding, or a `@ts-expect-error` whose line starts
 * compiling, fails the typecheck. Nothing here runs but the one test below.
 */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Each assignable to the other. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** `A` assignable to `B`. */
type Assignable<A, B> = [A] extends [B] ? true : false;
/** Compiles only when its argument is `true`. */
function assertType<T extends true>(_proof?: T): void {
    void _proof;
}

// ── The spec's §4.1 schema, against what `rebase generate-sdk` writes for it ──

type Spec = DatabaseOf<typeof specSchema>;
type Generated = GeneratedSpecDatabase;

/**
 * The keys of a `posts` block the type system knows exactly: every declared
 * column but `metadata` — a `col.jsonb<T>()` document, whose `T` the
 * descriptor (so the generated file) does not carry: it is typed there as an
 * open record — and none of the relation side.
 */
type ExactPostKeys = Exclude<keyof Generated["posts"]["Update"] & keyof Spec["posts"]["Update"], "metadata" | "authorId" | "author" | "tags"> | "id";
type Known<Block, Keys extends PropertyKey> = Pick<Block, Extract<keyof Block, Keys>>;
/** The relation side: the derived `authorId`, the `author` link and the `tags` membership. */
type RelationKeys = "authorId" | "author" | "tags";

export function specAgreement(): void {
    // One entry per table, under the same accessors, with the same slugs.
    assertType<Equal<keyof Spec, keyof Generated>>();
    assertType<Equal<Spec["posts"]["Slug"], Generated["posts"]["Slug"]>>();
    assertType<Equal<Spec["users"]["Slug"], "users">>();

    // Row, Insert and Update agree both ways on every column the type knows.
    assertType<Mutual<Known<Spec["posts"]["Row"], ExactPostKeys>, Known<Generated["posts"]["Row"], ExactPostKeys>>>();
    assertType<Mutual<Known<Spec["posts"]["Insert"], ExactPostKeys>, Known<Generated["posts"]["Insert"], ExactPostKeys>>>();
    assertType<Mutual<Known<Spec["posts"]["Update"], ExactPostKeys>, Known<Generated["posts"]["Update"], ExactPostKeys>>>();
    // …and on the whole of the tables without relations or documents.
    assertType<Mutual<Spec["tags"]["Row"], Generated["tags"]["Row"]>>();
    assertType<Mutual<Spec["tags"]["Insert"], Generated["tags"]["Insert"]>>();
    assertType<Mutual<Spec["tags"]["Update"], Generated["tags"]["Update"]>>();
    assertType<Mutual<Spec["users"]["Row"], Generated["users"]["Row"]>>();
    assertType<Mutual<Spec["users"]["Insert"], Generated["users"]["Insert"]>>();
    assertType<Mutual<Spec["users"]["Update"], Generated["users"]["Update"]>>();

    // The relation side is looser — a target's key and row are behind an
    // untyped thunk — so everything the generated file accepts, `DatabaseOf`
    // accepts: the generated types are a refinement of it.
    assertType<Assignable<Known<Generated["posts"]["Row"], RelationKeys>, Known<Spec["posts"]["Row"], RelationKeys>>>();
    assertType<Assignable<Generated["posts"]["Insert"], Omit<Spec["posts"]["Insert"], "metadata">>>();
    assertType<Assignable<Omit<Generated["posts"]["Update"], "metadata">, Omit<Spec["posts"]["Update"], "metadata">>>();
    // The same relation names, a required link non-null on Row.
    assertType<Equal<keyof Spec["posts"]["Relations"], keyof Generated["posts"]["Relations"]>>();
    assertType<Equal<Spec["posts"]["Row"]["authorId"], string | number>>();
    // `metadata` is the one column the static type knows better than the descriptor.
    assertType<Equal<Spec["posts"]["Row"]["metadata"], { seoTitle?: string; canonicalUrl?: string } | null | undefined>>();
}

export function specRequiredLink(insert: (row: Spec["posts"]["Insert"]) => void): void {
    const base = { title: "t", slug: "s", orgId: "o" };
    insert({ ...base, authorId: "u" });
    insert({ ...base, author: "u" });
    // @ts-expect-error — a NOT NULL derived link must be named, by either name
    insert({ ...base });
    // @ts-expect-error — `title` is NOT NULL with no default
    insert({ slug: "s", orgId: "o", author: "u" });
    insert({ ...base, author: "u", tags: ["t1", { id: "t2", _pivot: { sortOrder: 1 } }] });
    // @ts-expect-error — `sortOrder` is an integer
    insert({ ...base, author: "u", tags: [{ id: "t2", _pivot: { sortOrder: "1" } }] });
}

// ── What it reads of a module, and of each table ──────────────────────────────

const authors = defineTable("authors", {
    columns: {
        id: col.integer().primaryKey().identity(),
        name: col.text().notNull(),
        secret: col.text().private(),
        computed: col.text().readOnly()
    },
    relations: {
        posts: rel.hasMany(() => blogPosts, { foreignKey: "author_id" }),
        profile: rel.hasOne(() => blogPosts)
    },
    rls: "admin-only"
});

const blogPosts = defineTable("blog_posts", {
    slug: "my-posts",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        // A declared key column, under the key the link derives.
        editorId: col.integer().private()
    },
    relations: {
        author: rel.belongsTo(() => authors),
        editor: rel.belongsTo(() => authors),
        loose: rel.belongsTo(() => authors, { constraint: false, index: false })
    },
    rls: "admin-only"
});

const titles = defineView("post_titles", {
    query: "select id from blog_posts",
    columns: { id: col.uuid().primaryKey() }
});

const collectionTable = defineTable("collection", {
    table: "collection_table",
    columns: { id: col.uuid().primaryKey() },
    rls: "admin-only"
});

/** A schema module: tables, a view, and exports that are none of them. */
declare const moduleNamespace: {
    authors: typeof authors;
    blogPosts: typeof blogPosts;
    titles: typeof titles;
    collectionTable: typeof collectionTable;
    defaultRls: "admin-only";
    helper: () => string;
};
type Db = DatabaseOf<typeof moduleNamespace>;

export function moduleShape(): void {
    // Keyed by the accessor of each slug; non-table exports ignored; a
    // reserved accessor renamed as codegen renames it.
    assertType<Equal<keyof Db, "authors" | "myPosts" | "postTitles" | "collectionCollection">>();
    assertType<Equal<Db["myPosts"]["Slug"], "my-posts">>();
    assertType<Equal<TableAccessorOf<"order_items">, "orderItems">>();
    assertType<Equal<TableAccessorOf<"my-notes">, "myNotes">>();
    assertType<Equal<TableAccessorOf<"PRIVATE_NOTES">, "privateNotes">>();
    assertType<Equal<TableAccessorOf<"then">, "thenCollection">>();

    // A view is read, never written.
    assertType<Equal<Db["postTitles"]["Insert"], never>>();
    assertType<Equal<Db["postTitles"]["Update"], never>>();
    assertType<Equal<Db["postTitles"]["Row"], { id: string }>>();

    // Private off every block; read-only off the writes.
    assertType<Equal<"secret" extends keyof Db["authors"]["Row"] ? true : false, false>>();
    assertType<Equal<"computed" extends keyof Db["authors"]["Row"] ? true : false, true>>();
    assertType<Equal<"computed" extends keyof Db["authors"]["Insert"] ? true : false, false>>();
    assertType<Equal<"id" extends keyof Db["authors"]["Update"] ? true : false, false>>();

    // Relations by name and cardinality; the included row is an open record.
    assertType<Equal<Db["authors"]["Row"]["posts"], Record<string, unknown>[] | undefined>>();
    assertType<Equal<Db["authors"]["Row"]["profile"], Record<string, unknown> | undefined>>();
    assertType<Equal<keyof Db["authors"]["Relations"], "posts" | "profile">>();

    // A derived link: its key nullable and optional; written by either name.
    assertType<Equal<Db["myPosts"]["Row"]["authorId"], string | number | null | undefined>>();
    assertType<Equal<"author" extends keyof Db["myPosts"]["Insert"] ? true : false, true>>();
    // A link whose key column is private goes with it: not includable, not written by name.
    assertType<Equal<"editor" extends keyof Db["myPosts"]["Relations"] ? true : false, false>>();
    assertType<Equal<"editor" extends keyof Db["myPosts"]["Insert"] ? true : false, false>>();
    // An unconstrained link is written by its key alone.
    assertType<Equal<"loose" extends keyof Db["myPosts"]["Insert"] ? true : false, false>>();
    assertType<Equal<"looseId" extends keyof Db["myPosts"]["Insert"] ? true : false, true>>();
}

describe("DatabaseOf", () => {
    it("is checked by the type checker; the schema it reads builds", () => {
        expect([authors.name, blogPosts.name, titles.name, collectionTable.name]).toEqual(["authors", "blog_posts", "post_titles", "collection"]);
    });
});
