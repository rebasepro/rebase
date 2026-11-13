import { describe, it, expect, jest } from "@jest/globals";
import { compileTables } from "@rebasepro/common";
import { col, defineAuthTable, defineTable, defineView, json, rel, sql } from "@rebasepro/types";
import { toPascalCase, toCamelCase, toSafeIdentifier, toTableAccessor, indent } from "../src/utils";
import { generateTypedefs } from "../src/generate-types";
import { generateSDK } from "../src/index";
import { block, compiledOnly, generate, keysOf, rawTable } from "./helpers/tables";

// ─── Test Fixtures ─────────────────────────────────────────────────

const authors = defineTable("authors", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text().notNull(),
        email: col.text()
    },
    rls: "admin-only"
});
describe("Utils", () => {
    describe("toPascalCase", () => {
        it("converts snake_case to PascalCase", () => {
            expect(toPascalCase("private_notes")).toBe("PrivateNotes");
        });
        it("leaves already PascalCase input alone", () => {
            expect(toPascalCase("TestEntities")).toBe("TestEntities");
            expect(toPascalCase("GitRepoUrl")).toBe("GitRepoUrl");
        });
        it("keeps capitals inside a chunk when joining chunks", () => {
            expect(toPascalCase("private_testEntities")).toBe("PrivateTestEntities");
        });
        it("folds SHOUTING_CASE down to one capital per word", () => {
            expect(toPascalCase("PRIVATE_NOTES")).toBe("PrivateNotes");
        });
        it("handles kebab-case", () => {
            expect(toPascalCase("private-notes")).toBe("PrivateNotes");
        });
        it("handles space separated strings", () => {
            expect(toPascalCase("private notes")).toBe("PrivateNotes");
        });
        it("handles multiple delimiters and empty chunks", () => {
            expect(toPascalCase("private--notes__here")).toBe("PrivateNotesHere");
        });
    });

    describe("toCamelCase", () => {
        it("converts snake_case to camelCase", () => {
            expect(toCamelCase("private_notes")).toBe("privateNotes");
        });
        it("converts kebab-case to camelCase", () => {
            expect(toCamelCase("private-notes")).toBe("privateNotes");
        });
        it("preserves already camelCase and PascalCase when no separators are present", () => {
            expect(toCamelCase("customDomain")).toBe("customDomain");
            expect(toCamelCase("GitRepoUrl")).toBe("gitRepoUrl");
        });
    });

    describe("toSafeIdentifier", () => {
        it("converts slugs to camelCase", () => {
            expect(toSafeIdentifier("private-notes")).toBe("privateNotes");
        });
        it("strips invalid JS identifier characters and camel cases", () => {
            expect(toSafeIdentifier("my-special-slug!")).toBe("mySpecialSlug");
            expect(toSafeIdentifier("some@name#here")).toBe("someNameHere");
        });
    });

    describe("toTableAccessor", () => {
        it("is the safe identifier for an ordinary slug", () => {
            expect(toTableAccessor("my-notes")).toBe("myNotes");
            // `collection` is an ordinary name now that the dynamic accessor is `table`.
            expect(toTableAccessor("collection")).toBe("collection");
        });
        it("renames an accessor the client proxy reserves", () => {
            expect(toTableAccessor("table")).toBe("tableTable");
            expect(toTableAccessor("then")).toBe("thenTable");
            expect(toTableAccessor("toJSON")).toBe("toJSONTable");
        });
    });
    describe("indent", () => {
        it("indents multi-line string by given space count", () => {
            const block = "line1\nline2\nline3";
            const expected = "  line1\n  line2\n  line3";
            expect(indent(block, 2)).toBe(expected);
        });
        it("does not indent empty/whitespace lines", () => {
            const block = "line1\n\n  \nline2";
            const expected = "  line1\n\n  \n  line2";
            expect(indent(block, 2)).toBe(expected);
        });
    });
});

