import { describe, expect, it } from "@jest/globals";
import { ColumnBuilder, TABLE_BRAND, VIEW_BRAND, col, defineAuthTable, defineTable, defineView, json, policy, rel, pgEnum } from "@rebasepro/types";
import type { AnyTableDef, AnyViewDef, ColumnDef, DefaultRls } from "@rebasepro/types";

import { compileTables, type AnySchemaDef } from "../../src/schema/compile-tables";
import { SchemaDefinitionError, isSchemaDefinitionError, type SchemaDefinitionProblem } from "../../src/schema/errors";

/**
 * Every refusal of `compileTables`, asserted on the problem it reports — the
 * table, the key, and what the message tells the author to do — not merely on
 * "it throws". The compiler collects every problem before throwing, so one
 * test also proves that several surface together.
 */

function problemsOf(defs: readonly AnySchemaDef[], defaultRls?: DefaultRls): SchemaDefinitionProblem[] {
    try {
        compileTables(defs, defaultRls === undefined ? {} : { defaultRls });
    } catch (error) {
        if (isSchemaDefinitionError(error)) return [...error.problems];
        throw error;
    }
    return [];
}

/** A column whose definition no builder chain produces: what a JavaScript caller or a cast can hand over. */
function rawColumn(def: Partial<ColumnDef> & Pick<ColumnDef, "type">): ColumnBuilder<unknown> {
    return new ColumnBuilder<unknown>({ notNull: false, primaryKey: false, unique: false, readOnly: false, private: false, ...def });
}

/** A table definition written by hand, past `defineTable`'s own checks. */
function rawTable(name: string, config: AnyTableDef["config"], auth?: AnyTableDef["auth"]): AnyTableDef {
    return auth ? { brand: TABLE_BRAND, name, config, auth } : { brand: TABLE_BRAND, name, config };
}

function rawView(name: string, config: AnyViewDef["config"]): AnyViewDef {
    return { brand: VIEW_BRAND, name, config };
}

const id = () => col.uuid().primaryKey();
const table = (name: string, columns: AnyTableDef["config"]["columns"] = { id: id() }) =>
    rawTable(name, { columns, rls: "admin-only" });

