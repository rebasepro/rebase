import { pgTable, primaryKey, text, integer } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import type { ColumnDescriptor, JoinStep, RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { compileDescribedTables } from "@rebasepro/common";

import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { findRelationDefects, assertRelationsResolve } from "../src/model/validate-relations";

/**
 * Compiling settles what a relation may *say*, and that its names agree with
 * the declaration of both tables. This settles whether what it says is true of
 * the database the driver is connected to.
 *
 * Each case here used to boot fine and then answer `[]` at query time, which is
 * the same answer a correctly-configured relation gives for a parent with no
 * children — so there was no way to tell a broken relation from an empty one.
 *
 * The tables are written as descriptors, the way a declaration compiles: the
 * point of each case is a database that disagrees with one.
 *
 * (A relation whose target is outside the tables handed over is no longer a
 * case: compiling refuses a target that is not among the tables compiled.)
 */

// ── The database ─────────────────────────────────────────────────────────

const posts = pgTable("posts", { id: text("id").primaryKey(), author_id: text("author_id") });
const users = pgTable("users", { id: text("id").primaryKey() });
const tags = pgTable("tags", { id: text("id").primaryKey() });
const comments = pgTable("comments", { id: text("id").primaryKey(), post_id: text("post_id") });
const posts_tags = pgTable("posts_tags", { post_id: text("post_id"), tag_id: text("tag_id") });
const user_roles = pgTable("user_roles", { user_id: text("user_id"), role_id: integer("role_id") });
const roles = pgTable("roles", { id: integer("id").primaryKey() });

// ── The declarations ─────────────────────────────────────────────────────

const column = (key: string, sqlName = key, kind: "text" | "integer" = "text"): ColumnDescriptor =>
    ({ key, column: sqlName, type: { kind }, nullable: true });

const table = (
    slug: string,
    options: { keys?: ColumnDescriptor[]; columns?: ColumnDescriptor[]; relations?: RelationDescriptor[] } = {}
): TableDescriptor => {
    const keys = (options.keys ?? [column("id")]).map(key => ({ ...key, nullable: false, primaryKey: true as const }));
    return {
        name: slug, slug, table: slug, schema: "public", kind: "table",
        columns: [...keys, ...(options.columns ?? [])],
        primaryKey: keys.map(key => key.key),
        relations: options.relations ?? [],
        rls: { posture: "admin-only", rules: [], defaultPolicies: true }
    };
};

const belongsTo = (name: string, target: string, localKey: string): RelationDescriptor =>
    ({ name, kind: "belongsTo", target, cardinality: "one", localKey, localField: localKey, index: true, constraint: true });
const hasMany = (name: string, target: string, foreignKey: string, sourceKey?: string): RelationDescriptor =>
    ({ name, kind: "hasMany", target, cardinality: "many", foreignKey, ...(sourceKey ? { sourceKey } : {}) });
const manyToMany = (name: string, target: string, through: string, sourceKey: string, targetKey: string): RelationDescriptor =>
    ({ name, kind: "manyToMany", target, cardinality: "many", through: { table: through, sourceKey, targetKey, pivot: [] } });
const via = (name: string, target: string, steps: JoinStep[], cardinality: "one" | "many" = "many"): RelationDescriptor =>
    ({ name, kind: "via", target, cardinality, steps, writable: false });

/** A registry serving these tables over these catalogue tables. */
function registryWith(descriptors: TableDescriptor[], pgTables: Record<string, PgTable>): PostgresTableRegistry {
    const registry = new PostgresTableRegistry();
    registry.registerTables(compileDescribedTables(descriptors, { rls: () => "admin-only" }));
    for (const [name, pg] of Object.entries(pgTables)) registry.registerPgTable(pg, name);
    return registry;
}

const SCHEMA = { posts, users, tags, comments, posts_tags, user_roles, roles };
const others = [table("users"), table("tags"), table("comments", { columns: [column("postId", "post_id")] }), table("roles", { keys: [column("id", "id", "integer")] })];

/** The defects found for a `posts` table carrying these relations. */
function defectsFor(relations: RelationDescriptor[]): ReturnType<typeof findRelationDefects> {
    const postsTable = table("posts", { columns: [column("authorId", "author_id")], relations });
    return findRelationDefects(registryWith([postsTable, ...others], SCHEMA));
}

describe("relation validation at boot", () => {
    describe("accepts what is actually there", () => {
        it("passes every kind when all the names resolve", () => {
            expect(defectsFor([
                belongsTo("author", "users", "author_id"),
                hasMany("comments", "comments", "post_id"),
                manyToMany("tags", "tags", "posts_tags", "post_id", "tag_id"),
                // A link on a natural key: `author_id` is on `posts`.
                hasMany("sibling_comments", "comments", "post_id", "author_id")
            ])).toEqual([]);
        });

        it("stays quiet about a target this driver does not serve", () => {
            expect(defectsFor([belongsTo("x", "elsewhere", "author_id")])).toEqual([]);
        });

        it("skips a table this database does not hold", () => {
            const registry = registryWith([table("posts", { relations: [belongsTo("author", "users", "writer_id")] }), table("users")], { users });
            expect(findRelationDefects(registry)).toEqual([]);
        });
    });

    describe("catches names the database does not have", () => {
        it("a belongsTo pointing at a column that does not exist", () => {
            const [d] = defectsFor([belongsTo("author", "users", "writer_id")]);
            expect(d).toMatchObject({ table: "posts", relationName: "author", kind: "belongsTo" });
            expect(d.problem).toContain("`localKey: \"writer_id\"` is not a column on `posts`");
            expect(d.fix).toContain("`author_id`");
        });

        it("a hasMany whose foreign key is not on the target", () => {
            const [d] = defectsFor([hasMany("comments", "comments", "article_id")]);
            expect(d.problem).toBe("`foreignKey: \"article_id\"` is not a column on the target table `comments`");
            expect(d.fix).toContain("set `foreignKey` to one of:");
            expect(d.fix).toContain("`post_id`");
        });

        it("a sourceKey that names a column on the target instead of the source", () => {
            // The likeliest way to get `sourceKey` wrong, because it sits next
            // to `foreignKey` and every other column in the block lives on the
            // target.
            const [d] = defectsFor([hasMany("comments", "comments", "post_id", "post_id")]);
            expect(d.problem).toContain("`sourceKey: \"post_id\"` is not a column on `posts`");
            expect(d.fix).toContain("it is a column on the *target* table `comments`");
            expect(d.fix).toContain("the column of this table that the target's foreign key points at");
        });

        it("a sourceKey that exists nowhere", () => {
            const [d] = defectsFor([hasMany("comments", "comments", "post_id", "auth_user_id")]);
            expect(d.problem).toContain("`sourceKey: \"auth_user_id\"` is not a column on `posts`");
            expect(d.fix).toContain("add the column");
        });

        it("the junction-name footgun: a derived table that was never created", () => {
            const [d] = defectsFor([manyToMany("categories", "roles", "posts_roles", "post_id", "role_id")]);
            expect(d.problem).toBe("its junction table `posts_roles` does not exist");
            expect(d.fix).toContain("name the real one with `through: \"...\"`");
            expect(d.fix).toContain("derived from the two table names sorted");
        });

        it("a junction column that is not on the junction table", () => {
            const found = defectsFor([manyToMany("tags", "tags", "posts_tags", "article_id", "tag_id")]);
            expect(found).toHaveLength(1);
            expect(found[0].problem).toBe("`sourceKey: \"article_id\"` is not a column on the junction table `posts_tags`");
            expect(found[0].fix).toContain("naming *this* table");
        });

        it("a target whose table this database does not hold", () => {
            const registry = registryWith([table("posts", { columns: [column("authorId", "author_id")], relations: [belongsTo("author", "users", "author_id")] }), table("users")], { posts });
            const [d] = findRelationDefects(registry);
            expect(d.problem).toBe("it points at table `users`, which has no table `users` in this database");
            expect(d.fix).toContain("apply the schema to this database");
        });
    });

    describe("walks a via chain and says which hop is wrong", () => {
        const toRoles: JoinStep = { table: "roles", on: { from: "role_id", to: "id" } };
        const viaRoles = (steps: JoinStep[]) => defectsFor([via("roles", "roles", steps)]);

        it("accepts a chain that connects", () => {
            expect(viaRoles([{ table: "user_roles", on: { from: "author_id", to: "user_id" } }, toRoles])).toEqual([]);
        });

        it("names the step whose table does not exist", () => {
            const [d] = viaRoles([{ table: "account_roles", on: { from: "author_id", to: "user_id" } }]);
            expect(d.problem).toContain("step 1 of its `steps` joins `account_roles`, which is not a table");
            expect(d.fix).toBe("correct `steps[0].table`");
        });

        it("catches a `from` column that is not on the previous table", () => {
            const [d] = viaRoles([{ table: "user_roles", on: { from: "owner_id", to: "user_id" } }, toRoles]);
            expect(d.problem).toContain("step 1 joins `posts.owner_id`");
            expect(d.fix).toContain("names columns on this table:");
        });

        it("catches a `from` column that is not on the *previous step's* table", () => {
            const [d] = viaRoles([{ table: "user_roles", on: { from: "author_id", to: "user_id" } }, { table: "roles", on: { from: "group_id", to: "id" } }]);
            expect(d.problem).toContain("step 2 joins `user_roles.group_id`");
            expect(d.fix).toContain("the previous step's table (`user_roles`)");
        });

        it("catches a chain that ends somewhere other than the target", () => {
            const [d] = viaRoles([{ table: "user_roles", on: { from: "author_id", to: "user_id" } }]);
            expect(d.problem).toBe("its `steps` end at `user_roles`, but it targets `roles` (table `roles`)");
            expect(d.fix).toContain("point the relation at the table backed by `user_roles`");
        });

        it("catches a composite join comparing unequal numbers of columns", () => {
            const found = viaRoles([{ table: "user_roles", on: { from: ["author_id", "id"], to: "user_id" } }, toRoles]);
            expect(found.some(d => d.problem.includes("compares 2 column(s) against 1"))).toBe(true);
        });

        it("rejects empty steps rather than joining nothing", () => {
            // No door produces this (compiling refuses it); a runtime table
            // built from a descriptor that says it still answers with a defect.
            const [postsCompiled, ...rest] = compileDescribedTables(
                [table("posts", { columns: [column("authorId", "author_id")], relations: [via("roles", "roles", [toRoles])] }), ...others],
                { rls: () => "admin-only" }
            );
            const registry = new PostgresTableRegistry();
            registry.registerTables([
                { ...postsCompiled, descriptor: { ...postsCompiled.descriptor, relations: [via("roles", "roles", [])] } },
                ...rest
            ]);
            for (const [name, pg] of Object.entries(SCHEMA)) registry.registerPgTable(pg, name);
            const [d] = findRelationDefects(registry);
            expect(d.problem).toBe("its `steps` are empty, so it joins nothing");
        });

        describe("a step whose `on` lists alternatives", () => {
            it("accepts alternatives that each connect the same two tables", () => {
                expect(viaRoles([{ table: "user_roles", on: [{ from: "author_id", to: "user_id" }, { from: "id", to: "user_id" }] }, toRoles])).toEqual([]);
            });

            it("names the alternative whose `from` column is not on the previous table", () => {
                const [d] = viaRoles([{ table: "user_roles", on: [{ from: "author_id", to: "user_id" }, { from: "owner_id", to: "user_id" }] }, toRoles]);
                expect(d.problem).toContain("step 1 (alternative 2) joins `posts.owner_id`");
                expect(d.fix).toContain("`steps[0].on[1].from`");
            });

            it("names the alternative whose `to` column is not on the step's table", () => {
                const [d] = viaRoles([{ table: "user_roles", on: [{ from: "author_id", to: "account_id" }, { from: "id", to: "user_id" }] }, toRoles]);
                expect(d.problem).toContain("step 1 (alternative 1) joins into `user_roles.account_id`");
                expect(d.fix).toContain("`steps[0].on[0].to`");
            });

            it("names the alternative comparing unequal numbers of columns", () => {
                const found = viaRoles([{ table: "user_roles", on: [{ from: "author_id", to: "user_id" }, { from: ["author_id", "id"], to: "user_id" }] }, toRoles]);
                const d = found.find(x => x.problem.includes("compares 2 column(s) against 1"));
                expect(d?.problem).toContain("step 1 (alternative 2)");
                expect(d?.fix).toContain("`steps[0].on[1]`");
            });

            it("rejects an empty list, which would join on nothing", () => {
                const found = viaRoles([{ table: "user_roles", on: [] }, toRoles]);
                expect(found).toHaveLength(1);
                expect(found[0].problem).toContain("`steps[0].on` lists no conditions");
                expect(found[0].fix).toContain("at least one `{ from, to }`");
            });

            it("rejects alternatives that name different tables", () => {
                const found = viaRoles([{ table: "user_roles", on: [{ from: "author_id", to: "user_id" }, { from: "users.id", to: "user_id" }] }, toRoles]);
                const d = found.find(x => x.problem.includes("join different tables"));
                expect(d?.problem).toContain("alternative 1 joins `posts` → `user_roles`");
                expect(d?.problem).toContain("alternative 2 joins `users` → `user_roles`");
                expect(d?.fix).toContain("every entry of `steps[0].on` joins `posts` to `user_roles`");
            });

            it("says nothing of tables when a spelling names the tables the step joins anyway", () => {
                const found = viaRoles([{ table: "user_roles", on: [{ from: "author_id", to: "user_id" }, { from: "posts.id", to: "user_roles.user_id" }] }, toRoles]);
                expect(found.some(x => x.problem.includes("join different tables"))).toBe(false);
            });
        });
    });

    describe("assertRelationsResolve", () => {
        it("says nothing when everything resolves", () => {
            expect(() => assertRelationsResolve(registryWith([table("posts"), table("users")], SCHEMA))).not.toThrow();
        });

        it("reports every defect at once, each with its fix", () => {
            const registry = registryWith([
                table("posts", { relations: [belongsTo("author", "users", "writer_id"), hasMany("comments", "comments", "article_id")] }),
                ...others
            ], SCHEMA);
            let message = "";
            try {
                assertRelationsResolve(registry);
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }
            expect(message).toContain("2 relations cannot resolve");
            // Both, not just the first — one boot, one full list.
            expect(message).toContain("posts.author (belongsTo)");
            expect(message).toContain("posts.comments (hasMany)");
            expect(message).toContain("fix:");
            // Says why it is fatal rather than a warning.
            expect(message).toContain("return no rows at query time");
            expect(message).toContain("the table definition is what disagrees with the database");
        });
    });

    /**
     * A composite key is a key like any other — to read, write and address. A
     * link into one is not: every kind but `via` holds one column, and a lookup
     * on one column of `(id, locale)` matches every locale of that id. Compiling
     * refuses such a link in a declared table; an introspected one is checked here.
     */
    describe("a single-column link into a composite key", () => {
        const companies = pgTable("companies", { id: integer("id").primaryKey() });
        const translations = pgTable("company_translation", {
            id: integer("id").notNull(),
            locale: text("locale").notNull(),
            summary_id: integer("summary_id")
        }, t => [primaryKey({ columns: [t.id, t.locale] })]);
        const reviews = pgTable("reviews", { id: integer("id").primaryKey(), translation_id: integer("translation_id"), translation_locale: text("translation_locale") });
        const reviewsTranslations = pgTable("reviews_translations", { review_id: integer("review_id"), translation_id: integer("translation_id") });
        const catalogue = { companies, company_translation: translations, reviews, reviews_translations: reviewsTranslations };

        const companiesTable = table("companies", { keys: [column("id", "id", "integer")] });
        const translationsTable = (relations: RelationDescriptor[] = []) => table("company_translation", {
            keys: [column("id", "id", "integer"), column("locale")],
            columns: [column("summaryId", "summary_id", "integer")],
            relations
        });
        const reviewsTable = (relations: RelationDescriptor[] = []) => table("reviews", {
            keys: [column("id", "id", "integer")],
            columns: [column("translationId", "translation_id", "integer"), column("translationLocale", "translation_locale")],
            relations
        });
        const defectsWith = (descriptors: TableDescriptor[]) => findRelationDefects(registryWith(descriptors, catalogue));

        it("accepts a link *from* a composite-keyed table to a single-column key", () => {
            expect(defectsWith([translationsTable([belongsTo("company", "companies", "id")]), companiesTable])).toEqual([]);
        });

        it("refuses a belongsTo into it, naming the key", () => {
            const [defect] = defectsWith([reviewsTable([belongsTo("translation", "company_translation", "translation_id")]), translationsTable()]);
            expect(defect).toMatchObject({ table: "reviews", relationName: "translation", kind: "belongsTo" });
            expect(defect.problem).toBe(
                "`localKey: \"translation_id\"` is one column, and `company_translation` is keyed on `id`, `locale` " +
                "together — one column cannot reference a composite key"
            );
            expect(defect.fix).toContain("`rel.via(...)`");
        });

        it("refuses a hasMany out of it, unless a `sourceKey` names the one column it points at", () => {
            const [defect] = defectsWith([translationsTable([hasMany("summaries", "reviews", "translation_id")]), reviewsTable()]);
            expect(defect.problem).toContain("`foreignKey: \"translation_id\"` is one column");
            expect(defect.fix).toContain("`sourceKey`");
            expect(defectsWith([translationsTable([hasMany("summaries", "reviews", "translation_id", "summary_id")]), reviewsTable()])).toEqual([]);
        });

        it("refuses a manyToMany whose junction column would point at it", () => {
            const [defect] = defectsWith([
                reviewsTable([manyToMany("translations", "company_translation", "reviews_translations", "review_id", "translation_id")]),
                translationsTable()
            ]);
            expect(defect.problem).toContain("`targetKey: \"translation_id\"` is one column");
        });

        it("accepts a `via` into it, whose steps compare every key column", () => {
            expect(defectsWith([
                reviewsTable([via("translation", "company_translation", [{
                    table: "company_translation",
                    on: { from: ["translation_id", "translation_locale"], to: ["id", "locale"] }
                }], "one")]),
                translationsTable()
            ])).toEqual([]);
        });
    });
});