describe("column types", () => {
    it("maps every Postgres type to its wire type", () => {
        const ts = generate(defineTable("types_table", {
            columns: {
                id: col.uuid().primaryKey().defaultRandom(),
                bool: col.boolean(),
                ts: col.timestamp({ withTimezone: true }),
                day: col.date(),
                clock: col.time(),
                geo: col.geopoint(),
                vec: col.vector({ dimensions: 3 }),
                bin: col.bytea(),
                count: col.integer(),
                big: col.bigint({ mode: "number" }),
                money: col.numeric({ precision: 10, scale: 2 }),
                ratio: col.doublePrecision(),
                name: col.varchar({ length: 80 }),
                code: col.char({ length: 2 }),
                file: col.storage({ path: "files/" }),
                doc: col.jsonb()
            },
            rls: "admin-only"
        }));
        const row = block(ts, "Row", "typesTable");
        expect(row).toContain("id: string;");
        expect(row).toContain("bool?: boolean | null;");
        expect(row).toContain("ts?: string | null;");
        expect(row).toContain("day?: string | null;");
        expect(row).toContain("clock?: string | null;");
        expect(row).toContain("geo?: { latitude: number; longitude: number; } | null;");
        expect(row).toContain("vec?: number[] | null;");
        expect(row).toContain("bin?: string | null;");
        expect(row).toContain("count?: number | null;");
        expect(row).toContain("big?: number | null;");
        expect(row).toContain("money?: number | null;");
        expect(row).toContain("ratio?: number | null;");
        expect(row).toContain("name?: string | null;");
        expect(row).toContain("code?: string | null;");
        expect(row).toContain("file?: string | null;");
        expect(row).toContain("doc?: Record<string, unknown> | null;");
    });

    it("types a column of a type Rebase serves but does not create as unknown", () => {
        // What introspection reports for `inet`, `citext`, `interval`, … .
        const ts = generateTypedefs([rawTable("hosts", [
            { key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true },
            { key: "address", column: "address", type: { kind: "other", sqlType: "inet" }, nullable: true }
        ])]);
        expect(block(ts, "Row", "hosts")).toContain("address?: unknown | null;");
    });

    it("types a temporal column as a string on a read and a string or Date on a write", () => {
        const ts = generate(defineTable("events", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), at: col.timestamp({ withTimezone: true }).notNull() },
            rls: "admin-only"
        }));
        expect(block(ts, "Row", "events")).toContain("at: string;");
        expect(block(ts, "Insert", "events")).toContain("at: string | Date;");
        expect(block(ts, "Update", "events")).toContain("at?: string | Date;");
    });

    describe("closed value sets", () => {
        it("types a Postgres enum as the union of its values", () => {
            const ts = generate(defineTable("posts", {
                columns: { id: col.uuid().primaryKey().defaultRandom(), status: col.enum(["draft", "published"]) },
                rls: "admin-only"
            }));
            expect(ts).toContain('status?: "draft" | "published" | null;');
        });

        it("types a text `oneOf` as the union of its values", () => {
            const ts = generate(defineTable("posts", {
                columns: { id: col.uuid().primaryKey().defaultRandom(), status: col.text({ enum: ["draft", "published"] }) },
                rls: "admin-only"
            }));
            expect(ts).toContain('status?: "draft" | "published" | null;');
        });

        it("types a numeric `oneOf` — a number enum — as a union of numeric literals", () => {
            const ts = generate(defineTable("posts", {
                columns: { id: col.uuid().primaryKey().defaultRandom(), level: col.integer().oneOf([10, 20]) },
                rls: "admin-only"
            }));
            expect(ts).toContain("level?: 10 | 20 | null;");
        });

        it("types the items of a text array with a closed set", () => {
            const ts = generate(defineTable("posts", {
                columns: { id: col.uuid().primaryKey().defaultRandom(), labels: col.text({ enum: ["a", "b"] }).array() },
                rls: "admin-only"
            }));
            expect(ts).toContain('labels?: Array<"a" | "b"> | null;');
        });

        it("widens a numeric set that carries something no number literal can be", () => {
            const ts = generateTypedefs([rawTable("posts", [
                { key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true },
                { key: "level", column: "level", type: { kind: "integer" }, nullable: true, oneOf: [1, "x"] }
            ])]);
            expect(ts).toContain("level?: number | null;");
        });
    });

    describe("JSON documents", () => {
        it("types an object from its shape: required keys required, the rest optional and nullable", () => {
            const ts = generate(defineTable("users", {
                columns: {
                    id: col.uuid().primaryKey().defaultRandom(),
                    profile: col.jsonb(json.object({ age: json.number(), tagline: json.string().required(), seen: json.date() }))
                },
                rls: "admin-only"
            }));
            expect(ts).toContain("profile?: { age?: number | null; tagline: string; seen?: string | null; } | null;");
        });

        it("types nested objects, arrays, geopoints and closed sets inside a document", () => {
            const ts = generate(defineTable("places", {
                columns: {
                    id: col.uuid().primaryKey().defaultRandom(),
                    meta: col.jsonb(json.object({
                        where: json.geopoint().required(),
                        tags: json.array(json.string().oneOf(["x", "y"])),
                        inner: json.object({ flag: json.boolean() })
                    }))
                },
                rls: "admin-only"
            }));
            expect(ts).toContain(
                "meta?: { where: { latitude: number; longitude: number; }; tags?: Array<\"x\" | \"y\"> | null; " +
                "inner?: { flag?: boolean | null; } | null; } | null;"
            );
        });

        it("types an open object with no declared field as a record, and a document with no shape too", () => {
            const ts = generate(defineTable("users", {
                columns: {
                    id: col.uuid().primaryKey().defaultRandom(),
                    open: col.jsonb(json.object({}, { additional: true })),
                    bare: col.json()
                },
                rls: "admin-only"
            }));
            expect(ts).toContain("open?: Record<string, unknown> | null;");
            expect(ts).toContain("bare?: Record<string, unknown> | null;");
        });

        it("types typed blocks as the union of their variants", () => {
            const ts = generate(defineTable("pages", {
                columns: {
                    id: col.uuid().primaryKey().defaultRandom(),
                    content: col.jsonb(json.array(json.oneOf({ text: json.string(), quote: json.object({ by: json.string() }) }, { typeField: "kind" })))
                },
                rls: "admin-only"
            }));
            expect(ts).toContain(
                "content?: Array<{ kind: \"text\"; value: string; } | { kind: \"quote\"; value: { by?: string | null; }; }> | null;"
            );
        });

        it("types a JSON array of anything as `Array<unknown>`", () => {
            const ts = generate(defineTable("articles", {
                columns: { id: col.uuid().primaryKey().defaultRandom(), generic: col.jsonb(json.array(json.unknown())) },
                rls: "admin-only"
            }));
            expect(ts).toContain("generic?: Array<unknown> | null;");
        });
    });

    it("types a native array from its element type", () => {
        const ts = generate(defineTable("articles", {
            columns: {
                id: col.uuid().primaryKey().defaultRandom(),
                tags: col.text().array(),
                scores: col.integer().array(),
                files: col.storage({ path: "a/" }).multiple()
            },
            rls: "admin-only"
        }));
        expect(ts).toContain("tags?: Array<string> | null;");
        expect(ts).toContain("scores?: Array<number> | null;");
        expect(ts).toContain("files?: Array<string> | null;");
    });
});

