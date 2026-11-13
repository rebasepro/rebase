/**
 * The admin panel's view model of a row, built in the browser from the wire row
 * and the table descriptor — pinned, as the second half of the "one read
 * shape" oracle.
 *
 * The wire rows below are exactly the ones `server-postgres`'s
 * `test/wire-read-values.test.ts` pins (a REST body or a socket frame, after
 * `JSON.parse`): the panel's every read is one of them, and this is what it
 * renders from each — a date as a `Date`, a belongsTo foreign key as an
 * addressable `EntityRelation`, an included target as an `EntityRelation`
 * carrying the target's own view model, everything else as the wire has it.
 *
 * The collections are projected from the compiled descriptors
 * (`collectionsFromTables`), as `CollectionsProvider` projects the served ones.
 */
import { describe, expect, it } from "@jest/globals";
import { col, defineTable, EntityRelation, json, rel } from "@rebasepro/types";
import { compileSchema, rowToViewModel } from "@rebasepro/common";
import { collectionsFromTables } from "../../src/tables";

const samples = defineTable("samples", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        day: col.date(),
        at: col.timestamp({ withTimezone: true }),
        clock: col.time(),
        price: col.numeric({ precision: 10, scale: 2 }),
        big: col.bigint({ mode: "number" }),
        count: col.integer(),
        doc: col.jsonb(json.object({ when: json.date(), n: json.number(), label: json.string() })),
        plain: col.json(),
        tags: col.text().array(),
        blob: col.bytea(),
        place: col.geopoint(),
        mood: col.enum(["happy", "sad"]),
        note: col.text()
    },
    rls: "admin-only"
});
const tags = defineTable("tags", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), label: col.text() },
    rls: "admin-only"
});
const authors = defineTable("authors", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), name: col.text(), joinedAt: col.timestamp({ withTimezone: true }) },
    relations: {
        posts: rel.hasMany(() => posts),
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" })
    },
    rls: "admin-only"
});
const posts = defineTable("posts", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), title: col.text(), publishedAt: col.timestamp({ withTimezone: true }) },
    relations: {
        author: rel.belongsTo(() => authors),
        tags: rel.manyToMany(() => tags, { through: "post_tags", sourceKey: "post_id", targetKey: "tag_id" })
    },
    rls: "admin-only"
});
const profiles = defineTable("profiles", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), bio: col.text(), authorId: col.integer() },
    rls: "admin-only"
});

const collections = collectionsFromTables(compileSchema([samples, tags, authors, posts, profiles]).map(table => table.descriptor));
const resolve = (slug: string) => collections.find(collection => collection.slug === slug);
const viewModel = (row: Record<string, unknown>, slug: string) => rowToViewModel(row, slug, resolve);

/** `wire-read-values.test.ts` SAMPLE_WIRE. */
const SAMPLE_WIRE = {
    id: 1,
    day: "2026-03-04",
    at: "2026-08-23T23:37:57.647Z",
    clock: "09:30:00",
    price: 9.99,
    big: 9007199254740991,
    count: 42,
    doc: { when: "2026-01-02T03:04:05.000Z", n: "7", label: "x", extra: true },
    plain: { a: [1, 2] },
    tags: ["red", "green"],
    blob: { type: "Buffer", data: [0, 255, 16] },
    place: { latitude: 41.4, longitude: 2.17 },
    mood: "happy",
    note: "hello"
};

describe("the view model of a wire row", () => {
    it("every value family", () => {
        expect(viewModel(SAMPLE_WIRE, "samples")).toEqual({
            ...SAMPLE_WIRE,
            day: new Date("2026-03-04"),
            at: new Date("2026-08-23T23:37:57.647Z"),
            // A time of day is not a date the panel can parse.
            clock: null,
            doc: { when: new Date("2026-01-02T03:04:05.000Z"), n: "7", label: "x", extra: true }
        });
    });

    it("an all-null row stays as it is", () => {
        const empty = { id: 2, day: null, at: null, note: null };
        expect(viewModel(empty, "samples")).toBe(empty);
    });

    it("a belongsTo foreign key becomes an addressable relation", () => {
        const values = viewModel({ id: 1, title: "first", publishedAt: "2026-05-06T07:08:09.000Z", authorId: 1 }, "posts");
        expect(values).toEqual({
            id: 1, title: "first", publishedAt: new Date("2026-05-06T07:08:09.000Z"), authorId: 1,
            author: new EntityRelation(1, "authors")
        });
    });

    // An included target is addressed by its key as text (`buildCompositeId`);
    // a foreign key alone keeps the type it arrived with.
    it("an included belongsTo carries the target's own view model", () => {
        const values = viewModel({
            id: 1, title: "first", publishedAt: null, authorId: 1,
            author: { id: 1, name: "Ada", joinedAt: "2020-01-02T03:04:05.000Z" }
        }, "posts");
        expect(values.author).toEqual(new EntityRelation("1", "authors", {
            id: "1", path: "authors", values: { id: 1, name: "Ada", joinedAt: new Date("2020-01-02T03:04:05.000Z") }
        }));
    });

    it("included to-many and to-one relations: one relation per target row", () => {
        const values = viewModel({
            id: 1, name: "Ada", joinedAt: null,
            posts: [{ id: 2, title: "second", publishedAt: null, authorId: 1 }],
            profile: { id: 1, bio: "Ada writes", authorId: 1 }
        }, "authors");
        expect(values.posts).toEqual([new EntityRelation("2", "posts", {
            id: "2", path: "posts",
            values: { id: 2, title: "second", publishedAt: null, authorId: 1, author: new EntityRelation(1, "authors") }
        })]);
        expect(values.profile).toEqual(new EntityRelation("1", "profiles", {
            id: "1", path: "profiles", values: { id: 1, bio: "Ada writes", authorId: 1 }
        }));
    });

    it("an included manyToMany: one relation per tag", () => {
        const values = viewModel({ id: 1, title: "first", publishedAt: null, authorId: 1, tags: [{ id: 1, label: "red" }] }, "posts");
        expect(values.tags).toEqual([new EntityRelation("1", "tags", { id: "1", path: "tags", values: { id: 1, label: "red" } })]);
    });
});