describe("compileTables — refusals", () => {
    it("throws one SchemaDefinitionError listing every problem, in declaration order", () => {
        const a = rawTable("a", { columns: { name: col.text() }, rls: "admin-only" });
        const b = rawTable("b", { columns: { id: id() }, rls: "inherit" });
        let thrown: unknown;
        try {
            compileTables([a, b]);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(SchemaDefinitionError);
        if (!(thrown instanceof SchemaDefinitionError)) return;
        expect(thrown.problems.map(p => p.table)).toEqual(["a", "b"]);
        expect(thrown.message).toMatch(/^The schema cannot be used \(2 problems\):\n {2}- a: the table has no primary key/);
        expect(thrown.code).toBe("SCHEMA_DEFINITION_INVALID");
    });

    it("refuses a value that is not a definition", () => {
        expect(problemsOf([JSON.parse("{\"brand\":\"nope\",\"name\":\"x\"}")])).toEqual([
            { table: "#0", message: expect.stringMatching(/is not a `defineTable\(\.\.\.\)`, `defineAuthTable\(\.\.\.\)` or `defineView\(\.\.\.\)` result/) }
        ]);
    });

    describe("primary keys and names", () => {
        it("refuses a table without a primary key", () => {
            expect(problemsOf([table("t", { name: col.text() })])).toEqual([
                { table: "t", message: expect.stringContaining("the table has no primary key. Mark a column `.primaryKey()`") }
            ]);
        });

        it("refuses two definitions with one name, slug or SQL table", () => {
            const first = table("posts");
            const sameName = table("posts");
            const sameSlug = rawTable("articles", { slug: "posts", columns: { id: id() }, rls: "admin-only" });
            const sameTable = rawTable("blog", { table: "posts", columns: { id: id() }, rls: "admin-only" });
            const otherSchema = rawTable("archive", { table: "posts", schema: "archive", columns: { id: id() }, rls: "admin-only" });
            const problems = problemsOf([first, sameName, sameSlug, sameTable, otherSchema]);
            expect(problems).toEqual(expect.arrayContaining([
                { table: "posts", message: expect.stringContaining("two definitions are named \"posts\"") },
                { table: "articles", message: expect.stringContaining("its slug \"posts\" is also the slug of \"posts\"") },
                { table: "blog", message: expect.stringContaining("it resolves to the SQL table `public.posts`, which \"posts\" resolves to too") }
            ]));
            expect(problems.filter(p => p.table === "archive")).toEqual([]);
        });

        it("refuses a column key and a relation name colliding", () => {
            const target = table("users");
            const t = rawTable("t", {
                columns: { id: id(), author: col.uuid() },
                relations: { author: rel.belongsTo(() => target) },
                rls: "admin-only"
            });
            expect(problemsOf([target, t])).toContainEqual({
                table: "t", key: "author",
                message: expect.stringContaining("the table has both a column and a relation named \"author\"")
            });
        });

        it("refuses two columns resolving to one SQL column", () => {
            expect(problemsOf([table("t", { id: id(), myTitle: col.text(), my_title: col.text() })])).toEqual([{
                table: "t", key: "my_title",
                message: expect.stringContaining("\"my_title\" and \"myTitle\" both resolve to the SQL column \"my_title\"")
            }]);
            // `__order` snake-cases to `order`.
            expect(problemsOf([table("t", { id: id(), order: col.text(), __order: col.text() })])).toHaveLength(1);
        });

        it("refuses a key with no snake_case form", () => {
            expect(problemsOf([table("t", { id: id(), _: col.text() })])).toContainEqual({
                table: "t", key: "_", message: expect.stringContaining("has no snake_case form to name a SQL column with. Give it one: `.column(\"…\")`")
            });
        });

        it("refuses identifiers that collide once Postgres keeps 63 bytes", () => {
            const long = "a_table_with_a_really_long_name_that_goes_on_and_on_and_on_forever";
            const one = rawTable("one", { table: `${long}_one`, columns: { id: id() }, rls: "admin-only" });
            const two = rawTable("two", { table: `${long}_two`, columns: { id: id() }, rls: "admin-only" });
            expect(problemsOf([one, two])).toEqual([{
                table: "two", message: expect.stringMatching(/table "a_table.*_two" and table "a_table.*_one" both become "public"\."a_table_with_a_really_long_name_that_goes_on_and_on_and_on_fore" in Postgres/)
            }]);

            const cols = table("cols", {
                id: id(),
                first: col.text(`${long}_first`),
                second: col.text(`${long}_second`)
            });
            expect(problemsOf([cols])).toEqual([{
                table: "cols", key: "second", message: expect.stringContaining("once Postgres keeps the first 63 bytes. Give one a shorter `.column()`")
            }]);
        });

        it("refuses a table and an enum type sharing a name", () => {
            const posts = table("posts", { id: id(), status: col.enum(["a"]) });
            const postsStatus = table("posts_status");
            expect(problemsOf([posts, postsStatus])).toEqual([{
                table: "posts", key: "status",
                message: expect.stringContaining("the enum type of \"posts.status\" and table \"posts_status\" both become \"public\".\"posts_status\"")
            }]);
        });

        it("refuses one named enum type with two lists of values", () => {
            const sharedStatusEnum = pgEnum("shared_status", ["x", "y"]);

            const a = table("a", { id: id(), s: sharedStatusEnum() });
            const sharedStatusEnum2 = pgEnum("shared_status", ["x", "z"]);

            const b = table("b", { id: id(), s: sharedStatusEnum2() });
            const same = table("c", { id: id(), s: sharedStatusEnum() });
            expect(problemsOf([a, b, same])).toEqual([{
                table: "b", key: "s",
                message: expect.stringContaining("the enum type \"public\".\"shared_status\" is given the values (x, z) here and (x, y)")
            }]);
        });
    });

    describe("rls", () => {
        it("refuses \"inherit\" without a defaultRls", () => {
            expect(problemsOf([rawTable("t", { columns: { id: id() }, rls: "inherit" })])).toEqual([{
                table: "t", message: expect.stringContaining("`rls: \"inherit\"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts")
            }]);
        });

        it("refuses \"admin-only\" with defaultPolicies: false, written or inherited", () => {
            expect(problemsOf([rawTable("t", { columns: { id: id() }, rls: "admin-only", defaultPolicies: false })])).toEqual([{
                table: "t", message: expect.stringContaining("`rls: \"admin-only\"` with `defaultPolicies: false` grants nobody anything")
            }]);
            expect(problemsOf([rawTable("t", { columns: { id: id() }, rls: "inherit", defaultPolicies: false })], "admin-only")).toEqual([{
                table: "t", message: expect.stringContaining("resolves to the project's `defaultRls`, which is unusable: `rls: \"admin-only\"` with `defaultPolicies: false`")
            }]);
        });

        it("refuses an empty rule list — the builder and the compiler both", () => {
            expect(() => defineTable("t", { columns: { id: id() }, rls: JSON.parse("[]") })).toThrow(/admin-only/);
            expect(problemsOf([rawTable("t", { columns: { id: id() }, rls: JSON.parse("[]") })])).toEqual([{
                table: "t", message: expect.stringContaining("`rls: []` grants nothing and says nothing. Write `rls: \"admin-only\"`")
            }]);
        });

        it("refuses a missing or unreadable rls", () => {
            expect(problemsOf([rawTable("t", { columns: { id: id() }, rls: JSON.parse("null") })])).toEqual([{
                table: "t", message: expect.stringContaining("the table has no usable `rls`")
            }]);
            expect(problemsOf([rawTable("t", { columns: { id: id() }, rls: JSON.parse("[1]") })])).toEqual([{
                table: "t", message: "every entry of `rls` must be a security rule object."
            }]);
        });

        it("refuses an ownerField naming no column, and accepts a key, a relation or a column name", () => {
            const users = table("users");
            const t = rawTable("t", {
                columns: { id: id(), createdBy: col.uuid() },
                relations: { author: rel.belongsTo(() => users) },
                rls: [
                    { operation: "update", ownerField: "createdBy" },
                    { operation: "update", ownerField: "author" },
                    { operation: "update", ownerField: "author_id" },
                    { operation: "update", ownerField: "created_by" },
                    { name: "mine", operation: "delete", ownerField: "owner" }
                ]
            });
            expect(problemsOf([users, t])).toEqual([{
                table: "t", key: "rls[4]",
                message: expect.stringContaining("rule \"mine\" has `ownerField: \"owner\"`, and the table has no such column or `belongsTo` relation")
            }]);
        });

        it("refuses a structured condition comparing a field the table does not have", () => {
            const t = rawTable("t", {
                columns: { id: id(), status: col.text() },
                rls: [
                    { operation: "select", condition: policy.compare(policy.field("status"), "eq", policy.literal("published")) },
                    { operation: "select", condition: policy.and(policy.compare(policy.field("stauts"), "eq", policy.literal("x"))) },
                    {
                        operation: "update",
                        condition: policy.true(),
                        check: policy.existsIn({ table: "orgs", where: policy.compare(policy.field("anything"), "eq", policy.outerField("orgId")) })
                    }
                ]
            });
            expect(problemsOf([t])).toEqual([
                { table: "t", key: "rls[1]", message: expect.stringContaining("rule #1 compares the field \"stauts\" in its `condition`") },
                { table: "t", key: "rls[2]", message: expect.stringContaining("rule #2 compares the field \"orgId\" in its `check`") }
            ]);
        });

        it("refuses a shorthand condition naming a column the table does not have", () => {
            const t = rawTable("t", {
                columns: { id: id(), status: col.text() },
                rls: [{ operation: "select", condition: JSON.parse("{\"status\":\"published\",\"visible\":true}") }]
            });
            expect(problemsOf([t])).toEqual([
                { table: "t", key: "rls[0]", message: expect.stringContaining("compares the field \"visible\" in its `condition`") }
            ]);
        });

        it("checks the fields of inherited rules against each table", () => {
            const t = rawTable("t", { columns: { id: id() }, rls: "inherit" });
            expect(problemsOf([t], [{ operation: "update", ownerField: "ownerId" }])).toEqual([
                { table: "t", key: "rls[0]", message: expect.stringContaining("has `ownerField: \"ownerId\"`") }
            ]);
        });

        it("accepts the auth columns an auth table gets without declaring them", () => {
            const users = rawTable("users", {
                columns: { id: id() },
                rls: [{ operation: "select", condition: policy.compare(policy.field("email"), "eq", policy.literal("x")) }]
            }, {});
            expect(problemsOf([users])).toEqual([]);
        });
    });

    describe("table options", () => {
        it("refuses a tenant field naming no column, of the wrong type, or hidden", () => {
            const t = (columns: AnyTableDef["config"]["columns"], field: string) =>
                rawTable("t", { columns, rls: "admin-only", tenant: { field, from: { claim: "org_id" } } });
            expect(problemsOf([t({ id: id() }, "orgId")])).toEqual([{
                table: "t", message: expect.stringContaining("`tenant` scopes rows by \"orgId\", and the table has no such column or `belongsTo` relation")
            }]);
            expect(problemsOf([t({ id: id(), orgId: col.boolean() }, "orgId")])).toEqual([{
                table: "t", message: expect.stringContaining("\"orgId\" is `boolean`, which cannot hold a tenant id")
            }]);
            expect(problemsOf([t({ id: id(), orgId: col.uuid().private() }, "orgId")])).toEqual([{
                table: "t", message: expect.stringContaining("is also hidden from callers (`.private()`)")
            }]);
        });

        it("refuses a softDelete field naming no column, or not a timestamp", () => {
            const t = (columns: AnyTableDef["config"]["columns"], softDelete: AnyTableDef["config"]["softDelete"]) =>
                rawTable("t", { columns, rls: "admin-only", softDelete });
            expect(problemsOf([t({ id: id() }, true)])).toEqual([{
                table: "t", message: expect.stringContaining("`softDelete` records the deletion in \"deletedAt\", and the table has no such column")
            }]);
            expect(problemsOf([t({ id: id(), removed: col.boolean() }, { field: "removed" })])).toEqual([{
                table: "t", message: expect.stringContaining("that column is `boolean`. Make it `col.timestamptz()`")
            }]);
            expect(problemsOf([t({ id: id(), deletedAt: col.timestamp({ withTimezone: true }) }, JSON.parse("\"yes\""))])).toEqual([{
                table: "t", message: "`softDelete` must be `true` or `{ field }`."
            }]);
        });

        it("refuses index keys naming no column, in columns, include and where", () => {
            const users = table("users");
            const t = rawTable("t", {
                columns: { id: id(), status: col.text() },
                relations: { owner: rel.belongsTo(() => users) },
                rls: "admin-only",
                indexes: [
                    { columns: ["status", "owner", "ownerId", { column: "id", direction: "desc" }] },
                    { columns: ["stauts"] },
                    { columns: ["status"], include: ["nope"], where: { and: [{ column: "gone", op: "is null" }] } }
                ]
            });
            expect(problemsOf([users, t]).map(p => p.message)).toEqual([
                expect.stringContaining("`indexes[1]` names \"stauts\""),
                expect.stringContaining("`indexes[2]` names \"nope\""),
                expect.stringContaining("`indexes[2]` names \"gone\"")
            ]);
        });

        it("refuses search fields naming no column, a path into a non-JSON column, or a hidden column", () => {
            const t = rawTable("t", {
                columns: { id: id(), title: col.text(), meta: col.jsonb(), secret: col.text().access({ read: ["admin"] }) },
                rls: "admin-only",
                search: { fields: ["title", "meta.seo", { path: "titel" }, "title.x", "secret"] }
            });
            expect(problemsOf([t])).toEqual([
                { table: "t", key: "search", message: expect.stringContaining("names \"titel\", and \"titel\" is no column key") },
                { table: "t", key: "search", message: expect.stringContaining("names the path \"title.x\", and \"title\" is `text`, not a JSON column") },
                { table: "t", key: "search", message: expect.stringContaining("\"secret\" is named in `search.fields` and also restricted by `access.read`") }
            ]);
            expect(problemsOf([rawTable("e", { columns: { id: id() }, rls: "admin-only", search: { fields: [] } })])).toEqual([
                { table: "e", key: "search", message: expect.stringContaining("`search.fields` lists no field") }
            ]);
        });

        it("refuses a second defineAuthTable", () => {
            const users = defineAuthTable("users", { columns: { id: id() }, rls: "admin-only" });
            const admins = defineAuthTable("admins", { columns: { id: id() }, rls: "admin-only" });
            expect(problemsOf([users, admins])).toEqual([{
                table: "admins", message: expect.stringContaining("is a second `defineAuthTable` — \"users\" is already the table users are stored in")
            }]);
        });
    });

    describe("relations", () => {
        it("refuses a target outside the list, a thunk that throws, and one that returns nothing", () => {
            const elsewhere = table("elsewhere");
            const holder: { target: unknown } = { target: elsewhere };
            Object.assign(holder, { target: undefined });
            const t = rawTable("t", {
                columns: { id: id() },
                relations: {
                    gone: rel.belongsTo(() => elsewhere),
                    cycle: rel.hasMany(() => { throw new ReferenceError("x is not defined"); }),
                    broken: rel.hasMany(() => { throw new Error("boom"); }),
                    empty: rel.hasOne(() => holder.target),
                    // The type system does not check what a thunk returns (a
                    // `TableThunk` is `() => void`); the compiler does.
                    notATable: rel.hasOne(() => ({ name: "elsewhere" }))
                },
                rls: "admin-only"
            });
            expect(problemsOf([t])).toEqual([
                { table: "t", key: "gone", message: expect.stringContaining("its target \"elsewhere\" is not one of the tables being compiled. Export it from backend/schema/index.ts") },
                { table: "t", key: "cycle", message: expect.stringContaining("its target is not initialized yet — almost always an import cycle") },
                { table: "t", key: "broken", message: "the relation its target thunk threw: boom" },
                { table: "t", key: "empty", message: expect.stringContaining("its target resolved to `undefined`") },
                { table: "t", key: "notATable", message: expect.stringContaining("its target resolved to something that is not a table. The thunk must return the `defineTable` / `defineView` result itself") }
            ]);
        });

        it("refuses a relation that is both private and access-ruled", () => {
            const target = table("target");
            const t = rawTable("t", {
                columns: { id: id() },
                relations: { both: rel.hasMany(() => target, { private: true, access: { read: ["admin"] } }) },
                rls: "admin-only"
            });
            expect(problemsOf([target, t])).toEqual([
                { table: "t", key: "both", message: expect.stringContaining("is `private: true` and declares `access`") }
            ]);
        });

        it("refuses a via with no steps", () => {
            const target = table("target");
            const t = rawTable("t", {
                columns: { id: id() },
                relations: { hop: { brand: "rebase.relation", kind: "via", target: () => target, steps: [] } },
                rls: "admin-only"
            });
            expect(() => rel.via(() => target, { steps: [] })).toThrow(/at least one join step/);
            expect(problemsOf([target, t])).toEqual([{ table: "t", key: "hop", message: "`rel.via(target, { steps })` needs at least one join step." }]);
        });

        it("refuses a belongsTo bound to a column of another type than the target's key", () => {
            const users = table("users");
            const t = rawTable("t", {
                columns: { id: id(), authorId: col.integer() },
                relations: { author: rel.belongsTo(() => users) },
                rls: "admin-only"
            });
            expect(problemsOf([users, t])).toEqual([{
                table: "t", key: "author",
                message: expect.stringContaining("binds the column \"authorId\" (`integer`) as its foreign key, and `users`'s key \"id\" is `uuid`")
            }]);
        });

        it("refuses a bound enum column that is not the key's enum type", () => {
            const codes = table("codes", { code: col.enum(["a", "b"]).primaryKey() });
            const own = table("own", { id: id(), codeId: col.enum(["a", "b"]) });
            const codesCodeEnum = pgEnum("codes_code", ["a", "b"]);

            const shared = table("shared", { id: id(), codeId: codesCodeEnum() });
            const ownDef = rawTable("own", { ...own.config, relations: { code: rel.belongsTo(() => codes) } });
            const sharedDef = rawTable("shared", { ...shared.config, relations: { code: rel.belongsTo(() => codes) } });
            expect(problemsOf([codes, ownDef, sharedDef])).toEqual([{
                table: "own", key: "code", message: expect.stringContaining("binds the column \"codeId\" (`enum(a, b)`)")
            }]);
        });

        it("refuses notNull / unique on a belongsTo the bound column contradicts", () => {
            const users = table("users");
            const t = rawTable("t", {
                columns: { id: id(), authorId: col.uuid() },
                relations: { author: rel.belongsTo(() => users, { notNull: true, unique: true }) },
                rls: "admin-only"
            });
            expect(problemsOf([users, t]).map(p => p.message)).toEqual([
                expect.stringContaining("`notNull: true` applies to a derived foreign key, and this relation binds the declared column \"authorId\", which is nullable"),
                expect.stringContaining("`unique: true` applies to a derived foreign key")
            ]);
        });

        it("refuses a derived foreign key whose key is taken, or derived twice", () => {
            const users = table("users");
            const taken = rawTable("taken", {
                columns: { id: id(), authorId: col.text("writer") },
                relations: { author: rel.belongsTo(() => users) },
                rls: "admin-only"
            });
            const twice = rawTable("twice", {
                columns: { id: id() },
                relations: {
                    author: rel.belongsTo(() => users),
                    writer: rel.belongsTo(() => users, { localKey: "author_id" })
                },
                rls: "admin-only"
            });
            expect(problemsOf([users, taken, twice])).toEqual([
                { table: "taken", key: "author", message: expect.stringContaining("derives the foreign-key column \"author_id\", served as \"authorId\", and the column \"authorId\" already has that key") },
                { table: "twice", key: "writer", message: expect.stringContaining("derives the foreign-key column \"author_id\", served as \"authorId\", and the foreign key of relation \"author\" already has that key") }
            ]);
        });

        it("refuses two belongsTo relations on one bound column", () => {
            const users = table("users");
            const t = rawTable("t", {
                columns: { id: id(), authorId: col.uuid() },
                relations: { author: rel.belongsTo(() => users), writer: rel.belongsTo(() => users, { localKey: "author_id" }) },
                rls: "admin-only"
            });
            expect(problemsOf([users, t])).toEqual([{
                table: "t", key: "writer", message: expect.stringContaining("the relations \"author\" and \"writer\" both use the column \"author_id\"")
            }]);
        });

        it("refuses one-column links into a composite key", () => {
            const pair = table("pair", { a: col.uuid().primaryKey(), b: col.uuid().primaryKey() });
            const single = table("single");
            const into = rawTable("into", { columns: { id: id() }, relations: { pair: rel.belongsTo(() => pair) }, rls: "admin-only" });
            const out = rawTable("out", {
                columns: { a: col.uuid().primaryKey(), b: col.uuid().primaryKey() },
                relations: {
                    singles: rel.hasMany(() => single),
                    keyed: rel.hasMany(() => single, { sourceKey: "a" }),
                    links: rel.manyToMany(() => single)
                },
                rls: "admin-only"
            });
            expect(problemsOf([pair, single, into, out])).toEqual([
                { table: "into", key: "pair", message: expect.stringContaining("`localKey: \"pair_id\"` is one column, and `pair` is keyed on 2 columns together") },
                { table: "out", key: "singles", message: expect.stringContaining("Give the relation a `sourceKey`") },
                { table: "out", key: "links", message: expect.stringContaining("A junction column is one column, and `out` is keyed on 2 columns together") }
            ]);
        });

        it("refuses two many-to-many relations claiming one junction with different keys", () => {
            const posts: AnyTableDef = rawTable("posts", {
                columns: { id: id() },
                relations: { tags: rel.manyToMany(() => back), featuredTags: rel.manyToMany(() => back) },
                rls: "admin-only"
            });
            // The other side of `posts.tags` names the same two columns: one junction, legitimately.
            const back: AnyTableDef = rawTable("tags", {
                columns: { id: id() },
                relations: { posts: rel.manyToMany(() => posts) },
                rls: "admin-only"
            });
            const problems = problemsOf([posts, back]);
            expect(problems).toEqual([{
                table: "posts", key: "featuredTags",
                message: expect.stringContaining("two many-to-many relations resolve to the junction table \"posts_tags\" with different key columns")
            }]);
        });
    });

    describe("columns", () => {
        it("refuses modifiers that contradict each other or do not fit the column", () => {
            const t = table("t", {
                id: id(),
                generatedDefault: rawColumn({ type: { kind: "integer" }, generatedAs: "1", default: { kind: "literal", value: 2 } }),
                generatedStamp: rawColumn({ type: { kind: "timestamptz" }, generatedAs: "now()", stamp: { on: "create", value: "now" } }),
                identityText: rawColumn({ type: { kind: "text" }, default: { kind: "identity" } }),
                randomText: rawColumn({ type: { kind: "text" }, default: { kind: "random-uuid" } }),
                nowText: rawColumn({ type: { kind: "text" }, stamp: { on: "update", value: "now" } }),
                userNumber: rawColumn({ type: { kind: "integer" }, stamp: { on: "create", value: "user" } }),
                oneOfBool: rawColumn({ type: { kind: "boolean" }, oneOf: [1] }),
                oneOfEmpty: rawColumn({ type: { kind: "text" }, oneOf: [] }),
                elementEmpty: rawColumn({ type: { kind: "array", of: { kind: "text" } }, element: { ...col.text().def, oneOf: [] } })
            });
            expect(problemsOf([t])).toEqual([
                { table: "t", key: "generatedDefault", message: expect.stringContaining("`.generatedAs()` and a default contradict each other") },
                { table: "t", key: "generatedStamp", message: expect.stringContaining("`.generatedAs()` and a stamp") },
                { table: "t", key: "identityText", message: expect.stringContaining("`.identity()` needs a `smallint`, `integer` or `bigint` column, and this one is `text`") },
                { table: "t", key: "randomText", message: expect.stringContaining("`.defaultRandom()` writes `gen_random_uuid()`, which needs a `uuid` column") },
                { table: "t", key: "nowText", message: expect.stringContaining("`.onUpdateNow()` stamps the current time") },
                { table: "t", key: "userNumber", message: expect.stringContaining("`.onCreateUser()` stores the caller's id, which needs a text or `uuid` column, and this one is `integer`") },
                { table: "t", key: "oneOfBool", message: expect.stringContaining("`.oneOf()` takes a text or numeric column, and this one is `boolean`") },
                { table: "t", key: "oneOfEmpty", message: expect.stringContaining("`.oneOf([])` accepts no value at all") },
                { table: "t", key: "elementEmpty", message: expect.stringContaining("the array's items take `.oneOf([])`") }
            ]);
        });

        it("refuses an array item's column-only modifiers, and keeps the item rules", () => {
            const t = table("t", {
                id: id(),
                items: col.array(col.text().notNull().default("x").access({ read: ["a"] })),
                fine: col.text({ enum: ["a", "b"] }).validate({ max: 3 }).describe("an item").array()
            });
            expect(problemsOf([t])).toEqual([{
                table: "t",
                key: "items",
                message: expect.stringContaining("the array's items declare `.notNull()`, a default, `.access()`, which apply to a column, not to the items of one")
            }]);
        });

        it("refuses a private primary key and an instant as a key", () => {
            const t = table("t", { id: rawColumn({ type: { kind: "uuid" }, primaryKey: true, notNull: true, private: true }) });
            expect(problemsOf([t])).toEqual([{ table: "t", key: "id", message: expect.stringContaining("a primary-key column cannot be `.private()`") }]);
            const at = table("at", { at: col.timestamp({ withTimezone: true }).primaryKey() });
            expect(problemsOf([at])).toEqual([{ table: "at", key: "at", message: expect.stringContaining("a `timestamptz` column cannot be part of the key") }]);
            expect(problemsOf([table("day", { day: col.date().primaryKey() })])).toEqual([]);
        });

        it("refuses an enum with no values, a repeated or blank value, and a default outside it", () => {
            const t = table("t", {
                id: id(),
                none: rawColumn({ type: { kind: "enum", values: [] } }),
                twice: rawColumn({ type: { kind: "enum", values: ["a", "a"] } }),
                blank: rawColumn({ type: { kind: "enum", values: [""] } }),
                outside: rawColumn({ type: { kind: "enum", values: ["a"] }, default: { kind: "literal", value: "b" } }),
                items: rawColumn({ type: { kind: "array", of: { kind: "enum", values: ["x", "x"] } } })
            });
            expect(problemsOf([t])).toEqual([
                { table: "t", key: "none", message: expect.stringContaining("the enum lists no values") },
                { table: "t", key: "twice", message: expect.stringContaining("the enum lists \"a\" twice") },
                { table: "t", key: "blank", message: expect.stringContaining("the enum has a blank value") },
                { table: "t", key: "outside", message: expect.stringContaining("the default \"b\" is not one of the enum's values (a)") },
                { table: "t", key: "items", message: expect.stringContaining("the enum lists \"x\" twice") }
            ]);
            expect(() => col.enum(JSON.parse("[]"))).toThrow(/at least one value/);
        });

        it("refuses sizes a builder would have refused", () => {
            const t = table("t", {
                id: id(),
                v: rawColumn({ type: { kind: "varchar", length: 0 } }),
                d: rawColumn({ type: { kind: "vector", dimensions: 1.5 } }),
                n: rawColumn({ type: { kind: "numeric", scale: 2 } }),
                nested: rawColumn({ type: { kind: "array", of: { kind: "array", of: { kind: "text" } } } })
            });
            expect(problemsOf([t]).map(p => p.key)).toEqual(["v", "d", "n", "nested"]);
        });

        it("refuses a contradiction in a pivot column too", () => {
            const tags = table("tags");
            const posts = rawTable("posts", {
                columns: { id: id() },
                relations: { tags: rel.manyToMany(() => tags, { pivot: { rank: rawColumn({ type: { kind: "text" }, default: { kind: "identity" } }) } }) },
                rls: "admin-only"
            });
            expect(problemsOf([tags, posts])).toEqual([{
                table: "posts", key: "tags.pivot.rank", message: expect.stringContaining("`.identity()` needs")
            }]);
        });
    });

    describe("views", () => {
        it("refuses a view with no query, roles on a plain view, indexes on a plain view, no key, and table-only options", () => {
            const v = rawView("v", {
                query: " ",
                roles: ["admin"],
                columns: { id: col.uuid() },
                indexes: [{ columns: ["id"] }]
            });
            const withTenant = rawView("w", { query: "select 1", columns: { id: id() } });
            Object.assign(withTenant.config, { tenant: { field: "id", from: { claim: "x" } } });
            expect(problemsOf([v, withTenant])).toEqual([
                { table: "v", message: expect.stringContaining("the view has no primary key") },
                { table: "v", message: expect.stringContaining("only a materialized view stores rows to index") },
                { table: "v", message: expect.stringContaining("the view needs a `query`") },
                { table: "v", message: expect.stringContaining("the view lists `roles` but is not materialized") },
                { table: "w", message: expect.stringContaining("`tenant` cannot be declared on a view") }
            ]);
            expect(() => defineView("v", { query: "", columns: { id: id() } })).toThrow(/needs a `query`/);
            expect(() => defineView("v", { query: "select 1", roles: ["admin"], columns: { id: id() } })).toThrow(/not materialized/);
        });
    });
});

describe("compileTables — uniqueBy", () => {
    it("accepts it on a JSON array of objects, on the shape or on the column, naming the items' fields", () => {
        expect(problemsOf([table("t", {
            id: id(),
            lines: col.jsonb(json.array(json.object({ sku: json.string(), qty: json.number() })).validate({ uniqueBy: ["sku"] })),
            rows: rawColumn({ type: { kind: "jsonb" }, json: { kind: "array", of: { kind: "object", fields: { code: { kind: "string" } } } }, validate: { uniqueBy: ["code"] } })
        })])).toEqual([]);
    });

    it("refuses it where nothing can check it, naming the column and what to write", () => {
        const problems = problemsOf([table("t", {
            id: id(),
            missing: col.jsonb(json.array(json.object({ sku: json.string() })).validate({ uniqueBy: ["ean"] })),
            scalars: col.jsonb(json.array(json.string()).validate({ uniqueBy: ["x"] })),
            empty: col.jsonb(json.array(json.object({ sku: json.string() })).validate({ uniqueBy: [] })),
            pgArray: col.text().array().validate({ uniqueBy: ["x"] }),
            nested: col.jsonb(json.object({ inner: json.array(json.object({ a: json.string() })).validate({ uniqueBy: ["b"] }) }))
        })]);
        expect(problems.map(problem => [problem.key, problem.message])).toEqual([
            ["missing", expect.stringContaining("naming \"ean\", which the items do not have (they have \"sku\")")],
            ["scalars", expect.stringContaining("its items are JSON string values, not objects. For plain values, use `uniqueItems: true`")],
            ["empty", expect.stringContaining("`uniqueBy: []`, which compares nothing")],
            ["pgArray", expect.stringContaining("this column is not one")],
            ["nested", expect.stringContaining("\"inner\" declares `uniqueBy` naming \"b\"")]
        ]);
    });
});