describe("Insert: what a create may leave out", () => {
    const books = defineTable("books", {
        columns: {
            id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
            title: col.text().notNull(),
            subtitle: col.text(),
            code: col.text().notNull().dbDefault(),
            slug: col.text().notNull().default(sql`gen_short_id()`),
            status: col.enum(["draft", "live"]).notNull().default("draft"),
            createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
            createdBy: col.uuid().notNull().onCreateUser(),
            seq: col.serial().notNull(),
            words: col.integer().generatedAlwaysAs(sql`0`),
            locked: col.text().readOnly()
        },
        rls: "admin-only"
    });

    it("requires a NOT NULL column with no default, and offers the rest as optional", () => {
        const insert = block(generate(books), "Insert", "books");
        expect(insert).toContain("title: string;");
        expect(insert).toContain("subtitle?: string | null;");
    });

    it("leaves out an identity, a database default, a SQL default, a literal default, a stamp and a serial", () => {
        const insert = block(generate(books), "Insert", "books");
        expect(insert).toContain("id?: number;");
        expect(insert).toContain("code?: string;");
        expect(insert).toContain("slug?: string;");
        expect(insert).toContain('status?: "draft" | "live";');
        expect(insert).toContain("createdAt?: string | Date;");
        expect(insert).toContain("createdBy?: string;");
        expect(insert).toContain("seq?: number;");
    });

    it("keeps a defaulted column required on Row", () => {
        const row = block(generate(books), "Row", "books");
        expect(row).toContain("code: string;");
        expect(row).toContain('status: "draft" | "live";');
    });

    it("takes a generated and a read-only column off both write types, and keeps them on Row", () => {
        const ts = generate(books);
        for (const name of ["Insert", "Update"] as const) {
            expect(keysOf(block(ts, name, "books"))).not.toContain("words");
            expect(keysOf(block(ts, name, "books"))).not.toContain("locked");
        }
        expect(block(ts, "Row", "books")).toContain("words?: number | null;");
        expect(block(ts, "Row", "books")).toContain("locked?: string | null;");
    });

    it("requires a key the caller supplies, and a uuid key with a default is optional", () => {
        const ts = generate(
            defineTable("manual", { columns: { id: col.text().primaryKey(), note: col.text() }, rls: "admin-only" }),
            defineTable("generated", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" })
        );
        expect(block(ts, "Insert", "manual")).toContain("id: string;");
        expect(block(ts, "Insert", "generated")).toContain("id?: string;");
    });

    it("types a day key as its YYYY-MM-DD string, required on create", () => {
        const ts = generate(defineTable("scores", {
            columns: { day: col.date().primaryKey(), sid: col.text().primaryKey() },
            rls: "admin-only"
        }));
        expect(block(ts, "Row", "scores")).toContain("day: string;");
        expect(block(ts, "Insert", "scores")).toContain("day: string | Date;");
        expect(block(ts, "Insert", "scores")).toContain("sid: string;");
    });
});

describe("Update: every column optional, the key not reassignable", () => {
    it("makes every writable column optional and leaves the key out", () => {
        const update = block(generate(defineTable("books", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), title: col.text().notNull() },
            rls: "admin-only"
        })), "Update", "books");
        expect(update).toContain("title?: string;");
        expect(update).not.toMatch(/^\s+id\??:/m);
    });
});

describe("relations and foreign keys", () => {
    const numericAuthors = defineTable("authors", { columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() }, rls: "admin-only" });
    const uuidAuthors = defineTable("authors", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });

    it("types a derived foreign key as the target's key, under its wire key", () => {
        const posts = defineTable("posts", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() },
            relations: { author: rel.belongsTo(() => numericAuthors, { localKey: "author_id" }) },
            rls: "admin-only"
        });
        const ts = generate(posts, numericAuthors);
        // The foreign key is emitted under its wire name. `author_id` is the
        // column behind it and is not a name the API ever answers to.
        expect(block(ts, "Row", "posts")).toContain("authorId?: number | null;");
        expect(ts).not.toContain("author_id");
    });

    it("types a link into a table outside the run by its own column, its row as an open record", () => {
        const posts = defineTable("posts", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() },
            relations: { author: rel.belongsTo(() => uuidAuthors) },
            rls: "admin-only"
        });
        const ts = generateTypedefs(compiledOnly([posts, uuidAuthors], ["posts"]));
        expect(block(ts, "Row", "posts")).toContain("authorId?: string | null;");
        expect(block(ts, "Row", "posts")).toContain("author?: Record<string, unknown>;");
        expect(block(ts, "Relations", "posts")).toContain("author: never;");
    });

    // A required link: NOT NULL in the database, so non-null on Row, and a
    // create must name it — under either spelling, which the server's required
    // check reads both of.
    it("requires a NOT NULL link on create, under either of its names", () => {
        const posts = defineTable("posts", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() },
            relations: { author: rel.belongsTo(() => uuidAuthors, { localKey: "author_id", notNull: true }) },
            rls: "admin-only"
        });
        const ts = generate(posts, uuidAuthors);
        expect(block(ts, "Row", "posts")).toContain("authorId: string;");
        expect(ts).toContain("} & ({ authorId: string } | { author: string });");
    });

    it("binds a declared foreign-key column, typed and placed by its declaration", () => {
        const posts = defineTable("posts", {
            columns: {
                id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
                authorRef: col.uuid("author_id").notNull().describe("who wrote it"),
                title: col.text()
            },
            relations: { author: rel.belongsTo(() => uuidAuthors, { localKey: "author_id" }) },
            rls: "admin-only"
        });
        const ts = generate(posts, uuidAuthors);
        expect(keysOf(block(ts, "Row", "posts"))).toEqual(["id", "authorRef", "title", "author"]);
        expect(block(ts, "Insert", "posts")).toContain("authorRef: string;");
        expect(block(ts, "Insert", "posts")).toContain("author: string;");
    });

    it("lists a column that is nothing but the link with the relations, as a derived one is", () => {
        const posts = defineTable("posts", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), authorId: col.uuid(), title: col.text() },
            relations: { author: rel.belongsTo(() => uuidAuthors) },
            rls: "admin-only"
        });
        expect(keysOf(block(generate(posts, uuidAuthors), "Row", "posts"))).toEqual(["id", "title", "authorId", "author"]);
    });

    it("writes an unconstrained link by its key alone", () => {
        // `constraint: false` keeps a bare column: the server writes it by its
        // key, and does not map the relation's name onto it.
        const posts = defineTable("posts", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), authorId: col.uuid() },
            relations: { author: rel.belongsTo(() => uuidAuthors, { constraint: false, index: false }) },
            rls: "admin-only"
        });
        const insert = block(generate(posts, uuidAuthors), "Insert", "posts");
        expect(insert).toContain("authorId?: string | null;");
        expect(keysOf(insert)).not.toContain("author");
    });

    it("types a relation as the target's own row, inlined — the shape a read serves", () => {
        const tags = defineTable("tags", { columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() }, rls: "admin-only" });
        const posts = defineTable("posts", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() },
            relations: { tags: rel.manyToMany(() => tags) },
            rls: "admin-only"
        });
        const ts = generate(posts, tags);
        expect(ts).toContain("tags?: Array<Database[\"tags\"][\"Row\"]>;");
        expect(ts).not.toContain("__type: \"relation\"");
    });

    it("types a junction's payload as `_pivot`, on a read and on a write", () => {
        const tags = defineTable("tags", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
        const posts = defineTable("posts", {
            columns: { id: col.uuid().primaryKey().defaultRandom() },
            relations: {
                tags: rel.manyToMany(() => tags, {
                    pivot: { position: col.integer(), addedAt: col.timestamp({ withTimezone: true }).notNull() }
                })
            },
            rls: "admin-only"
        });
        const ts = generate(posts, tags);
        expect(block(ts, "Row", "posts")).toContain(
            "tags?: Array<Database[\"tags\"][\"Row\"] & { _pivot?: { position?: number | null; addedAt: string; } }>;"
        );
        expect(block(ts, "Insert", "posts")).toContain(
            "tags?: Array<string | { id: string; _pivot?: { position?: number | null; addedAt?: string | Date; } }>;"
        );
    });

    it("writes a hasMany as the targets' keys and a hasOne by naming the target row", () => {
        const profiles = defineTable("profiles", { columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() }, rls: "admin-only" });
        const comments = defineTable("comments", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
        const writers = defineTable("writers", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() },
            relations: {
                profile: rel.hasOne(() => profiles, { foreignKey: "writer_id" }),
                comments: rel.hasMany(() => comments, { foreignKey: "writer_id" })
            },
            rls: "admin-only"
        });
        const insert = block(generate(writers, profiles, comments), "Insert", "writers");
        expect(insert).toContain("profile?: number | null;");
        expect(insert).toContain("comments?: Array<string | { id: string }>;");
    });
});

describe("Row, Insert and Update describe different things", () => {
    const posts = defineTable("posts", {
        columns: {
            id: col.uuid().primaryKey().defaultRandom(),
            title: col.text().notNull(),
            subtitle: col.text(),
            secret: col.text().private()
        },
        relations: { author: rel.belongsTo(() => authors) },
        rls: "admin-only"
    });

    it("marks the primary key required on Row", () => {
        expect(block(generate(posts, authors), "Row", "posts")).toContain("id: string;");
    });

    it("types a nullable column as nullable, not merely absent", () => {
        expect(block(generate(posts, authors), "Row", "posts")).toContain("subtitle?: string | null;");
    });

    it("leaves a private column out of every type", () => {
        const ts = generate(posts, authors);
        for (const name of ["Row", "Insert", "Update"] as const) {
            expect(block(ts, name, "posts")).not.toContain("secret");
        }
    });

    it("does not let Update reassign the primary key, and keeps the foreign key writable", () => {
        const update = block(generate(posts, authors), "Update", "posts");
        expect(update).not.toMatch(/^\s+id\??:/m);
        expect(update).toContain("title?: string;");
        expect(update).toContain("authorId?: number | null;");
    });

    it("accepts both write shapes for a belongsTo relation", () => {
        const insert = block(generate(posts, authors), "Insert", "posts");
        expect(insert).toContain("authorId?: number | null;");
        expect(insert).toContain("author?: number | null;");
        expect(insert).not.toContain("string | number");
    });

    it("treats every column of a composite key as part of the row's identity", () => {
        const ts = generate(defineTable("company_translation", {
            columns: { id: col.integer().primaryKey(), locale: col.text().primaryKey(), name: col.text() },
            rls: "admin-only"
        }));
        expect(block(ts, "Row", "companyTranslation")).toContain("id: number;");
        expect(block(ts, "Row", "companyTranslation")).toContain("locale: string;");
        expect(block(ts, "Insert", "companyTranslation")).toMatch(/^\s+id: number;/m);
        expect(block(ts, "Insert", "companyTranslation")).toMatch(/^\s+locale: string;/m);
        const update = block(ts, "Update", "companyTranslation");
        expect(update).not.toMatch(/^\s+(id|locale)\??:/m);
        expect(update).toContain("name?: string | null;");
    });
});

/**
 * `.private()` means one thing: the API surface does not mention the column,
 * in either direction — and a link whose foreign key is private goes with it.
 * The assertions are over the rule, derived from the fixture, not over a list
 * of names.
 */
describe("a private column is off every generated type", () => {
    const owners = defineTable("owners", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
    const hidden = {
        credential: col.text().private(),
        attempts: col.integer().notNull().private(),
        lockedOut: col.boolean().private(),
        rotatedAt: col.timestamp({ withTimezone: true }).private(),
        recoveryCodes: col.text().array().private(),
        internalNotes: col.jsonb(json.object({ note: json.string() })).private(),
        closed: col.text().access({ read: [], write: [] }),
        auditorId: col.uuid("auditor_id").private()
    };
    const vault = defineTable("vault", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), label: col.text().notNull(), ...hidden },
        relations: {
            owner: rel.belongsTo(() => owners, { localKey: "owner_id" }),
            auditor: rel.belongsTo(() => owners, { localKey: "auditor_id" })
        },
        rls: "admin-only"
    });
    const generated = generate(vault, owners);
    const forbidden = [...Object.keys(hidden), "auditor"];

    it.each(["Row", "Insert", "Update"] as const)("%s names none of them", name => {
        const keys = keysOf(block(generated, name, "vault"));
        expect(keys).toContain("label");
        for (const key of forbidden) expect(keys).not.toContain(key);
    });

    it("keeps the open link, its foreign key and its include", () => {
        for (const name of ["Row", "Insert", "Update"] as const) {
            expect(keysOf(block(generated, name, "vault"))).toEqual(expect.arrayContaining(["owner", "ownerId"]));
        }
        expect(block(generated, "Relations", "vault")).toContain("owner: \"owners\";");
        expect(block(generated, "Relations", "vault")).not.toContain("auditor");
    });

    it("keeps a column everyone may read and nobody may write on Row only", () => {
        const ts = generate(owners, defineTable("stats", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), computed: col.text().access({ write: [] }), salary: col.integer().access({ read: ["hr"], write: ["hr"] }) },
            relations: { owner: rel.belongsTo(() => owners, { localKey: "owner_id" }) },
            rls: "admin-only"
        }));
        expect(keysOf(block(ts, "Row", "stats"))).toContain("computed");
        expect(keysOf(block(ts, "Insert", "stats"))).not.toContain("computed");
        expect(keysOf(block(ts, "Update", "stats"))).not.toContain("computed");
        // A role rule is not a closure: some caller may.
        for (const name of ["Row", "Insert", "Update"] as const) expect(keysOf(block(ts, name, "stats"))).toContain("salary");
    });

    it("hides the auth table's secrets whatever the declaration says", () => {
        const users = defineAuthTable("users", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text().notNull(), passwordHash: col.text() },
            rls: "admin-only"
        });
        const ts = generate(users);
        for (const name of ["Row", "Insert", "Update"] as const) expect(keysOf(block(ts, name, "users"))).not.toContain("passwordHash");
        expect(block(ts, "Row", "users")).toContain("email: string;");
    });
});

describe("views and tenants", () => {
    it("types a view's reads and no writes", () => {
        const titles = defineView("post_titles", {
            query: "select id, title from posts",
            columns: { id: col.uuid().primaryKey(), title: col.text() }
        });
        const ts = generate(titles);
        expect(block(ts, "Row", "postTitles")).toContain("title?: string | null;");
        expect(ts).toContain("    Insert: never;\n    Update: never;");
    });

    it("types a tenant column NOT NULL, as the planner makes it", () => {
        const ts = generate(defineTable("projects", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), orgId: col.uuid() },
            tenant: { field: "orgId", from: { claim: "org_id" } },
            rls: "admin-only"
        }));
        expect(block(ts, "Row", "projects")).toContain("orgId: string;");
    });
});

describe("generateSDK configurations", () => {
    const tables = compileTables([authors]);

    it("does not generate README.md if includeReadme is false", () => {
        expect(generateSDK(tables, { includeReadme: false }).map(f => f.path)).toEqual(["database.types.ts"]);
    });

    it("generates the README by default", () => {
        for (const options of [undefined, {}, { includeReadme: true }]) {
            const files = generateSDK(tables, options);
            expect(files.map(f => f.path)).toEqual(["database.types.ts", "README.md"]);
            const readme = files.find(f => f.path === "README.md")!;
            expect(readme.content).toContain("createRebaseClient");
            expect(readme.content).toContain("@rebasepro/client");
        }
    });

    /**
     * `rebase dev` binds a port derived from the project's path, not 3001, and
     * the README's example connected to 3001 whatever the project was on.
     */
    it("connects the README's example to the address it is given", () => {
        const readme = generateSDK(tables, { baseUrl: "http://localhost:3755" }).find(f => f.path === "README.md")!.content;
        expect(readme).toContain("baseUrl: 'http://localhost:3755'");
        expect(readme).not.toContain("3001");
        expect(readme).toContain("tables: tablesDictionary");
    });

    it("always emits the typedefs, and they reflect the tables passed in", () => {
        const types = generateSDK(tables).find(f => f.path === "database.types.ts")!;
        expect(types.content).toContain("export interface Database");
        expect(types.content).toContain("authors:");
    });

    /**
     * The README taught the naming rule from before 0.14 — that a field keeps
     * its *column* name. A declared column is its key, and a derived foreign
     * key arrives camelCased (`author_id` → `authorId`).
     */
    it("teaches the wire names, not the column names", () => {
        const readme = generateSDK(tables).find(f => f.path === "README.md")!.content;
        expect(readme).not.toContain("created_at");
        expect(readme).not.toContain("author_id");
        expect(readme).not.toMatch(/\brow\.[a-z0-9]+_/);
        expect(readme).not.toMatch(/\{\s*[a-z0-9]+_[a-z0-9_]*:/);
        expect(readme).toContain("row.authorId");
        expect(readme).toContain("row.createdAt");
    });
});

describe("generateTypedefs is independent of table order", () => {
    // `rebase generate-sdk && git diff --exit-code` and `rebase doctor` compare
    // the generator's output against the file it wrote.
    const tables = compileTables([
        defineTable("authors", { columns: { id: col.uuid().primaryKey(), name: col.text() }, rls: "admin-only" }),
        defineTable("articles", { columns: { id: col.uuid().primaryKey(), title: col.text() }, rls: "admin-only" })
    ]);

    it("emits byte-identical output for a shuffled input", () => {
        expect(generateTypedefs([...tables].reverse())).toEqual(generateTypedefs(tables));
    });

    it("does not reorder the array it was given", () => {
        const input = [...tables];
        generateTypedefs(input);
        expect(input.map(t => t.slug)).toEqual(["authors", "articles"]);
    });
});

describe("a slug the client proxy reserves gets a renamed accessor", () => {
    // `client.data.table` is the dynamic `table(slug)` function, and
    // `then`, `toJSON` and `$$typeof` are answered `undefined` so promise and
    // serialisation probes do not mistake the proxy for something else.
    const slugs = ["table", "then", "toJSON", "posts"];
    const tables = compileTables(slugs.map(slug => defineTable(slug, {
        table: `t_${slug.toLowerCase()}`,
        columns: { id: col.uuid().primaryKey(), title: col.text() },
        rls: "admin-only"
    })));

    it("emits `<name>Table` and maps it back to the slug", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const output = generateTypedefs(tables);
            expect(output).toContain("  tableTable: \"table\",");
            expect(output).toContain("  thenTable: \"then\",");
            expect(output).toContain("  toJSONTable: \"toJSON\",");
            expect(output).toContain("  posts: \"posts\",");
            expect(output).toMatch(/^ {2}tableTable: \{$/m);
            expect(output).not.toMatch(/^ {2}table: /m);
            expect(output).not.toMatch(/^ {2}then: /m);

            const messages = warn.mock.calls.map(call => String(call[0]));
            expect(messages.some(m => m.includes("\"table\"") && m.includes("tableTable"))).toBe(true);
            expect(messages.some(m => m.includes("\"then\"") && m.includes("thenTable"))).toBe(true);
            expect(messages.some(m => m.includes("posts"))).toBe(false);
        } finally {
            warn.mockRestore();
        }
    });

    it("refuses when the renamed accessor collides with another slug's", () => {
        const clash = [tables[0], rawTable("table_table")];
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(() => generateTypedefs(clash)).toThrow(/tableTable/);
        } finally {
            warn.mockRestore();
        }
    });
});
